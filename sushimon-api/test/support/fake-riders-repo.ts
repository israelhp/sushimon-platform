import { randomUUID } from 'node:crypto';
import type { AuditEventInput } from '../../src/audit/audit.service.js';
import { nameKeyOf } from '../../src/riders/rider-policy.js';
import {
  RIDER_ACTIVE_DELIVERIES_PORT,
  type RiderActiveDeliveriesPort,
  type RiderBusyQuery,
  type RiderBusyResult,
} from '../../src/riders/ports/rider-active-deliveries.port.js';
import { RidersRepository } from '../../src/riders/riders.repository.js';
import type {
  NewRiderData,
  RiderEligibilityRow,
  RiderListFilter,
  RiderPatchData,
  RiderRead,
  RiderRecord,
  RidersTx,
  TxClient,
} from '../../src/riders/riders.types.js';

export { RIDER_ACTIVE_DELIVERIES_PORT };

/** Doble del puerto de entregas activas: `known` y `busyIds` configurables; registra cada consulta. */
export class FakeBusyPort implements RiderActiveDeliveriesPort {
  known = false;
  busyIds = new Set<string>();
  queries: RiderBusyQuery[] = [];
  findBusy(query: RiderBusyQuery): Promise<RiderBusyResult> {
    this.queries.push(query);
    return Promise.resolve({ known: this.known, busyIds: new Set(this.busyIds) });
  }
}

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

/**
 * Repositorio de motoristas EN MEMORIA con la semántica observable del real (alcance, CAS por versión, único de teléfono,
 * sucursal activa, traslado => UNAVAILABLE, inactivo => UNAVAILABLE). Las transacciones son atómicas (restauran el estado si
 * algo falla, también la auditoría) y se serializan (el candado `FOR UPDATE` real se prueba en `riders.int-spec.ts`).
 */
export class FakeRidersRepo {
  riders = new Map<string, RiderRecord>();
  branches = new Map<string, { name: string; active: boolean }>();
  /** `branch_delivery_settings.own_delivery_zones_enabled` por sucursal (ausente = false). */
  ownDelivery = new Map<string, boolean>();
  audits: AuditEventInput[] = [];
  calls: string[] = [];
  failAudit = false;
  /** Error crudo que lanza la transacción (p. ej. `lock_timeout`). */
  failWith: unknown = null;
  private lock: Promise<void> = Promise.resolve();
  private tick = Date.parse('2026-11-18T19:00:00.000Z');

  asRepository = (): RidersRepository => this as unknown as RidersRepository;

  addBranch(name: string, active = true): string {
    const id = randomUUID();
    this.branches.set(id, { name, active });
    return id;
  }

  /** Siembra un motorista directamente (como una fila preexistente). */
  seed(over: Partial<RiderRecord> & { branchId: string }): RiderRecord {
    const when = new Date((this.tick += 1000));
    const rider: RiderRecord = {
      id: randomUUID(),
      branchName: this.branches.get(over.branchId)?.name ?? '?',
      fullName: 'Luis Pérez',
      phone: `+502${String(50000000 + this.riders.size)}`,
      vehicleType: 'MOTORCYCLE',
      licensePlate: null,
      active: true,
      availability: 'UNAVAILABLE',
      version: 1,
      createdAt: when,
      updatedAt: when,
      ...over,
    };
    this.riders.set(rider.id, rider);
    return rider;
  }

  private now = (): Date => new Date((this.tick += 1));
  private visible = (r: RiderRecord, scope: string[] | null): boolean =>
    scope === null || scope.includes(r.branchId);
  private phoneTaken = (phone: string, exceptId?: string): boolean =>
    [...this.riders.values()].some((r) => r.phone === phone && r.id !== exceptId);

  list = (f: RiderListFilter): Promise<{ rows: RiderRecord[]; total: number }> => {
    this.calls.push('list');
    if (f.scope !== null && f.scope.length === 0) return Promise.resolve({ rows: [], total: 0 });
    const busy = new Set(f.busyIds);
    let rows = [...this.riders.values()].filter(
      (r) =>
        this.visible(r, f.scope) &&
        (f.branchId === undefined || r.branchId === f.branchId) &&
        (f.active === undefined || r.active === f.active) &&
        (f.key === undefined || nameKeyOf(r.fullName).includes(f.key)) &&
        (f.availability !== 'UNAVAILABLE' || r.availability === 'UNAVAILABLE') &&
        (f.availability !== 'AVAILABLE' ||
          (r.active && r.availability === 'AVAILABLE' && !busy.has(r.id))) &&
        (f.availability !== 'BUSY' || (r.active && busy.has(r.id))),
    );
    const sign = f.order === 'desc' ? -1 : 1;
    const keyOf = (r: RiderRecord): string | number =>
      f.sort === 'fullName'
        ? nameKeyOf(r.fullName)
        : f.sort === 'createdAt'
          ? r.createdAt.getTime()
          : r.updatedAt.getTime();
    rows = rows.sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      const c = ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1;
      return c * sign;
    });
    const total = rows.length;
    const from = (f.page - 1) * f.pageSize;
    return Promise.resolve({ rows: rows.slice(from, from + f.pageSize), total });
  };

  findOne = (id: string, scope: string[] | null): Promise<RiderRecord | null> => {
    this.calls.push('findOne');
    const r = this.riders.get(id);
    return Promise.resolve(r && this.visible(r, scope) ? r : null);
  };

  findEligibilityRow = (
    riderId: string,
    orderBranchId: string,
  ): Promise<RiderEligibilityRow | null> => {
    this.calls.push('eligibility');
    const r = this.riders.get(riderId);
    return Promise.resolve(
      r
        ? {
            riderBranchId: r.branchId,
            active: r.active,
            availability: r.availability,
            ownDeliveryEnabled: this.ownDelivery.get(orderBranchId) ?? false,
          }
        : null,
    );
  };

  transaction = async <T>(fn: (tx: RidersTx) => Promise<T>): Promise<T> => {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    const snapshot = new Map([...this.riders].map(([k, v]) => [k, { ...v }]));
    const auditMark = this.audits.length;
    try {
      if (this.failWith) throw this.failWith as Error;
      return await fn(this.txOf());
    } catch (error) {
      this.riders = snapshot;
      this.audits.length = auditMark;
      throw error;
    } finally {
      release();
    }
  };

  private txOf(): RidersTx {
    const withBranch = (r: RiderRecord): RiderRecord => ({
      ...r,
      branchName: this.branches.get(r.branchId)?.name ?? '?',
    });
    return {
      client: {} as TxClient,
      read: (id, scope, opts) => {
        this.calls.push(opts?.lock ? 'read:lock' : 'read');
        const r = this.riders.get(id);
        if (!r || !this.visible(r, scope)) return Promise.resolve(null);
        const dest =
          opts?.destBranchId !== undefined
            ? (this.branches.get(opts.destBranchId)?.active ?? null)
            : null;
        return Promise.resolve({ rider: withBranch(r), destActive: dest } satisfies RiderRead);
      },
      insert: (data: NewRiderData) => {
        this.calls.push('insert');
        const b = this.branches.get(data.branchId);
        if (!b?.active) return Promise.resolve(null);
        if (this.phoneTaken(data.phone)) return Promise.reject(pgError('23505'));
        const when = this.now();
        const rider: RiderRecord = {
          id: randomUUID(),
          branchId: data.branchId,
          branchName: b.name,
          fullName: data.fullName,
          phone: data.phone,
          vehicleType: data.vehicleType,
          licensePlate: data.licensePlate,
          active: true,
          availability: 'UNAVAILABLE',
          version: 1,
          createdAt: when,
          updatedAt: when,
        };
        this.riders.set(rider.id, rider);
        return Promise.resolve(withBranch(rider));
      },
      update: (id, expectedVersion, origin, patch: RiderPatchData) => {
        this.calls.push('update');
        const r = this.riders.get(id);
        if (!r || r.version !== expectedVersion || r.branchId !== origin)
          return Promise.resolve(null);
        if (patch.phone !== undefined && this.phoneTaken(patch.phone, id)) {
          return Promise.reject(pgError('23505'));
        }
        if (patch.fullName !== undefined) r.fullName = patch.fullName;
        if (patch.phone !== undefined) r.phone = patch.phone;
        if (patch.vehicleType !== undefined) r.vehicleType = patch.vehicleType;
        if (patch.licensePlate !== undefined) r.licensePlate = patch.licensePlate;
        if (patch.branchId !== undefined) {
          r.branchId = patch.branchId;
          r.availability = 'UNAVAILABLE';
        }
        r.version += 1;
        r.updatedAt = this.now();
        return Promise.resolve(withBranch(r));
      },
      setActive: (id, branchId, active) => {
        this.calls.push('setActive');
        const r = this.riders.get(id);
        if (!r || r.branchId !== branchId || r.active === active) return Promise.resolve(null);
        r.active = active;
        if (!active) r.availability = 'UNAVAILABLE';
        r.version += 1;
        r.updatedAt = this.now();
        return Promise.resolve(withBranch(r));
      },
      setAvailability: (id, branchId, availability) => {
        this.calls.push('setAvailability');
        const r = this.riders.get(id);
        if (!r || r.branchId !== branchId || r.availability === availability) {
          return Promise.resolve(null);
        }
        if (availability === 'AVAILABLE' && !r.active) return Promise.resolve(null);
        r.availability = availability;
        r.version += 1;
        r.updatedAt = this.now();
        return Promise.resolve(withBranch(r));
      },
      audit: (event) => {
        this.calls.push('audit');
        if (this.failAudit) return Promise.reject(new Error('audit down'));
        this.audits.push(event);
        return Promise.resolve();
      },
    };
  }
}
