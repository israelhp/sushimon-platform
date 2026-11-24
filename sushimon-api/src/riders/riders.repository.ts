import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type AuditEventInput } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { COMMAND_LOCK_TIMEOUT } from '../orders/admin/admin-orders.repository.js';
import type {
  NewRiderData,
  RiderAvailabilityValue,
  RiderEligibilityRow,
  RiderListFilter,
  RiderPatchData,
  RiderRead,
  RiderRecord,
  RidersTx,
  TxClient,
} from './riders.types.js';

const TX_OPTIONS = {
  timeout: 5_000,
  maxWait: 2_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

interface RiderDbRow {
  id: string;
  branch_id: string;
  branch_name: string;
  full_name: string;
  phone: string;
  vehicle_type: string | null;
  license_plate: string | null;
  active: boolean;
  availability: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Columnas de un motorista con el nombre de su sucursal. Requiere los alias `r` (riders) y `b` (branches). */
const RIDER_COLS = Prisma.sql`r.id, r.branch_id, b.name AS branch_name, r.full_name, r.phone, r.vehicle_type,
  r.license_plate, r.active, r.availability, r.version, r.created_at, r.updated_at`;

const toRecord = (r: RiderDbRow): RiderRecord => ({
  id: r.id,
  branchId: r.branch_id,
  branchName: r.branch_name,
  fullName: r.full_name,
  phone: r.phone,
  vehicleType: r.vehicle_type,
  licensePlate: r.license_plate,
  active: r.active,
  availability: r.availability,
  version: Number(r.version),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Alcance en SQL: `null` = todas las sucursales; lista = SOLO esas (una lista vacía no devuelve nada, nunca «todo»). */
const scopeSql = (branchIds: string[] | null): Prisma.Sql =>
  branchIds === null ? Prisma.sql`TRUE` : Prisma.sql`r.branch_id = ANY(${[...branchIds]}::uuid[])`;

/** Sentencia de escritura (`WITH r AS (… RETURNING *)`) + nombre de la sucursal en la MISMA sentencia. */
const returning = (write: Prisma.Sql): Prisma.Sql => Prisma.sql`
  WITH r AS (${write})
  SELECT ${RIDER_COLS} FROM r JOIN app.branches b ON b.id = r.branch_id`;

/** Columnas de orden permitidas (lista blanca: NADA del cliente se interpola). */
const SORT_COLUMN = {
  fullName: 'r.name_key',
  createdAt: 'r.created_at',
  updatedAt: 'r.updated_at',
} as const;

const whereOf = (f: RiderListFilter): Prisma.Sql => {
  const conds: Prisma.Sql[] = [scopeSql(f.scope)];
  if (f.branchId !== undefined) conds.push(Prisma.sql`r.branch_id = ${f.branchId}::uuid`);
  if (f.active !== undefined) conds.push(Prisma.sql`r.active = ${f.active}::boolean`);
  if (f.key !== undefined) conds.push(Prisma.sql`position(${f.key}::text in r.name_key) > 0`);
  if (f.availability === 'UNAVAILABLE') conds.push(Prisma.sql`r.availability = 'UNAVAILABLE'`);
  if (f.availability === 'AVAILABLE') {
    conds.push(
      Prisma.sql`r.active AND r.availability = 'AVAILABLE' AND r.id <> ALL(${[...f.busyIds]}::uuid[])`,
    );
  }
  if (f.availability === 'BUSY') {
    conds.push(Prisma.sql`r.active AND r.id = ANY(${[...f.busyIds]}::uuid[])`);
  }
  return Prisma.join(conds, ' AND ');
};

/**
 * Acceso a datos de motoristas (F27, spec 028 §7 y §10). SQL parametrizado con `$queryRaw`/`Prisma.sql`: NADA del cliente se
 * interpola (el orden sale de una lista blanca). Se prueba contra PostgreSQL real en `test/riders.int-spec.ts`.
 */
@Injectable()
export class RidersRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** `GET /riders`: 1 sentencia (+1 conteo si la página pedida queda vacía y `page > 1`). */
  async list(f: RiderListFilter): Promise<{ rows: RiderRecord[]; total: number }> {
    if (f.scope !== null && f.scope.length === 0) return { rows: [], total: 0 };
    const dir = f.order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const orderBy = Prisma.sql`${Prisma.raw(SORT_COLUMN[f.sort])} ${dir}, r.id ${dir}`;
    const rows = await this.prisma.$queryRaw<(RiderDbRow & { total_count: number })[]>(Prisma.sql`
      SELECT ${RIDER_COLS}, (count(*) OVER())::int AS total_count
        FROM app.riders r JOIN app.branches b ON b.id = r.branch_id
       WHERE ${whereOf(f)}
       ORDER BY ${orderBy}
       LIMIT ${f.pageSize}::int OFFSET ${(f.page - 1) * f.pageSize}::int`);
    const first = rows[0];
    if (first) return { rows: rows.map(toRecord), total: Number(first.total_count) };
    if (f.page === 1) return { rows: [], total: 0 };
    const count = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM app.riders r WHERE ${whereOf(f)}`);
    return { rows: [], total: Number(count[0]?.n ?? 0) };
  }

  /** `GET /riders/{id}`: 1 sentencia; inexistente y fuera de alcance dan la MISMA sentencia y `null`. */
  async findOne(id: string, branchIds: string[] | null): Promise<RiderRecord | null> {
    if (branchIds !== null && branchIds.length === 0) return null;
    return readRider(this.prisma, id, branchIds);
  }

  /** Elegibilidad (F28): UNA sentencia (`riders LEFT JOIN branch_delivery_settings`); solo lectura, sin candados. */
  async findEligibilityRow(
    riderId: string,
    orderBranchId: string,
    tx?: TxClient,
  ): Promise<RiderEligibilityRow | null> {
    const rows = await (tx ?? this.prisma).$queryRaw<
      { branch_id: string; active: boolean; availability: string; own_enabled: boolean }[]
    >(Prisma.sql`
      SELECT r.branch_id, r.active, r.availability,
             COALESCE(s.own_delivery_zones_enabled, false) AS own_enabled
        FROM app.riders r
        LEFT JOIN app.branch_delivery_settings s ON s.branch_id = ${orderBranchId}::uuid
       WHERE r.id = ${riderId}::uuid`);
    const r = rows[0];
    return r
      ? {
          riderBranchId: r.branch_id,
          active: r.active,
          availability: r.availability,
          ownDeliveryEnabled: r.own_enabled,
        }
      : null;
  }

  /**
   * Transacción corta (`ReadCommitted`, 5 s). Primera sentencia: `SET LOCAL lock_timeout` (55P03 => 503 `RIDERS_BUSY`). Un error
   * propagado revierte TODO (cambio y auditoría).
   */
  transaction<T>(fn: (tx: RidersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => {
      await client.$executeRawUnsafe(`SET LOCAL lock_timeout = '${COMMAND_LOCK_TIMEOUT}'`);
      return fn(this.txOf(client));
    }, TX_OPTIONS);
  }

  private txOf(client: Prisma.TransactionClient): RidersTx {
    return {
      client,
      read: async (id, branchIds, opts) => {
        if (branchIds !== null && branchIds.length === 0) return null;
        const dest =
          opts?.destBranchId !== undefined
            ? Prisma.sql`(SELECT d.active FROM app.branches d WHERE d.id = ${opts.destBranchId}::uuid)`
            : Prisma.sql`NULL::boolean`;
        const lock = opts?.lock ? Prisma.sql`FOR UPDATE OF r` : Prisma.empty;
        const rows = await client.$queryRaw<(RiderDbRow & { dest_active: boolean | null })[]>(
          Prisma.sql`
          SELECT ${RIDER_COLS}, ${dest} AS dest_active
            FROM app.riders r JOIN app.branches b ON b.id = r.branch_id
           WHERE r.id = ${id}::uuid AND ${scopeSql(branchIds)}
           ${lock}`,
        );
        const r = rows[0];
        return r ? ({ rider: toRecord(r), destActive: r.dest_active } satisfies RiderRead) : null;
      },
      insert: async (data: NewRiderData) => {
        // `INSERT … SELECT` desde `branches` ACTIVAS: sucursal inexistente/inactiva => 0 filas. El trigger es la 2.ª barrera.
        const rows = await client.$queryRaw<RiderDbRow[]>(
          returning(Prisma.sql`
            INSERT INTO app.riders (branch_id, full_name, name_key, phone, vehicle_type, license_plate)
            SELECT b.id, ${data.fullName}::text, ${data.nameKey}::text, ${data.phone}::text,
                   ${data.vehicleType}::text, ${data.licensePlate}::text
              FROM app.branches b WHERE b.id = ${data.branchId}::uuid AND b.active
            RETURNING *`),
        );
        return rows[0] ? toRecord(rows[0]) : null;
      },
      update: async (id, expectedVersion, originBranchId, patch) => {
        const rows = await client.$queryRaw<RiderDbRow[]>(
          returning(Prisma.sql`
            UPDATE app.riders SET ${setClauses(patch)}
             WHERE id = ${id}::uuid AND version = ${expectedVersion}::int AND branch_id = ${originBranchId}::uuid
            RETURNING *`),
        );
        return rows[0] ? toRecord(rows[0]) : null;
      },
      setActive: async (id, branchId, active) => {
        // Compare-and-set sobre el valor vigente; desactivar fuerza UNAVAILABLE; reactivar NO lo deja disponible.
        const rows = await client.$queryRaw<RiderDbRow[]>(
          returning(Prisma.sql`
            UPDATE app.riders
               SET active = ${active}::boolean,
                   availability = CASE WHEN ${active}::boolean THEN availability ELSE 'UNAVAILABLE' END,
                   version = version + 1, updated_at = now()
             WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid AND active IS DISTINCT FROM ${active}::boolean
            RETURNING *`),
        );
        return rows[0] ? toRecord(rows[0]) : null;
      },
      setAvailability: async (id, branchId, availability: RiderAvailabilityValue) => {
        // `AVAILABLE` exige activo EN la sentencia (carrera con desactivar); el CHECK de BD es la segunda barrera.
        const rows = await client.$queryRaw<RiderDbRow[]>(
          returning(Prisma.sql`
            UPDATE app.riders
               SET availability = ${availability}::text, version = version + 1, updated_at = now()
             WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid
               AND availability IS DISTINCT FROM ${availability}::text
               AND (${availability}::text <> 'AVAILABLE' OR active)
            RETURNING *`),
        );
        return rows[0] ? toRecord(rows[0]) : null;
      },
      audit: (event: AuditEventInput) => this.audit.record(client, event),
    };
  }
}

const readRider = async (
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  id: string,
  branchIds: string[] | null,
): Promise<RiderRecord | null> => {
  const rows = await client.$queryRaw<RiderDbRow[]>(Prisma.sql`
    SELECT ${RIDER_COLS}
      FROM app.riders r JOIN app.branches b ON b.id = r.branch_id
     WHERE r.id = ${id}::uuid AND ${scopeSql(branchIds)}`);
  return rows[0] ? toRecord(rows[0]) : null;
};

/** `SET` de la edición: solo las columnas presentes; el traslado deja `UNAVAILABLE`; siempre sube `version`. */
function setClauses(patch: RiderPatchData): Prisma.Sql {
  const sets: Prisma.Sql[] = [];
  if (patch.fullName !== undefined) {
    sets.push(Prisma.sql`full_name = ${patch.fullName}::text`);
    sets.push(Prisma.sql`name_key = ${patch.nameKey ?? ''}::text`);
  }
  if (patch.phone !== undefined) sets.push(Prisma.sql`phone = ${patch.phone}::text`);
  if (patch.vehicleType !== undefined) {
    sets.push(Prisma.sql`vehicle_type = ${patch.vehicleType}::text`);
  }
  if (patch.licensePlate !== undefined) {
    sets.push(Prisma.sql`license_plate = ${patch.licensePlate}::text`);
  }
  if (patch.branchId !== undefined) {
    sets.push(Prisma.sql`branch_id = ${patch.branchId}::uuid`);
    sets.push(Prisma.sql`availability = 'UNAVAILABLE'`);
  }
  sets.push(Prisma.sql`version = version + 1`, Prisma.sql`updated_at = now()`);
  return Prisma.join(sets, ', ');
}
