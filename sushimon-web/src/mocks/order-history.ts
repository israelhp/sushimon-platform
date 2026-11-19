import type { DraftOrder, OrderDetail } from '@/lib/data-access/models';
import { digits } from './domain';
import { lifecycleOf } from './order-tracking';
import type { MockStore, PlacedOrderRecord } from './store';

/**
 * F23 — Pedidos «persistidos» SIMULADOS derivados de los BORRADORES sembrados (historial de la cuenta de demostración): así el
 * historial, el detalle, el seguimiento, el recibo y «Volver a pedir» comparten UN solo camino (ids UUID y forma real del contrato)
 * en lugar de leer el borrador. La derivación es determinista (el UUID sale del número del pedido) y perezosa (se materializa al
 * pedirla). NO es la API: solo reproduce su forma.
 */

export const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const draftUuid = (draftId: string) => uuidFor(Number(digits(draftId)));
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cadena decimal de 2 posiciones (`"46.00"`) desde un importe del borrador. */
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function deriveRecord(draft: DraftOrder): PlacedOrderRecord {
  const fulfillmentType = draft.fulfillment === 'delivery' ? 'DELIVERY' : 'PICKUP';
  const provider =
    fulfillmentType === 'DELIVERY'
      ? draft.delivery?.provider === 'pedidosya'
        ? 'PEDIDOSYA'
        : 'OWN'
      : null;
  const detail: OrderDetail = {
    id: draftUuid(draft.id),
    orderNumber: Number(digits(draft.id)),
    displayNumber: draft.id,
    status: lifecycleOf(draft.status, fulfillmentType),
    branchId: draft.branchId,
    fulfillmentType,
    deliveryProvider: provider,
    currency: 'GTQ',
    lines: draft.lines.map((l) => ({
      productName: l.name,
      quantity: l.quantity,
      unitPrice: money(l.unitPrice),
      modifiers: [],
      extrasPerUnit: '0.00',
      lineSubtotal: money(l.subtotal),
      discount: '0.00',
      lineTotal: money(l.subtotal),
      notes: l.note || null,
    })),
    promotions: draft.discount > 0 ? [{ name: 'Promoción', amount: money(draft.discount) }] : [],
    address: draft.address
      ? {
          municipalityName: draft.address.municipality,
          zone: draft.address.zone ? `Zona ${draft.address.zone}` : null,
          addressLine: draft.address.line,
          referenceNote: draft.address.references || null,
        }
      : null,
    contact: {
      fullName: draft.customer.name,
      phoneMasked: `****${digits(draft.customer.phone).slice(-4)}`,
    },
    notes: draft.note || null,
    subtotal: money(draft.subtotal),
    extrasTotal: '0.00',
    discountTotal: money(draft.discount),
    deliveryFee: money(draft.deliveryFee),
    total: money(draft.total),
    payment: {
      methodPreference: draft.payment.method === 'cash' ? 'cash' : null,
      status: 'NOT_STARTED',
    },
    placedAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
  return {
    detail,
    draftId: draft.id,
    ownerEmail: draft.customer.email.trim().toLowerCase(),
    tokens: [],
    derived: true,
    lineRefs: draft.lines.map((l) => ({ productId: l.productId, modifiers: [] })),
  };
}

/** Registro del pedido real simulado de este borrador (lo crea si aún no existe). */
export function ensurePlacedRecord(store: MockStore, draft: DraftOrder): PlacedOrderRecord {
  store.placedOrders ??= [];
  const found = store.placedOrders.find((p) => p.draftId === draft.id);
  if (found) return syncFromDraft(store, found);
  const record = deriveRecord(draft);
  store.placedOrders.push(record);
  return record;
}

/** Un registro derivado sigue el estado de su borrador (la demo legada lo avanza sin tocar el registro). */
export function syncFromDraft(store: MockStore, record: PlacedOrderRecord): PlacedOrderRecord {
  if (!record.derived) return record;
  const draft = store.orders.find((o) => o.id === record.draftId);
  if (draft) {
    record.detail.status = lifecycleOf(draft.status, record.detail.fulfillmentType);
    record.detail.updatedAt = draft.updatedAt;
  }
  return record;
}

/** Materializa el registro derivado cuyo UUID es `id` (o `undefined` si ningún borrador lo produce). */
export function materializeById(store: MockStore, id: string): PlacedOrderRecord | undefined {
  if (!UUID_SHAPE.test(id)) return undefined;
  const draft = store.orders.find((o) => draftUuid(o.id) === id);
  return draft ? ensurePlacedRecord(store, draft) : undefined;
}
