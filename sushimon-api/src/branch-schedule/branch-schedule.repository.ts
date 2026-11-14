import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { formatClock, parsePgTime } from './business-time.js';
import type { ClosureRecord } from './closure-policy.js';
import type { HoursDay } from './schedule-policy.js';

export type ScheduleTx = Prisma.TransactionClient;

/** Fila de horario ya convertida: `weekday` ISO y `HH:mm` (`24:00` incluido). */
export interface HourRow {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

const CLOSURE_SELECT = {
  id: true,
  branchId: true,
  startsAt: true,
  endsAt: true,
  reason: true,
} satisfies Prisma.BranchClosureSelect;

type ClosureRow = Prisma.BranchClosureGetPayload<{ select: typeof CLOSURE_SELECT }>;

const toRecord = (r: ClosureRow): ClosureRecord => ({
  id: r.id,
  branchId: r.branchId,
  startsAt: r.startsAt.getTime(),
  endsAt: r.endsAt.getTime(),
  reason: r.reason,
});

const WRITE_MAX_WAIT_MS = 2_000;
const WRITE_TIMEOUT_MS = 8_000;
/** Espera máxima por un candado de fila (PostgreSQL 55P03 al vencer → 409 BRANCH_SCHEDULE_BUSY). */
const LOCK_TIMEOUT = '2s';

/** Máximo de cierres vigentes o futuros por sucursal (S2). */
export const MAX_OPEN_CLOSURES = 100;

export type ClosureListStatus = 'current' | 'upcoming' | 'active' | 'past' | 'all';

export interface ClosureListFilter {
  branchId: string;
  status: ClosureListStatus;
  now: number;
  from?: number;
  to?: number;
  page: number;
  pageSize: number;
}

interface SnapshotRow {
  id: string;
  active: boolean;
  hours: { weekday: number; opensAt: string; closesAt: string }[];
  closures: { startsAt: number | string; endsAt: number | string }[];
}

/** Estado administrativo, horario semanal y cierres de una sucursal (insumo del motor puro). */
export interface ScheduleSnapshot {
  branchId: string;
  active: boolean;
  hours: HourRow[];
  closures: { startsAt: number; endsAt: number }[];
}

/**
 * Único acceso a datos de horarios y cierres. `branch_hours` se lee con `$queryRaw` (`::text`) y se escribe con
 * `$executeRaw` (`::time`): una `time` con '24:00:00' no es segura con los métodos tipados de Prisma (migración
 * 0006). `branch_closures` usa el cliente tipado. Selects mínimos; sin N+1.
 */
@Injectable()
export class BranchScheduleRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Transacción interactiva de ESCRITURA con límites cortos (S1): `maxWait` para obtener conexión y `timeout`
   * total acotados, de modo que ráfagas de escrituras sobre una sucursal no agoten el pool.
   */
  transaction<T>(fn: (tx: ScheduleTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: WRITE_MAX_WAIT_MS, timeout: WRITE_TIMEOUT_MS });
  }

  /**
   * Bloquea la fila de la sucursal hasta el fin de la transacción; null si no existe. `FOR NO KEY UPDATE` serializa
   * a los escritores de horarios/cierres y choca con el `FOR SHARE` de F07 (`allActiveForShare`), pero NO bloquea
   * las inserciones de filas hijas (FK) de otros módulos. `lock_timeout` evita esperas largas que agoten el pool.
   */
  async lockBranch(tx: ScheduleTx, id: string): Promise<{ id: string; active: boolean } | null> {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const rows = await tx.$queryRaw<{ id: string; active: boolean }[]>`
      SELECT id, active FROM app.branches WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return rows[0] ?? null;
  }

  /** Horario de la sucursal (todas sus filas, ordenadas). `tx` para leer dentro de la transacción. */
  async readHours(branchId: string, tx?: ScheduleTx): Promise<HourRow[]> {
    const rows = await (tx ?? this.prisma).$queryRaw<
      { weekday: number; opens_at: string; closes_at: string }[]
    >`
      SELECT weekday::int AS weekday, opens_at::text AS opens_at, closes_at::text AS closes_at
      FROM app.branch_hours WHERE branch_id = ${branchId}::uuid
      ORDER BY weekday, opens_at`;
    return rows.map((r) => ({
      weekday: Number(r.weekday),
      opensAt: formatClock(parsePgTime(r.opens_at)),
      closesAt: formatClock(parsePgTime(r.closes_at)),
    }));
  }

  /** Reemplaza el horario completo dentro de la transacción: DELETE + un INSERT con todas las filas. */
  async replaceHours(tx: ScheduleTx, branchId: string, days: readonly HoursDay[]): Promise<void> {
    await tx.$executeRaw`DELETE FROM app.branch_hours WHERE branch_id = ${branchId}::uuid`;
    const flat = days.flatMap((d) =>
      d.intervals.map((iv) => ({ weekday: String(d.weekday), o: iv.opensAt, c: iv.closesAt })),
    );
    if (flat.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO app.branch_hours (branch_id, weekday, opens_at, closes_at)
      SELECT ${branchId}::uuid, t.w::smallint, t.o::time, t.c::time
      FROM unnest(${flat.map((r) => r.weekday)}::text[], ${flat.map((r) => r.o)}::text[], ${flat.map((r) => r.c)}::text[])
        AS t(w, o, c)`;
  }

  /**
   * Estado + horario + cierres de VARIAS sucursales en UNA consulta (una sola conexión, sin N+1). Una sucursal
   * inexistente no aparece en el resultado; una inactiva viene con `hours`/`closures` vacíos (no se consultan).
   * Los cierres son los que intersectan `[from, to]` (`starts_at <= to AND ends_at > from`), ordenados por
   * inicio. `closureLimit` (opcional) solo se usa para listados informativos (p. ej. `upcomingClosures`): el motor
   * de disponibilidad NO limita ni trunca los cierres porque un resultado truncado sería incorrecto.
   */
  async loadSchedule(
    branchIds: readonly string[],
    from: Date,
    to: Date,
    opts: { tx?: ScheduleTx; closureLimit?: number } = {},
  ): Promise<ScheduleSnapshot[]> {
    if (branchIds.length === 0) return [];
    const rows = await (opts.tx ?? this.prisma).$queryRaw<SnapshotRow[]>`
      SELECT b.id, b.active,
        CASE WHEN b.active THEN COALESCE((
          SELECT json_agg(json_build_object(
                   'weekday', h.weekday::int, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text)
                 ORDER BY h.weekday, h.opens_at)
          FROM app.branch_hours h WHERE h.branch_id = b.id), '[]'::json) ELSE '[]'::json END AS hours,
        CASE WHEN b.active THEN COALESCE((
          SELECT json_agg(json_build_object('startsAt', c.s, 'endsAt', c.e) ORDER BY c.s)
          FROM (
            SELECT (EXTRACT(EPOCH FROM x.starts_at) * 1000)::bigint AS s,
                   (EXTRACT(EPOCH FROM x.ends_at) * 1000)::bigint AS e
            FROM app.branch_closures x
            WHERE x.branch_id = b.id AND x.starts_at <= ${to.toISOString()}::timestamptz
              AND x.ends_at > ${from.toISOString()}::timestamptz
            ORDER BY x.starts_at
            LIMIT ${opts.closureLimit ?? null}::int
          ) c), '[]'::json) ELSE '[]'::json END AS closures
      FROM app.branches b
      WHERE b.id = ANY(${[...branchIds]}::uuid[])`;
    return rows.map((r) => ({
      branchId: r.id,
      active: r.active,
      hours: r.hours.map((h) => ({
        weekday: Number(h.weekday),
        opensAt: formatClock(parsePgTime(h.opensAt)),
        closesAt: formatClock(parsePgTime(h.closesAt)),
      })),
      closures: r.closures.map((c) => ({ startsAt: Number(c.startsAt), endsAt: Number(c.endsAt) })),
    }));
  }

  /** Cierres vigentes o futuros (`ends_at > now`) de la sucursal, para el tope de S2. */
  countOpenClosures(tx: ScheduleTx, branchId: string, now: number): Promise<number> {
    return tx.branchClosure.count({ where: { branchId, endsAt: { gt: new Date(now) } } });
  }

  async listClosures(f: ClosureListFilter): Promise<{ items: ClosureRecord[]; total: number }> {
    const now = new Date(f.now);
    const and: Prisma.BranchClosureWhereInput[] = [];
    if (f.status === 'current') and.push({ endsAt: { gt: now } });
    if (f.status === 'upcoming') and.push({ startsAt: { gt: now } });
    if (f.status === 'active') and.push({ startsAt: { lte: now }, endsAt: { gt: now } });
    if (f.status === 'past') and.push({ endsAt: { lte: now } });
    if (f.to !== undefined) and.push({ startsAt: { lt: new Date(f.to) } });
    if (f.from !== undefined) and.push({ endsAt: { gt: new Date(f.from) } });
    const where: Prisma.BranchClosureWhereInput = { branchId: f.branchId, AND: and };
    const direction = f.status === 'past' || f.status === 'all' ? 'desc' : 'asc';
    // Dos lecturas independientes en paralelo (sin transacción por lote). Orden por `starts_at` con desempate por
    // `id`: se mantiene para que la paginación sea estable cuando dos cierres comparten inicio.
    const [rows, total] = await Promise.all([
      this.prisma.branchClosure.findMany({
        where,
        select: CLOSURE_SELECT,
        orderBy: [{ startsAt: direction }, { id: 'asc' }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.branchClosure.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
  }

  async findClosure(tx: ScheduleTx, branchId: string, id: string): Promise<ClosureRecord | null> {
    const row = await tx.branchClosure.findFirst({
      where: { id, branchId },
      select: CLOSURE_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  /** Id de otro cierre de la sucursal que se solapa con `[startsAt, endsAt)` (contiguos no cuentan). */
  async findOverlap(
    tx: ScheduleTx,
    branchId: string,
    startsAt: number,
    endsAt: number,
    excludeId?: string,
  ): Promise<string | null> {
    const row = await tx.branchClosure.findFirst({
      where: {
        branchId,
        startsAt: { lt: new Date(endsAt) },
        endsAt: { gt: new Date(startsAt) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
      orderBy: { startsAt: 'asc' },
    });
    return row?.id ?? null;
  }

  async insertClosure(
    tx: ScheduleTx,
    data: { branchId: string; startsAt: number; endsAt: number; reason: string | null },
  ): Promise<ClosureRecord> {
    const row = await tx.branchClosure.create({
      data: {
        branchId: data.branchId,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        reason: data.reason,
      },
      select: CLOSURE_SELECT,
    });
    return toRecord(row);
  }

  async updateClosure(
    tx: ScheduleTx,
    id: string,
    data: { startsAt: number; endsAt: number; reason: string | null },
  ): Promise<ClosureRecord> {
    const row = await tx.branchClosure.update({
      where: { id },
      data: {
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        reason: data.reason,
      },
      select: CLOSURE_SELECT,
    });
    return toRecord(row);
  }

  async deleteClosure(tx: ScheduleTx, id: string): Promise<void> {
    await tx.branchClosure.delete({ where: { id } });
  }
}
