import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type AuditEventInput } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { COMMAND_LOCK_TIMEOUT } from '../orders/admin/admin-orders.repository.js';
import { CONTACT_VISIBLE_STATUSES, OPEN_STATUSES } from './delivery-policy.js';
import type {
  ChangeInput,
  DeliveriesTx,
  DeliveryChange,
  DeliveryDetailRecord,
  DeliveryHistoryRow,
  DeliveryLastEvent,
  DeliveryListFilter,
  DeliveryListRow,
  DeliveryRow,
  OrderForDelivery,
  RiderLock,
} from './deliveries.types.js';

/** Eventos de historial que se muestran como máximo; se leen `MAX + 1` para detectar el truncamiento. */
export const DELIVERY_HISTORY_LIMIT = 50;
const TX_OPTIONS = {
  timeout: 10_000,
  maxWait: 2_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

interface LastEventJson {
  event: string;
  oldStatus: string | null;
  status: string;
  riderId: string | null;
  changedBy: string | null;
  changedAt: string;
}

interface DeliveryDbRow {
  id: string;
  order_id: string;
  branch_id: string;
  branch_name: string;
  status: string;
  version: number;
  rider_id: string | null;
  assigned_at: Date | null;
  picked_up_at: Date | null;
  delivered_at: Date | null;
  returned_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  order_status: string;
  order_number: bigint;
  fulfillment_type: string;
  delivery_provider: string | null;
  municipality_name: string | null;
  zone: string | null;
  rider_name: string | null;
  rider_vehicle_type: string | null;
  rider_phone_masked: string | null;
  last_event?: LastEventJson | null;
  created_at_key?: string;
}

/**
 * Columnas de una entrega con pedido, sucursal, municipio/zona y motorista (nombre, vehículo y teléfono ENMASCARADO en SQL: el
 * valor completo no sale de la BD; sin sucursal del motorista). Requiere los alias `d` (deliveries o la CTE de la escritura),
 * `o` (orders), `b` (branches), `a` (order_addresses) y `r` (riders).
 */
const COLS = Prisma.sql`d.id, d.order_id, d.branch_id, b.name AS branch_name, d.status, d.version, d.rider_id,
  d.assigned_at, d.picked_up_at, d.delivered_at, d.returned_at, d.cancelled_at, d.created_at, d.updated_at,
  o.status AS order_status, o.order_number, o.fulfillment_type, o.delivery_provider,
  a.municipality_name, a.zone,
  r.full_name AS rider_name, r.vehicle_type AS rider_vehicle_type,
  CASE WHEN r.id IS NULL THEN NULL ELSE left(r.phone, 4) || '****' || right(r.phone, 4) END AS rider_phone_masked`;

const JOINS = Prisma.sql`JOIN app.orders o ON o.id = d.order_id
  JOIN app.branches b ON b.id = d.branch_id
  LEFT JOIN app.order_addresses a ON a.order_id = d.order_id
  LEFT JOIN app.riders r ON r.id = d.rider_id`;

/** Último evento del historial como JSON (subconsulta escalar: no interfiere con `FOR UPDATE OF d`). */
const LAST_EVENT = Prisma.sql`(SELECT json_build_object('event', h.event, 'oldStatus', h.old_status, 'status', h.status,
    'riderId', h.rider_id, 'changedBy', h.changed_by,
    'changedAt', to_char(h.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM app.delivery_status_history h WHERE h.delivery_id = d.id ORDER BY h.changed_at DESC, h.id DESC LIMIT 1) AS last_event`;

const CREATED_AT_KEY = Prisma.sql`to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_key`;

const toLastEvent = (e: LastEventJson | null | undefined): DeliveryLastEvent | null | undefined =>
  e === undefined
    ? undefined
    : e === null
      ? null
      : {
          event: e.event,
          oldStatus: e.oldStatus,
          status: e.status,
          riderId: e.riderId,
          changedBy: e.changedBy,
          changedAt: new Date(e.changedAt),
        };

const toRow = (r: DeliveryDbRow): DeliveryRow => ({
  id: r.id,
  orderId: r.order_id,
  branchId: r.branch_id,
  branchName: r.branch_name,
  status: r.status,
  version: Number(r.version),
  riderId: r.rider_id,
  assignedAt: r.assigned_at,
  pickedUpAt: r.picked_up_at,
  deliveredAt: r.delivered_at,
  returnedAt: r.returned_at,
  cancelledAt: r.cancelled_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  orderStatus: r.order_status,
  orderNumber: BigInt(r.order_number),
  fulfillmentType: r.fulfillment_type,
  deliveryProvider: r.delivery_provider,
  municipalityName: r.municipality_name,
  zone: r.zone,
  riderName: r.rider_name,
  riderVehicleType: r.rider_vehicle_type,
  riderPhoneMasked: r.rider_phone_masked,
  ...(r.last_event !== undefined ? { lastEvent: toLastEvent(r.last_event) } : {}),
});

/** Alcance en SQL sobre una columna de sucursal: `null` = todas; lista = SOLO esas (una lista vacía no devuelve nada). */
const scopeSql = (column: Prisma.Sql, branchIds: string[] | null): Prisma.Sql =>
  branchIds === null ? Prisma.sql`TRUE` : Prisma.sql`${column} = ANY(${[...branchIds]}::uuid[])`;

/** `SET` por tipo de cambio: valores SIEMPRE parametrizados; `version` y `updated_at` siempre se actualizan. */
function setClauses(change: DeliveryChange): Prisma.Sql {
  const sets: Prisma.Sql[] = [];
  switch (change.kind) {
    case 'assign':
      sets.push(
        Prisma.sql`status = 'assigned'`,
        Prisma.sql`rider_id = ${change.riderId}::uuid`,
        Prisma.sql`assigned_at = clock_timestamp()`,
      );
      break;
    case 'unassign':
      sets.push(
        Prisma.sql`status = 'pending'`,
        Prisma.sql`rider_id = NULL`,
        Prisma.sql`assigned_at = NULL`,
      );
      break;
    case 'pick_up':
      sets.push(Prisma.sql`status = 'picked_up'`, Prisma.sql`picked_up_at = clock_timestamp()`);
      break;
    case 'deliver':
      sets.push(Prisma.sql`status = 'delivered'`, Prisma.sql`delivered_at = clock_timestamp()`);
      break;
    case 'return':
      sets.push(Prisma.sql`status = 'returned'`, Prisma.sql`returned_at = clock_timestamp()`);
      break;
    case 'cancel':
      sets.push(
        Prisma.sql`status = 'cancelled'`,
        Prisma.sql`rider_id = NULL`,
        Prisma.sql`assigned_at = NULL`,
        Prisma.sql`cancelled_at = clock_timestamp()`,
      );
      break;
    case 'reopen':
      sets.push(Prisma.sql`status = 'pending'`, Prisma.sql`cancelled_at = NULL`);
      break;
  }
  sets.push(Prisma.sql`version = version + 1`, Prisma.sql`updated_at = clock_timestamp()`);
  return Prisma.join(sets, ', ');
}

/**
 * Acceso a datos de entregas propias (F28, spec 029 §4, §9 y §15). SQL parametrizado con `$queryRaw`/`Prisma.sql`: NADA del
 * cliente se interpola. NINGUNA escritura a `orders` (el pedido solo cambia por `OrderTransitionsService`, con la MISMA
 * transacción). Se prueba contra PostgreSQL real en `test/deliveries.int-spec.ts`.
 */
@Injectable()
export class DeliveriesRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- lecturas ----------

  /** ¿Existe la sucursal? (solo con alcance global y filtro `branchId` que devolvió una página vacía). */
  async branchExists(branchId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app.branches WHERE id = ${branchId}::uuid`;
    return (rows[0]?.n ?? 0) > 0;
  }

  /**
   * Estado vigente de una entrega (sin alcance: solo lo usa el servicio DESPUÉS de autorizar, para el `current` de un 409 tras
   * una carrera resuelta por las guardas de la BD). Fuera de la transacción fallida.
   */
  async currentOf(id: string): Promise<{ status: string; version: number } | null> {
    const rows = await this.prisma.$queryRaw<{ status: string; version: number }[]>`
      SELECT status, version FROM app.deliveries WHERE id = ${id}::uuid`;
    const r = rows[0];
    return r ? { status: r.status, version: Number(r.version) } : null;
  }

  /** Estado vigente de un pedido (mismo uso que `currentOf`, para el 409 `ORDER_STATE_CONFLICT` de la creación). */
  async orderCurrentOf(orderId: string): Promise<{ status: string; updatedAt: Date } | null> {
    const rows = await this.prisma.$queryRaw<{ status: string; updated_at: Date }[]>`
      SELECT status, updated_at FROM app.orders WHERE id = ${orderId}::uuid`;
    const r = rows[0];
    return r ? { status: r.status, updatedAt: r.updated_at } : null;
  }

  /**
   * Una página (`limit + 1` filas para saber si hay más): UNA sentencia con pedido, sucursal, zona y motorista. Predicado
   * (spec §4.2): `status = ANY(estados) AND (abierto OR created_at en [from, to])`; el rango solo acota `returned|cancelled`.
   */
  async list(filter: DeliveryListFilter): Promise<DeliveryListRow[]> {
    if (filter.branchIds !== null && filter.branchIds.length === 0) return [];
    const where: Prisma.Sql[] = [
      scopeSql(Prisma.sql`d.branch_id`, filter.branchIds),
      Prisma.sql`d.status = ANY(${[...filter.statuses]}::text[])`,
    ];
    const range: Prisma.Sql[] = [Prisma.sql`d.created_at >= ${filter.from}`];
    if (filter.to) range.push(Prisma.sql`d.created_at <= ${filter.to}`);
    where.push(
      Prisma.sql`(d.status = ANY(${[...OPEN_STATUSES]}::text[]) OR (${Prisma.join(range, ' AND ')}))`,
    );
    if (filter.riderId !== null) where.push(Prisma.sql`d.rider_id = ${filter.riderId}::uuid`);
    if (filter.cursor) {
      where.push(
        Prisma.sql`(d.created_at, d.id) < (${filter.cursor.createdAtKey}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }
    const rows = await this.prisma.$queryRaw<DeliveryDbRow[]>(Prisma.sql`
      SELECT ${COLS}, ${CREATED_AT_KEY}
        FROM app.deliveries d ${JOINS}
       WHERE ${Prisma.join(where, ' AND ')}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ${filter.limit + 1}::int`);
    return rows.map((r) => ({ ...toRow(r), createdAtKey: r.created_at_key ?? '' }));
  }

  /**
   * Detalle con el alcance EN LA CONSULTA (inexistente y fuera de alcance dan la misma sentencia y `null`): 2 sentencias (fila
   * con JOINs + historial). El contacto y la dirección se SELECCIONAN solo si la entrega está `pending|assigned|picked_up` (S7) Y
   * la sucursal está en el alcance de `orders.read` (`contactBranchIds`): no se leen y se descartan después, el valor ni sale de
   * la base. `reason` y `actorName` del historial (S1/S8) solo se seleccionan con `deliveries.update` en la sucursal de la entrega
   * (`updateBranchIds`); sin él llegan `null` desde SQL.
   */
  async findDetail(
    id: string,
    branchIds: string[] | null,
    contactBranchIds: string[] | null,
    updateBranchIds: string[] | null,
  ): Promise<DeliveryDetailRecord | null> {
    if (branchIds !== null && branchIds.length === 0) return null;
    const visible = Prisma.sql`(d.status = ANY(${[...CONTACT_VISIBLE_STATUSES]}::text[]) AND ${scopeSql(Prisma.sql`o.branch_id`, contactBranchIds)})`;
    const rows = await this.prisma.$queryRaw<
      (DeliveryDbRow & {
        contact_visible: boolean;
        customer_name: string | null;
        customer_phone: string | null;
        address_line: string | null;
        reference_note: string | null;
      })[]
    >(Prisma.sql`
      SELECT ${COLS}, ${visible} AS contact_visible,
             CASE WHEN ${visible} THEN o.customer_name END AS customer_name,
             CASE WHEN ${visible} THEN o.customer_phone END AS customer_phone,
             CASE WHEN ${visible} THEN a.address_line END AS address_line,
             CASE WHEN ${visible} THEN a.reference_note END AS reference_note
        FROM app.deliveries d ${JOINS}
       WHERE d.id = ${id}::uuid AND ${scopeSql(Prisma.sql`d.branch_id`, branchIds)}`);
    const h = rows[0];
    if (!h) return null;

    const staffVisible = updateBranchIds === null || updateBranchIds.includes(h.branch_id);
    const history = await this.prisma.$queryRaw<
      {
        event: string;
        old_status: string | null;
        status: string;
        rider_id: string | null;
        rider_name: string | null;
        reason: string | null;
        actor_name: string | null;
        changed_at: Date;
      }[]
    >`
      SELECT h.event, h.old_status, h.status, h.rider_id, r.full_name AS rider_name,
             CASE WHEN ${staffVisible}::boolean THEN h.reason END AS reason,
             CASE WHEN ${staffVisible}::boolean THEN s.full_name END AS actor_name, h.changed_at
        FROM app.delivery_status_history h
        LEFT JOIN app.riders r ON r.id = h.rider_id
        LEFT JOIN app.staff_users s ON s.id = h.changed_by AND ${staffVisible}::boolean
       WHERE h.delivery_id = ${id}::uuid
       ORDER BY h.changed_at DESC, h.id DESC
       LIMIT ${DELIVERY_HISTORY_LIMIT + 1}::int`;
    const shown: DeliveryHistoryRow[] = history
      .slice(0, DELIVERY_HISTORY_LIMIT)
      .reverse()
      .map((e) => ({
        event: e.event,
        oldStatus: e.old_status,
        status: e.status,
        riderId: e.rider_id,
        riderName: e.rider_name,
        reason: e.reason,
        actorName: e.actor_name,
        at: e.changed_at,
      }));
    const row = toRow(h);
    return {
      row,
      contactVisible: h.contact_visible,
      customer:
        h.contact_visible && h.customer_name !== null && h.customer_phone !== null
          ? { name: h.customer_name, phone: h.customer_phone }
          : null,
      address:
        h.contact_visible && h.municipality_name !== null && h.address_line !== null
          ? {
              municipalityName: h.municipality_name,
              zone: h.zone,
              addressLine: h.address_line,
              referenceNote: h.reference_note,
            }
          : null,
      history: shown,
      historyTruncated: history.length > DELIVERY_HISTORY_LIMIT,
    };
  }

  // ---------- transacción ----------

  /**
   * Transacción corta (`ReadCommitted`, 10 s, espera de conexión 2 s). Primera sentencia: `SET LOCAL lock_timeout` (55P03 =>
   * 503 `DELIVERIES_BUSY`). Un error propagado revierte TODO (entrega, pedido, historiales y auditoría). El pedido lo escribe
   * `OrderTransitionsService` con `AdminOrdersRepository.transitionTx(tx.client)` sobre ESTE mismo cliente.
   */
  transaction<T>(fn: (tx: DeliveriesTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => {
      await client.$executeRawUnsafe(`SET LOCAL lock_timeout = '${COMMAND_LOCK_TIMEOUT}'`);
      return fn(this.txOf(client));
    }, TX_OPTIONS);
  }

  private txOf(client: Prisma.TransactionClient): DeliveriesTx {
    const readOne = async (
      id: string,
      scope: Prisma.Sql,
      lock: Prisma.Sql,
      withLastEvent: boolean,
    ): Promise<DeliveryRow | null> => {
      // P5: el último evento (subconsulta) solo se lee cuando quien llama lo usa (repeticiones idempotentes).
      const rows = await client.$queryRaw<DeliveryDbRow[]>(Prisma.sql`
        SELECT ${COLS}${withLastEvent ? Prisma.sql`, ${LAST_EVENT}` : Prisma.empty}
          FROM app.deliveries d ${JOINS}
         WHERE d.id = ${id}::uuid AND ${scope}
         ${lock}`);
      return rows[0] ? toRow(rows[0]) : null;
    };
    return {
      client,
      readDelivery: async (id, branchIds, opts) => {
        if (branchIds !== null && branchIds.length === 0) return null;
        return readOne(
          id,
          scopeSql(Prisma.sql`d.branch_id`, branchIds),
          opts?.lock ? Prisma.sql`FOR UPDATE OF d` : Prisma.empty,
          opts?.lastEvent === true,
        );
      },
      lockRider: async (riderId, branchIds): Promise<RiderLock | null> => {
        // S2: el alcance de `riders.read` va EN el SQL del bloqueo: un motorista de otra sucursal (o un actor sin alcance) NO se
        // bloquea y es indistinguible de uno inexistente (404 uniforme). Primer bloqueo del orden motorista → entrega → pedido
        // (el MISMO `FOR UPDATE` que F27 en sus transiciones peligrosas).
        if (branchIds !== null && branchIds.length === 0) return null;
        const rows = await client.$queryRaw<{ id: string; branch_id: string }[]>(Prisma.sql`
          SELECT r.id, r.branch_id FROM app.riders r
           WHERE r.id = ${riderId}::uuid AND ${scopeSql(Prisma.sql`r.branch_id`, branchIds)} FOR UPDATE`);
        const r = rows[0];
        return r ? { id: r.id, branchId: r.branch_id } : null;
      },
      readDeliveryLocked: async (id) => {
        // S9: DOS sentencias con orden EXPLÍCITO entrega → pedido (no se depende del plan de una sola sentencia). La entrega se
        // bloquea y se lee con su último evento; luego se bloquea el pedido y se toma su estado VIGENTE (READ COMMITTED: tras
        // esperar el bloqueo se lee la versión confirmada más reciente), que sustituye al leído sin bloqueo en la primera.
        const row = await readOne(id, Prisma.sql`TRUE`, Prisma.sql`FOR UPDATE OF d`, true);
        if (!row) return null;
        const orders = await client.$queryRaw<
          { status: string; fulfillment_type: string; delivery_provider: string | null }[]
        >(Prisma.sql`
          SELECT o.status, o.fulfillment_type, o.delivery_provider FROM app.orders o
           WHERE o.id = ${row.orderId}::uuid FOR SHARE`);
        const o = orders[0];
        if (!o) return null;
        return {
          ...row,
          orderStatus: o.status,
          fulfillmentType: o.fulfillment_type,
          deliveryProvider: o.delivery_provider,
        };
      },
      readOrderForCreate: async (orderId, branchIds): Promise<OrderForDelivery | null> => {
        if (branchIds !== null && branchIds.length === 0) return null;
        const rows = await client.$queryRaw<
          {
            id: string;
            branch_id: string;
            status: string;
            fulfillment_type: string;
            delivery_provider: string | null;
            updated_at: Date;
            delivery_id: string | null;
            delivery_status: string | null;
            delivery_version: number | null;
          }[]
        >(Prisma.sql`
          SELECT o.id, o.branch_id, o.status, o.fulfillment_type, o.delivery_provider, o.updated_at,
                 d.id AS delivery_id, d.status AS delivery_status, d.version AS delivery_version
            FROM app.orders o LEFT JOIN app.deliveries d ON d.order_id = o.id
           WHERE o.id = ${orderId}::uuid AND ${scopeSql(Prisma.sql`o.branch_id`, branchIds)}`);
        const o = rows[0];
        if (!o) return null;
        return {
          orderId: o.id,
          branchId: o.branch_id,
          status: o.status,
          fulfillmentType: o.fulfillment_type,
          deliveryProvider: o.delivery_provider,
          updatedAt: o.updated_at,
          existing:
            o.delivery_id !== null && o.delivery_status !== null && o.delivery_version !== null
              ? {
                  id: o.delivery_id,
                  status: o.delivery_status,
                  version: Number(o.delivery_version),
                }
              : null,
        };
      },
      insert: async (orderId, branchId, changedBy) => {
        const rows = await client.$queryRaw<DeliveryDbRow[]>(Prisma.sql`
          WITH d AS (
            INSERT INTO app.deliveries (order_id, branch_id)
            VALUES (${orderId}::uuid, ${branchId}::uuid)
            ON CONFLICT (order_id) DO NOTHING
            RETURNING *
          ), h AS (
            INSERT INTO app.delivery_status_history (delivery_id, old_status, status, event, changed_by, changed_at)
            SELECT id, NULL, status, 'created', ${changedBy}::uuid, created_at FROM d
            RETURNING 1
          )
          SELECT ${COLS} FROM d ${JOINS}`);
        const row = rows[0];
        if (!row) return null;
        return {
          ...toRow(row),
          lastEvent: {
            event: 'created',
            oldStatus: null,
            status: row.status,
            riderId: null,
            changedBy,
            changedAt: row.created_at,
          },
        };
      },
      change: async (input: ChangeInput) => {
        const rows = await client.$queryRaw<DeliveryDbRow[]>(Prisma.sql`
          WITH d AS (
            UPDATE app.deliveries SET ${setClauses(input.change)}
             WHERE id = ${input.id}::uuid AND version = ${input.expectedVersion}::int
               AND status = ANY(${[...input.fromStatuses]}::text[])
            RETURNING *
          ), h AS (
            INSERT INTO app.delivery_status_history
              (delivery_id, old_status, status, event, rider_id, reason, changed_by, changed_at)
            SELECT id, ${input.oldStatus}::text, status, ${input.event}::text, ${input.historyRiderId}::uuid,
                   ${input.reason}::text, ${input.changedBy}::uuid, updated_at FROM d
            RETURNING 1
          )
          SELECT ${COLS} FROM d ${JOINS}`);
        const row = rows[0];
        if (!row) return null;
        return {
          ...toRow(row),
          lastEvent: {
            event: input.event,
            oldStatus: input.oldStatus,
            status: row.status,
            riderId: input.historyRiderId,
            changedBy: input.changedBy,
            changedAt: row.updated_at,
          },
        };
      },
      audit: (event: AuditEventInput) => this.audit.record(client, event),
    };
  }
}
