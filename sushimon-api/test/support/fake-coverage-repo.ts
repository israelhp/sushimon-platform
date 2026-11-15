import { randomUUID } from 'node:crypto';
import type { OwnCandidate } from '../../src/delivery-coverage/coverage-policy.js';
import {
  DEFAULT_DELIVERY_SETTINGS,
  type DeliverySettingsValues,
} from '../../src/delivery-coverage/coverage.types.js';
import type {
  CoverageContext,
  CoverageTx,
  NewZoneData,
  SettingsRecord,
  ZoneListFilter,
  ZonePatchData,
  ZoneRecord,
} from '../../src/delivery-coverage/delivery-coverage.repository.js';

export interface CoverageAuditRecord {
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  branchId: string | null;
  reason?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

export const DEPT_GT = 'd0000000-0000-4000-8000-000000000001';
export const DEPT_SM = 'd0000000-0000-4000-8000-000000000002';
export const MUN_MIXCO = 'e0000000-0000-4000-8000-000000000001';
export const MUN_VN = 'e0000000-0000-4000-8000-000000000002';
export const MUN_MISSING = 'e0000000-0000-4000-8000-0000000000ff';

/**
 * Doble en memoria de `DeliveryCoverageRepository` (misma superficie pública). `transaction` serializa y hace
 * rollback de zonas, settings y auditoría si el callback lanza. Reproduce el UNIQUE `(branch, municipality, key)`
 * (error `23505` al insertar un duplicado) y el UPDATE optimista por `version`. El SQL real se cubre en
 * `test/delivery-coverage.int-spec.ts`.
 */
export class FakeCoverageRepo {
  branches = new Map<string, { id: string; active: boolean }>();
  municipalities = new Map<
    string,
    { id: string; name: string; departmentId: string; departmentName: string }
  >([
    [
      MUN_MIXCO,
      { id: MUN_MIXCO, name: 'Mixco', departmentId: DEPT_GT, departmentName: 'Guatemala' },
    ],
    [
      MUN_VN,
      { id: MUN_VN, name: 'Villa Nueva', departmentId: DEPT_GT, departmentName: 'Guatemala' },
    ],
  ]);
  zones = new Map<string, ZoneRecord>();
  settings = new Map<string, SettingsRecord>();
  audit: CoverageAuditRecord[] = [];
  queries = { context: 0, candidates: 0, settings: 0 };
  /** Ejecutado justo antes de insertar (para provocar una carrera de duplicados tras el precheck). */
  beforeInsert: (() => void) | null = null;
  failNextWriteWith: unknown = null;

  addBranch(id: string, active = true): this {
    this.branches.set(id, { id, active });
    return this;
  }

  addZone(over: Partial<ZoneRecord> & { branchId: string; municipalityId: string }): ZoneRecord {
    const mun = this.municipalities.get(over.municipalityId);
    const now = new Date('2026-11-14T12:00:00.000Z');
    const zone: ZoneRecord = {
      id: randomUUID(),
      municipalityName: mun?.name ?? '?',
      departmentId: mun?.departmentId ?? DEPT_GT,
      departmentName: mun?.departmentName ?? '?',
      zoneLabel: null,
      zoneKey: '',
      baseFee: '15.00',
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...over,
    };
    this.zones.set(zone.id, zone);
    return zone;
  }

  private externalCommits: ZoneRecord[] = [];

  /** Zona confirmada por OTRA transacción mientras la actual corre: sobrevive al rollback de esta. */
  commitConcurrently(
    over: Partial<ZoneRecord> & { branchId: string; municipalityId: string },
  ): ZoneRecord {
    const zone = this.addZone(over);
    this.externalCommits.push(zone);
    return zone;
  }

  setSettings(branchId: string, values: Partial<DeliverySettingsValues>): this {
    this.settings.set(branchId, {
      ...DEFAULT_DELIVERY_SETTINGS,
      ...values,
      updatedAt: new Date('2026-11-14T12:00:00.000Z'),
    });
    return this;
  }

  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(fn: (tx: CoverageTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.runTransaction(fn));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runTransaction<T>(fn: (tx: CoverageTx) => Promise<T>): Promise<T> {
    const snapshot = {
      zones: new Map([...this.zones].map(([k, v]) => [k, { ...v }])),
      settings: new Map([...this.settings].map(([k, v]) => [k, { ...v }])),
      audit: [...this.audit],
    };
    const tx = {
      auditEvent: {
        create: ({ data }: { data: CoverageAuditRecord }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as CoverageTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.zones = snapshot.zones;
      this.settings = snapshot.settings;
      this.audit = snapshot.audit;
      for (const z of this.externalCommits) this.zones.set(z.id, z);
      this.externalCommits = [];
      throw error;
    }
  }

  private throwIfFailing(): void {
    if (this.failNextWriteWith) {
      const e = this.failNextWriteWith;
      this.failNextWriteWith = null;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- simula cualquier error de BD
      throw e;
    }
  }

  findZone(id: string): Promise<ZoneRecord | null> {
    const z = this.zones.get(id);
    return Promise.resolve(z ? { ...z } : null);
  }

  findZoneByKey(branchId: string, municipalityId: string, zoneKey: string) {
    const z = [...this.zones.values()].find(
      (x) =>
        x.branchId === branchId && x.municipalityId === municipalityId && x.zoneKey === zoneKey,
    );
    return Promise.resolve(z ? { id: z.id } : null);
  }

  municipalityExists(id: string): Promise<boolean> {
    return Promise.resolve(this.municipalities.has(id));
  }

  listZones(f: ZoneListFilter): Promise<{ items: ZoneRecord[]; total: number }> {
    const mun = (z: ZoneRecord) => this.municipalities.get(z.municipalityId);
    let rows = [...this.zones.values()].filter((z) => {
      if (f.branchId !== null && z.branchId !== f.branchId) return false;
      if (f.branchId === null && f.scope !== null && !f.scope.includes(z.branchId)) return false;
      if (f.municipalityId && z.municipalityId !== f.municipalityId) return false;
      if (f.departmentId && mun(z)?.departmentId !== f.departmentId) return false;
      if (f.active !== undefined && z.active !== f.active) return false;
      if (f.keyContains && !z.zoneKey.includes(f.keyContains)) return false;
      return true;
    });
    const dir = f.order === 'asc' ? 1 : -1;
    const cmp = (a: ZoneRecord, b: ZoneRecord): number => {
      if (f.sort === 'baseFee') return (Number(a.baseFee) - Number(b.baseFee)) * dir;
      if (f.sort === 'createdAt') return (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
      return (
        (a.departmentName.localeCompare(b.departmentName) ||
          a.municipalityName.localeCompare(b.municipalityName) ||
          (a.zoneKey < b.zoneKey ? -1 : a.zoneKey > b.zoneKey ? 1 : 0)) * dir
      );
    };
    rows = rows.sort((a, b) => cmp(a, b) || (a.id < b.id ? -1 : 1));
    const total = rows.length;
    const start = (f.page - 1) * f.pageSize;
    return Promise.resolve({
      items: rows.slice(start, start + f.pageSize).map((z) => ({ ...z })),
      total,
    });
  }

  insertZone(_tx: CoverageTx, data: NewZoneData): Promise<ZoneRecord> {
    this.throwIfFailing();
    this.beforeInsert?.();
    const dup = [...this.zones.values()].find(
      (x) =>
        x.branchId === data.branchId &&
        x.municipalityId === data.municipalityId &&
        x.zoneKey === data.zoneKey,
    );
    if (dup) {
      return Promise.reject(
        Object.assign(new Error('unique'), {
          code: 'P2002',
          meta: { target: ['branch_id', 'municipality_id', 'zone_key'] },
        }),
      );
    }
    return Promise.resolve(this.addZone({ ...data }));
  }

  updateZone(
    _tx: CoverageTx,
    id: string,
    expectedVersion: number | null,
    patch: ZonePatchData,
  ): Promise<ZoneRecord | null> {
    this.throwIfFailing();
    const z = this.zones.get(id);
    if (!z || (expectedVersion !== null && z.version !== expectedVersion))
      return Promise.resolve(null);
    const clash = [...this.zones.values()].find(
      (x) =>
        x.id !== id &&
        x.branchId === z.branchId &&
        x.municipalityId === z.municipalityId &&
        x.zoneKey === (patch.zoneKey ?? z.zoneKey),
    );
    if (clash) {
      return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    }
    Object.assign(z, patch, {
      version: z.version + 1,
      updatedAt: new Date('2026-11-14T13:00:00.000Z'),
    });
    return Promise.resolve({ ...z });
  }

  findSettings(branchId: string): Promise<SettingsRecord | null> {
    this.queries.settings++;
    const s = this.settings.get(branchId);
    return Promise.resolve(s ? { ...s } : null);
  }

  upsertSettings(
    _tx: CoverageTx,
    branchId: string,
    patch: Partial<DeliverySettingsValues>,
  ): Promise<SettingsRecord> {
    this.throwIfFailing();
    const cur = this.settings.get(branchId) ?? {
      ...DEFAULT_DELIVERY_SETTINGS,
      updatedAt: new Date(0),
    };
    const next: SettingsRecord = {
      ownDeliveryZonesEnabled: patch.ownDeliveryZonesEnabled ?? cur.ownDeliveryZonesEnabled,
      pedidosyaEnabled: patch.pedidosyaEnabled ?? cur.pedidosyaEnabled,
      updatedAt: new Date('2026-11-14T13:00:00.000Z'),
    };
    this.settings.set(branchId, next);
    return Promise.resolve({ ...next });
  }

  loadCoverageContext(branchId: string, municipalityId: string): Promise<CoverageContext> {
    this.queries.context++;
    const s = this.settings.get(branchId);
    return Promise.resolve({
      branchActive: this.branches.get(branchId)?.active ?? null,
      municipalityExists: this.municipalities.has(municipalityId),
      settings: {
        ownDeliveryZonesEnabled:
          s?.ownDeliveryZonesEnabled ?? DEFAULT_DELIVERY_SETTINGS.ownDeliveryZonesEnabled,
        pedidosyaEnabled: s?.pedidosyaEnabled ?? DEFAULT_DELIVERY_SETTINGS.pedidosyaEnabled,
      },
    });
  }

  findOwnCandidates(
    branchId: string,
    municipalityId: string,
    keys: readonly string[],
  ): Promise<OwnCandidate[]> {
    this.queries.candidates++;
    return Promise.resolve(
      [...this.zones.values()]
        .filter(
          (z) =>
            z.branchId === branchId &&
            z.municipalityId === municipalityId &&
            z.active &&
            keys.includes(z.zoneKey),
        )
        .map((z) => ({ id: z.id, zoneKey: z.zoneKey, baseFee: z.baseFee })),
    );
  }
}
