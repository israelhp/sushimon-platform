import type {
  MyOrderPage,
  MyOrderSummary,
  OrderLifecycleStatus,
  OrderReceipt,
  OrderReorderPreview,
} from '@/lib/data-access/models';
import { receiptPayment } from '../cash-payments';
import { moneyToCents } from '@/lib/checkout-quote';
import { priceToCents } from '@/lib/product-rules';
import {
  availableAt,
  badRequest,
  effectivePriceAt,
  failCode,
  fail,
  normalizeOrderNumber,
} from '../domain';
import {
  diagnoseReorder,
  type CatalogView,
  type DiagGroup,
  type ReorderSourceLine,
} from '../order-reorder';
import { UUID_SHAPE, ensurePlacedRecord, syncFromDraft } from '../order-history';
import { PUBLIC_OF, TERMINAL } from '../order-tracking';
import type { MockStore, PlacedOrderRecord } from '../store';
import { authorizePlaced, findPlacedOrder, problem } from './order-placement';
import { settleReviews, visibleOrder } from './orders';
import { isProductVisible } from './products';
import { availabilityFor } from './schedule';
import { now, type Handler, type Req } from './shared';

/**
 * F23 (spec 024, ADR-0029) — historial, recibo y vista previa de «Volver a pedir» SIMULADOS con la forma REAL del contrato
 * (`MyOrderPage`, `OrderReceipt`, `OrderReorderPreview`) y los mismos errores: 400 (filtros, cursor `ORDER_CURSOR_INVALID`, cuerpo
 * con campos desconocidos), 401 (lista sin sesión), 404 UNIFORME (pedido inexistente, ajeno o sin credencial; `BRANCH_NOT_FOUND`
 * solo tras autorizar), 429 `RATE_LIMITED` y 503 `ORDERS_BUSY` con `Retry-After` (fallos de prueba `rate-limited` y `busy`).
 * Solo lectura: no crea ni modifica pedidos. NO es seguridad: la autorización real es del servidor.
 */

const RETRY_AFTER_SEC = 2;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_RANGE_MS = 366 * 86_400_000;
const LIFECYCLE: readonly OrderLifecycleStatus[] = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function faults(req: Req) {
  if (req.fault === 'rate-limited') {
    problem(
      429,
      'RATE_LIMITED',
      'Demasiadas solicitudes; espera unos segundos',
      {},
      RETRY_AFTER_SEC,
    );
  }
  if (req.fault === 'busy') {
    problem(
      503,
      'ORDERS_BUSY',
      'Hay mucha demanda; reintenta en unos segundos',
      {},
      RETRY_AFTER_SEC,
    );
  }
}

// ── Cursor opaco (base64url de `(placedAt, id)`) ───────────────────────────────────────────

const encodeCursor = (placedAt: string, id: string) =>
  btoa(JSON.stringify({ t: placedAt, id }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function decodeCursor(raw: string): { t: string; id: string } {
  const invalid = () => failCode(400, 'ORDER_CURSOR_INVALID', 'El cursor no es válido');
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const value: unknown = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { t?: unknown }).t === 'string' &&
      typeof (value as { id?: unknown }).id === 'string' &&
      !Number.isNaN(Date.parse((value as { t: string }).t))
    ) {
      return value as { t: string; id: string };
    }
  } catch {
    /* cursor ilegible */
  }
  return invalid();
}

// ── GET /v1/me/orders ──────────────────────────────────────────────────────────────────────

function summaryOf(store: MockStore, record: PlacedOrderRecord): MyOrderSummary {
  const d = record.detail;
  return {
    id: d.id,
    orderNumber: d.orderNumber,
    displayNumber: d.displayNumber,
    status: d.status,
    publicStatus: PUBLIC_OF[d.status],
    terminal: TERMINAL.includes(d.status),
    branchId: d.branchId,
    branchName: store.branches.find((b) => b.id === d.branchId)?.name ?? '',
    fulfillmentType: d.fulfillmentType,
    deliveryProvider: d.deliveryProvider,
    itemCount: d.lines.reduce((n, l) => n + l.quantity, 0),
    total: d.total,
    currency: 'GTQ',
    paymentMethodPreference: 'cash',
    placedAt: d.placedAt,
    updatedAt: d.updatedAt,
  };
}

function parseFilters(req: Req) {
  const problems: string[] = [];
  const q = req.query;
  let statuses: OrderLifecycleStatus[] | null = null;
  const rawStatus = q.get('status');
  if (rawStatus !== null) {
    const parts = rawStatus.split(',').map((x) => x.trim());
    if (parts.length > LIFECYCLE.length) problems.push('status: demasiados valores');
    else if (parts.some((p) => !LIFECYCLE.includes(p as OrderLifecycleStatus))) {
      problems.push('status: valor fuera del catálogo');
    } else statuses = parts as OrderLifecycleStatus[];
  }
  const instant = (name: 'from' | 'to'): number | null => {
    const raw = q.get(name);
    if (raw === null) return null;
    const ms = WITH_ZONE.test(raw) ? Date.parse(raw) : Number.NaN;
    if (Number.isNaN(ms)) problems.push(`${name}: instante ISO 8601 con zona`);
    return Number.isNaN(ms) ? null : ms;
  };
  const from = instant('from');
  const to = instant('to');
  if (from !== null && to !== null && (to <= from || to - from > MAX_RANGE_MS)) {
    problems.push('to: mayor que from y a lo sumo 366 días después');
  }
  let limit = DEFAULT_LIMIT;
  const rawLimit = q.get('limit');
  if (rawLimit !== null) {
    limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > MAX_LIMIT) problems.push(`limit: entero entre 1 y ${MAX_LIMIT}`);
  }
  if (problems.length) badRequest(problems);
  const rawCursor = q.get('cursor');
  return {
    statuses,
    branchId: q.get('branchId') || null,
    from,
    to,
    limit,
    cursor: rawCursor ? decodeCursor(rawCursor) : null,
  };
}

/** GET /v1/me/orders — historial del cliente de la sesión; orden `placed_at DESC, id DESC`, keyset por cursor, sin conteo total. */
export const listMyOrders: Handler = (req): MyOrderPage => {
  faults(req);
  const session = req.context.session.customer;
  if (!session) fail(401, 'Inicia sesión para continuar');
  const email = session.email.trim().toLowerCase();
  const f = parseFilters(req);

  const mine = req.store.orders.filter((o) => o.customer.email.trim().toLowerCase() === email);
  settleReviews(req, mine);
  const records = mine
    .map((draft) => ensurePlacedRecord(req.store, draft))
    // Un pedido de invitado (sin dueño) jamás se lista, aunque el correo coincida.
    .filter((r) => r.ownerEmail === email);

  const rows = records
    .map((r) => summaryOf(req.store, r))
    .filter((o) => !f.statuses || f.statuses.includes(o.status))
    .filter((o) => !f.branchId || o.branchId === f.branchId)
    .filter((o) => f.from === null || Date.parse(o.placedAt) >= f.from)
    .filter((o) => f.to === null || Date.parse(o.placedAt) < f.to)
    .sort(
      (a, b) => b.placedAt.localeCompare(a.placedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .filter(
      (o) =>
        !f.cursor || o.placedAt < f.cursor.t || (o.placedAt === f.cursor.t && o.id < f.cursor.id),
    );
  const items = rows.slice(0, f.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > f.limit && last ? encodeCursor(last.placedAt, last.id) : null,
    generatedAt: now(req).toISOString(),
  };
};

// ── Autorización por pedido (receipt / reorder-preview) ────────────────────────────────────

/**
 * Misma regla que `getOrder`: dueño por sesión o `X-Order-Token` vigente; si no, el MISMO 404. Por comodidad del mock, un número
 * `MON-…` (pedido BORRADOR del seguimiento simulado) se resuelve contra el pedido simulado equivalente con la visibilidad heredada.
 */
function authorizedRecord(req: Req): PlacedOrderRecord {
  const id = req.params.id ?? '';
  if (UUID_SHAPE.test(id)) {
    const record = findPlacedOrder(req.store, id);
    if (!record) fail(404, 'Pedido no encontrado');
    authorizePlaced(req, record);
    return record;
  }
  const draft = visibleOrder(req, normalizeOrderNumber(id));
  return syncFromDraft(req.store, ensurePlacedRecord(req.store, draft));
}

// ── GET /v1/orders/{id}/receipt ────────────────────────────────────────────────────────────

/** GET /v1/orders/{id}/receipt — recibo NO fiscal desde los snapshots (jamás recalcula desde el catálogo; sin ids, tokens ni motivos). */
export const getOrderReceipt: Handler = (req): OrderReceipt => {
  faults(req);
  const record = authorizedRecord(req);
  const d = record.detail;
  const branch = req.store.branches.find((b) => b.id === d.branchId);
  return {
    fiscalStatus: 'NOT_FISCAL',
    displayNumber: d.displayNumber,
    status: d.status,
    publicStatus: PUBLIC_OF[d.status],
    placedAt: d.placedAt,
    generatedAt: now(req).toISOString(),
    timeZone: 'America/Guatemala',
    currency: 'GTQ',
    branch: {
      name: branch?.name ?? '',
      address: branch?.address ?? '',
      phone: branch?.phone ?? null,
    },
    fulfillment: { type: d.fulfillmentType, provider: d.deliveryProvider },
    address: d.address,
    contact: d.contact,
    lines: d.lines,
    promotions: d.promotions,
    notes: d.notes,
    subtotal: d.subtotal,
    extrasTotal: d.extrasTotal,
    discountTotal: d.discountTotal,
    deliveryFee: d.deliveryFee,
    total: d.total,
    payment: receiptPayment(req.store, record.draftId),
  };
};

// ── POST /v1/orders/{id}/reorder-preview ───────────────────────────────────────────────────

function groupsOf(store: MockStore, productId: string): DiagGroup[] {
  return (store.productModifierGroups[productId] ?? []).flatMap((groupId) => {
    const group = store.modifierGroups.find((g) => g.id === groupId);
    if (!group) return [];
    return [
      {
        id: group.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        active: group.active,
        options: store.modifiers
          .filter((m) => m.groupId === group.id)
          .map((m) => ({ id: m.id, name: m.name, extraPrice: m.extraPrice, active: m.active })),
      },
    ];
  });
}

function catalogView(store: MockStore, branchId: string, branchActive: boolean): CatalogView {
  return {
    branchActive,
    product: (id) => {
      const p = store.products.find((x) => x.id === id);
      if (!p) return null;
      const media = [...p.media].sort((a, b) => a.sortOrder - b.sortOrder)[0];
      return {
        state: !isProductVisible(store, p)
          ? 'HIDDEN'
          : !availableAt(store, p, branchId)
            ? 'SOLD_OUT'
            : 'OK',
        slug: p.slug,
        name: p.name,
        imageUrl: media?.url ?? null,
        unitCents: priceToCents(effectivePriceAt(store, p, branchId)) ?? 0,
      };
    },
    groups: (productId) => groupsOf(store, productId),
  };
}

function sourceLines(record: PlacedOrderRecord): ReorderSourceLine[] {
  return record.detail.lines.map((l, i) => {
    const refs = record.lineRefs?.[i];
    return {
      lineNo: i + 1,
      productId: refs?.productId ?? null,
      productName: l.productName,
      quantity: l.quantity,
      unitCents: moneyToCents(l.unitPrice) ?? 0,
      extrasPerUnitCents: moneyToCents(l.extrasPerUnit) ?? 0,
      modifiers: l.modifiers.map((m, j) => ({
        modifierId: refs?.modifiers[j]?.modifierId ?? null,
        name: m.name,
        extraCents: moneyToCents(m.extraPrice) ?? 0,
      })),
      notes: l.notes,
    };
  });
}

/** Cuerpo opcional `{ branchId? }` con lista blanca: cualquier otra propiedad (precios, líneas, `customerId`, `__proto__`) => 400. */
function parseBranchChoice(req: Req): string | null {
  const raw = req.body;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw))
    badRequest(['Cuerpo de la solicitud inválido']);
  const extra = Object.keys(raw).filter((k) => k !== 'branchId');
  if (extra.length) badRequest(extra.map((k) => `${k}: campo no permitido`));
  const value = (raw as { branchId?: unknown }).branchId;
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value) badRequest(['branchId: obligatorio como texto']);
  return value;
}

/**
 * POST /v1/orders/{id}/reorder-preview — vista previa de SOLO LECTURA contra el catálogo VIGENTE de la sucursal. No crea pedidos, no
 * guarda nada y no copia precios, promociones, tarifa, modalidad, dirección ni pago. El 404 `BRANCH_NOT_FOUND` se evalúa DESPUÉS de
 * autorizar el pedido (no sirve para sondear pedidos). Los diagnósticos viajan en el 200 (no son errores).
 */
export const previewOrderReorder: Handler = (req): OrderReorderPreview => {
  faults(req);
  const record = authorizedRecord(req);
  const d = record.detail;
  const requested = parseBranchChoice(req) ?? d.branchId;
  const branch = req.store.branches.find((b) => b.id === requested);
  if (!branch) failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');

  const at = now(req);
  const availability = availabilityFor(req.store, branch, at);
  const active = branch.active && branch.status === 'active';
  const { lines, summary } = diagnoseReorder(
    sourceLines(record),
    catalogView(req.store, branch.id, active),
  );
  return {
    generatedAt: at.toISOString(),
    source: {
      displayNumber: d.displayNumber,
      status: d.status,
      fulfillmentType: d.fulfillmentType,
      deliveryProvider: d.deliveryProvider,
      placedAt: d.placedAt,
    },
    branch: {
      originalBranchId: d.branchId,
      requestedBranchId: branch.id,
      sameBranch: branch.id === d.branchId,
      name: branch.name,
      active,
      acceptingOrders: active && availability.isAcceptingOrders,
      reason: active ? availability.reason : 'INACTIVE',
      nextOpensAt: active ? availability.nextOpensAt : null,
    },
    lines,
    summary,
  };
};
