import type {
  CreateIncidentRequest,
  DraftCreateOrderRequest,
  Incident,
  DraftOrder,
  OrderLine,
  OrderLookupRequest,
} from '@/lib/data-access/models';
import { priceToNumber } from '@/lib/product-rules';
import {
  assertAddress,
  availableAt,
  effectivePriceAt,
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
import { availabilityFor } from './schedule';
import { pick, rngFor } from '../factories/random';
import type { MockStore } from '../store';
import { advanceDelivery, applyOrderStatus, dispatchOrder, freeOwnRider } from './logistics';
import { isProductVisible } from './products';
import { resolveOwnDelivery } from '../coverage';
import { findPlacedOrder, readPlacedOrder } from './order-placement';
import { body, now, oneOf, requireStaff, str, type Handler, type Req } from './shared';

const REVIEW_SETTLE_MS = 20_000;
const MAX_LINES = 50;

export function nextOrderId(store: MockStore): string {
  return `MON-3${String(store.sequences.order++).padStart(5, '0')}`;
}

/** ¿Puede esta sesión ver el pedido? (dueño con cuenta o invitado verificado en la sesión). */
function canSee(req: Req, order: DraftOrder): boolean {
  const email = req.context.session.customer?.email.trim().toLowerCase();
  return (
    req.store.verifiedOrderIds.includes(order.id) ||
    (!!email && order.customer.email.trim().toLowerCase() === email)
  );
}

export function visibleOrder(req: Req, id: string): DraftOrder {
  const order = findOrder(req.store, id);
  if (!canSee(req, order)) fail(404, 'Pedido no encontrado');
  return order;
}

/** Pago "en verificación" que se confirma solo pasados 20 s del reloj (salvo order-pending). */
export function settleReviews(req: Req, orders: DraftOrder[]) {
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

/**
 * POST /v1/demo/orders — SOLO mock: crea el pedido BORRADOR (`DraftOrder`) que usan el seguimiento y el backoffice simulados.
 * El pedido real de F20 es `POST /v1/orders` (`order-placement.ts`). Se retira con F21/F22.
 */
export const createDraftOrder: Handler = (req): DraftOrder => {
  const b = body<DraftCreateOrderRequest>(req);
  // ADR-0036: solo a domicilio e inmediato (`pickup` => 400).
  const fulfillment = oneOf(b.fulfillment, ['delivery'] as const, 'fulfillment');
  const paymentMethod = oneOf(b.paymentMethod, ['cash', 'card'] as const, 'paymentMethod');

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
  const address = assertAddress(req.store, b.address);
  // F09: la tarifa es el `baseFee` de la zona propia (nunca un monto del cliente). Checkout/pedidos reales: F19/F20.
  const own = resolveOwnDelivery(req.store, address, branchId);
  if (!own) fail(422, 'Sin cobertura de envío para esa dirección');
  branchId = own.branchId;
  const deliveryFee = own.fee;
  const branch = req.store.branches.find((x) => x.id === branchId);
  if (!branch) fail(404, 'Sucursal no encontrada');
  if (branch.status !== 'active') fail(422, 'La sucursal aún no está disponible');

  const at = now(req);
  // La validación definitiva la hace el servidor con el motor de disponibilidad (F08), no la respuesta pública cacheada.
  if (!availabilityFor(req.store, branch, at).isAcceptingOrders) {
    fail(409, 'La sucursal está cerrada en este momento');
  }

  const lines: OrderLine[] = b.lines.map((l) => {
    const product = req.store.products.find((p) => p.id === l.productId);
    // F11: solo se piden productos publicados (activos con categoría visible); el precio es el `basePrice` del servidor.
    if (!product || !isProductVisible(req.store, product)) {
      fail(422, `Producto inexistente: ${l.productId}`);
    }
    if (!availableAt(req.store, product, branch.id))
      fail(409, `${product.name} no está disponible`);
    // F13: el precio lo fija el servidor con el precio EFECTIVO de ESA sucursal (override o base), nunca el del cliente.
    const unitPrice = priceToNumber(effectivePriceAt(req.store, product, branch.id));
    return {
      productId: product.id,
      name: product.name,
      quantity: l.quantity,
      note: (l.note ?? '').trim(),
      unitPrice,
      subtotal: round2(unitPrice * l.quantity),
    };
  });
  const t = totals(lines, deliveryFee);

  const order: DraftOrder = {
    id: nextOrderId(req.store),
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    branchId: branch.id,
    fulfillment,
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
    deliveryTier: null,
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
function cancelAbandonedCardOrders(req: Req, fresh: DraftOrder, at: Date) {
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

/**
 * GET /v1/orders/:id — dos formas según el id: un pedido REAL simulado de F20 (UUID, `OrderDetail`, dueño o `X-Order-Token`) o el
 * pedido BORRADOR del seguimiento simulado (`MON-…`, `DraftOrder`).
 */
export const getOrder: Handler = (req) => {
  const placed = findPlacedOrder(req.store, req.params.id ?? '');
  if (placed) return readPlacedOrder(req, placed);
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
        // PICKUP histórico (ADR-0036): ya no se crean pedidos nuevos para recoger.
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
  const at0 = now(req);
  const open = req.store.branches.filter(
    (x) => x.status === 'active' && availabilityFor(req.store, x, at0).isAcceptingOrders,
  );
  const n = req.store.sequences.order;
  const rng = rngFor(`simulate|${n}`);
  const ownBranch = user.scope.allBranches ? null : (user.scope.branchIds[0] ?? null);
  const branchId = ownBranch ?? b.branchId ?? open[n % Math.max(open.length, 1)]?.id;
  const branch = req.store.branches.find((x) => x.id === branchId && x.status === 'active');
  if (!branch) fail(409, 'No hay sucursales abiertas');
  const pool = req.store.products.filter(
    (p) => p.food && isProductVisible(req.store, p) && availableAt(req.store, p, branch.id),
  );
  if (pool.length === 0) fail(409, 'No hay productos disponibles');
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
      unitPrice: priceToNumber(p.basePrice),
      subtotal: priceToNumber(p.basePrice) * quantity,
    };
  });
  const zoneRule = req.store.deliveryZones.find(
    (z) =>
      z.branchId === branch.id && z.active && z.municipalityName === 'Guatemala' && z.zoneLabel,
  );
  const fee = zoneRule ? Number(zoneRule.baseFee) : 0;
  const t = totals(lines, fee);
  const name = SIM_NAMES[n % SIM_NAMES.length] ?? 'Cliente';
  const order: DraftOrder = {
    id: nextOrderId(req.store),
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    branchId: branch.id,
    fulfillment: 'delivery',
    customer: {
      name,
      phone: `+502 5${100 + (n % 800)}-${1000 + ((n * 37) % 9000)}`,
      email: `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(' ', '.')}@ejemplo.com`,
    },
    address: zoneRule
      ? {
          department: 'Guatemala',
          municipality: 'Guatemala',
          zone: (zoneRule.zoneLabel ?? '').replace(/^Zona /, ''),
          line: `${1 + (n % 20)}a avenida ${n % 30}-${10 + (n % 80)}, ${zoneRule.zoneLabel}`,
          references: '',
        }
      : null,
    lines,
    ...t,
    currency: 'GTQ',
    note: n % 2 ? '' : 'Agregar palillos extra, por favor.',
    deliveryTier: null,
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
