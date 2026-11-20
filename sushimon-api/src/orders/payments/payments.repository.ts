import { Inject, Injectable } from '@nestjs/common';
import { AuditService, type AuditEventInput } from '../../audit/audit.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { COMMAND_LOCK_TIMEOUT } from '../admin/admin-orders.repository.js';
import type {
  MarkPaidInput,
  PaymentEventRow,
  PaymentHistoryRecord,
  PaymentOrderView,
  PaymentsTx,
} from './payments.types.js';

const TX_OPTIONS = {
  timeout: 5_000,
  maxWait: 2_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

/** Eventos que se leen como máximo (el contrato topa en 20). */
const HISTORY_LIMIT = 20;

interface ViewDbRow {
  id: string;
  order_number: bigint;
  status: string;
  branch_id: string;
  fulfillment_type: string;
  delivery_provider: string | null;
  total: string;
  payment_id: string | null;
  payment_status: string | null;
  payment_amount: string | null;
  tendered: string | null;
  change: string | null;
  received_at: Date | null;
  collection_context: string | null;
  received_by_staff_id: string | null;
  collector_name: string | null;
  confirm_key_hash: Uint8Array | null;
  confirm_request_hash: Uint8Array | null;
}

/** Alcance en SQL: `null` = todas las sucursales; lista = SOLO esas (una lista vacía no devuelve nada, nunca «todo»). */
const scopeSql = (branchIds: string[] | null): Prisma.Sql =>
  branchIds === null ? Prisma.sql`TRUE` : Prisma.sql`o.branch_id = ANY(${[...branchIds]}::uuid[])`;

/** Pedido + pago + nombre del cobrador en UNA sentencia (`UNIQUE(order_id)` => a lo sumo una fila de pago). */
const readView = (
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  orderId: string,
  branchIds: string[] | null,
): Promise<PaymentOrderView | null> =>
  client
    .$queryRaw<ViewDbRow[]>(
      Prisma.sql`
      SELECT o.id, o.order_number, o.status, o.branch_id, o.fulfillment_type, o.delivery_provider, o.total::text AS total,
             p.id AS payment_id, p.status AS payment_status, p.amount::text AS payment_amount,
             p.tendered_amount::text AS tendered, p.change_amount::text AS change, p.received_at,
             p.collection_context, p.received_by_staff_id, s.full_name AS collector_name,
             p.confirm_key_hash, p.confirm_request_hash
        FROM app.orders o
        LEFT JOIN app.payments p ON p.order_id = o.id
        LEFT JOIN app.staff_users s ON s.id = p.received_by_staff_id
       WHERE o.id = ${orderId}::uuid AND ${scopeSql(branchIds)}`,
    )
    .then((rows) => {
      const r = rows[0];
      if (!r) return null;
      return {
        orderId: r.id,
        orderNumber: BigInt(r.order_number),
        orderStatus: r.status,
        branchId: r.branch_id,
        fulfillmentType: r.fulfillment_type,
        deliveryProvider: r.delivery_provider,
        total: r.total,
        payment:
          r.payment_id !== null && r.payment_status !== null && r.payment_amount !== null
            ? {
                id: r.payment_id,
                status: r.payment_status,
                amount: r.payment_amount,
                tendered: r.tendered,
                change: r.change,
                receivedAt: r.received_at,
                collectionContext: r.collection_context,
                receivedByStaffId: r.received_by_staff_id,
                collectorName: r.collector_name,
                confirmKeyHash: r.confirm_key_hash,
                confirmRequestHash: r.confirm_request_hash,
              }
            : null,
      } satisfies PaymentOrderView;
    });

/**
 * Acceso a datos de los pagos en efectivo (F24, spec 025 §7 y §11). SQL parametrizado con `$queryRaw`: NADA del cliente se
 * interpola. Nunca toca `orders` (registrar el pago no cambia el estado ni `updated_at` del pedido). Se prueba contra PostgreSQL
 * real en `test/payments.int-spec.ts` (ver su cabecera).
 */
@Injectable()
export class PaymentsRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- lecturas ----------

  /** `getAdminOrderPayment`: 1 sentencia; inexistente y fuera de alcance dan la MISMA sentencia y `null`. */
  findForStaff(orderId: string, branchIds: string[] | null): Promise<PaymentOrderView | null> {
    if (branchIds !== null && branchIds.length === 0) return Promise.resolve(null);
    return readView(this.prisma, orderId, branchIds);
  }

  /**
   * `listAdminOrderPaymentHistory`: 1 sentencia (pedido con alcance + eventos con el nombre del actor por `LEFT JOIN`). Un pedido
   * visible sin eventos devuelve una fila con el evento nulo (historial vacío); fuera de alcance => 0 filas => `null`.
   */
  async findHistory(
    orderId: string,
    branchIds: string[] | null,
  ): Promise<PaymentHistoryRecord | null> {
    if (branchIds !== null && branchIds.length === 0) return null;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        order_number: bigint;
        event_id: string | null;
        event_type: string | null;
        occurred_at: Date | null;
        actor_name: string | null;
        amount: string | null;
        tendered: string | null;
        change: string | null;
      }[]
    >(Prisma.sql`
      SELECT o.id, o.order_number, e.id AS event_id, e.event_type, e.occurred_at, s.full_name AS actor_name,
             e.amount::text AS amount, e.tendered_amount::text AS tendered, e.change_amount::text AS change
        FROM app.orders o
        LEFT JOIN app.payment_events e ON e.order_id = o.id
        LEFT JOIN app.staff_users s ON s.id = e.actor_staff_id
       WHERE o.id = ${orderId}::uuid AND ${scopeSql(branchIds)}
       ORDER BY e.occurred_at ASC, e.id ASC
       LIMIT ${HISTORY_LIMIT}`);
    const first = rows[0];
    if (!first) return null;
    const events: PaymentEventRow[] = rows.flatMap((r) =>
      r.event_id !== null && r.event_type !== null && r.occurred_at !== null && r.amount !== null
        ? [
            {
              id: r.event_id,
              type: r.event_type,
              at: r.occurred_at,
              actorName: r.actor_name,
              amount: r.amount,
              tendered: r.tendered,
              change: r.change,
            },
          ]
        : [],
    );
    return { orderId: first.id, orderNumber: BigInt(first.order_number), events };
  }

  /** Puerto de lectura de F22 (`payment_review`): ¿hay un pago `paid` sobre un pedido `rejected|cancelled`? 1 sentencia. */
  async hasPaidOnClosedOrder(orderId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ review: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM app.payments p JOIN app.orders o ON o.id = p.order_id
         WHERE p.order_id = ${orderId}::uuid AND p.status = 'paid' AND o.status IN ('rejected', 'cancelled')
      ) AS review`;
    return rows[0]?.review === true;
  }

  // ---------- registro ----------

  /**
   * Transacción corta (`ReadCommitted`, 5 s, espera de conexión 2 s). Primera sentencia: `SET LOCAL lock_timeout` (55P03 y el
   * timeout de la transacción se traducen a 503 `ORDERS_BUSY` en el servicio). Un error propagado revierte TODO (pago,
   * evento y auditoría). Sentencias de aplicación: lectura, CAS+evento, auditoría = 3 (con carrera perdida, +1 relectura = 4;
   * repetición: 1; spec: ≤ 6).
   */
  transaction<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => {
      await client.$executeRawUnsafe(`SET LOCAL lock_timeout = '${COMMAND_LOCK_TIMEOUT}'`);
      return fn(this.txOf(client));
    }, TX_OPTIONS);
  }

  private txOf(client: Prisma.TransactionClient): PaymentsTx {
    return {
      read: (orderId, branchIds) =>
        branchIds !== null && branchIds.length === 0
          ? Promise.resolve(null)
          : readView(client, orderId, branchIds),
      markPaid: async (input: MarkPaidInput) => {
        // UNA sentencia atómica: `UPDATE` condicional (compare-and-set sobre `status = 'pending'` y pedido no cerrado) + evento
        // `cash_received` con EL MISMO `received_at` (`clock_timestamp()`). El cambio lo calcula la BD: `tendered - amount`.
        // El `UPDATE` no modifica `orders`. El trigger `payments_guard` y el CHECK `payments_reception_chk` validan el resultado.
        // CARRERA cobro vs cancelar/rechazar (F22): el pedido se lee con `FOR SHARE` (NO `FOR KEY SHARE`: el `UPDATE orders SET
        // status` de F22 toma `FOR NO KEY UPDATE`, que solo choca con `FOR SHARE`). Así, con READ COMMITTED: (a) si la transición
        // ya confirmó, el candado espera, relee la fila VIGENTE y `status NOT IN (…)` falla => 0 filas => 409 `ORDER_NOT_PAYABLE`;
        // (b) si el cobro toma el candado primero, la transición ESPERA a que el cobro confirme y luego cancela => `paid` +
        // `cancelled` = «posible devolución pendiente» (resultado válido y consistente, nunca un estado a medias). Sin interbloqueo:
        // el cobro bloquea `orders` (compartido) y LUEGO `payments`; la transición solo bloquea `orders` (y escribe historial y
        // auditoría) y jamás toca `payments`, así que no hay ciclo. El orden es siempre pedido -> pago.
        const rows = await client.$queryRaw<{ received_at: Date; change: string }[]>(Prisma.sql`
          WITH upd AS (
            UPDATE app.payments p
               SET status = 'paid',
                   tendered_amount = ${input.tendered}::numeric,
                   change_amount = ${input.tendered}::numeric - p.amount,
                   collector_type = 'STAFF',
                   received_by_staff_id = ${input.staffId}::uuid,
                   collection_context = ${input.context}::text,
                   received_at = clock_timestamp(),
                   confirm_key_hash = ${new Uint8Array(input.keyHash)},
                   confirm_request_hash = ${new Uint8Array(input.requestHash)},
                   updated_at = clock_timestamp()
              FROM (SELECT id, status FROM app.orders WHERE id = ${input.orderId}::uuid FOR SHARE) o
             WHERE p.id = ${input.paymentId}::uuid AND p.order_id = o.id AND p.status = 'pending'
               AND o.status NOT IN ('rejected', 'cancelled')
            RETURNING p.id, p.order_id, p.amount, p.tendered_amount, p.change_amount, p.received_at
          ), ev AS (
            INSERT INTO app.payment_events
              (payment_id, order_id, event_type, actor_staff_id, amount, tendered_amount, change_amount, occurred_at)
            SELECT id, order_id, 'cash_received', ${input.staffId}::uuid, amount, tendered_amount, change_amount, received_at
              FROM upd
            RETURNING 1
          )
          SELECT received_at, change_amount::text AS change FROM upd`);
        const r = rows[0];
        return r ? { receivedAt: r.received_at, change: r.change } : null;
      },
      audit: (event: AuditEventInput) => this.audit.record(client, event),
    };
  }
}
