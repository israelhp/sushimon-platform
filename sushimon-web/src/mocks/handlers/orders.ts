import type {
  CardPaymentRequest,
  CreateIncidentRequest,
  CreateOrderRequest,
  Incident,
  Order,
  OrderLine,
  OrderLookupRequest,
  OrderSchedule,
  PaymentResult,
} from '@/lib/data-access/models';
import { isScheduleValid } from '@/lib/schedule';
import {
  assertAddress,
  availableAt,
  branchView,
  digits,
  event,
  fail,
  findOrder,
  isAwaitingPayment,
  isValidEmail,
  isValidPhone,
  normalizeOrderNumber,
  phoneKey,
  round2,
  totals,
  touch,
} from '../domain';
import { TEST_CARDS } from '../fixtures/orders';
import { pick, rngFor } from '../factories/random';
import type { MockStore } from '../store';
import { advanceDelivery, applyOrderStatus, dispatchOrder, freeOwnRider } from './logistics';
import { quoteFor } from './public';
import { body, now, oneOf, requireStaff, str, type Handler, type Req } from './shared';

const REVIEW_SETTLE_MS = 20_000;
const MAX_LINES = 50;

export function nextOrderId(store: MockStore): string {
  return `MON-3${String(store.sequences.order++).padStart(5, '0')}`;
}

/** ¿Puede esta sesión ver el pedido? (dueño con cuenta o invitado verificado en la sesión). */
function canSee(req: Req, order: Order): boolean {
  const email = req.context.session.customer?.email.trim().toLowerCase();
  return (
    req.store.verifiedOrderIds.includes(order.id) ||
    (!!email && order.customer.email.trim().toLowerCase() === email)
  );
}

function visibleOrder(req: Req, id: string): Order {
  const order = findOrder(req.store, id);
  if (!canSee(req, order)) fail(404, 'Pedido no encontrado');
  return order;
}

/** Pago "en verificación" que se confirma solo pasados 20 s del reloj (salvo order-pending). */
export function settleReviews(req: Req, orders: Order[]) {
  if (req.scenario === 'order-pending') return;
  const t = now(req);
  for (const o of orders) {
    const p = o.payment;
    if (p.status !== 'review' || !p.processedAt) continue;
    if (t.getTime() - new Date(p.processedAt).getTime() < REVIEW_SETTLE_MS) continue;
    p.status = 'approved';
    o.history.push(event(t, 'payment', 'approved'));
    touch(o, t);
  }
}

function parseSchedule(value: unknown): OrderSchedule {
  if (!value || typeof value !== 'object') fail(400, 'schedule inválido');
  const s = value as Partial<OrderSchedule>;
  const kind = oneOf(s.kind, ['now', 'scheduled'] as const, 'schedule.kind');
  if (kind === 'now') return { kind };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(s.date)) || !/^\d{2}:\d{2}$/.test(str(s.time))) {
    fail(400, 'Fecha u hora programada inválida');
  }
  return { kind, date: s.date, time: s.time };
}

/** POST /v1/orders — el precio final lo calcula el "servidor" (este handler). */
export const createOrder: Handler = (req): Order => {
  const b = body<CreateOrderRequest>(req);
  const fulfillment = oneOf(b.fulfillment, ['pickup', 'delivery'] as const, 'fulfillment');
  const paymentMethod = oneOf(b.paymentMethod, ['cash', 'card'] as const, 'paymentMethod');
  const schedule = parseSchedule(b.schedule);

  const customer = b.customer ?? { name: '', phone: '', email: '' };
  if (str(customer.name).trim().length < 3) fail(400, 'Escribe tu nombre');
  if (!isValidPhone(str(customer.phone))) fail(400, 'Teléfono inválido');
  if (!isValidEmail(str(customer.email))) fail(400, 'Correo inválido');

  if (!Array.isArray(b.lines) || b.lines.length === 0) fail(400, 'El pedido no tiene productos');
  if (b.lines.length > MAX_LINES) fail(400, 'Demasiadas líneas');
  for (const l of b.lines) {
    if (!l || typeof l.productId !== 'string') fail(400, 'Línea inválida');
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99) {
      fail(400, 'Cantidad inválida (1–99)');
    }
    if (l.note !== undefined && (typeof l.note !== 'string' || l.note.length > 140)) {
      fail(400, 'Nota demasiado larga');
    }
  }
  if (b.note !== undefined && str(b.note).length > 280) fail(400, 'Comentario demasiado largo');

  // Sucursal y envío.
  let branchId = str(b.branchId) || null;
  let address = null;
  let deliveryFee = 0;
  let tier = null;
  if (fulfillment === 'delivery') {
    address = assertAddress(req.store, b.address);
    const quote = quoteFor(req, address, branchId);
    if (!quote.covered || !quote.branchId || quote.fee === null) {
      fail(422, 'Sin cobertura de envío para esa dirección');
    }
    branchId = quote.branchId;
    deliveryFee = quote.fee;
    tier = quote.tier;
  } else if (!branchId) {
    fail(400, 'Elige la sucursal para recoger');
  }
  const branch = req.store.branches.find((x) => x.id === branchId);
  if (!branch) fail(404, 'Sucursal no encontrada');
  if (branch.status !== 'active') fail(422, 'La sucursal aún no está disponible');

  const at = now(req);
  if (schedule.kind === 'now' && !branchView(branch, at).openNow) {
    fail(409, 'La sucursal está cerrada en este momento; programa tu pedido');
  }
  if (!isScheduleValid(req.store.config.schedule, branch.hours, schedule, at)) {
    fail(422, 'Horario programado no disponible');
  }

  const lines: OrderLine[] = b.lines.map((l) => {
    const product = req.store.products.find((p) => p.id === l.productId);
    if (!product) fail(422, `Producto inexistente: ${l.productId}`);
    if (!availableAt(product, branch.id)) fail(409, `${product.name} no está disponible`);
    return {
      productId: product.id,
      name: product.name,
      quantity: l.quantity,
      note: (l.note ?? '').trim(),
      unitPrice: product.price,
      subtotal: round2(product.price * l.quantity),
    };
  });
  const t = totals(lines, deliveryFee);

  const order: Order = {
    id: nextOrderId(req.store),
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    branchId: branch.id,
    fulfillment,
    schedule,
    customer: {
      name: str(customer.name).trim(),
      phone: str(customer.phone).trim(),
      email: str(customer.email).trim(),
    },
    address,
    lines,
    ...t,
    currency: 'GTQ',
    note: str(b.note).trim(),
    deliveryTier: tier,
    status: 'received',
    rejectionReason: null,
    payment: {
      method: paymentMethod,
      status: 'pending',
      amount: t.total,
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
  cancelAbandonedCardOrders(req, order, at);
  req.store.orders.unshift(order);
  req.store.verifiedOrderIds.push(order.id);
  return order;
};

/**
 * Un pedido con tarjeta que nunca se pagó (rechazo, diálogo cerrado) queda abandonado cuando el mismo
 * cliente y sesión crean otro pedido (p. ej. cambia a efectivo): se cancela para no dejar huérfanos
 * en el store. En la API real lo haría el servidor (expiración/cancelación de pedidos sin pago).
 */
function cancelAbandonedCardOrders(req: Req, fresh: Order, at: Date) {
  for (const o of req.store.orders) {
    if (
      o.status !== 'received' ||
      !isAwaitingPayment(o) ||
      !req.store.verifiedOrderIds.includes(o.id) ||
      phoneKey(o.customer.phone) !== phoneKey(fresh.customer.phone)
    ) {
      continue;
    }
    o.status = 'cancelled';
    o.rejectionReason = 'Pago con tarjeta no completado';
    o.history.push(event(at, 'order', 'cancelled', { reason: o.rejectionReason }));
    touch(o, at);
  }
}

/** GET /v1/orders/:id */
export const getOrder: Handler = (req) => {
  const order = visibleOrder(req, req.params.id ?? '');
  settleReviews(req, [order]);
  return order;
};

const LOOKUP_MAX_FAILURES = 5;
/** El bloqueo se levanta si pasan 60 s (reloj de la demo) desde el último intento fallido. */
const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_NOT_FOUND = 'No encontramos un pedido con esos datos';

/**
 * POST /v1/orders/lookup — mismo 404 si no existe o el teléfono no coincide.
 * Anti fuerza bruta: tras 5 intentos fallidos para el mismo número de pedido responde 429 con el
 * mismo mensaje genérico (existan o no el pedido). Un acierto NO resetea el contador.
 * Nota: en el mock el contador vive en el store (`lookupFailures`). La API real debe limitar por IP
 * Y por pedido (ventana de tiempo, p. ej. en Redis/tabla), no solo por pedido.
 */
export const lookupOrder: Handler = (req) => {
  const b = body<OrderLookupRequest>(req);
  const id = normalizeOrderNumber(str(b.orderNumber));
  const phone = str(b.phone);
  const failures = (req.store.lookupFailures ??= {});
  const at = now(req).getTime();
  // Un store persistido antes de la ventana guardaba solo el número de fallos: se descarta.
  const previous = failures[id];
  const entry =
    typeof previous === 'object' && at - previous.lastAt < LOOKUP_WINDOW_MS ? previous : undefined;
  if (!entry && previous !== undefined) delete failures[id];
  if ((entry?.count ?? 0) >= LOOKUP_MAX_FAILURES) fail(429, LOOKUP_NOT_FOUND);
  const order = req.store.orders.find((o) => o.id === id);
  if (!order || digits(phone).length < 8 || phoneKey(order.customer.phone) !== phoneKey(phone)) {
    failures[id] = { count: (entry?.count ?? 0) + 1, lastAt: at };
    fail(404, LOOKUP_NOT_FOUND);
  }
  if (!req.store.verifiedOrderIds.includes(order.id)) req.store.verifiedOrderIds.push(order.id);
  settleReviews(req, [order]);
  return order;
};

function expiryValid(expiry: string, at: Date): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const y = at.getUTCFullYear();
  return year > y || (year === y && month >= at.getUTCMonth() + 1);
}

/**
 * POST /v1/payments/card — pasarela NeoNet SIMULADA. Solo acepta las tarjetas de prueba.
 * El número completo y el CVV se usan para validar y se descartan: al store solo llegan marca,
 * últimos 4 dígitos y una referencia simulada.
 */
export const payWithCard: Handler = (req): PaymentResult => {
  const b = body<CardPaymentRequest>(req);
  const order = visibleOrder(req, str(b.orderId));
  if (order.payment.method !== 'card') fail(409, 'El pedido no es con tarjeta');
  if (order.payment.status === 'approved') fail(409, 'El pedido ya está pagado');
  if (order.payment.status === 'review') fail(409, 'El pago está en verificación');
  if (order.status !== 'received') fail(409, 'El pedido ya no admite pagos');

  const number = digits(str(b.cardNumber));
  const at = now(req);
  if (number.length !== 16) fail(400, 'Número de tarjeta inválido');
  if (str(b.holderName).trim().length < 2) fail(400, 'Nombre del titular inválido');
  if (!expiryValid(str(b.expiry), at)) fail(400, 'Fecha de vencimiento inválida');
  if (!/^\d{3,4}$/.test(str(b.cvv))) fail(400, 'CVV inválido');
  const card = TEST_CARDS.find((c) => c.number === number);
  if (!card) fail(422, 'Solo se aceptan tarjetas de prueba (simulación)');

  let status: PaymentResult['status'] = card.result;
  if (req.scenario === 'payment-rejected') status = 'declined';
  else if (req.scenario === 'order-pending' && status === 'approved') status = 'review';

  const reference =
    status === 'declined' ? null : `DEMO-${String(req.store.sequences.payment++).padStart(6, '0')}`;
  order.payment = {
    ...order.payment,
    status,
    reference,
    cardBrand: card.brand,
    cardLast4: number.slice(-4),
    amount: order.total,
    processedAt: at.toISOString(),
  };
  order.history.push(event(at, 'payment', status));
  touch(order, at);
  return {
    orderId: order.id,
    status,
    reference,
    amount: order.total,
    processedAt: at.toISOString(),
    simulated: true,
  };
};

/** POST /v1/incidents */
export const createIncident: Handler = (req): Incident => {
  const b = body<CreateIncidentRequest>(req);
  const order = findOrder(req.store, str(b.orderId));
  const phoneOk = !!b.phone && phoneKey(str(b.phone)) === phoneKey(order.customer.phone);
  if (!canSee(req, order) && !phoneOk) fail(404, 'Pedido no encontrado');
  const type = oneOf(
    b.type,
    ['missing', 'wrong', 'late', 'quality', 'charge', 'other'] as const,
    'type',
  );
  const resolution = oneOf(
    b.resolution,
    ['replace', 'refund', 'credit', 'inform'] as const,
    'resolution',
  );
  if (!Array.isArray(b.items)) fail(400, 'items inválido');
  const productIds = new Set(order.lines.map((l) => l.productId));
  if (b.items.some((i) => !productIds.has(i))) fail(422, 'Producto que no está en el pedido');
  if ((type === 'missing' || type === 'wrong' || type === 'quality') && b.items.length === 0) {
    fail(400, 'Marca al menos un producto');
  }
  if (str(b.description).trim().length < 10) fail(400, 'Describe el problema (mín. 10 caracteres)');
  const incident: Incident = {
    id: `INC-${req.store.sequences.incident++}`,
    orderId: order.id,
    createdAt: now(req).toISOString(),
    type,
    items: [...b.items],
    description: str(b.description).trim(),
    resolution,
    status: 'received',
    answer: null,
  };
  order.incidents.push(incident);
  if (!req.store.verifiedOrderIds.includes(order.id)) req.store.verifiedOrderIds.push(order.id);
  return incident;
};

// ── 🎭 Rutas solo de simulación ──────────────────────────────────────────────────────────

/**
 * POST /v1/demo/orders/:id/advance — botón "Ver siguiente estado (simulación)" de la tienda.
 * Lleva el pedido un paso por la misma máquina de estados (despacha con repartidor propio si
 * hace falta). No existe en la API real.
 */
export const demoAdvanceOrder: Handler = (req) => {
  const order = visibleOrder(req, req.params.id ?? '');
  settleReviews(req, [order]);
  switch (order.status) {
    case 'received':
      applyOrderStatus(req, order, 'accepted', 'staff');
      break;
    case 'accepted':
      applyOrderStatus(req, order, 'preparing', 'staff');
      break;
    case 'preparing':
      applyOrderStatus(req, order, 'ready', 'staff');
      break;
    case 'ready':
      if (order.fulfillment === 'pickup') {
        applyOrderStatus(req, order, 'delivered', 'staff');
      } else if (!order.delivery || order.delivery.status === 'failed') {
        const rider = freeOwnRider(req.store, order.branchId);
        if (rider) dispatchOrder(req, order, 'own', rider.id);
        else dispatchOrder(req, order, 'pedidosya');
        if (order.delivery?.provider === 'own') advanceDelivery(req, order);
      } else {
        advanceDelivery(req, order);
      }
      break;
    case 'on_the_way':
      while (order.status === 'on_the_way') advanceDelivery(req, order);
      break;
    default:
      fail(409, 'El pedido ya terminó');
  }
  return order;
};

const SIM_NAMES = [
  'Alejandra Soto',
  'Mario Quiñónez',
  'Fernanda Arriaga',
  'Luis Gálvez',
  'Paula Rosales',
  'Héctor Monzón',
  'Isabel Contreras',
  'Raúl Batres',
];

/**
 * POST /v1/demo/orders/simulate — "nuevo pedido entrante" del backoffice (simulate()).
 * Body opcional `{ branchId }`. Determinista por número de secuencia.
 */
export const demoSimulateOrder: Handler = (req) => {
  const user = requireStaff(req);
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as { branchId?: string };
  const open = req.store.branches.filter((x) => x.status === 'active' && x.isOpen);
  const n = req.store.sequences.order;
  const rng = rngFor(`simulate|${n}`);
  const branchId = user.branchId ?? b.branchId ?? open[n % Math.max(open.length, 1)]?.id;
  const branch = req.store.branches.find((x) => x.id === branchId && x.status === 'active');
  if (!branch) fail(409, 'No hay sucursales abiertas');
  const pool = req.store.products.filter((p) => p.food && availableAt(p, branch.id));
  if (pool.length === 0) fail(409, 'No hay productos disponibles');
  const delivery = n % 3 !== 1;
  const at = now(req);
  const picks = [pick(rng, pool), pick(rng, pool)].filter(
    (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i,
  );
  const lines: OrderLine[] = picks.map((p, i) => {
    const quantity = i === 0 ? 1 + (n % 2) : 1;
    return {
      productId: p.id,
      name: p.name,
      quantity,
      note: '',
      unitPrice: p.price,
      subtotal: p.price * quantity,
    };
  });
  const zoneRule = branch.coverage.find((r) => r.tier === 'near' && r.zone !== null);
  const fee = delivery
    ? (req.store.config.deliveryTiers.find((x) => x.id === 'near')?.fee ?? 0)
    : 0;
  const t = totals(lines, fee);
  const name = SIM_NAMES[n % SIM_NAMES.length] ?? 'Cliente';
  const order: Order = {
    id: nextOrderId(req.store),
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    branchId: branch.id,
    fulfillment: delivery ? 'delivery' : 'pickup',
    schedule: { kind: 'now' },
    customer: {
      name,
      phone: `+502 5${100 + (n % 800)}-${1000 + ((n * 37) % 9000)}`,
      email: `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(' ', '.')}@ejemplo.com`,
    },
    address:
      delivery && zoneRule
        ? {
            department: 'Guatemala',
            municipality: 'Guatemala',
            zone: zoneRule.zone ?? '',
            line: `${1 + (n % 20)}a avenida ${n % 30}-${10 + (n % 80)}, Zona ${zoneRule.zone}`,
            references: '',
          }
        : null,
    lines,
    ...t,
    currency: 'GTQ',
    note: n % 2 ? '' : 'Agregar palillos extra, por favor.',
    deliveryTier: delivery ? 'near' : null,
    status: 'received',
    rejectionReason: null,
    payment: {
      method: 'cash',
      status: 'pending',
      amount: t.total,
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
  req.store.orders.unshift(order);
  return order;
};
