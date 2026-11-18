import type { DraftOrder } from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';

/** Número de WhatsApp válido (internacional, 11–15 dígitos): igual que la guarda del prototipo. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/** `https://wa.me/<número>?text=<mensaje>`; sin mensaje abre solo el chat. null si el número no es válido. */
export function whatsappUrl(number: string | null | undefined, message?: string): string | null {
  const digits = whatsappDigits(number);
  if (!digits) return null;
  return message
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${digits}`;
}

export interface WhatsappMessageLabels {
  /** Plantilla ICU `incidents.waMsg` ({id} {date} {mode} {items} {total} {name}). */
  template: (values: Record<string, string>) => string;
  /** `mode.delivery` / `mode.pickup`. */
  delivery: string;
  pickup: string;
  /** Nombre de la sucursal del pedido. */
  branchName: string;
  locale: string;
}

/** Mensaje prellenado con los datos del pedido (como `By` del prototipo). El cliente solo agrega qué pasó. */
export function buildIncidentWhatsappMessage(
  order: DraftOrder,
  labels: WhatsappMessageLabels,
): string {
  return labels.template({
    id: order.id,
    date: formatDateTime(order.createdAt, labels.locale),
    mode: `${order.fulfillment === 'delivery' ? labels.delivery : labels.pickup} · ${labels.branchName}`,
    items: order.lines
      .map((l) => `${l.quantity}× ${l.name}${l.note ? ` (${l.note})` : ''}`)
      .join(', '),
    total: formatMoney(order.total, labels.locale),
    name: order.customer.name,
  });
}
