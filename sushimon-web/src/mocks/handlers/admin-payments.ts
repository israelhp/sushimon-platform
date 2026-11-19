import type {
  AdminCashPaymentResult,
  AdminOrderPayment,
  AdminPaymentHistory,
  DraftOrder,
} from '@/lib/data-access/models';
import { can } from '@/lib/permissions';
import { ruleOrderOf } from '../admin-orders';
import {
  MAX_TENDERED_CENTS,
  adminPayment,
  cents,
  contextOf,
  isClosed,
  money,
  parseTendered,
  paymentEvents,
  paymentRecord,
  requestHashOf,
} from '../cash-payments';
import { canFor, faultGuard, placedOf, problem, readableOrder } from './admin-orders';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F24 (spec 025 §12.3) — Handlers SIMULADOS de `/v1/admin/orders/{id}/payment*` con la FORMA REAL del contrato. Misma autorización
 * (`payments.read`/`payments.confirm`), mismo 404 uniforme, misma idempotencia por clave (en memoria del store) y mismos
 * 400/401/403/404/409/422/429/503 que el servidor. SIMULACIÓN: un cobro simulado NUNCA confirma un cobro real y no sale a la red.
 *
 * Fallos de prueba (`window.__sushimonMockFaults['POST /v1/admin/orders/<id>/payment/cash']`): `payment-already-registered` (otra
 * persona cobró justo antes: 409 con `current`), `payment-busy` (503 `ORDERS_BUSY`), `rate-limited`/`busy` (comunes) y
 * `lost-response` (el cobro se persistió pero la respuesta se pierde: el reintento con la MISMA clave responde `replayed`).
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
type Obj = Record<string, unknown>;

function paymentScoped(req: Req, actor: StaffActor): DraftOrder {
  const draft = readableOrder(req, actor);
  // El alcance de `payments.read`/`confirm` cubre la sucursal DEL PEDIDO; si no, el MISMO 404 (anti-IDOR).
  if (!can(actor.grants, 'payments.read', draft.branchId)) {
    problem(404, 'ORDER_NOT_FOUND', 'Pedido no disponible');
  }
  return draft;
}

function view(req: Req, actor: StaffActor, draft: DraftOrder): AdminOrderPayment {
  return adminPayment(
    req.store,
    draft,
    ruleOrderOf(draft, placedOf(req.store, draft.id)),
    can(actor.grants, 'payments.confirm', draft.branchId),
    now(req),
  );
}

/** GET /v1/admin/orders/:id/payment */
export const getAdminOrderPayment: Handler = (req): AdminOrderPayment => {
  faultGuard(req);
  const actor = requireStaff(req, 'payments.read');
  return view(req, actor, paymentScoped(req, actor));
};

/** GET /v1/admin/orders/:id/payment/history */
export const listAdminOrderPaymentHistory: Handler = (req): AdminPaymentHistory => {
  faultGuard(req);
  const actor = requireStaff(req, 'payments.read');
  const draft = paymentScoped(req, actor);
  return {
    orderId: draft.id,
    displayNumber: draft.id,
    items: paymentEvents(req.store, draft),
    generatedAt: now(req).toISOString(),
  };
};

/** POST /v1/admin/orders/:id/payment/cash */
export const registerAdminOrderCashPayment: Handler = (req): AdminCashPaymentResult => {
  faultGuard(req);
  if (req.fault === 'payment-busy') {
    problem(503, 'ORDERS_BUSY', 'Hay mucha demanda; reintenta en unos segundos', {}, 2);
  }
  const actor = requireStaff(req, 'payments.confirm');

  // Validación de la entrada (antes de tocar datos).
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    problem(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key ausente o con formato inválido');
  }
  const raw = req.body;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problem(400, undefined, 'Cuerpo de la solicitud inválido');
  }
  const input = raw as Obj;
  if (Object.keys(input).some((k) => k !== 'tendered' && k !== 'receivedConfirmed')) {
    problem(400, undefined, 'Datos inválidos', { details: ['Campos no permitidos'] });
  }
  if (input.receivedConfirmed !== true) {
    problem(400, 'PAYMENT_CONFIRMATION_REQUIRED', 'Confirma que recibiste el dinero');
  }
  const parsed = parseTendered(input.tendered);
  if (!parsed.ok) problem(400, parsed.code, 'El efectivo recibido no es un importe válido');

  const draft = readableOrder(req, actor);
  if (!canFor(actor, draft.branchId)('payments.confirm')) {
    problem(403, 'PAYMENT_ACTION_FORBIDDEN', 'No tienes permiso para cobrar en esa sucursal');
  }
  const rule = ruleOrderOf(draft, placedOf(req.store, draft.id));
  const at = now(req);
  const hash = requestHashOf(draft.id, parsed.cents);

  // Otra persona cobró justo antes (prueba de la carrera): queda registrado con OTRA clave.
  if (req.fault === 'payment-already-registered' && !paymentRecord(req.store, draft.id)) {
    const total = cents(draft.total);
    req.store.cashPayments ??= {};
    req.store.cashPayments[draft.id] = {
      amountApplied: money(total),
      tendered: money(total),
      change: '0.00',
      receivedAt: at.toISOString(),
      collectorId: 'otra-persona',
      collectorName: 'Otra persona',
      context: contextOf(rule) ?? 'BRANCH',
      key: 'otra-persona-key-xxxxxxxxxxxx',
      requestHash: requestHashOf(draft.id, total),
    };
  }

  const existing = paymentRecord(req.store, draft.id);
  const current = () => view(req, actor, draft);
  if (existing) {
    if (existing.key === key) {
      if (existing.requestHash === hash) {
        return {
          payment: current(),
          replayed: true,
          appliedByMe: existing.collectorId === actor.id,
        };
      }
      problem(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Esa clave de idempotencia ya se usó con otro importe',
      );
    }
    problem(409, 'PAYMENT_ALREADY_REGISTERED', 'Otra persona ya registró este pago', {
      current: current(),
    });
  }
  if (isClosed(rule.status)) {
    problem(409, 'ORDER_NOT_PAYABLE', 'El pedido está cancelado o rechazado: no se cobra', {
      current: current(),
    });
  }
  const total = cents(draft.total);
  const violation =
    rule.deliveryProvider === 'PEDIDOSYA'
      ? 'PROVIDER_BLOCKED_EXTERNAL'
      : total <= 0
        ? 'AMOUNT_ZERO'
        : null;
  if (violation) {
    problem(422, 'PAYMENT_NOT_COLLECTABLE', 'Este pedido no se puede cobrar', {
      violations: [{ path: 'order', code: violation, message: 'No se puede cobrar este pedido' }],
    });
  }
  if (parsed.cents < total) {
    problem(422, 'CASH_AMOUNT_INSUFFICIENT', 'El efectivo recibido no cubre el total del pedido');
  }
  if (parsed.cents > MAX_TENDERED_CENTS) {
    problem(422, 'CASH_TENDERED_TOO_LARGE', 'El efectivo recibido supera el tope de seguridad');
  }

  // Éxito: la recepción se persiste en el almacén del mock; el cambio lo calcula el "servidor" (centavos enteros).
  req.store.cashPayments ??= {};
  req.store.cashPayments[draft.id] = {
    amountApplied: money(total),
    tendered: money(parsed.cents),
    change: money(parsed.cents - total),
    receivedAt: at.toISOString(),
    collectorId: actor.id,
    collectorName: actor.name,
    context: contextOf(rule) ?? 'BRANCH',
    key,
    requestHash: hash,
  };
  return { payment: current(), replayed: false, appliedByMe: true };
};
