import type { Category, DraftOrder, ReportGroup, ReportSummary } from '@/lib/data-access/models';
import { localMinutes } from '@/lib/time';
import { fail, round2 } from '../domain';
import { clampRange } from '../factories/history';
import { isSale } from './backoffice';
import {
  body,
  ordersForDay,
  requireStaff,
  scopedBranchIds,
  str,
  today,
  type Handler,
  type Req,
} from './shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ── Categorías ────────────────────────────────────────────────────────────────────────────

/** GET /v1/backoffice/categories — todas, por orden. */
export const listBoCategories: Handler = (req): Category[] => {
  requireStaff(req);
  return [...req.store.categories].sort((a, b) => a.sortOrder - b.sortOrder);
};

/** POST /v1/backoffice/categories (admin) */
export const createCategory: Handler = (req): Category => {
  requireStaff(req, 'catalog.create');
  const b = body<Category>(req);
  if (!str(b.name).trim()) fail(400, 'Escribe el nombre de la categoría');
  const base = slug(str(b.name)) || `categoria-${req.store.sequences.category}`;
  const category: Category = {
    id: req.store.categories.some((c) => c.id === base)
      ? `${base}-${req.store.sequences.category}`
      : base,
    name: str(b.name).trim(),
    nameEn: b.nameEn ? str(b.nameEn).trim() : undefined,
    sortOrder:
      typeof b.sortOrder === 'number'
        ? b.sortOrder
        : Math.max(0, ...req.store.categories.map((c) => c.sortOrder)) + 1,
    visible: b.visible !== false,
    kind: 'products',
    illustration: b.illustration ? str(b.illustration) : undefined,
    jpLabel: b.jpLabel ? str(b.jpLabel) : undefined,
  };
  req.store.sequences.category++;
  req.store.categories.push(category);
  return category;
};

/** PATCH /v1/backoffice/categories/:id — nombre, orden, visibilidad. */
export const updateCategory: Handler = (req): Category => {
  requireStaff(req, 'catalog.update');
  const b = body<Category>(req);
  const index = req.store.categories.findIndex((c) => c.id === req.params.id);
  const current = req.store.categories[index];
  if (!current) fail(404, 'Categoría no encontrada');
  const next: Category = { ...current };
  if (b.name !== undefined) {
    if (!str(b.name).trim()) fail(400, 'Escribe el nombre de la categoría');
    next.name = str(b.name).trim();
  }
  if (b.nameEn !== undefined) next.nameEn = str(b.nameEn).trim();
  if (b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder)) fail(400, 'Orden inválido');
    next.sortOrder = b.sortOrder;
  }
  if (b.visible !== undefined) next.visible = b.visible === true;
  req.store.categories[index] = next;
  return next;
};

// ── Reportes ──────────────────────────────────────────────────────────────────────────────

function rangeParams(req: Req) {
  const from = req.query.get('from') || today(req);
  const to = req.query.get('to') || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) fail(400, 'Fechas inválidas (YYYY-MM-DD)');
  return clampRange(from, to, today(req));
}

const sales = (orders: DraftOrder[]) =>
  round2(orders.filter(isSale).reduce((s, o) => s + o.total, 0));

/** GET /v1/backoffice/reports/summary?from&to&branchId */
export const getReportSummary: Handler = (req): ReportSummary => {
  const user = requireStaff(req, 'reports.read');
  const branchIds = scopedBranchIds(req, user);
  const range = rangeParams(req);
  const perDay = range.days.map((d) => ({ day: d, orders: ordersForDay(req, d, branchIds) }));
  const all = perDay.flatMap((x) => x.orders);
  const byBranch = (orders: DraftOrder[]) =>
    branchIds.map((branchId) => {
      const mine = orders.filter((o) => o.branchId === branchId);
      return { branchId, orders: mine.length, sales: sales(mine) };
    });
  const group = (key: string, orders: DraftOrder[]): ReportGroup => ({
    key,
    orders: orders.length,
    sales: sales(orders),
    byBranch: byBranch(orders),
  });

  let unit: ReportSummary['unit'] = 'day';
  let groups: ReportGroup[];
  if (range.days.length === 1) {
    unit = 'hour';
    groups = Array.from({ length: 11 }, (_, i) => {
      const hour = 12 + i;
      const inHour = all.filter((o) => {
        const h = Math.min(22, Math.max(12, Math.floor(localMinutes(new Date(o.createdAt)) / 60)));
        return h === hour;
      });
      return group(String(hour), inHour);
    });
  } else {
    groups = perDay.map((x) => group(x.day, x.orders));
  }

  const qty = new Map<string, { name: string; quantity: number }>();
  for (const o of all) {
    if (o.status === 'rejected' || o.status === 'cancelled') continue;
    for (const l of o.lines) {
      const cur = qty.get(l.productId) ?? { name: l.name, quantity: 0 };
      cur.quantity += l.quantity;
      qty.set(l.productId, cur);
    }
  }
  const cancelled = all.filter((o) => o.status === 'rejected' || o.status === 'cancelled').length;
  const totalSales = sales(all);
  const ok = all.length - cancelled;
  return {
    from: range.from,
    to: range.to,
    branchId: branchIds.length === 1 ? (branchIds[0] ?? null) : null,
    unit,
    clipped: range.clipped,
    minDate: range.min,
    groups,
    byBranch: byBranch(all),
    topProducts: [...qty.entries()]
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.quantity - a.quantity || a.productId.localeCompare(b.productId))
      .slice(0, 6),
    orders: all.length,
    cancelled,
    sales: totalSales,
    averageTicket: ok ? round2(totalSales / ok) : 0,
    deliveryOrders: all.filter((o) => o.fulfillment === 'delivery').length,
  };
};

/** GET /v1/backoffice/reports/history?from&to&branchId — pedidos del rango (más recientes primero). */
export const getReportHistory: Handler = (req): DraftOrder[] => {
  const user = requireStaff(req, 'reports.read');
  const branchIds = scopedBranchIds(req, user);
  const range = rangeParams(req);
  return range.days
    .flatMap((d) => ordersForDay(req, d, branchIds))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
