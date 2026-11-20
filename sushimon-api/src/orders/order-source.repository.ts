import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { DecimalLike, OrderPaymentRecord, OrderRecord } from './orders.types.js';

export interface OrderSourceModifier {
  modifierId: string | null;
  modifierName: string;
  unitExtraPrice: string;
}

export interface OrderSourceLine {
  lineNo: number;
  /** `null` si el producto ya no está enlazado (el snapshot conserva el nombre). */
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: string;
  extrasPerUnit: string;
  lineDiscount: string;
  notes: string | null;
  modifiers: OrderSourceModifier[];
}

/**
 * Pedido completo LEÍDO en UNA sentencia (cabecera + sucursal + dirección + líneas con extras + promociones) para el recibo y la
 * vista previa de «Volver a pedir» (F23, spec 024 §4.2 y §8.4). Solo snapshots: sin correo ni coordenadas, sin historial.
 */
export interface OrderSource {
  id: string;
  orderNumber: bigint;
  status: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  branchId: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string | null;
  customerName: string;
  customerPhone: string;
  notes: string | null;
  subtotal: string;
  extrasTotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  paymentMethodPreference: string | null;
  /** F24: pago real (LEFT JOIN `payments`, `UNIQUE(order_id)`); `null` = pedido histórico sin fila de pago. */
  payment: {
    status: string;
    amount: string;
    tendered: string | null;
    change: string | null;
    receivedAt: Date | null;
  } | null;
  placedAt: Date;
  updatedAt: Date;
  address: {
    municipalityName: string;
    zone: string | null;
    addressLine: string;
    referenceNote: string | null;
  } | null;
  lines: OrderSourceLine[];
  promotions: { promotionName: string; amount: string }[];
}

interface SourceDbRow {
  id: string;
  order_number: bigint;
  status: string;
  fulfillment_type: string;
  delivery_provider: string | null;
  branch_id: string;
  branch_name: string;
  branch_address: string;
  branch_phone: string | null;
  customer_name: string;
  customer_phone: string;
  notes: string | null;
  subtotal: string;
  extras_total: string;
  discount_total: string;
  delivery_fee: string;
  total: string;
  payment_method_preference: string | null;
  payment_status: string | null;
  payment_amount: string | null;
  payment_tendered: string | null;
  payment_change: string | null;
  payment_received_at: Date | null;
  placed_at: Date;
  updated_at: Date;
  address: unknown;
  lines: unknown;
  promotions: unknown;
}

/** Prisma devuelve `json` ya interpretado; por si un adaptador lo entrega como texto. */
const asJson = <T>(value: unknown): T =>
  typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);

const dec = (value: string): DecimalLike => ({ toFixed: () => value });

const toSource = (r: SourceDbRow): OrderSource => ({
  id: r.id,
  orderNumber: BigInt(r.order_number),
  status: r.status,
  fulfillmentType: r.fulfillment_type,
  deliveryProvider: r.delivery_provider,
  branchId: r.branch_id,
  branchName: r.branch_name,
  branchAddress: r.branch_address,
  branchPhone: r.branch_phone,
  customerName: r.customer_name,
  customerPhone: r.customer_phone,
  notes: r.notes,
  subtotal: r.subtotal,
  extrasTotal: r.extras_total,
  discountTotal: r.discount_total,
  deliveryFee: r.delivery_fee,
  total: r.total,
  paymentMethodPreference: r.payment_method_preference,
  payment:
    r.payment_status !== null && r.payment_amount !== null
      ? {
          status: r.payment_status,
          amount: r.payment_amount,
          tendered: r.payment_tendered,
          change: r.payment_change,
          receivedAt: r.payment_received_at,
        }
      : null,
  placedAt: r.placed_at,
  updatedAt: r.updated_at,
  address: r.address === null ? null : asJson<NonNullable<OrderSource['address']>>(r.address),
  lines: asJson<OrderSourceLine[]>(r.lines),
  promotions: asJson<OrderSource['promotions']>(r.promotions),
});

/**
 * `OrderSource` -> `OrderRecord` (F20) para reutilizar `toOrderDetail` y que el recibo tenga EXACTAMENTE las mismas cifras que
 * `getOrder` (spec 024 §11 #23). Los importes ya vienen como cadena exacta de `numeric(12,2)`.
 */
const sourcePayment = (source: OrderSource): OrderPaymentRecord | null =>
  source.payment
    ? {
        status: source.payment.status,
        amount: dec(source.payment.amount),
        tendered: source.payment.tendered === null ? null : dec(source.payment.tendered),
        change: source.payment.change === null ? null : dec(source.payment.change),
        receivedAt: source.payment.receivedAt,
      }
    : null;

export function sourceToOrderRecord(source: OrderSource): OrderRecord {
  return {
    id: source.id,
    orderNumber: source.orderNumber,
    customerId: null,
    branchId: source.branchId,
    customerName: source.customerName,
    customerPhone: source.customerPhone,
    fulfillmentType: source.fulfillmentType,
    deliveryProvider: source.deliveryProvider,
    notes: source.notes,
    status: source.status,
    subtotal: dec(source.subtotal),
    extrasTotal: dec(source.extrasTotal),
    discountTotal: dec(source.discountTotal),
    deliveryFee: dec(source.deliveryFee),
    total: dec(source.total),
    paymentMethodPreference: source.paymentMethodPreference,
    payment: sourcePayment(source),
    placedAt: source.placedAt,
    updatedAt: source.updatedAt,
    address: source.address,
    items: source.lines.map((l) => ({
      lineNo: l.lineNo,
      productName: l.productName,
      quantity: l.quantity,
      unitPrice: dec(l.unitPrice),
      extrasPerUnit: dec(l.extrasPerUnit),
      lineDiscount: dec(l.lineDiscount),
      notes: l.notes,
      modifiers: l.modifiers.map((m) => ({
        modifierName: m.modifierName,
        unitExtraPrice: dec(m.unitExtraPrice),
      })),
    })),
    promotions: source.promotions.map((p) => ({
      promotionName: p.promotionName,
      amount: dec(p.amount),
    })),
  };
}

const SOURCE_COLUMNS = Prisma.sql`
  o.id, o.order_number, o.status, o.fulfillment_type, o.delivery_provider, o.branch_id,
  b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
  o.customer_name, o.customer_phone, o.notes,
  o.subtotal::text AS subtotal, o.extras_total::text AS extras_total, o.discount_total::text AS discount_total,
  o.delivery_fee::text AS delivery_fee, o.total::text AS total,
  o.payment_method_preference, o.placed_at, o.updated_at,
  p.status AS payment_status, p.amount::text AS payment_amount, p.tendered_amount::text AS payment_tendered,
  p.change_amount::text AS payment_change, p.received_at AS payment_received_at,
  CASE WHEN a.order_id IS NULL THEN NULL ELSE json_build_object(
    'municipalityName', a.municipality_name, 'zone', a.zone,
    'addressLine', a.address_line, 'referenceNote', a.reference_note) END AS address,
  COALESCE((SELECT json_agg(json_build_object(
      'lineNo', i.line_no, 'productId', i.product_id, 'productName', i.product_name, 'quantity', i.quantity,
      'unitPrice', i.unit_price::text, 'extrasPerUnit', i.extras_per_unit::text,
      'lineDiscount', i.line_discount::text, 'notes', i.notes,
      'modifiers', COALESCE((SELECT json_agg(json_build_object(
          'modifierId', m.modifier_id, 'modifierName', m.modifier_name,
          'unitExtraPrice', m.unit_extra_price::text) ORDER BY m.modifier_name, m.id)
        FROM app.order_item_modifiers m WHERE m.order_item_id = i.id), '[]'::json)
    ) ORDER BY i.line_no) FROM app.order_items i WHERE i.order_id = o.id), '[]'::json) AS lines,
  COALESCE((SELECT json_agg(json_build_object('promotionName', p.promotion_name, 'amount', p.amount::text)
      ORDER BY p.promotion_name, p.promotion_id)
    FROM app.order_promotions p WHERE p.order_id = o.id), '[]'::json) AS promotions`;

const FROM_SQL = Prisma.sql`
  FROM app.orders o
  JOIN app.branches b ON b.id = o.branch_id
  LEFT JOIN app.order_addresses a ON a.order_id = o.id
  LEFT JOIN app.payments p ON p.order_id = o.id`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lectura de SOLO LECTURA del pedido para el recibo y la vista previa (F23). La autorización va EN LA MISMA consulta (dueño por
 * join a `customers.auth_user_id`; invitado por hash del token vigente y no revocado): inexistente, ajeno y de invitado con JWT
 * dan la misma única sentencia y `null`. Presupuesto: 1 sentencia por intento (token, dueño). SQL parametrizado: nada del
 * cliente se interpola. Se prueba contra PostgreSQL real en `test/order-history.int-spec.ts` (ver su cabecera).
 */
@Injectable()
export class OrderSourceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findForOwner(id: string, authUserId: string): Promise<OrderSource | null> {
    // Un `sub` que no sea UUID nunca coincide (y evita un error 22P02 de la BD).
    if (!UUID.test(authUserId)) return null;
    const rows = await this.prisma.$queryRaw<SourceDbRow[]>(Prisma.sql`
      SELECT ${SOURCE_COLUMNS} ${FROM_SQL}
       WHERE o.id = ${id}::uuid
         AND EXISTS (SELECT 1 FROM app.customers c WHERE c.id = o.customer_id AND c.auth_user_id = ${authUserId}::uuid)`);
    return rows[0] ? toSource(rows[0]) : null;
  }

  async findForGuestToken(id: string, tokenHash: Buffer, now: Date): Promise<OrderSource | null> {
    const rows = await this.prisma.$queryRaw<SourceDbRow[]>(Prisma.sql`
      SELECT ${SOURCE_COLUMNS} ${FROM_SQL}
       WHERE o.id = ${id}::uuid
         AND EXISTS (SELECT 1 FROM app.order_access_tokens t
                      WHERE t.order_id = o.id AND t.token_hash = ${new Uint8Array(tokenHash)}
                        AND t.revoked_at IS NULL AND t.expires_at > ${now})`);
    return rows[0] ? toSource(rows[0]) : null;
  }

  /** Nombre de una sucursal (solo la vista previa con `branchId` distinto al del pedido); `null` si no existe. */
  async findBranchName(branchId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM app.branches WHERE id = ${branchId}::uuid`;
    return rows[0]?.name ?? null;
  }
}
