import { randomUUID } from 'node:crypto';
import type {
  ClosureListFilter,
  HourRow,
  ScheduleSnapshot,
  ScheduleTx,
} from '../../src/branch-schedule/branch-schedule.repository.js';
import type { ClosureRecord } from '../../src/branch-schedule/closure-policy.js';
import type { HoursDay } from '../../src/branch-schedule/schedule-policy.js';

export interface AuditRecord {
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  branchId: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

/**
 * Doble en memoria de `BranchScheduleRepository` (misma superficie pública). `transaction` hace rollback del
 * estado (y de la auditoría) si el callback lanza: permite probar atomicidad sin base de datos. El SQL real se
 * cubre en `test/branch-schedule.int-spec.ts`.
 */
export class FakeScheduleRepo {
  branches = new Map<string, { id: string; active: boolean }>();
  hours = new Map<string, HourRow[]>();
  closures: ClosureRecord[] = [];
  audit: AuditRecord[] = [];
  queries = { readHours: 0, loadSchedule: 0, lockBranch: 0 };
  /** Para simular un error de BD al escribir el horario o un cierre. */
  failNextWriteWith: unknown = null;
  /** Para probar carreras: se ejecuta tras tomar el candado, antes de seguir. */
  afterLock: (() => void) | null = null;

  addBranch(id: string, active = true): this {
    this.branches.set(id, { id, active });
    return this;
  }

  setHours(branchId: string, days: readonly HoursDay[]): this {
    this.hours.set(
      branchId,
      days.flatMap((d) =>
        d.intervals.map((iv) => ({
          weekday: d.weekday,
          opensAt: iv.opensAt,
          closesAt: iv.closesAt,
        })),
      ),
    );
    return this;
  }

  addClosure(branchId: string, startsAt: string, endsAt: string, reason: string | null = null) {
    const c: ClosureRecord = {
      id: randomUUID(),
      branchId,
      startsAt: Date.parse(startsAt),
      endsAt: Date.parse(endsAt),
      reason,
    };
    this.closures.push(c);
    return c;
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Serializa las transacciones (modela el `SELECT … FOR UPDATE` de la sucursal) y hace rollback si fallan. */
  transaction<T>(fn: (tx: ScheduleTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.runTransaction(fn));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runTransaction<T>(fn: (tx: ScheduleTx) => Promise<T>): Promise<T> {
    const snapshot = {
      hours: new Map([...this.hours].map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
      closures: this.closures.map((c) => ({ ...c })),
      audit: [...this.audit],
    };
    const tx = {
      auditEvent: {
        create: ({ data }: { data: AuditRecord }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as ScheduleTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.hours = snapshot.hours;
      this.closures = snapshot.closures;
      this.audit = snapshot.audit;
      throw error;
    }
  }

  lockBranch(_tx: ScheduleTx, id: string) {
    this.queries.lockBranch++;
    this.afterLock?.();
    return Promise.resolve(this.branches.get(id) ?? null);
  }

  readHours(branchId: string): Promise<HourRow[]> {
    this.queries.readHours++;
    return Promise.resolve((this.hours.get(branchId) ?? []).map((r) => ({ ...r })));
  }

  replaceHours(_tx: ScheduleTx, branchId: string, days: readonly HoursDay[]): Promise<void> {
    this.throwIfFailing();
    this.setHours(branchId, days);
    return Promise.resolve();
  }

  loadSchedule(
    branchIds: readonly string[],
    from: Date,
    to: Date,
    opts: { tx?: ScheduleTx; closureLimit?: number } = {},
  ): Promise<ScheduleSnapshot[]> {
    this.queries.loadSchedule++;
    return Promise.resolve(
      branchIds.flatMap((id) => {
        const branch = this.branches.get(id);
        if (!branch) return [];
        const closures = this.closures
          .filter(
            (c) => c.branchId === id && c.startsAt <= to.getTime() && c.endsAt > from.getTime(),
          )
          .sort((a, b) => a.startsAt - b.startsAt)
          .slice(0, opts.closureLimit ?? Infinity)
          .map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt }));
        return [
          {
            branchId: id,
            active: branch.active,
            hours: branch.active ? (this.hours.get(id) ?? []).map((r) => ({ ...r })) : [],
            closures: branch.active ? closures : [],
          },
        ];
      }),
    );
  }

  countOpenClosures(_tx: ScheduleTx, branchId: string, now: number): Promise<number> {
    return Promise.resolve(
      this.closures.filter((c) => c.branchId === branchId && c.endsAt > now).length,
    );
  }

  listClosures(f: ClosureListFilter) {
    const rows = this.closures
      .filter((c) => c.branchId === f.branchId)
      .filter((c) => {
        if (f.status === 'current') return c.endsAt > f.now;
        if (f.status === 'upcoming') return c.startsAt > f.now;
        if (f.status === 'active') return c.startsAt <= f.now && c.endsAt > f.now;
        if (f.status === 'past') return c.endsAt <= f.now;
        return true;
      })
      .filter((c) => (f.to === undefined ? true : c.startsAt < f.to))
      .filter((c) => (f.from === undefined ? true : c.endsAt > f.from));
    const dir = f.status === 'past' || f.status === 'all' ? -1 : 1;
    rows.sort((a, b) => dir * (a.startsAt - b.startsAt) || a.id.localeCompare(b.id));
    return Promise.resolve({
      items: rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize).map((c) => ({ ...c })),
      total: rows.length,
    });
  }

  findClosure(_tx: ScheduleTx, branchId: string, id: string) {
    const c = this.closures.find((x) => x.id === id && x.branchId === branchId);
    return Promise.resolve(c ? { ...c } : null);
  }

  findOverlap(
    _tx: ScheduleTx,
    branchId: string,
    startsAt: number,
    endsAt: number,
    excludeId?: string,
  ) {
    const c = this.closures
      .filter((x) => x.branchId === branchId && x.id !== excludeId)
      .filter((x) => x.startsAt < endsAt && x.endsAt > startsAt)
      .sort((a, b) => a.startsAt - b.startsAt)[0];
    return Promise.resolve(c?.id ?? null);
  }

  insertClosure(
    _tx: ScheduleTx,
    data: { branchId: string; startsAt: number; endsAt: number; reason: string | null },
  ) {
    this.throwIfFailing();
    const c: ClosureRecord = { id: randomUUID(), ...data };
    this.closures.push(c);
    return Promise.resolve({ ...c });
  }

  updateClosure(
    _tx: ScheduleTx,
    id: string,
    data: { startsAt: number; endsAt: number; reason: string | null },
  ) {
    this.throwIfFailing();
    const c = this.closures.find((x) => x.id === id) as ClosureRecord;
    Object.assign(c, data);
    return Promise.resolve({ ...c });
  }

  deleteClosure(_tx: ScheduleTx, id: string): Promise<void> {
    this.closures = this.closures.filter((c) => c.id !== id);
    return Promise.resolve();
  }

  private throwIfFailing(): void {
    if (this.failNextWriteWith) {
      const error = this.failNextWriteWith;
      this.failNextWriteWith = null;
      // Los errores de BD que se simulan son objetos con `code` (no necesariamente `Error`).
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw error;
    }
  }
}
