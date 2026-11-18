import type { Branch, DraftOrder, ReportSummary } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { addDaysISO, localDate, localMinutes, localTime } from '@/lib/time';
import { dayNumber, dayShort, formatMoneyCompact } from './format';

/**
 * Lógica de presentación de Reportes (sin React): rangos, modelos de gráficos y filtros/totales del historial.
 * Los totales del historial se calculan SOLO a partir de las filas, para que coincidan con lo que se ve.
 */

// ── Rangos ────────────────────────────────────────────────────────────────────────────────

export type RangeKey = 'hoy' | 'ayer' | '7d' | '30d' | 'mes' | 'custom';

export interface DateRange {
  key: RangeKey;
  from: string;
  to: string;
}

/** Atajos de periodo (`setRange` del prototipo). `today` es la fecha de la demo (`useNow`), nunca `new Date()`. */
export function presetRange(key: Exclude<RangeKey, 'custom'>, today: string): DateRange {
  switch (key) {
    case 'hoy':
      return { key, from: today, to: today };
    case 'ayer': {
      const y = addDaysISO(today, -1);
      return { key, from: y, to: y };
    }
    case '7d':
      return { key, from: addDaysISO(today, -6), to: today };
    case '30d':
      return { key, from: addDaysISO(today, -29), to: today };
    case 'mes':
      return { key, from: `${today.slice(0, 8)}01`, to: today };
  }
}

// ── Gráficos del resumen ──────────────────────────────────────────────────────────────────

/** Color de cada sucursal en los gráficos (`BR_COLOR` del prototipo), por posición entre las sucursales activas. */
export const BRANCH_COLORS = [
  'var(--bo-primary)',
  'var(--bo-secondary)',
  'var(--bo-accent)',
  'var(--bo-green)',
  'var(--bo-muted)',
] as const;

export function branchColor(branches: readonly Pick<Branch, 'id'>[], branchId: string): string {
  const index = branches.findIndex((b) => b.id === branchId);
  return BRANCH_COLORS[(index < 0 ? 0 : index) % BRANCH_COLORS.length] ?? BRANCH_COLORS[0];
}

/** Más de 11 columnas: etiquetas cortas y sin cifras sobre las barras (`many` del prototipo). */
export const MANY_GROUPS = 11;

export interface OrderBar {
  branchId: string;
  count: number;
  /** Altura en % (mínimo 2). */
  h: number;
  color: string;
  title: string;
}

export interface OrderGroup {
  key: string;
  label: string;
  count: number;
  /** Cifra sobre la columna ('' si hay muchas columnas). */
  total: string;
  bars: OrderBar[];
}

export interface SalesBar {
  key: string;
  label: string;
  sales: number;
  h: number;
  value: string;
  today: boolean;
  title: string;
}

export interface BranchSalesRow {
  branchId: string;
  name: string;
  sales: number;
  salesLabel: string;
  pct: number;
  color: string;
}

export interface TopRow {
  pos: number;
  name: string;
  quantity: number;
  pct: number;
}

export interface ReportCharts {
  unit: 'hour' | 'day';
  many: boolean;
  gap: number;
  minWidth: number;
  salesMinWidth: number;
  orderGroups: OrderGroup[];
  salesBars: SalesBar[];
  legend: { branchId: string; name: string; color: string }[];
  byBranch: BranchSalesRow[];
  top: TopRow[];
}

const zoneShort = (branch: Branch | undefined) => branch?.zoneLabel.split(' · ')[0] ?? '';

/**
 * Modelo de los gráficos del resumen a partir de la respuesta del servidor. `branches` = sucursales activas, en el
 * orden que fija el color. `today` marca la barra del día actual (solo con unidad "día").
 */
export function buildReportCharts(
  summary: ReportSummary,
  branches: readonly Branch[],
  today: string | null,
): ReportCharts {
  const many = summary.groups.length > MANY_GROUPS;
  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const groupLabel = (key: string) =>
    summary.unit === 'hour' ? `${key}h` : many ? dayNumber(key) : dayShort(key);

  const maxCount = Math.max(1, ...summary.groups.flatMap((g) => g.byBranch.map((b) => b.orders)));
  const maxSales = Math.max(1, ...summary.groups.map((g) => g.sales));

  const orderGroups = summary.groups.map<OrderGroup>((g) => ({
    key: g.key,
    label: groupLabel(g.key),
    count: g.orders,
    total: many ? '' : String(g.orders),
    bars: g.byBranch.map((b) => ({
      branchId: b.branchId,
      count: b.orders,
      h: Math.max(2, Math.round((b.orders / maxCount) * 100)),
      color: branchColor(branches, b.branchId),
      title: `${nameOf(b.branchId)} · ${b.orders} pedidos`,
    })),
  }));

  const salesBars = summary.groups.map<SalesBar>((g) => ({
    key: g.key,
    label: groupLabel(g.key),
    sales: g.sales,
    h: Math.max(2, Math.round((g.sales / maxSales) * 100)),
    value: many ? '' : formatMoneyCompact(g.sales),
    today: summary.unit === 'day' && g.key === today,
    title: `${groupLabel(g.key)} · ${formatMoney(g.sales)}`,
  }));

  const maxBranch = Math.max(1, ...summary.byBranch.map((b) => b.sales));
  const byBranch = summary.byBranch.map<BranchSalesRow>((b) => {
    const branch = branches.find((x) => x.id === b.branchId);
    return {
      branchId: b.branchId,
      name: branch ? `${branch.name} · ${zoneShort(branch)}` : b.branchId,
      sales: b.sales,
      salesLabel: formatMoneyCompact(b.sales),
      pct: Math.round((b.sales / maxBranch) * 100),
      color: branchColor(branches, b.branchId),
    };
  });

  const maxTop = Math.max(1, summary.topProducts[0]?.quantity ?? 1);
  const top = summary.topProducts.map<TopRow>((p, i) => ({
    pos: i + 1,
    name: p.name,
    quantity: p.quantity,
    pct: Math.round((p.quantity / maxTop) * 100),
  }));

  return {
    unit: summary.unit,
    many,
    gap: many ? 4 : 12,
    minWidth: many ? summary.groups.length * 34 : 0,
    salesMinWidth: many ? summary.groups.length * 30 : 0,
    orderGroups,
    salesBars,
    legend: summary.byBranch.map((b) => ({
      branchId: b.branchId,
      name: nameOf(b.branchId),
      color: branchColor(branches, b.branchId),
    })),
    byBranch,
    top,
  };
}

export interface SummaryKpis {
  orders: number;
  cancelled: number;
  sales: number;
  averageTicket: number;
  deliveryOrders: number;
  /** % de pedidos de delivery sobre el total (entero). */
  deliveryPct: number;
}

export function summaryKpis(summary: ReportSummary): SummaryKpis {
  return {
    orders: summary.orders,
    cancelled: summary.cancelled,
    sales: summary.sales,
    averageTicket: summary.averageTicket,
    deliveryOrders: summary.deliveryOrders,
    deliveryPct: summary.orders ? Math.round((summary.deliveryOrders / summary.orders) * 100) : 0,
  };
}

// ── Historial ─────────────────────────────────────────────────────────────────────────────

export type HistoryStatus = 'todos' | 'entregado' | 'cancelado' | 'curso';
export type HistoryType = 'todos' | 'delivery' | 'pickup';
export type HistorySlot = 'todas' | 'almuerzo' | 'tarde' | 'noche';
export type HistorySort = 'recientes' | 'antiguos' | 'mayor' | 'menor';

export interface HistoryFilters {
  search: string;
  status: HistoryStatus;
  type: HistoryType;
  slot: HistorySlot;
  /** `all` o id de producto. */
  product: string;
  min: string;
  max: string;
  sort: HistorySort;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  search: '',
  status: 'todos',
  type: 'todos',
  slot: 'todas',
  product: 'all',
  min: '',
  max: '',
  sort: 'recientes',
};

/** Tamaño de página del historial. */
export const HISTORY_PAGE = 25;

/** Un pedido cuenta como venta salvo recibido sin aceptar, rechazado o cancelado (misma regla que el servidor). */
export const isSaleOrder = (order: Pick<DraftOrder, 'status'>) =>
  !['received', 'rejected', 'cancelled'].includes(order.status);

export const isCancelledOrder = (order: Pick<DraftOrder, 'status'>) =>
  order.status === 'rejected' || order.status === 'cancelled';

export const orderDay = (order: Pick<DraftOrder, 'createdAt'>) =>
  localDate(new Date(order.createdAt));

export const orderClock = (order: Pick<DraftOrder, 'createdAt'>) =>
  localTime(new Date(order.createdAt));

const orderMinutes = (order: Pick<DraftOrder, 'createdAt'>) =>
  localMinutes(new Date(order.createdAt));

export function productsText(order: Pick<DraftOrder, 'lines'>): string {
  return order.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ');
}

/** Cantidad de filtros activos (contador de "Filtros"). */
export function activeFilterCount(f: HistoryFilters): number {
  const min = parseFloat(f.min);
  const max = parseFloat(f.max);
  return (
    (f.search.trim() ? 1 : 0) +
    (f.status !== 'todos' ? 1 : 0) +
    (f.type !== 'todos' ? 1 : 0) +
    (f.slot !== 'todas' ? 1 : 0) +
    (f.product !== 'all' ? 1 : 0) +
    (Number.isNaN(min) ? 0 : 1) +
    (Number.isNaN(max) ? 0 : 1)
  );
}

export function matchesHistorySearch(
  order: Pick<DraftOrder, 'id' | 'customer'>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/[^0-9]/g, '');
  return (
    order.id.toLowerCase().includes(q) ||
    order.customer.name.toLowerCase().includes(q) ||
    (digits.length >= 4 && order.customer.phone.replace(/[^0-9]/g, '').includes(digits))
  );
}

export function filterHistory(orders: readonly DraftOrder[], f: HistoryFilters): DraftOrder[] {
  const min = parseFloat(f.min);
  const max = parseFloat(f.max);
  return orders.filter((o) => {
    if (!matchesHistorySearch(o, f.search)) return false;
    if (f.status === 'entregado' && o.status !== 'delivered') return false;
    if (f.status === 'cancelado' && !isCancelledOrder(o)) return false;
    if (f.status === 'curso' && (o.status === 'delivered' || isCancelledOrder(o))) return false;
    if (f.type !== 'todos' && o.fulfillment !== f.type) return false;
    const minutes = orderMinutes(o);
    if (f.slot === 'almuerzo' && !(minutes < 900)) return false;
    if (f.slot === 'tarde' && !(minutes >= 900 && minutes < 1080)) return false;
    if (f.slot === 'noche' && !(minutes >= 1080)) return false;
    if (f.product !== 'all' && !o.lines.some((l) => l.productId === f.product)) return false;
    if (!Number.isNaN(min) && o.total < min) return false;
    if (!Number.isNaN(max) && o.total > max) return false;
    return true;
  });
}

export function sortHistory(orders: readonly DraftOrder[], sort: HistorySort): DraftOrder[] {
  const list = [...orders];
  const key = (o: DraftOrder) => `${o.createdAt} ${o.id}`;
  if (sort === 'recientes') return list.sort((a, b) => (key(a) < key(b) ? 1 : -1));
  if (sort === 'antiguos') return list.sort((a, b) => (key(a) < key(b) ? -1 : 1));
  if (sort === 'menor') return list.sort((a, b) => a.total - b.total);
  return list.sort((a, b) => b.total - a.total);
}

export interface HistoryTotals {
  count: number;
  cancelled: number;
  delivery: number;
  /** Suma de `total` de las filas que cuentan como venta. */
  sales: number;
  /** Ventas / pedidos no cancelados. */
  ticket: number;
  cancelledPct: number;
  deliveryPct: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function historyTotals(orders: readonly DraftOrder[]): HistoryTotals {
  const count = orders.length;
  const cancelled = orders.filter(isCancelledOrder).length;
  const delivery = orders.filter((o) => o.fulfillment === 'delivery').length;
  const sales = round2(orders.filter(isSaleOrder).reduce((sum, o) => sum + o.total, 0));
  const ok = count - cancelled;
  return {
    count,
    cancelled,
    delivery,
    sales,
    ticket: ok ? round2(sales / ok) : 0,
    cancelledPct: count ? Math.round((cancelled / count) * 1000) / 10 : 0,
    deliveryPct: count ? Math.round((delivery / count) * 100) : 0,
  };
}

export interface DayGroup {
  /** `YYYY-MM-DD`, o '' cuando se ordena por monto. */
  day: string;
  count: number;
  sales: number;
  cancelled: number;
  rows: DraftOrder[];
}

/**
 * Agrupa por día las primeras `limit` filas (ya ordenadas). Los totales del encabezado de cada día salen de TODAS las
 * filas del día, no solo de las mostradas.
 */
export function groupByDay(sorted: readonly DraftOrder[], limit: number): DayGroup[] {
  const perDay = new Map<string, { count: number; sales: number; cancelled: number }>();
  for (const o of sorted) {
    const d = orderDay(o);
    const t = perDay.get(d) ?? { count: 0, sales: 0, cancelled: 0 };
    t.count += 1;
    if (isCancelledOrder(o)) t.cancelled += 1;
    if (isSaleOrder(o)) t.sales = round2(t.sales + o.total);
    perDay.set(d, t);
  }
  const groups: DayGroup[] = [];
  for (const o of sorted.slice(0, limit)) {
    const d = orderDay(o);
    let g = groups[groups.length - 1];
    if (!g || g.day !== d) {
      g = { day: d, ...(perDay.get(d) ?? { count: 0, sales: 0, cancelled: 0 }), rows: [] };
      groups.push(g);
    }
    g.rows.push(o);
  }
  return groups;
}

/** Productos presentes en los pedidos del periodo (para el filtro "Producto"), por nombre. */
export function historyProductOptions(
  orders: readonly DraftOrder[],
): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const o of orders) for (const l of o.lines) map.set(l.productId, l.name);
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
