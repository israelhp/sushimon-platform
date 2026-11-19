import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LAZY_PURGE_BATCH, LAZY_PURGE_PROBABILITY } from './order-idempotency.js';
import type {
  CreateOutcome,
  IdempotencyClaim,
  NewOrder,
  OrderRecord,
  StoredIdempotency,
} from './orders.types.js';
import type { IssuedGuestToken } from './order-access-token.js';
import { hashesEqual } from './order-idempotency.js';
import { ordersBusy, ordersUnavailable } from './orders-errors.js';
import { TRACKING_HISTORY_READ_LIMIT } from './order-tracking.mapper.js';
import type { OrderTrackingRecord } from './order-tracking.types.js';

/**
 * Espera máxima por la fila de una clave de idempotencia retenida por otra transacción (`SET LOCAL lock_timeout`). 2 s: acota
 * el tiempo que una conexión del pool queda bloqueada (revisión de rendimiento); al vencer => 409 `IDEMPOTENCY_IN_PROGRESS`.
 */
export const LOCK_TIMEOUT = '2s';
/** Espera por una conexión del pool para abrir la transacción, alineada con `LOCK_TIMEOUT`. */
export const TX_MAX_WAIT_MS = 2_000;
/** Tokens de invitado vigentes que se conservan por pedido (los más recientes); los demás se revocan. */
export const MAX_ACTIVE_GUEST_TOKENS = 5;

/** Campos que se LEEN para responder: sin correo ni coordenadas (minimización de PII). */
const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  customerId: true,
  branchId: true,
  customerName: true,
  customerPhone: true,
  fulfillmentType: true,
  deliveryProvider: true,
  notes: true,
  status: true,
  subtotal: true,
  extrasTotal: true,
  discountTotal: true,
  deliveryFee: true,
  total: true,
  paymentMethodPreference: true,
  // F24: pago real (relación 1:1 por `UNIQUE(order_id)`); sin empleado, hashes ni historial.
  payment: {
    select: {
      status: true,
      amount: true,
      tenderedAmount: true,
      changeAmount: true,
      receivedAt: true,
    },
  },
  placedAt: true,
  updatedAt: true,
  address: {
    select: { municipalityName: true, zone: true, addressLine: true, referenceNote: true },
  },
  items: {
    orderBy: { lineNo: 'asc' },
    select: {
      lineNo: true,
      productName: true,
      quantity: true,
      unitPrice: true,
      extrasPerUnit: true,
      lineDiscount: true,
      notes: true,
      modifiers: {
        orderBy: { modifierName: 'asc' },
        select: { modifierName: true, unitExtraPrice: true },
      },
    },
  },
  promotions: {
    orderBy: { promotionName: 'asc' },
    select: { promotionName: true, amount: true },
  },
} satisfies Prisma.OrderSelect;

/**
 * Seguimiento (F21, spec 022 §6.3): SOLO las columnas necesarias (sin contacto, dirección, notas ni importes) y el historial
 * (`newStatus`, `changedAt`; sin `id`, `oldStatus`, `changedBy` ni `reason`) los 51 eventos más RECIENTES (orden
 * `changed_at desc, id desc`; el 51.º detecta el truncamiento) que se devuelven en orden cronológico ascendente. Prisma emite 2 sentencias (pedido + historial por el índice `order_status_history_order_idx`).
 */
const TRACKING_SELECT = {
  id: true,
  orderNumber: true,
  branchId: true,
  fulfillmentType: true,
  deliveryProvider: true,
  status: true,
  placedAt: true,
  updatedAt: true,
  payment: { select: { status: true, receivedAt: true } },
  statusHistory: {
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    take: TRACKING_HISTORY_READ_LIMIT,
    select: { newStatus: true, changedAt: true },
  },
} satisfies Prisma.OrderSelect;

type TrackingRow = Prisma.OrderGetPayload<{ select: typeof TRACKING_SELECT }>;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

/** `Prisma.Decimal` -> `DecimalLike` y `tenderedAmount`/`changeAmount` -> `tendered`/`change` (el dominio no conoce Prisma). */
function toOrderRecord(row: OrderRow | null): OrderRecord | null {
  if (!row) return null;
  const { payment, ...order } = row;
  return {
    ...order,
    payment: payment
      ? {
          status: payment.status,
          amount: payment.amount,
          tendered: payment.tenderedAmount,
          change: payment.changeAmount,
          receivedAt: payment.receivedAt,
        }
      : null,
  };
}

function toTrackingRecord(row: TrackingRow | null): OrderTrackingRecord | null {
  if (!row) return null;
  const { statusHistory, payment, ...order } = row;
  // La consulta trae los MÁS RECIENTES (desc) para no perder el último evento; se entregan en orden cronológico.
  return { ...order, payment, history: [...statusHistory].reverse() };
}

/**
 * Acceso a datos de los pedidos (F20, spec 021 §4 y §7). La transacción de creación SOLO escribe (~10 sentencias por
 * lote, 1 conexión, sin red): reclama la clave de idempotencia ANTES de gastar un número de secuencia. El SQL aquí NO se
 * ha ejecutado contra PostgreSQL real salvo por `test/orders.int-spec.ts` (ver su cabecera).
 */
@Injectable()
export class OrdersRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- idempotencia ----------

  /**
   * Fast path: fila de la clave del alcance (vigente o vencida) o `null`. Una consulta, fuera de transacción. `expired`
   * permite que el llamador purgue SOLO si hace falta (`purgeExpired`), sin una consulta extra.
   */
  async findIdempotent(
    scope: string,
    keyHash: Buffer,
    now: Date,
  ): Promise<StoredIdempotency | null> {
    const row = await this.prisma.orderIdempotencyKey.findFirst({
      where: { scope, keyHash: new Uint8Array(keyHash) },
      select: { requestHash: true, orderId: true, expiresAt: true },
    });
    return row
      ? { requestHash: row.requestHash, orderId: row.orderId, expired: row.expiresAt <= now }
      : null;
  }

  /**
   * Borrado PEREZOSO (sin cron): la fila vencida de ESTA clave SOLO si `findIdempotent` la encontró vencida
   * (`expiredSeen`) y, con probabilidad 1/50, hasta 100 filas vencidas de cualquier clave. Se ejecuta justo antes de la
   * transacción de creación.
   */
  async purgeExpired(
    scope: string,
    keyHash: Buffer,
    now: Date,
    expiredSeen: boolean,
  ): Promise<void> {
    if (expiredSeen) {
      await this.prisma.orderIdempotencyKey.deleteMany({
        where: { scope, keyHash: new Uint8Array(keyHash), expiresAt: { lte: now } },
      });
    }
    if (Math.random() < LAZY_PURGE_PROBABILITY) {
      await this.prisma.$executeRaw`
        DELETE FROM app.order_idempotency_keys
         WHERE id IN (SELECT id FROM app.order_idempotency_keys WHERE expires_at < ${now} LIMIT ${LAZY_PURGE_BATCH})`;
    }
  }

  /**
   * Pedidos `pending` recientes (24 h) de un CLIENTE autenticado (tope P51; índice `orders_customer_placed_idx`). Los de
   * invitado NO se limitan por teléfono (vector de denegación dirigida): su freno son los throttles (y P55 antes de producción).
   */
  countPending(customerId: string, since: Date): Promise<number> {
    return this.prisma.order.count({
      where: { status: 'pending', placedAt: { gte: since }, customerId },
    });
  }

  // ---------- creación ----------

  /**
   * Transacción de creación (READ COMMITTED, 1 conexión). Orden: `lock_timeout` local -> reclamo de la clave
   * (`INSERT … ON CONFLICT DO NOTHING`, que Prisma emite con `createMany({ skipDuplicates })`; un concurrente se BLOQUEA
   * aquí hasta que el ganador confirme o revierta) -> pedido -> dirección -> líneas -> extras -> promociones ->
   * historial inicial `pending` -> token de invitado -> auditoría `order.created`. La FK `order_id` de la clave es
   * DEFERRABLE: se comprueba al COMMIT. Si algo falla, TODO revierte (clave incluida).
   */
  async createOrder(claim: IdempotencyClaim, order: NewOrder): Promise<CreateOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        const claimed = await tx.orderIdempotencyKey.createMany({
          data: [
            {
              id: randomUUID(),
              scope: claim.scope,
              keyHash: new Uint8Array(claim.keyHash),
              requestHash: new Uint8Array(claim.requestHash),
              orderId: order.orderId,
              expiresAt: claim.expiresAt,
            },
          ],
          skipDuplicates: true,
        });
        if (claimed.count === 0) {
          // Otra transacción ya tiene (o confirmó) la clave: se descarta esta y se responde como repetición.
          const stored = await tx.orderIdempotencyKey.findFirst({
            where: { scope: claim.scope, keyHash: new Uint8Array(claim.keyHash) },
            select: { requestHash: true, orderId: true },
          });
          if (!stored) throw ordersBusy(); // el ganador revirtió o la fila venció entre medias: reintentar
          return hashesEqual(stored.requestHash, claim.requestHash)
            ? { kind: 'replay', orderId: stored.orderId }
            : { kind: 'reused' };
        }

        const created = await tx.order.create({
          data: {
            id: order.orderId,
            customerId: order.customerId,
            branchId: order.branchId,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            customerEmail: order.customerEmail,
            fulfillmentType: order.fulfillmentType,
            deliveryProvider: order.deliveryProvider,
            notes: order.notes,
            status: 'pending',
            subtotal: order.subtotal,
            extrasTotal: order.extrasTotal,
            discountTotal: order.discountTotal,
            deliveryFee: order.deliveryFee,
            total: order.total,
            currency: 'GTQ',
            paymentMethodPreference: order.paymentMethodPreference,
          },
          select: { orderNumber: true, placedAt: true, updatedAt: true },
        });
        if (order.address) {
          await tx.orderAddress.create({
            data: { orderId: order.orderId, ...order.address },
          });
        }
        const itemIds = order.lines.map(() => randomUUID());
        await tx.orderItem.createMany({
          data: order.lines.map((l, i) => ({
            id: itemIds[i] as string,
            orderId: order.orderId,
            lineNo: l.lineNo,
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            extrasPerUnit: l.extrasPerUnit,
            lineDiscount: l.lineDiscount,
          })),
        });
        const modifiers = order.lines.flatMap((l, i) =>
          l.modifiers.map((m) => ({
            orderItemId: itemIds[i] as string,
            modifierId: m.modifierId,
            modifierName: m.modifierName,
            quantity: 1,
            unitExtraPrice: m.unitExtraPrice,
          })),
        );
        if (modifiers.length > 0) await tx.orderItemModifier.createMany({ data: modifiers });
        if (order.promotions.length > 0) {
          await tx.orderPromotion.createMany({
            data: order.promotions.map((p) => ({ orderId: order.orderId, ...p })),
          });
        }
        await tx.orderStatusHistory.create({
          data: { orderId: order.orderId, oldStatus: null, newStatus: 'pending' },
        });
        // F24 (spec 025 §5.5): el pago en efectivo nace `pending` en la MISMA transacción, en UNA sentencia (CTE: pago + evento
        // `created`), leyendo `orders.total` y el método `cash` dentro de la sentencia. Un reintento idempotente retorna ARRIBA
        // (ruta `replay`) antes de llegar aquí, y `UNIQUE(order_id)` lo garantiza además. Sin el método `cash` activo (seed
        // ausente) no se inserta nada => revierte TODO con 503 `ORDERS_UNAVAILABLE` (fail-closed).
        const paymentRows = await tx.$executeRaw`
          WITH p AS (
            INSERT INTO app.payments (order_id, method_id, branch_id, amount)
            SELECT o.id, m.id, o.branch_id, o.total
              FROM app.orders o JOIN app.payment_methods m ON m.code = 'cash' AND m.active
             WHERE o.id = ${order.orderId}::uuid
            RETURNING id, order_id, amount
          )
          INSERT INTO app.payment_events (payment_id, order_id, event_type, amount)
          SELECT id, order_id, 'created', amount FROM p`;
        if (paymentRows !== 1) throw ordersUnavailable();
        if (order.guestToken) {
          await tx.orderAccessToken.create({
            data: {
              orderId: order.orderId,
              tokenHash: new Uint8Array(order.guestToken.hash),
              expiresAt: order.guestToken.expiresAt,
            },
          });
        }
        // Rastro de quién/cuándo en la MISMA transacción. `actor_id` es `staff_users.id`: el cliente/invitado no es
        // personal => NULL. Sin PII (ni contacto ni dirección ni notas).
        await this.audit.record(tx, {
          actorId: null,
          branchId: order.branchId,
          entityType: 'order',
          entityId: order.orderId,
          action: 'order.created',
          newValues: {
            status: 'pending',
            fulfillmentType: order.fulfillmentType,
            deliveryProvider: order.deliveryProvider,
            total: order.total,
            itemCount: order.itemCount,
            actor: order.customerId === null ? 'guest' : 'customer',
          },
        });
        return { kind: 'created', orderId: order.orderId, ...created } as const;
      },
      {
        timeout: 15_000,
        maxWait: TX_MAX_WAIT_MS,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  // ---------- lecturas ----------

  /** Pedido por id (ya autorizado por el llamador: repetición idempotente). */
  async findById(id: string): Promise<OrderRecord | null> {
    return toOrderRecord(
      await this.prisma.order.findUnique({ where: { id }, select: ORDER_SELECT }),
    );
  }

  /** Pedido del cliente dueño (`customer_id` = el de la sesión). Un pedido de invitado (NULL) nunca coincide. */
  async findForCustomer(id: string, customerId: string): Promise<OrderRecord | null> {
    return toOrderRecord(
      await this.prisma.order.findFirst({ where: { id, customerId }, select: ORDER_SELECT }),
    );
  }

  /** Pedido accesible con un token de invitado vigente y no revocado (compara el sha256 indexado). */
  async findForGuestToken(id: string, tokenHash: Buffer, now: Date): Promise<OrderRecord | null> {
    return toOrderRecord(
      await this.prisma.order.findFirst({
        where: {
          id,
          accessTokens: {
            some: {
              tokenHash: new Uint8Array(tokenHash),
              revokedAt: null,
              expiresAt: { gt: now },
            },
          },
        },
        select: ORDER_SELECT,
      }),
    );
  }

  /**
   * Seguimiento (F21) del pedido del cliente dueño, autorizado en la MISMA consulta por el `auth_user_id` de la sesión (join
   * a `customers`; sin leer la fila del cliente). Un pedido de invitado (`customer_id` NULL) nunca coincide. SOLO lectura.
   */
  async findTrackingForOwnerAuthUser(
    id: string,
    authUserId: string,
  ): Promise<OrderTrackingRecord | null> {
    return toTrackingRecord(
      await this.prisma.order.findFirst({
        where: { id, customer: { authUserId } },
        select: TRACKING_SELECT,
      }),
    );
  }

  /** Seguimiento (F21) con un token de invitado vigente y no revocado (mismo criterio que `findForGuestToken`). */
  async findTrackingForGuestToken(
    id: string,
    tokenHash: Buffer,
    now: Date,
  ): Promise<OrderTrackingRecord | null> {
    return toTrackingRecord(
      await this.prisma.order.findFirst({
        where: {
          id,
          accessTokens: {
            some: { tokenHash: new Uint8Array(tokenHash), revokedAt: null, expiresAt: { gt: now } },
          },
        },
        select: TRACKING_SELECT,
      }),
    );
  }

  /**
   * Repetición de invitado: emite un token ADICIONAL (el vigente NO se revoca: conocer clave + cuerpo equivale a poseer el
   * pedido y revocar permitiría a quien repita la petición expulsar al dueño). Para acotar el crecimiento se revocan solo
   * los activos que excedan los `MAX_ACTIVE_GUEST_TOKENS` más recientes. Transacción corta.
   */
  async issueGuestToken(
    orderId: string,
    issued: Pick<IssuedGuestToken, 'hash' | 'expiresAt'>,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        await tx.orderAccessToken.create({
          data: {
            orderId,
            tokenHash: new Uint8Array(issued.hash),
            expiresAt: issued.expiresAt,
          },
        });
        const excess = await tx.orderAccessToken.findMany({
          where: { orderId, revokedAt: null },
          orderBy: { createdAt: 'desc' },
          skip: MAX_ACTIVE_GUEST_TOKENS,
          select: { id: true },
        });
        if (excess.length > 0) {
          await tx.orderAccessToken.updateMany({
            where: { id: { in: excess.map((t) => t.id) } },
            data: { revokedAt: now },
          });
        }
      },
      {
        timeout: 10_000,
        maxWait: TX_MAX_WAIT_MS,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
