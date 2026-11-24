import type {
  AdminDelivery,
  AdminDeliveryCommandResult,
  AdminDeliveryEvent,
  AdminDeliveryHistoryEntry,
  AdminDeliveryPage,
  AdminDeliveryStatus,
  AdminDeliverySummary,
  DraftOrder,
  StaffPermission,
} from '@/lib/data-access/models';
import { can } from '@/lib/permissions';
import { maskRiderPhone } from '@/lib/rider-rules';
import { normalizeOrderNumber } from '../domain';
import {
  COMMAND_SPECS,
  OCCUPYING_STATUSES,
  OPEN_STATUSES,
  CONTACT_STATUSES,
  availableDeliveryActionsFor,
  deliveriesOf,
  orderEligibilityViolations,
  type DeliveryCommand,
} from '../admin-deliveries';
import { ruleOrderOf } from '../admin-orders';
import { settingsOf } from '../coverage';
import type { AdminDeliveryRecord } from '../fixtures/admin-deliveries';
import type { AdminRiderRecord } from '../fixtures/admin-riders';
import type { MockStore } from '../store';
import { apply, placedOf, problem } from './admin-orders';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F28 (spec 029) — Handlers SIMULADOS de `/v1/admin/deliveries*` con la FORMA REAL del contrato `admin-deliveries`. Mismas reglas que
 * la API: permiso por operación + alcance por sucursal, 404 uniforme fuera del alcance de `deliveries.read` (anti-IDOR), 403
 * `DELIVERY_ACTION_FORBIDDEN` si ve la entrega pero no puede el comando, `expectedVersion` (compare-and-set) con 409 y `current`,
 * `replayed`, elegibilidad del pedido y del motorista (422, sin revelar la sucursal del motorista), recoger/entregar mueven el
 * pedido, retorno separado, sin PATCH ni DELETE. SIMULACIÓN: nada de esto toca la base real ni confirma nada real.
 *
 * Fallos de prueba (`window.__sushimonMockFaults['<MÉTODO> /v1/admin/deliveries…']`): `rate-limited` (429), `busy` (503
 * `DELIVERIES_BUSY`), `version-conflict` (otra persona cambió la entrega justo antes: sube la versión y responde 409 con `current`)
 * y `rider-busy` (en asignar: pierde la carrera por el motorista y responde 422 `RIDER_NOT_ELIGIBLE` `BUSY`).
 */

type Obj = Record<string, unknown>;
const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;
const MAX_RANGE_DAYS = 92;
const MAX_HISTORY = 50;
const WITH_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const STATUSES: readonly AdminDeliveryStatus[] = [
  'pending',
  'assigned',
  'picked_up',
  'delivered',
  'returned',
  'cancelled',
];

function guard(req: Req): void {
  if (req.fault === 'rate-limited') {
    problem(429, 'RATE_LIMITED', 'Demasiadas solicitudes; espera unos segundos', {}, 2);
  }
  if (req.fault === 'busy') {
    problem(503, 'DELIVERIES_BUSY', 'Hay mucha demanda; reintenta en unos segundos', {}, 2);
  }
}

const invalid = (details: string[]): never =>
  problem(400, undefined, 'Datos inválidos', { details });

const ridersOf = (store: MockStore): AdminRiderRecord[] => (store.adminRiders ??= []);
const riderOf = (store: MockStore, id: string | null) =>
  id ? ridersOf(store).find((r) => r.id === id) : undefined;
const orderOf = (store: MockStore, id: string): DraftOrder | undefined =>
  store.orders.find((o) => o.id === normalizeOrderNumber(id));

const canIn = (actor: StaffActor, permission: StaffPermission, branchId: string) =>
  can(actor.grants, permission, branchId);

function summaryOf(
  store: MockStore,
  actor: StaffActor,
  d: AdminDeliveryRecord,
): AdminDeliverySummary {
  const draft = orderOf(store, d.orderId);
  const rule = draft ? ruleOrderOf(draft, placedOf(store, draft.id)) : null;
  const rider = riderOf(store, d.riderId);
  const occupied = rider !== undefined && OCCUPYING_STATUSES.includes(d.status);
  return {
    id: d.id,
    orderId: d.orderId,
    displayNumber: d.orderId,
    branchId: d.branchId,
    branchName: store.branches.find((b) => b.id === d.branchId)?.name ?? d.branchId,
    status: d.status,
    orderStatus: rule?.status ?? 'pending',
    municipalityName: draft?.address?.municipality || null,
    zone: draft?.address?.zone || null,
    rider: rider
      ? {
          id: rider.id,
          fullName: rider.fullName,
          vehicleType: rider.vehicleType,
          phoneMasked: maskRiderPhone(rider.phone),
        }
      : null,
    riderOccupied: occupied,
    awaitingReturn: d.status === 'delivered',
    version: d.version,
    assignedAt: d.assignedAt,
    pickedUpAt: d.pickedUpAt,
    deliveredAt: d.deliveredAt,
    returnedAt: d.returnedAt,
    cancelledAt: d.cancelledAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    availableActions: availableDeliveryActionsFor(d, rule?.status ?? 'pending', (p) =>
      canIn(actor, p, d.branchId),
    ),
  };
}

function detailOf(store: MockStore, actor: StaffActor, d: AdminDeliveryRecord): AdminDelivery {
  const summary = summaryOf(store, actor, d);
  const draft = orderOf(store, d.orderId);
  const rule = draft ? ruleOrderOf(draft, placedOf(store, draft.id)) : null;
  // §8: contacto y dirección SOLO con la entrega ABIERTA y `orders.read` en la sucursal; si no, `null` (no se leen).
  const contactVisible =
    draft !== undefined &&
    CONTACT_STATUSES.includes(d.status) &&
    canIn(actor, 'orders.read', d.branchId);
  // S1: el motivo del historial es interno; solo con `deliveries.update` en la sucursal (si no, `null`).
  const canSeeReason = canIn(actor, 'deliveries.update', d.branchId);
  return {
    ...summary,
    order: {
      id: d.orderId,
      displayNumber: d.orderId,
      status: rule?.status ?? 'pending',
      deliveryProvider: rule?.deliveryProvider ?? 'OWN',
    },
    contactVisible,
    customer:
      contactVisible && draft
        ? { name: draft.customer.name, phone: draft.customer.phone.replace(/[\s-]/g, '') }
        : null,
    address:
      contactVisible && draft?.address
        ? {
            municipalityName: draft.address.municipality,
            zone: draft.address.zone || null,
            addressLine: draft.address.line,
            referenceNote: draft.address.references || null,
          }
        : null,
    history: d.history.slice(-MAX_HISTORY).map((h) => (canSeeReason ? h : { ...h, reason: null })),
    historyTruncated: d.history.length > MAX_HISTORY,
  };
}

/** Entrega visible (alcance de `deliveries.read`) o el MISMO 404 de «no existe». */
function visibleDelivery(req: Req, actor: StaffActor): AdminDeliveryRecord {
  const found = deliveriesOf(req.store, req.scenario).find((d) => d.id === req.params.id);
  if (!found || !canIn(actor, 'deliveries.read', found.branchId)) {
    problem(404, 'DELIVERY_NOT_FOUND', 'Entrega no encontrada');
  }
  return found as AdminDeliveryRecord;
}

const forbiddenAction = (): never =>
  problem(
    403,
    'DELIVERY_ACTION_FORBIDDEN',
    'No tienes permiso para esta acción en la sucursal de la entrega',
  );

// ── Cursor ─────────────────────────────────────────────────────────────────────────────────────

const encodeCursor = (d: Pick<AdminDeliveryRecord, 'createdAt' | 'id'>) =>
  btoa(`${d.createdAt}|${d.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeCursor(raw: string): { createdAt: string; id: string } {
  try {
    const text = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const [createdAt, id] = text.split('|');
    if (createdAt && id && !Number.isNaN(Date.parse(createdAt))) return { createdAt, id };
  } catch {
    // formato inválido: se informa abajo
  }
  return problem(400, 'DELIVERY_CURSOR_INVALID', 'Cursor inválido');
}

function instant(raw: string | null, field: string): number | null {
  if (raw === null || raw === '') return null;
  if (!WITH_ZONE.test(raw) || Number.isNaN(Date.parse(raw))) {
    problem(400, undefined, `${field} debe ser un instante ISO 8601 con zona`);
  }
  return Date.parse(raw);
}

// ── Lecturas ───────────────────────────────────────────────────────────────────────────────────

/** GET /v1/admin/deliveries — listado ligero por cursor (orden fijo `createdAt` desc, `id` desc). */
export const listAdminDeliveries: Handler = (req): AdminDeliveryPage => {
  guard(req);
  const actor = requireStaff(req, 'deliveries.read');
  const at = now(req);
  const branchId = req.query.get('branchId') || undefined;
  const visibleBranches = req.store.branches
    .filter((b) => canIn(actor, 'deliveries.read', b.id))
    .map((b) => b.id);
  if (branchId && !visibleBranches.includes(branchId)) {
    problem(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
  }
  const statusRaw = req.query.get('status');
  const statuses = statusRaw
    ? (statusRaw.split(',').filter(Boolean) as AdminDeliveryStatus[])
    : [...OPEN_STATUSES];
  if (statuses.length === 0 || statuses.some((s) => !STATUSES.includes(s))) {
    invalid(['status inválido']);
  }
  const riderId = req.query.get('riderId') || undefined;
  const limitRaw = req.query.get('limit');
  const limit = limitRaw === null || limitRaw === '' ? LIMIT_DEFAULT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) invalid(['limit fuera de rango']);
  const toMs = instant(req.query.get('to'), 'to') ?? at.getTime();
  const fromMs = instant(req.query.get('from'), 'from') ?? at.getTime() - 7 * 86_400_000;
  if (toMs <= fromMs || toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
    invalid(['Rango de fechas inválido (máximo 92 días)']);
  }
  const cursorRaw = req.query.get('cursor');
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

  const matches = deliveriesOf(req.store, req.scenario)
    .filter((d) => visibleBranches.includes(d.branchId))
    .filter((d) => !branchId || d.branchId === branchId)
    .filter((d) => statuses.includes(d.status))
    // `from`/`to` solo acotan los estados terminales.
    .filter(
      (d) =>
        OPEN_STATUSES.includes(d.status) ||
        (Date.parse(d.createdAt) >= fromMs && Date.parse(d.createdAt) <= toMs),
    )
    .filter((d) => !riderId || d.riderId === riderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .filter(
      (d) =>
        !cursor ||
        d.createdAt < cursor.createdAt ||
        (d.createdAt === cursor.createdAt && d.id < cursor.id),
    );
  const page = matches.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((d) => summaryOf(req.store, actor, d)),
    nextCursor: matches.length > limit && last ? encodeCursor(last) : null,
    generatedAt: at.toISOString(),
  };
};

/** GET /v1/admin/deliveries/:id */
export const getAdminDelivery: Handler = (req): AdminDelivery => {
  guard(req);
  const actor = requireStaff(req, 'deliveries.read');
  return detailOf(req.store, actor, visibleDelivery(req, actor));
};

// ── Escrituras ─────────────────────────────────────────────────────────────────────────────────

function entryOf(
  event: AdminDeliveryEvent,
  d: AdminDeliveryRecord,
  oldStatus: AdminDeliveryStatus | null,
  actor: Pick<StaffActor, 'name'>,
  at: string,
  extra: { riderId?: string | null; riderName?: string | null; reason?: string | null } = {},
): AdminDeliveryHistoryEntry {
  return {
    event,
    oldStatus,
    status: d.status,
    riderId: extra.riderId ?? null,
    riderName: extra.riderName ?? null,
    reason: extra.reason ?? null,
    actorName: actor.name,
    at,
  };
}

const result = (
  req: Req,
  actor: StaffActor,
  d: AdminDeliveryRecord,
  from: AdminDeliveryStatus | null,
  event: AdminDeliveryEvent,
  at: string,
  replayed: boolean,
  appliedByMe: boolean,
): AdminDeliveryCommandResult => ({
  delivery: summaryOf(req.store, actor, d),
  transition: { from, to: d.status, event, at, replayed, appliedByMe },
});

const nextDeliveryId = (list: readonly AdminDeliveryRecord[]) =>
  `delivery-${list.reduce((max, d) => Math.max(max, Number(/(\d+)$/.exec(d.id)?.[1] ?? 0)), 0) + 1}`;

/** POST /v1/admin/deliveries {orderId} — crea (o reabre) la entrega; idempotente por pedido. */
export const createAdminDelivery: Handler = (req): AdminDeliveryCommandResult => {
  guard(req);
  const actor = requireStaff(req, 'deliveries.assign');
  const raw = req.body as Obj | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(['Cuerpo inválido']);
  const extra = Object.keys(raw as Obj).filter((k) => k !== 'orderId');
  if (extra.length) invalid(extra.map((k) => `${k} no está permitido`));
  const orderId = (raw as Obj).orderId;
  if (typeof orderId !== 'string' || !orderId.trim()) invalid(['orderId es obligatorio']);
  const draft = orderOf(req.store, orderId as string);
  if (!draft || !canIn(actor, 'deliveries.read', draft.branchId)) {
    problem(404, 'ORDER_NOT_FOUND', 'Pedido no disponible');
  }
  const order = draft as DraftOrder;
  if (!canIn(actor, 'deliveries.assign', order.branchId)) forbiddenAction();
  const rule = ruleOrderOf(order, placedOf(req.store, order.id));
  const violations = orderEligibilityViolations(rule);

  const list = deliveriesOf(req.store, req.scenario);
  const existing = list.find((d) => d.orderId === order.id);
  const at = now(req).toISOString();
  if (existing && OPEN_STATUSES.includes(existing.status)) {
    // Idempotente: ya hay una abierta (se devuelve la vigente SIN escribir).
    const last = existing.history[existing.history.length - 1];
    return result(
      req,
      actor,
      existing,
      null,
      last?.event ?? 'created',
      existing.createdAt,
      true,
      last?.actorName === actor.name,
    );
  }
  if (violations.length > 0) {
    problem(422, 'DELIVERY_ORDER_NOT_ELIGIBLE', 'El pedido no admite una entrega propia', {
      violations: violations.map((code) => ({ path: 'orderId', code, message: code })),
    });
  }
  if (existing && existing.status === 'returned') {
    problem(409, 'DELIVERY_STATE_CONFLICT', 'La entrega cambió mientras la veías', {
      current: { status: existing.status, version: existing.version },
    });
  }
  if (existing) {
    // Reapertura: `cancelled → pending`; el historial conserva el ciclo anterior.
    const before = existing.status;
    existing.status = 'pending';
    existing.cancelledAt = null;
    existing.riderId = null;
    existing.version += 1;
    existing.updatedAt = at;
    existing.history.push(entryOf('reopened', existing, before, actor, at));
    return result(req, actor, existing, before, 'reopened', at, false, true);
  }
  const created: AdminDeliveryRecord = {
    id: nextDeliveryId(list),
    orderId: order.id,
    branchId: order.branchId,
    status: 'pending',
    riderId: null,
    version: 1,
    assignedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    returnedAt: null,
    cancelledAt: null,
    createdAt: at,
    updatedAt: at,
    history: [],
  };
  created.history.push(entryOf('created', created, null, actor, at));
  list.push(created);
  return result(req, actor, created, null, 'created', at, false, true);
};

interface ParsedBody {
  expectedVersion: number;
  riderId: string | null;
  reason: string | null;
}

function parseBody(req: Req, command: DeliveryCommand): ParsedBody {
  const spec = COMMAND_SPECS[command];
  const raw = req.body as Obj | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(['Cuerpo inválido']);
  const allowed = ['expectedVersion'];
  if (command === 'assign') allowed.push('riderId');
  if (spec.reason !== 'none') allowed.push('reason');
  const extra = Object.keys(raw as Obj).filter((k) => !allowed.includes(k));
  if (extra.length) invalid(extra.map((k) => `${k} no está permitido`));
  const body = raw as Obj;
  const expected = body.expectedVersion;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
    invalid(['expectedVersion es obligatorio']);
  }
  let riderId: string | null = null;
  if (command === 'assign') {
    if (typeof body.riderId !== 'string' || !body.riderId) invalid(['riderId es obligatorio']);
    riderId = body.riderId as string;
  }
  let reason: string | null = null;
  if (spec.reason !== 'none') {
    if (body.reason === undefined) {
      if (spec.reason === 'required') {
        problem(400, 'DELIVERY_REASON_REQUIRED', 'El motivo es obligatorio o inválido');
      }
    } else {
      const text = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (text.length < 3 || text.length > 280 || CONTROL.test(text)) {
        problem(
          400,
          'DELIVERY_REASON_REQUIRED',
          'El motivo es obligatorio o inválido (3 a 280 caracteres, sin caracteres de control)',
        );
      }
      reason = text;
    }
  }
  return { expectedVersion: expected as number, riderId, reason };
}

/** Razones por las que un motorista NO puede tomar la entrega (sin revelar su sucursal). Vacío = elegible. */
function riderViolations(
  req: Req,
  rider: AdminRiderRecord,
  d: AdminDeliveryRecord,
  branchId: string,
): string[] {
  const out: string[] = [];
  if (!rider.active) out.push('INACTIVE');
  if (rider.branchId !== branchId) out.push('WRONG_BRANCH');
  if (rider.availability !== 'AVAILABLE') out.push('UNAVAILABLE');
  const busyElsewhere = (req.store.adminDeliveries ?? []).some(
    (x) => x.id !== d.id && x.riderId === rider.id && OCCUPYING_STATUSES.includes(x.status),
  );
  if (busyElsewhere || (req.fault === 'rider-busy' && !out.includes('BUSY'))) out.push('BUSY');
  if (!settingsOf(req.store, branchId).ownDeliveryZonesEnabled) {
    out.push('OWN_DELIVERY_DISABLED');
  }
  return out;
}

const currentOf = (d: AdminDeliveryRecord) => ({ status: d.status, version: d.version });

function run(req: Req, command: DeliveryCommand): AdminDeliveryCommandResult {
  guard(req);
  const spec = COMMAND_SPECS[command];
  const actor = requireStaff(req, spec.permissions[0]);
  const body = parseBody(req, command);
  const d = visibleDelivery(req, actor);
  if (!spec.permissions.every((p) => canIn(actor, p, d.branchId))) forbiddenAction();

  const at = now(req).toISOString();
  const draft = orderOf(req.store, d.orderId);
  const rule = draft ? ruleOrderOf(draft, placedOf(req.store, draft.id)) : null;
  const before = d.status;

  // Fallos de prueba: otra persona se adelantó.
  if (req.fault === 'version-conflict') {
    d.version += 1;
    d.updatedAt = at;
  }

  let rider: AdminRiderRecord | undefined;
  if (command === 'assign') {
    rider = riderOf(req.store, body.riderId);
    // 404 uniforme: inexistente o fuera del alcance de `riders.read` EN LA SUCURSAL DEL MOTORISTA.
    if (!rider || !canIn(actor, 'riders.read', rider.branchId)) {
      problem(404, 'RIDER_NOT_FOUND', 'Motorista no encontrado');
    }
    // Mismo motorista ya asignado: estado deseado alcanzado, sin escribir.
    if (d.status === 'assigned' && d.riderId === body.riderId) {
      const last = d.history[d.history.length - 1];
      return result(
        req,
        actor,
        d,
        'assigned',
        last?.event ?? 'rider_assigned',
        d.assignedAt ?? at,
        true,
        last?.actorName === actor.name,
      );
    }
    if (rule) {
      const orderViolations = orderEligibilityViolations(rule);
      if (orderViolations.length > 0) {
        problem(422, 'DELIVERY_ORDER_NOT_ELIGIBLE', 'El pedido no admite una entrega propia', {
          violations: orderViolations.map((code) => ({ path: 'orderId', code, message: code })),
        });
      }
    }
    const reasons = riderViolations(req, rider as AdminRiderRecord, d, d.branchId);
    if (reasons.length > 0 && spec.from.includes(d.status)) {
      problem(422, 'RIDER_NOT_ELIGIBLE', 'El motorista no puede tomar esta entrega', {
        violations: reasons.map((code) => ({ path: 'riderId', code, message: code })),
      });
    }
  }

  // Repetición idempotente de comandos con destino propio (no `assign`).
  if (command !== 'assign' && d.status === spec.to) {
    const last = d.history[d.history.length - 1];
    const sameEvent: Record<DeliveryCommand, AdminDeliveryEvent> = {
      assign: 'rider_assigned',
      unassign: 'rider_unassigned',
      mark_picked_up: 'picked_up',
      mark_delivered: 'delivered',
      return_to_branch: 'returned',
      cancel: 'cancelled',
    };
    if (last?.event === sameEvent[command] && req.fault !== 'version-conflict') {
      return result(
        req,
        actor,
        d,
        spec.from[0] ?? null,
        last.event,
        last.at,
        true,
        last.actorName === actor.name,
      );
    }
  }
  if (!spec.from.includes(d.status) || d.version !== body.expectedVersion) {
    problem(409, 'DELIVERY_STATE_CONFLICT', 'La entrega cambió mientras la veías', {
      current: currentOf(d),
    });
  }

  // Recoger/entregar mueven también el pedido (misma «transacción»).
  if (spec.order) {
    if (!draft || !rule || rule.status !== spec.order.expected) {
      problem(409, 'ORDER_STATE_CONFLICT', 'El pedido cambió mientras lo veías', {
        current: { status: rule?.status ?? 'pending', updatedAt: draft?.updatedAt ?? at },
      });
    }
    apply(req, draft as DraftOrder, spec.order.to, actor, null, now(req));
  }

  let event: AdminDeliveryEvent;
  const extra: { riderId?: string | null; riderName?: string | null; reason?: string | null } = {};
  switch (command) {
    case 'assign': {
      const picked = rider as AdminRiderRecord;
      event = before === 'assigned' ? 'rider_reassigned' : 'rider_assigned';
      d.riderId = picked.id;
      d.assignedAt = at;
      extra.riderId = picked.id;
      extra.riderName = picked.fullName;
      break;
    }
    case 'unassign': {
      event = 'rider_unassigned';
      const previous = riderOf(req.store, d.riderId);
      extra.riderId = d.riderId;
      extra.riderName = previous?.fullName ?? null;
      extra.reason = body.reason;
      d.riderId = null;
      d.assignedAt = null;
      break;
    }
    case 'mark_picked_up':
      event = 'picked_up';
      d.pickedUpAt = at;
      break;
    case 'mark_delivered':
      event = 'delivered';
      d.deliveredAt = at;
      break;
    case 'return_to_branch':
      event = 'returned';
      d.returnedAt = at;
      break;
    case 'cancel': {
      event = 'cancelled';
      extra.reason = body.reason;
      extra.riderId = d.riderId;
      extra.riderName = riderOf(req.store, d.riderId)?.fullName ?? null;
      d.riderId = null;
      d.cancelledAt = at;
      break;
    }
  }
  d.status = spec.to;
  d.version += 1;
  d.updatedAt = at;
  if (!extra.riderId && d.riderId) {
    extra.riderId = d.riderId;
    extra.riderName = riderOf(req.store, d.riderId)?.fullName ?? null;
  }
  d.history.push(entryOf(event, d, before, actor, at, extra));
  return result(req, actor, d, before, event, at, false, true);
}

export const assignOwnRiderToAdminDelivery: Handler = (req) => run(req, 'assign');
export const unassignRiderFromAdminDelivery: Handler = (req) => run(req, 'unassign');
export const markAdminDeliveryPickedUp: Handler = (req) => run(req, 'mark_picked_up');
export const markAdminDeliveryDelivered: Handler = (req) => run(req, 'mark_delivered');
export const returnAdminDeliveryToBranch: Handler = (req) => run(req, 'return_to_branch');
export const cancelAdminDelivery: Handler = (req) => run(req, 'cancel');
