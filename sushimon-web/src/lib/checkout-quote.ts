import type { components } from '@sushimon/contracts';
import type {
  CheckoutBlocker,
  CheckoutClientView,
  CheckoutFulfillmentInput,
  CheckoutQuote,
  CheckoutQuoteLine,
  CheckoutQuoteRequest,
} from '@/lib/data-access/models';
import { ApiError } from '@/lib/data-access/errors';
import { sortSelections, type CartLine, type CartQuoteInput } from '@/lib/cart-rules';

/**
 * F19 (spec 020, ADR-0025) — Reglas PURAS de la cotización de checkout en la web: huella canónica de las entradas, cuerpo de la
 * solicitud, vista del cliente, vigencia, clasificación de errores y códigos estables. Sin React ni red.
 *
 * El SERVIDOR es la autoridad del dinero: aquí NO se calcula ningún importe definitivo. La huella solo identifica las ENTRADAS
 * (sucursal, líneas, selecciones, modalidad, dirección, proveedor, cupón); `clientView` queda fuera (es una pista, no una entrada).
 */

export type CourierProvider = components['schemas']['CourierProvider'];

/** Entradas de la cotización (todo lo que cambia el resultado) + la pista `clientView` (que NO cambia la clave). */
export interface QuoteInputs {
  cart: CartQuoteInput;
  fulfillment: CheckoutFulfillmentInput;
  /** Cupón YA normalizado (`normalizeCoupon`); `''` = sin cupón. */
  couponCode: string;
  clientView?: CheckoutClientView;
}

/** Cupón: recortado, espacios colapsados y en mayúsculas. El servidor lo normaliza igual; aquí solo estabiliza la clave. */
export const normalizeCoupon = (raw: string): string =>
  raw.trim().replace(/\s+/g, ' ').toUpperCase();

/** Tope del campo (contrato: `maxLength: 64`). */
export const COUPON_MAX_LENGTH = 64;

/** Importe en centavos → cadena canónica del contrato (`"85.00"`). Nunca coma flotante. */
export const centsToMoney = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** Cadena canónica del contrato (`"85.00"`) → centavos enteros (`null` si no es canónica). */
export function moneyToCents(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,9})\.(\d{2})$/.exec(value);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

const fulfillmentKey = (f: CheckoutFulfillmentInput): string =>
  f.type === 'PICKUP'
    ? 'PICKUP'
    : [
        'DELIVERY',
        f.customerAddressId ? `a:${f.customerAddressId}` : `m:${f.municipalityId ?? ''}`,
        f.customerAddressId ? '' : `z:${(f.zone ?? '').trim().toLowerCase()}`,
        `p:${f.deliveryProvider ?? ''}`,
      ].join('|');

/**
 * Huella canónica de las entradas: la MISMA entrada produce la MISMA cadena (las líneas ya vienen ordenadas por `toQuoteInput`) y
 * cualquier cambio de sucursal, producto, cantidad, extra, modalidad, dirección, proveedor o cupón la cambia. No incluye
 * `clientView` ni textos de presentación. Es la clave de TanStack Query: nunca se reutiliza la respuesta de otra huella.
 */
export function quoteFingerprint(inputs: QuoteInputs): string {
  const lines = inputs.cart.lines
    .map((l) => {
      const selections = l.selections
        .map((s) => `${s.groupId}:${s.optionId}:${s.quantity}`)
        .join(',');
      return `${l.productId}x${l.quantity}[${selections}]`;
    })
    .join(';');
  return [
    `b:${inputs.cart.branchId}`,
    `l:${lines}`,
    `f:${fulfillmentKey(inputs.fulfillment)}`,
    `c:${inputs.couponCode}`,
  ].join('#');
}

/** Cuerpo de `POST /v1/checkout/quote`. Sin importes: solo ids, cantidades, modalidad, dirección y cupón (+ pista `clientView`). */
export function buildQuoteRequest(inputs: QuoteInputs): CheckoutQuoteRequest {
  return {
    cart: inputs.cart,
    fulfillment: inputs.fulfillment,
    ...(inputs.couponCode ? { couponCode: inputs.couponCode } : {}),
    ...(inputs.clientView ? { clientView: inputs.clientView } : {}),
  };
}

/** Clave estable de una configuración (producto + selecciones) para emparejar líneas del carrito con las cotizadas. */
export const configKey = (
  productId: string,
  selections: readonly { groupId: string; optionId: string }[],
): string =>
  `${productId}|${sortSelections(selections)
    .map((s) => `${s.groupId}:${s.optionId}`)
    .join(',')}`;

export const quoteLineKey = (line: CheckoutQuoteLine): string =>
  configKey(line.productId, line.modifiers);

/**
 * Pista `clientView` (NO autoritativa): el precio unitario de producto que el cliente VIO por cada línea cotizada (`index` de
 * `cart.lines`) y, si lo hay, el total que ya tenía en pantalla (solo del servidor). El servidor solo produce avisos con ella.
 */
export function buildClientView(
  quoteCart: CartQuoteInput,
  cartLines: readonly CartLine[],
  shownTotal: string | null,
): CheckoutClientView | undefined {
  const seen = new Map<string, number>();
  for (const line of cartLines) {
    const key = configKey(line.productId, line.selections);
    if (!seen.has(key)) seen.set(key, line.display.unitCents);
  }
  const lines: { index: number; unitPrice: string }[] = [];
  quoteCart.lines.forEach((l, index) => {
    const cents = seen.get(configKey(l.productId, l.selections));
    if (cents !== undefined && Number.isSafeInteger(cents) && cents >= 0) {
      lines.push({ index, unitPrice: centsToMoney(cents) });
    }
  });
  if (lines.length === 0 && !shownTotal) return undefined;
  return { ...(lines.length ? { lines } : {}), ...(shownTotal ? { total: shownTotal } : {}) };
}

// ── Vigencia ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Duración de la vigencia (ms) = `expiresAt − generatedAt`. Se mide contra el instante de LLEGADA de la respuesta (reloj local) y
 * no contra `expiresAt`, así un reloj del dispositivo desfasado no marca como vencida una cotización recién emitida.
 * `null` si el contrato no se cumple (fechas ilegibles o no positivas).
 */
export function quoteTtlMs(quote: CheckoutQuote): number | null {
  const ttl = Date.parse(quote.quote.expiresAt) - Date.parse(quote.quote.generatedAt);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : null;
}

// ── Códigos estables ─────────────────────────────────────────────────────────────────────────────────────

export const LINE_BLOCKER_CODES = [
  'UNAVAILABLE',
  'INACTIVE',
  'NOT_FOUND',
  'MODIFIER_INVALID',
  'OPTION_UNAVAILABLE',
] as const;
export const FULFILLMENT_BLOCKER_CODES = [
  'ADDRESS_INCOMPLETE',
  'DELIVERY_UNAVAILABLE',
  'DELIVERY_UNVERIFIED',
  'DELIVERY_PROVIDER_NOT_SELECTABLE',
] as const;
const BLOCKER_CODES = [
  ...LINE_BLOCKER_CODES,
  ...FULFILLMENT_BLOCKER_CODES,
  'BRANCH_CLOSED',
] as const;
const NOTICE_CODES = ['PRICE_CHANGED', 'TOTAL_CHANGED', 'PROMOTIONS_TRUNCATED'] as const;
const REASON_CODES = [
  'PROVIDER_DISABLED',
  'NO_ZONE_COVERAGE',
  'COVERAGE_UNKNOWN',
  'SIMULATED',
  'CUSTOMER_FEE_UNDEFINED',
] as const;

const pick = <T extends string>(list: readonly T[], value: string | undefined): T | 'UNKNOWN' =>
  list.find((x) => x === value) ?? 'UNKNOWN';

/** Clave de mensaje (`checkout.quote.*`) de un bloqueo; un código futuro cae en el genérico (el contrato dice tolerarlos). */
export const blockerMessageKey = (code: string) =>
  `checkout.quote.blockers.${pick(BLOCKER_CODES, code)}` as const;
export const noticeMessageKey = (code: string) =>
  `checkout.quote.notices.${pick(NOTICE_CODES, code)}` as const;
export const reasonMessageKey = (reason: string | undefined) =>
  `checkout.quote.reasons.${pick(REASON_CODES, reason)}` as const;

/** ¿El bloqueo es de una línea (se corrige en «Tu pedido»)? */
export const isLineBlocker = (b: CheckoutBlocker): boolean => b.scope === 'LINE';

/**
 * ¿Se puede continuar? `canProceed` del servidor, salvo el horario cuando el cliente (SOLO con datos simulados) programó el pedido:
 * la cotización siempre es «ahora» y `BRANCH_CLOSED` no aplica a un pedido programado (P42).
 */
export function canProceedFor(quote: CheckoutQuote, scheduled: boolean): boolean {
  if (quote.canProceed) return true;
  return (
    scheduled &&
    quote.blockers.length > 0 &&
    quote.blockers.every((b) => b.code === 'BRANCH_CLOSED')
  );
}

// ── Errores ──────────────────────────────────────────────────────────────────────────────────────────────

export type QuoteErrorKind =
  | 'offline'
  | 'busy'
  | 'rate-limited'
  | 'branch-unavailable'
  | 'session'
  | 'not-found'
  | 'invalid'
  | 'unknown';

/** Clasifica el error de la cotización por estado HTTP y código de negocio estable (nunca por el texto del mensaje). */
export function classifyQuoteError(error: unknown): QuoteErrorKind {
  if (!(error instanceof ApiError)) return 'unknown';
  if (error.status === 0) return 'offline';
  if (error.status === 503) return 'busy';
  if (error.status === 429) return 'rate-limited';
  if (error.status === 422 && error.businessCode === 'BRANCH_NOT_AVAILABLE') {
    return 'branch-unavailable';
  }
  if (error.status === 401) return 'session';
  if (error.status === 404) return 'not-found';
  if (error.status === 400 || error.status === 422) return 'invalid';
  return 'unknown';
}

/** Reintento automático acotado: UNA vez ante 503 (`CHECKOUT_BUSY`) o red caída; nunca ante 4xx (incluye 429). */
export function shouldRetryQuote(failureCount: number, error: unknown): boolean {
  const kind = classifyQuoteError(error);
  return (kind === 'busy' || kind === 'offline') && failureCount < 1;
}
