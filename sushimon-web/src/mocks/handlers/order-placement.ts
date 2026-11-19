import { ApiError, codeForStatus } from '@/lib/data-access/errors';
import type {
  CheckoutBlocker,
  CheckoutQuote,
  DraftOrder,
  OrderCreated,
  OrderDetail,
  OrderDetailLine,
  OrderDetailPromotion,
  OrderQuoteChange,
  OrderTracking,
} from '@/lib/data-access/models';
import { centsToPrice, priceToCents } from '@/lib/product-rules';
import { moneyToCents } from '@/lib/checkout-quote';
import {
  digits,
  effectivePriceAt,
  event,
  fail,
  isAwaitingPayment,
  isValidEmail,
  phoneKey,
  isValidPhone,
} from '../domain';
import { MUNICIPALITY_SEEDS } from '../fixtures/geography';
import { readMockQuoteToken, stableStringify, type MockQuoteEvidence } from '../quote-token';
import { sha256Hex } from '../sha256';
import type { MockStore, PlacedOrderRecord } from '../store';
import { buildOrderTracking } from '../order-tracking';
import { quoteCheckout } from './checkout';
import { now, requireCustomer, str, type Handler, type Req } from './shared';

/**
 * F20 — `POST /v1/orders` (`createOrder`) y lectura `GET /v1/orders/{id}` de pedidos «persistidos» SIMULADOS (spec 021, ADR-0026).
 * El mock EMULA al servidor con la MISMA forma del contrato (`OrderCreated` / `OrderDetail`) y los mismos errores: 400
 * `IDEMPOTENCY_KEY_INVALID`/forma, 409 `QUOTE_CHANGED`/`QUOTE_EXPIRED`/`IDEMPOTENCY_KEY_REUSED`, 422 `QUOTE_INVALID`/
 * `CHECKOUT_BLOCKED`/`CONTACT_INCOMPLETE`/`PAYMENT_METHOD_UNAVAILABLE`/`DELIVERY_PROVIDER_NOT_SELECTABLE`, 429 `RATE_LIMITED`/
 * `PENDING_ORDERS_LIMIT`, 503 `ORDERS_BUSY`/`ORDERS_UNAVAILABLE`. NO es seguridad: el token de cotización es un doble sin firma
 * (`quote-token.ts`) y la credencial de invitado es ficticia. Idempotencia en memoria del store por (ámbito, clave).
 *
 * Cada pedido crea además su BORRADOR enlazado (`store.orders`, id `MON-3xxxxx` = `displayNumber`) para que el seguimiento, el
 * backoffice y la pasarela NeoNet simulados sigan funcionando (F21/F22 retirarán el borrador). Nada se cobra ni se notifica.
 *
 * Fallos de prueba (`req.fault`, ver `window.__sushimonMockFaults`): `busy`, `unavailable`, `rate-limited`, `expired` y
 * `price-change` (sube el precio del primer producto en la sucursal: reproduce `QUOTE_CHANGED` de forma natural).
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const ALLOWED_KEYS = [
  'cart',
  'fulfillment',
  'couponCode',
  'quoteToken',
  'contact',
  'deliveryAddress',
  'notes',
  'paymentMethodPreference',
] as const;
const PENDING_LIMIT = 3;
const TOKEN_TTL_MS = 14 * 24 * 3600_000;
const RATE_LIMIT_RETRY_SEC = 2;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Error con el cuerpo completo del contrato (`ErrorResponse` + extensiones) y `Retry-After` opcional. */
function problem(
  status: number,
  code: string | undefined,
  message: string,
  extra: Obj = {},
  retryAfterSec?: number,
): never {
  const error = codeForStatus(status);
  throw new ApiError(
    status,
    error,
    message,
    undefined,
    Array.isArray(extra.details) ? (extra.details as string[]) : undefined,
    code,
    undefined,
    retryAfterSec,
    { statusCode: status, error, message, ...(code ? { code } : {}), ...extra },
  );
}

// ── Entrada ────────────────────────────────────────────────────────────────────────────────

interface Contact {
  fullName: string;
  phone: string;
  email: string;
}

interface ParsedOrder {
  cart: unknown;
  fulfillment: Obj;
  couponCode: string;
  quoteToken: string;
  contact: Partial<Contact>;
  deliveryAddress: { addressLine: string; referenceNote: string } | null;
  notes: string;
  preference: 'cash' | 'bank_transfer' | null;
}

const hasControl = (text: string) =>
  [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

function parseBody(req: Req): ParsedOrder {
  const raw = req.body;
  if (!isObj(raw))
    problem(400, undefined, 'Datos inválidos', { details: ['Cuerpo de la solicitud inválido'] });
  const issues: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key))
      issues.push(`${key}: campo no permitido`);
  }
  if (!isObj(raw.cart)) issues.push('cart: obligatorio');
  if (!isObj(raw.fulfillment)) issues.push('fulfillment: obligatorio');
  if (typeof raw.quoteToken !== 'string' || !raw.quoteToken) issues.push('quoteToken: obligatorio');

  const contact: Partial<Contact> = {};
  if (raw.contact !== undefined) {
    if (!isObj(raw.contact)) issues.push('contact: inválido');
    else {
      for (const key of Object.keys(raw.contact)) {
        if (!['fullName', 'phone', 'email'].includes(key))
          issues.push(`contact.${key}: campo no permitido`);
      }
      const { fullName, phone, email } = raw.contact;
      if (fullName !== undefined) {
        const name = str(fullName).trim();
        if (name.length < 2 || name.length > 120 || hasControl(name))
          issues.push('contact.fullName: 2–120 caracteres');
        else contact.fullName = name;
      }
      if (phone !== undefined) {
        if (!isValidPhone(str(phone))) issues.push('contact.phone: teléfono de Guatemala inválido');
        else contact.phone = `+502${phoneKey(str(phone))}`;
      }
      if (email !== undefined) {
        if (!isValidEmail(str(email)) || str(email).length > 254)
          issues.push('contact.email: correo inválido');
        else contact.email = str(email).trim();
      }
    }
  }

  let deliveryAddress: ParsedOrder['deliveryAddress'] = null;
  if (raw.deliveryAddress !== undefined) {
    const d = raw.deliveryAddress;
    if (!isObj(d)) issues.push('deliveryAddress: inválido');
    else {
      for (const key of Object.keys(d)) {
        if (!['addressLine', 'referenceNote'].includes(key))
          issues.push(`deliveryAddress.${key}: campo no permitido`);
      }
      const line = str(d.addressLine).trim();
      if (line.length < 1 || line.length > 200 || hasControl(line))
        issues.push('deliveryAddress.addressLine: 1–200 caracteres');
      deliveryAddress = { addressLine: line, referenceNote: str(d.referenceNote).trim() };
    }
  }

  const notes = raw.notes === undefined ? '' : str(raw.notes).trim();
  if (
    raw.notes !== undefined &&
    (typeof raw.notes !== 'string' || notes.length > 280 || hasControl(notes))
  ) {
    issues.push('notes: texto plano de hasta 280 caracteres');
  }
  const pref = raw.paymentMethodPreference;
  if (pref !== undefined && pref !== 'cash' && pref !== 'bank_transfer' && pref !== 'card') {
    issues.push('paymentMethodPreference: valor no permitido');
  }
  if (issues.length) problem(400, undefined, 'Datos inválidos', { details: issues });
  // La validación de FORMA de `cart` y `fulfillment` (topes, selecciones, importes) la hace el cotizador al recotizar (400).
  return {
    cart: raw.cart,
    fulfillment: raw.fulfillment as Obj,
    couponCode: str(raw.couponCode),
    quoteToken: str(raw.quoteToken),
    contact,
    deliveryAddress,
    notes,
    preference: pref === 'cash' || pref === 'bank_transfer' ? pref : null,
  };
}

// ── Cotización ─────────────────────────────────────────────────────────────────────────────

function quoteOf(req: Req, parsed: ParsedOrder): CheckoutQuote {
  const sub: Req = {
    ...req,
    body: {
      cart: parsed.cart,
      fulfillment: parsed.fulfillment,
      ...(parsed.couponCode ? { couponCode: parsed.couponCode } : {}),
    },
    fault: undefined,
  };
  return quoteCheckout(sub) as CheckoutQuote;
}

const evidenceOf = (quote: CheckoutQuote): MockQuoteEvidence | null =>
  readMockQuoteToken(quote.quote.token);

function conflict(
  code: 'QUOTE_CHANGED' | 'QUOTE_EXPIRED',
  changes: OrderQuoteChange[],
  quote: CheckoutQuote,
): never {
  problem(
    409,
    code,
    code === 'QUOTE_CHANGED'
      ? 'El precio o la entrega de tu pedido cambiaron'
      : 'La cotización venció; vuelve a confirmarla',
    { changes, quote },
  );
}

function diffEvidence(before: MockQuoteEvidence, after: MockQuoteEvidence): OrderQuoteChange[] {
  const changes: OrderQuoteChange[] = [];
  if (before.provider !== after.provider) {
    changes.push({ field: 'provider', previous: before.provider, current: after.provider });
  }
  for (const field of ['subtotal', 'discountTotal', 'deliveryFee', 'total'] as const) {
    if (before[field] !== after[field]) {
      changes.push({ field, previous: before[field], current: after[field] });
    }
  }
  if (before.linesHash !== after.linesHash)
    changes.push({ field: 'lines', previous: null, current: null });
  return changes;
}

/** Fallo de prueba `price-change`: sube Q1.00 el precio efectivo del primer producto del carrito en esa sucursal. */
function bumpPrice(store: MockStore, parsed: ParsedOrder, at: Date) {
  const cart = isObj(parsed.cart) ? parsed.cart : {};
  const branchId = str(cart.branchId);
  const first =
    Array.isArray(cart.lines) && isObj(cart.lines[0]) ? str(cart.lines[0].productId) : '';
  const product = store.products.find((p) => p.id === first);
  if (!product || !branchId) return;
  const current = priceToCents(effectivePriceAt(store, product, branchId));
  if (current === null) return;
  const next = centsToPrice(current + 100);
  const row = store.branchProducts.find(
    (r) => r.branchId === branchId && r.productId === product.id,
  );
  if (row) {
    row.priceOverride = next;
    row.updatedAt = at.toISOString();
  } else {
    store.branchProducts.push({
      branchId,
      productId: product.id,
      priceOverride: next,
      available: true,
      updatedAt: at.toISOString(),
    });
  }
}

// ── Pedido ─────────────────────────────────────────────────────────────────────────────────

const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const guestToken = (n: number, rev: number) =>
  `smo_${sha256Hex(`mock-guest|${n}|${rev}`).slice(0, 43)}`;

function issueToken(
  record: PlacedOrderRecord,
  at: Date,
): { guestToken: string; expiresAt: string } {
  for (const t of record.tokens) t.revoked = true;
  const n = Number(digits(record.draftId));
  const token = guestToken(n, record.tokens.length);
  const expiresAt = new Date(at.getTime() + TOKEN_TTL_MS).toISOString();
  record.tokens.push({ token, expiresAt, revoked: false });
  return { guestToken: token, expiresAt };
}

function createdOf(record: PlacedOrderRecord, at: Date, replay: boolean): OrderCreated {
  // Repetición de invitado: el servidor revoca los tokens activos y emite uno nuevo; el autenticado no recibe credencial.
  const access = record.ownerEmail === null ? issueToken(record, at) : null;
  void replay;
  return { order: record.detail, access };
}

function buildDetail(
  req: Req,
  id: string,
  displayNumber: string,
  quote: CheckoutQuote,
  parsed: ParsedOrder,
  contact: Contact,
  place: {
    municipalityName: string;
    zone: string | null;
    addressLine: string;
    referenceNote: string;
  } | null,
  at: Date,
): OrderDetail {
  const { store } = req;
  const promotions = new Map<string, number>();
  const lines: OrderDetailLine[] = quote.lines.map((l) => {
    const product = store.products.find((p) => p.id === l.productId);
    const names = new Map(store.modifiers.map((m) => [m.id, m.name]));
    if (l.promotionId) {
      promotions.set(
        l.promotionId,
        (promotions.get(l.promotionId) ?? 0) + (moneyToCents(l.discount) ?? 0),
      );
    }
    return {
      productName: product?.name ?? l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice ?? '0.00',
      modifiers: l.modifiers.map((m) => ({
        name: names.get(m.optionId) ?? m.optionId,
        extraPrice: m.extraPrice,
      })),
      extrasPerUnit: l.extrasPerUnit ?? '0.00',
      lineSubtotal: l.lineSubtotal ?? '0.00',
      discount: l.discount ?? '0.00',
      lineTotal: l.lineTotal ?? '0.00',
      notes: null,
    };
  });
  const promotionsView: OrderDetailPromotion[] = [...promotions].map(([promotionId, cents]) => ({
    name: store.promotions.find((p) => p.id === promotionId)?.name ?? promotionId,
    amount: centsToPrice(cents),
  }));
  const provider = quote.fulfillment.delivery?.selectedProvider ?? null;
  return {
    id,
    orderNumber: Number(digits(displayNumber)),
    displayNumber,
    status: 'pending',
    branchId: quote.branch.id,
    fulfillmentType: quote.fulfillment.type,
    deliveryProvider: provider,
    currency: 'GTQ',
    lines,
    promotions: promotionsView,
    address: place
      ? {
          municipalityName: place.municipalityName,
          zone: place.zone,
          addressLine: place.addressLine,
          referenceNote: place.referenceNote || null,
        }
      : null,
    contact: { fullName: contact.fullName, phoneMasked: `****${contact.phone.slice(-4)}` },
    notes: parsed.notes || null,
    subtotal: quote.subtotal ?? '0.00',
    extrasTotal: quote.extrasTotal ?? '0.00',
    discountTotal: quote.discountTotal ?? '0.00',
    deliveryFee: quote.deliveryFee ?? '0.00',
    total: quote.total ?? '0.00',
    payment: { methodPreference: parsed.preference, status: 'NOT_STARTED' },
    placedAt: at.toISOString(),
    updatedAt: at.toISOString(),
  };
}

/** Pedido BORRADOR enlazado (seguimiento/backoffice simulados). `bank_transfer` solo existe en el pedido real: aquí cuenta como efectivo. */
function buildDraft(
  id: string,
  detail: OrderDetail,
  contact: Contact,
  ownerEmail: string | null,
  place: {
    department: string;
    municipality: string;
    zone: string;
    line: string;
    references: string;
  } | null,
  at: Date,
): DraftOrder {
  const cents = (v: string) => (moneyToCents(v) ?? 0) / 100;
  return {
    id,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    branchId: detail.branchId,
    fulfillment: detail.fulfillmentType === 'DELIVERY' ? 'delivery' : 'pickup',
    schedule: { kind: 'now' },
    customer: { name: contact.fullName, phone: contact.phone, email: ownerEmail ?? contact.email },
    address: place,
    lines: detail.lines.map((l, i) => ({
      productId: String(i),
      name: l.productName,
      quantity: l.quantity,
      note: '',
      unitPrice: cents(l.unitPrice) + cents(l.extrasPerUnit),
      subtotal: cents(l.lineSubtotal),
    })),
    subtotal: cents(detail.subtotal),
    deliveryFee: cents(detail.deliveryFee),
    discount: cents(detail.discountTotal),
    total: cents(detail.total),
    currency: 'GTQ',
    note: detail.notes ?? '',
    deliveryTier: null,
    status: 'received',
    rejectionReason: null,
    payment: {
      method: 'cash',
      status: 'pending',
      amount: cents(detail.total),
      reference: null,
      cardBrand: null,
      cardLast4: null,
      simulated: true,
      processedAt: null,
    },
    delivery: null,
    history: [event(at, 'order', 'received')],
    incidents: [],
  };
}

// ── Handlers ───────────────────────────────────────────────────────────────────────────────

/** POST /v1/orders — SIMULADO (ver arriba). */
export const createPlacedOrder: Handler = (req): OrderCreated => {
  const { store } = req;
  const at = now(req);

  // Fallos reproducibles de la capa (antes de cualquier proceso, como el limitador y el semáforo del servidor).
  if (req.fault === 'rate-limited') {
    problem(
      429,
      'RATE_LIMITED',
      'Demasiadas solicitudes; espera unos segundos',
      {},
      RATE_LIMIT_RETRY_SEC,
    );
  }
  if (req.fault === 'busy')
    problem(503, 'ORDERS_BUSY', 'Hay mucha demanda; reintenta en unos segundos');
  if (req.fault === 'unavailable')
    problem(503, 'ORDERS_UNAVAILABLE', 'No podemos recibir pedidos en este momento');

  const key = req.headers['idempotency-key'] ?? '';
  if (!KEY_PATTERN.test(key))
    problem(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key ausente o con formato inválido');

  const parsed = parseBody(req);
  const ownerEmail = req.context.session.customer?.email.trim().toLowerCase() ?? null;
  const scope = ownerEmail ?? 'guest';
  const { quoteToken: _token, ...hashed } = req.body as Obj;
  void _token;
  const requestHash = sha256Hex(stableStringify(hashed));
  store.placedOrders ??= [];
  store.orderIdempotency ??= {};

  // Repetición ANTES de validar el token: devuelve el MISMO pedido (o 409 si el cuerpo cambió).
  const previous = store.orderIdempotency[`${scope}|${key}`];
  if (previous) {
    if (previous.requestHash !== requestHash) {
      problem(409, 'IDEMPOTENCY_KEY_REUSED', 'Esa clave de idempotencia ya se usó con otro pedido');
    }
    const record = store.placedOrders.find((p) => p.detail.id === previous.orderId);
    if (record) return createdOf(record, at, true);
  }

  // Preferencia de pago (la tarjeta es F25 BLOCKED_EXTERNAL) y dirección de entrega.
  if ((req.body as Obj).paymentMethodPreference === 'card') {
    problem(422, 'PAYMENT_METHOD_UNAVAILABLE', 'El pago con tarjeta aún no está disponible');
  }
  const f = parsed.fulfillment;
  const isDelivery = f.type === 'DELIVERY';
  const saved = isDelivery && typeof f.customerAddressId === 'string';
  if (parsed.deliveryAddress && (!isDelivery || saved)) {
    problem(400, undefined, 'Datos inválidos', {
      details: ['deliveryAddress: no se admite con PICKUP ni con una dirección guardada'],
    });
  }
  if (isDelivery && !saved && !parsed.deliveryAddress) {
    problem(400, undefined, 'Datos inválidos', {
      details: ['deliveryAddress: obligatoria a domicilio'],
    });
  }

  // Contacto: invitado => nombre y teléfono; con cuenta se completa con el perfil (sin sobrescribirlo).
  const account = ownerEmail ? requireCustomer(req) : null;
  const contact: Contact = {
    fullName: parsed.contact.fullName ?? account?.profile.fullName ?? '',
    phone:
      parsed.contact.phone ??
      (account?.profile.phone && isValidPhone(account.profile.phone)
        ? `+502${phoneKey(account.profile.phone)}`
        : ''),
    email: parsed.contact.email ?? ownerEmail ?? '',
  };
  if (!contact.fullName || !contact.phone) {
    if (account) problem(422, 'CONTACT_INCOMPLETE', 'Falta tu nombre o teléfono de contacto');
    problem(400, undefined, 'Datos inválidos', {
      details: ['contact: nombre y teléfono obligatorios para invitados'],
    });
  }

  // Cotización: token legible, del mismo sujeto y vigente.
  const evidence = readMockQuoteToken(parsed.quoteToken);
  if (!evidence) problem(422, 'QUOTE_INVALID', 'La cotización no es válida; vuelve a calcularla');
  if (evidence.sub !== scope)
    problem(422, 'QUOTE_INVALID', 'La cotización no corresponde a esta sesión');
  if (req.fault === 'price-change') bumpPrice(store, parsed, at);
  const fresh = quoteOf(req, parsed);
  if (req.fault === 'expired' || evidence.exp <= at.getTime()) conflict('QUOTE_EXPIRED', [], fresh);
  if (!fresh.canProceed) {
    problem(422, 'CHECKOUT_BLOCKED', 'Tu pedido tiene problemas que impiden confirmarlo', {
      blockers: fresh.blockers as CheckoutBlocker[],
    });
  }
  const after = evidenceOf(fresh);
  if (!after) problem(422, 'QUOTE_INVALID', 'No se pudo verificar la cotización');
  if (after.provider !== null && after.provider !== 'OWN') {
    problem(422, 'DELIVERY_PROVIDER_NOT_SELECTABLE', 'Ese proveedor de entrega no está disponible');
  }
  if (evidence.inputHash !== after.inputHash)
    problem(422, 'QUOTE_INVALID', 'La cotización no corresponde a este pedido');
  const changes = diffEvidence(evidence, after);
  if (changes.length) conflict('QUOTE_CHANGED', changes, fresh);

  // Tope de pedidos pendientes por teléfono (P51).
  const pending = store.placedOrders.filter(
    (p) =>
      p.detail.status === 'pending' &&
      store.orders.find((o) => o.id === p.draftId)?.status === 'received' &&
      phoneKey(store.orders.find((o) => o.id === p.draftId)?.customer.phone ?? '') ===
        phoneKey(contact.phone),
  );
  if (pending.length >= PENDING_LIMIT)
    problem(429, 'PENDING_ORDERS_LIMIT', 'Tienes demasiados pedidos pendientes');

  // Lugar de entrega (snapshot) y creación.
  let place: {
    municipalityName: string;
    zone: string | null;
    addressLine: string;
    referenceNote: string;
  } | null = null;
  let draftPlace: Parameters<typeof buildDraft>[4] = null;
  if (isDelivery) {
    const zone = typeof f.zone === 'string' ? f.zone : null;
    if (saved) {
      const stored = account?.addresses.find((a) => a.id === f.customerAddressId);
      if (!stored) problem(404, undefined, 'Dirección no encontrada');
      place = {
        municipalityName: stored.municipality,
        zone: stored.zone ? `Zona ${stored.zone.replace(/\D/g, '')}` : null,
        addressLine: stored.line,
        referenceNote: stored.references,
      };
      draftPlace = {
        department: stored.department,
        municipality: stored.municipality,
        zone: stored.zone,
        line: stored.line,
        references: stored.references,
      };
    } else {
      const municipality = MUNICIPALITY_SEEDS.find((m) => m.id === f.municipalityId);
      const address = parsed.deliveryAddress as NonNullable<ParsedOrder['deliveryAddress']>;
      place = {
        municipalityName: municipality?.name ?? '',
        zone,
        addressLine: address.addressLine,
        referenceNote: address.referenceNote,
      };
      draftPlace = {
        department: 'Guatemala',
        municipality: municipality?.name ?? '',
        zone: (zone ?? '').replace(/\D/g, ''),
        line: address.addressLine,
        references: address.referenceNote,
      };
    }
  }

  const draftId = `MON-3${String(store.sequences.order++).padStart(5, '0')}`;
  const id = uuidFor(Number(digits(draftId)));
  const detail = buildDetail(req, id, draftId, fresh, parsed, contact, place, at);
  // Un pedido con tarjeta que nunca se pagó (rechazo, diálogo cerrado) queda abandonado cuando el mismo teléfono crea otro (p. ej.
  // cambia a efectivo): se cancela para no dejar huérfanos (en la API real lo haría el servidor).
  for (const o of store.orders) {
    if (
      o.status === 'received' &&
      isAwaitingPayment(o) &&
      store.verifiedOrderIds.includes(o.id) &&
      phoneKey(o.customer.phone) === phoneKey(contact.phone)
    ) {
      o.status = 'cancelled';
      o.rejectionReason = 'Pago con tarjeta no completado';
      o.history.push(event(at, 'order', 'cancelled', { reason: o.rejectionReason }));
      o.updatedAt = at.toISOString();
      const abandoned = store.placedOrders.find((p) => p.draftId === o.id);
      if (abandoned) abandoned.detail.status = 'cancelled';
    }
  }
  store.orders.unshift(buildDraft(draftId, detail, contact, ownerEmail, draftPlace, at));
  store.verifiedOrderIds.push(draftId);
  const record: PlacedOrderRecord = { detail, draftId, ownerEmail, tokens: [] };
  store.placedOrders.unshift(record);
  store.orderIdempotency[`${scope}|${key}`] = { requestHash, orderId: id };
  return createdOf(record, at, false);
};

export const findPlacedOrder = (store: MockStore, id: string): PlacedOrderRecord | undefined =>
  store.placedOrders?.find((p) => p.detail.id === id);

/** Autorización del pedido real simulado: dueño (sesión) o `X-Order-Token` vigente; si no, el MISMO 404 (sin revelar nada). */
function authorizePlaced(req: Req, record: PlacedOrderRecord): void {
  const at = now(req).getTime();
  const token = req.headers['x-order-token'];
  const byToken =
    !!token &&
    record.tokens.some((t) => !t.revoked && t.token === token && Date.parse(t.expiresAt) > at);
  const owner = req.context.session.customer?.email.trim().toLowerCase() ?? null;
  const byOwner = owner !== null && record.ownerEmail === owner;
  if (!byToken && !byOwner) fail(404, 'Pedido no encontrado');
}

/** GET /v1/orders/{id} de un pedido real simulado: dueño (sesión) o `X-Order-Token` vigente; si no, el MISMO 404. */
export function readPlacedOrder(req: Req, record: PlacedOrderRecord): OrderDetail {
  authorizePlaced(req, record);
  return record.detail;
}

/**
 * GET /v1/orders/{id}/tracking (F21, `getOrderTracking`) — SIMULADO. Misma autorización y MISMO 404 que `getOrder` (inexistente,
 * ajeno, sin token, revocado o vencido). Forma real `OrderTracking` construida desde el historial del borrador enlazado
 * (`mocks/order-tracking.ts`). Fallos de prueba: `rate-limited` (429 con `Retry-After`) y `busy` (503 `ORDERS_BUSY`); `offline` y
 * `lost-response` los resuelve el cliente. Solo lectura: no emite tokens ni cambia el pedido.
 */
export const getOrderTracking: Handler = (req): OrderTracking => {
  if (req.fault === 'rate-limited') {
    problem(
      429,
      'RATE_LIMITED',
      'Demasiadas solicitudes; espera unos segundos',
      {},
      RATE_LIMIT_RETRY_SEC,
    );
  }
  if (req.fault === 'busy')
    problem(503, 'ORDERS_BUSY', 'Hay mucha demanda; reintenta en unos segundos', {}, 2);
  const record = findPlacedOrder(req.store, req.params.id ?? '');
  if (!record) fail(404, 'Pedido no encontrado');
  authorizePlaced(req, record);
  const draft = req.store.orders.find((o) => o.id === record.draftId);
  if (!draft) fail(404, 'Pedido no encontrado');
  return buildOrderTracking(record.detail, draft, now(req));
};

/** POST /v1/demo/orders/:id/card — SIMULADO: prepara el pedido borrador para la pasarela NeoNet de demostración. */
export const prepareDraftCard: Handler = (req) => {
  const order = req.store.orders.find((o) => o.id === str(req.params.id));
  if (!order || !req.store.verifiedOrderIds.includes(order.id)) fail(404, 'Pedido no encontrado');
  if (order.payment.status !== 'pending') fail(409, 'El pedido ya no admite pagos');
  order.payment = { ...order.payment, method: 'card' };
  return order;
};
