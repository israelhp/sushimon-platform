import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type AuditEventInput } from '../../audit/audit.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { DecimalLike, OrderRecord } from '../orders.types.js';
import type {
  AdminHistoryRow,
  AdminOrderDetailRecord,
  AdminOrderListRow,
  AdminOrderRow,
  BoardCounts,
  ListFilter,
  TransitionState,
  TransitionTx,
} from './admin-orders.types.js';
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from './order-transition.matrix.js';

/** Eventos de historial que se muestran como máximo; se leen `MAX + 1` para detectar el truncamiento. */
export const ADMIN_HISTORY_LIMIT = 50;
/** Tarjetas por columna terminal del tablero (tope fijo, spec §4.3). */
export const TERMINAL_CARD_LIMIT = 10;
/** Espera máxima por el candado de la fila de otro comando (`SET LOCAL lock_timeout`); al vencer => 503 `ORDERS_BUSY`. */
export const COMMAND_LOCK_TIMEOUT = '2s';
const TX_OPTIONS = {
  timeout: 5_000,
  maxWait: 2_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

interface SummaryDbRow {
  id: string;
  order_number: bigint;
  status: string;
  branch_id: string;
  branch_name: string;
  fulfillment_type: string;
  delivery_provider: string | null;
  customer_name: string;
  total: string;
  payment_method_preference: string | null;
  payment_status: string | null;
  payment_received_at: Date | null;
  scheduled_for: Date | null;
  placed_at: Date;
  updated_at: Date;
  item_count: number;
  placed_at_key?: string;
}

/** Columnas mínimas (sin teléfono, correo, notas ni desglose) con unidades agregadas en la MISMA sentencia (sin N+1). */
const SUMMARY_COLUMNS = Prisma.sql`o.id, o.order_number, o.status, o.branch_id, b.name AS branch_name,
  o.fulfillment_type, o.delivery_provider, o.customer_name, o.total::text AS total, o.payment_method_preference,
  p.status AS payment_status, p.received_at AS payment_received_at,
  o.scheduled_for, o.placed_at, o.updated_at,
  (SELECT COALESCE(sum(i.quantity), 0)::int FROM app.order_items i WHERE i.order_id = o.id) AS item_count`;

/** Columnas que la tarjeta lee de `orders` (nunca teléfono, correo ni notas). */
const CARD_COLUMNS = Prisma.sql`o.id, o.order_number, o.status, o.branch_id, o.fulfillment_type, o.delivery_provider,
  o.customer_name, o.total, o.payment_method_preference, o.scheduled_for, o.placed_at, o.updated_at`;

const PLACED_AT_KEY = Prisma.sql`to_char(o.placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS placed_at_key`;

const toRow = (r: SummaryDbRow): AdminOrderRow => ({
  id: r.id,
  orderNumber: BigInt(r.order_number),
  status: r.status,
  branchId: r.branch_id,
  branchName: r.branch_name,
  fulfillmentType: r.fulfillment_type,
  deliveryProvider: r.delivery_provider,
  customerName: r.customer_name,
  itemCount: Number(r.item_count),
  total: r.total,
  paymentMethodPreference: r.payment_method_preference,
  paymentStatus: r.payment_status,
  paymentPaidAt: r.payment_received_at,
  scheduledFor: r.scheduled_for,
  placedAt: r.placed_at,
  updatedAt: r.updated_at,
});

/** Alcance en SQL: `null` = todas las sucursales; lista = SOLO esas (una lista vacía no devuelve nada, nunca «todo»). */
const scopeSql = (branchIds: string[] | null): Prisma.Sql =>
  branchIds === null ? Prisma.sql`TRUE` : Prisma.sql`o.branch_id = ANY(${[...branchIds]}::uuid[])`;

const dec = (value: string): DecimalLike => ({ toFixed: () => value });

/**
 * Acceso a datos de la gestión de pedidos (F22, spec 023 §5 y §7). SQL parametrizado con `$queryRaw`: NADA del cliente se
 * interpola. Este SQL se prueba contra PostgreSQL real en `test/admin-orders.int-spec.ts` (ver su cabecera).
 */
@Injectable()
export class AdminOrdersRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- lecturas ----------

  /** ¿Existe la sucursal? (solo cuando el alcance es global y llega un filtro `branchId`). */
  async branchExists(branchId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app.branches WHERE id = ${branchId}::uuid`;
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Una página (limit + 1 filas para saber si hay más): UNA sentencia con unidades y sucursal agregadas. */
  async list(filter: ListFilter): Promise<AdminOrderListRow[]> {
    if (filter.branchIds !== null && filter.branchIds.length === 0) return [];
    const where: Prisma.Sql[] = [
      scopeSql(filter.branchIds),
      Prisma.sql`o.placed_at >= ${filter.from}`,
    ];
    if (filter.to) where.push(Prisma.sql`o.placed_at <= ${filter.to}`);
    if (filter.status) where.push(Prisma.sql`o.status = ANY(${[...filter.status]}::text[])`);
    if (filter.fulfillmentType) {
      where.push(Prisma.sql`o.fulfillment_type = ${filter.fulfillmentType}`);
    }
    if (filter.orderNumber !== null) {
      where.push(Prisma.sql`o.order_number = ${filter.orderNumber}::bigint`);
    }
    if (filter.nameContains !== null) {
      // `position` y no LIKE: los comodines del usuario son literales.
      where.push(
        Prisma.sql`position(lower(${filter.nameContains}::text) in lower(o.customer_name)) > 0`,
      );
    }
    if (filter.cursor) {
      where.push(
        Prisma.sql`(o.placed_at, o.id) < (${filter.cursor.placedAtKey}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }
    const rows = await this.prisma.$queryRaw<SummaryDbRow[]>(Prisma.sql`
      SELECT ${SUMMARY_COLUMNS}, ${PLACED_AT_KEY}
        FROM app.orders o JOIN app.branches b ON b.id = o.branch_id
        LEFT JOIN app.payments p ON p.order_id = o.id
       WHERE ${Prisma.join(where, ' AND ')}
       ORDER BY o.placed_at DESC, o.id DESC
       LIMIT ${filter.limit + 1}`);
    return rows.map((r) => ({ ...toRow(r), placedAtKey: r.placed_at_key ?? '' }));
  }

  /** Tablero, sentencia 1: conteo y espera por estado (activas: todas; terminales: desde `terminalSince`). */
  async boardCounts(branchIds: string[] | null, terminalSince: Date): Promise<BoardCounts[]> {
    if (branchIds !== null && branchIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { status: string; cnt: number; oldest: Date | null }[]
    >(
      Prisma.sql`
      SELECT o.status, count(*)::int AS cnt, min(o.placed_at) AS oldest
        FROM app.orders o
       WHERE ${scopeSql(branchIds)}
         AND (o.status = ANY(${[...ACTIVE_STATUSES]}::text[]) OR o.placed_at >= ${terminalSince})
       GROUP BY o.status`,
    );
    return rows.map((r) => ({ status: r.status, count: Number(r.cnt), oldest: r.oldest }));
  }

  /**
   * Tablero, sentencia 2: tarjetas por columna con un `LATERAL` por estado (activas: las más ANTIGUAS primero; terminales:
   * las más recientes de la ventana, tope fijo), con unidades y sucursal en la misma sentencia. El índice
   * `orders_branch_status_placed_idx` sirve la igualdad de estado y el filtro de sucursal; el orden `placed_at ASC` entre
   * varias sucursales puede requerir una ordenación pequeña por estado (verificar con EXPLAIN, #46). Conteos y tarjetas son
   * DOS sentencias (dos instantáneas `ReadCommitted`): `count` puede diferir en 1 de las tarjetas si un pedido cambia entre
   * ambas; es inocuo (la web refresca en el siguiente sondeo).
   */
  async boardCards(
    branchIds: string[] | null,
    terminalSince: Date,
    activeLimit: number,
  ): Promise<AdminOrderRow[]> {
    if (branchIds !== null && branchIds.length === 0) return [];
    const scope = scopeSql(branchIds);
    const rows = await this.prisma.$queryRaw<SummaryDbRow[]>(Prisma.sql`
      SELECT ${SUMMARY_COLUMNS}
        FROM (
          SELECT x.* FROM unnest(${[...ACTIVE_STATUSES]}::text[]) AS s(status)
           CROSS JOIN LATERAL (
             SELECT ${CARD_COLUMNS} FROM app.orders o
              WHERE o.status = s.status AND ${scope}
              ORDER BY o.placed_at ASC, o.id ASC LIMIT ${activeLimit}) x
          UNION ALL
          SELECT x.* FROM unnest(${[...TERMINAL_STATUSES]}::text[]) AS s(status)
           CROSS JOIN LATERAL (
             SELECT ${CARD_COLUMNS} FROM app.orders o
              WHERE o.status = s.status AND ${scope} AND o.placed_at >= ${terminalSince}
              ORDER BY o.placed_at DESC, o.id DESC LIMIT ${TERMINAL_CARD_LIMIT}) x
        ) o
        JOIN app.branches b ON b.id = o.branch_id
        LEFT JOIN app.payments p ON p.order_id = o.id`);
    return rows.map(toRow);
  }

  /**
   * Detalle con el alcance EN LA CONSULTA (inexistente y fuera de alcance dan la misma única sentencia y `null`).
   * Sentencias (SECUENCIALES, 1 conexión a la vez): pedido+sucursal+unidades (1), líneas con modificadores (2),
   * promociones (3), dirección (4), historial con nombre del actor por `LEFT JOIN` (5). Presupuesto: ≤ 5 (spec ≤ 7); no
   * cuenta la lectura de grants del personal (fuera del gate).
   */
  async findDetail(
    orderId: string,
    branchIds: string[] | null,
  ): Promise<AdminOrderDetailRecord | null> {
    if (branchIds !== null && branchIds.length === 0) return null;
    const head = await this.prisma.$queryRaw<
      (SummaryDbRow & {
        customer_phone: string;
        notes: string | null;
        subtotal: string;
        extras_total: string;
        discount_total: string;
        delivery_fee: string;
      })[]
    >(Prisma.sql`
      SELECT ${SUMMARY_COLUMNS}, o.customer_phone, o.notes, o.subtotal::text AS subtotal,
             o.extras_total::text AS extras_total, o.discount_total::text AS discount_total,
             o.delivery_fee::text AS delivery_fee
        FROM app.orders o JOIN app.branches b ON b.id = o.branch_id
        LEFT JOIN app.payments p ON p.order_id = o.id
       WHERE o.id = ${orderId}::uuid AND ${scopeSql(branchIds)}`);
    const h = head[0];
    if (!h) return null;

    // SECUENCIAL a propósito: una plaza del gate = una conexión a la vez (con `Promise.all` serían 4 conexiones por plaza).
    const items = await this.prisma.$queryRaw<
      {
        line_no: number;
        product_name: string;
        quantity: number;
        unit_price: string;
        extras_per_unit: string;
        line_discount: string;
        notes: string | null;
        modifiers: { name: string; price: string }[];
      }[]
    >`
        SELECT i.line_no, i.product_name, i.quantity, i.unit_price::text AS unit_price,
               i.extras_per_unit::text AS extras_per_unit, i.line_discount::text AS line_discount, i.notes,
               COALESCE(json_agg(json_build_object('name', m.modifier_name, 'price', m.unit_extra_price::text)
                                 ORDER BY m.modifier_name) FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS modifiers
          FROM app.order_items i LEFT JOIN app.order_item_modifiers m ON m.order_item_id = i.id
         WHERE i.order_id = ${orderId}::uuid
         GROUP BY i.id ORDER BY i.line_no`;
    const promotions = await this.prisma.$queryRaw<{ promotion_name: string; amount: string }[]>`
        SELECT promotion_name, amount::text AS amount FROM app.order_promotions
         WHERE order_id = ${orderId}::uuid ORDER BY promotion_name`;
    const addresses = await this.prisma.$queryRaw<
      {
        municipality_name: string;
        zone: string | null;
        address_line: string;
        reference_note: string | null;
      }[]
    >`
        SELECT municipality_name, zone, address_line, reference_note FROM app.order_addresses
         WHERE order_id = ${orderId}::uuid`;
    const history = await this.prisma.$queryRaw<
      {
        old_status: string | null;
        new_status: string;
        changed_at: Date;
        reason: string | null;
        actor_name: string | null;
      }[]
    >`
        SELECT h.old_status, h.new_status, h.changed_at, h.reason, s.full_name AS actor_name
          FROM app.order_status_history h LEFT JOIN app.staff_users s ON s.id = h.changed_by
         WHERE h.order_id = ${orderId}::uuid
         ORDER BY h.changed_at DESC, h.id DESC LIMIT ${ADMIN_HISTORY_LIMIT + 1}`;

    const row = toRow(h);
    const a = addresses[0];
    const record: OrderRecord = {
      id: row.id,
      orderNumber: row.orderNumber,
      customerId: null,
      branchId: row.branchId,
      customerName: row.customerName,
      customerPhone: h.customer_phone,
      fulfillmentType: row.fulfillmentType,
      deliveryProvider: row.deliveryProvider,
      notes: h.notes,
      status: row.status,
      subtotal: dec(h.subtotal),
      extrasTotal: dec(h.extras_total),
      discountTotal: dec(h.discount_total),
      deliveryFee: dec(h.delivery_fee),
      total: dec(row.total),
      paymentMethodPreference: row.paymentMethodPreference,
      placedAt: row.placedAt,
      updatedAt: row.updatedAt,
      address: a
        ? {
            municipalityName: a.municipality_name,
            zone: a.zone,
            addressLine: a.address_line,
            referenceNote: a.reference_note,
          }
        : null,
      items: items.map((i) => ({
        lineNo: i.line_no,
        productName: i.product_name,
        quantity: i.quantity,
        unitPrice: dec(i.unit_price),
        extrasPerUnit: dec(i.extras_per_unit),
        lineDiscount: dec(i.line_discount),
        notes: i.notes,
        modifiers: i.modifiers.map((m) => ({ modifierName: m.name, unitExtraPrice: dec(m.price) })),
      })),
      promotions: promotions.map((p) => ({
        promotionName: p.promotion_name,
        amount: dec(p.amount),
      })),
    };
    const truncated = history.length > ADMIN_HISTORY_LIMIT;
    const shown: AdminHistoryRow[] = history
      .slice(0, ADMIN_HISTORY_LIMIT)
      .reverse()
      .map((e) => ({
        oldStatus: e.old_status,
        newStatus: e.new_status,
        changedAt: e.changed_at,
        reason: e.reason,
        actorName: e.actor_name,
      }));
    return { row, record, history: shown, historyTruncated: truncated };
  }

  // ---------- transición ----------

  /**
   * Transacción corta (`ReadCommitted`, 5 s, espera de conexión 2 s). Primera sentencia: `SET LOCAL lock_timeout` (55P03 y el
   * timeout de la transacción se traducen a 503 `ORDERS_BUSY` en el servicio). Un error propagado revierte TODO (estado,
   * historial y auditoría). Presupuesto de un comando (sentencias de APLICACIÓN, sin BEGIN/COMMIT ni el `SET LOCAL`): lectura,
   * CAS+historial, auditoría = 3; con repetición o conflicto, +1 relectura = 4 (spec: ≤ 6).
   */
  transaction<T>(fn: (tx: TransitionTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => {
      await client.$executeRawUnsafe(`SET LOCAL lock_timeout = '${COMMAND_LOCK_TIMEOUT}'`);
      return fn(this.txOf(client));
    }, TX_OPTIONS);
  }

  private txOf(client: Prisma.TransactionClient): TransitionTx {
    return {
      readOrder: async (orderId) => {
        const rows = await client.$queryRaw<SummaryDbRow[]>(Prisma.sql`
          SELECT ${SUMMARY_COLUMNS}
            FROM app.orders o JOIN app.branches b ON b.id = o.branch_id
            LEFT JOIN app.payments p ON p.order_id = o.id
           WHERE o.id = ${orderId}::uuid`);
        return rows[0] ? toRow(rows[0]) : null;
      },
      casAndRecord: async ({ orderId, expected, to, changedBy, reason }) => {
        // UNA sentencia atómica: el `UPDATE` condicional devuelve `updated_at` (`clock_timestamp()`, evaluado cuando la
        // fila se actualiza de verdad) y el MISMO valor exacto (microsegundos) es `changed_at` de la fila de historial.
        const rows = await client.$queryRaw<{ updated_at: Date }[]>(Prisma.sql`
          WITH upd AS (
            UPDATE app.orders SET status = ${to}::text, updated_at = clock_timestamp()
             WHERE id = ${orderId}::uuid AND status = ${expected}::text
            RETURNING id, updated_at
          ), hist AS (
            INSERT INTO app.order_status_history (order_id, old_status, new_status, changed_by, reason, changed_at)
            SELECT id, ${expected}::text, ${to}::text, ${changedBy}::uuid, ${reason}::text, updated_at FROM upd
            RETURNING 1
          )
          SELECT updated_at FROM upd`);
        return rows[0]?.updated_at ?? null;
      },
      readState: async (orderId) => {
        const rows = await client.$queryRaw<
          {
            status: string;
            updated_at: Date;
            old_status: string | null;
            new_status: string | null;
            changed_by: string | null;
            changed_at: Date | null;
          }[]
        >(Prisma.sql`
          SELECT o.status, o.updated_at, h.old_status, h.new_status, h.changed_by, h.changed_at
            FROM app.orders o
            LEFT JOIN LATERAL (
              SELECT old_status, new_status, changed_by, changed_at FROM app.order_status_history
               WHERE order_id = o.id ORDER BY changed_at DESC, id DESC LIMIT 1) h ON TRUE
           WHERE o.id = ${orderId}::uuid`);
        const r = rows[0];
        if (!r) return null;
        const state: TransitionState = {
          status: r.status,
          updatedAt: r.updated_at,
          lastEvent:
            r.new_status !== null && r.changed_at !== null
              ? {
                  oldStatus: r.old_status,
                  newStatus: r.new_status,
                  changedBy: r.changed_by,
                  changedAt: r.changed_at,
                }
              : null,
        };
        return state;
      },
      audit: (event: AuditEventInput) => this.audit.record(client, event),
    };
  }
}
