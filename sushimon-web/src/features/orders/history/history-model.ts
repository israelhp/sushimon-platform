import type { MyOrderSummary, OrderLifecycleStatus } from '@/lib/data-access/models';
import type { MyOrderFilters } from '@/services/orders';

/**
 * F23 (spec 024 §9.2) — Modelo de vista PURO del historial «Mis pedidos»: pestañas → estados, rango de fechas → instantes con zona
 * de Guatemala, validación del rango y aplanado de páginas. NO ordena ni filtra lo que el servidor ya hace (orden fijo
 * `placed_at DESC, id DESC`, filtros y paginación por cursor) y NO calcula totales: la API real no entrega conteo ni «gastado».
 */

export type HistoryTab = 'active' | 'history';
export const HISTORY_TABS: readonly HistoryTab[] = ['active', 'history'];

/** «En curso» = lo que aún cambia; «Historial» = estados finales (spec 024 §9.2). */
export const ACTIVE_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
] as const satisfies readonly OrderLifecycleStatus[];
export const HISTORY_STATUSES = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
] as const satisfies readonly OrderLifecycleStatus[];

export const PAGE_SIZE = 20;
/** Rango máximo que acepta el servidor entre `from` y `to` (366 días). */
export const MAX_RANGE_DAYS = 366;

/** Guatemala no usa horario de verano: UTC−6 todo el año. */
const GT_OFFSET = '-06:00';
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros de la pantalla. Serializable y estable: forma parte de la clave de caché (con la identidad). */
export interface OrderHistoryFilters {
  tab: HistoryTab;
  /** `null` = todas las sucursales. */
  branchId: string | null;
  /** Fechas locales `YYYY-MM-DD` (inclusivas), o `null`. */
  from: string | null;
  to: string | null;
}

export const defaultHistoryFilters = (tab: HistoryTab = 'active'): OrderHistoryFilters => ({
  tab,
  branchId: null,
  from: null,
  to: null,
});

const dayNumber = (date: string): number | null => {
  if (!DATE_PATTERN.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
};

/** Día siguiente (`YYYY-MM-DD`) en aritmética de calendario (sin zona horaria del navegador). */
export function nextDay(date: string): string | null {
  const n = dayNumber(date);
  return n === null ? null : new Date((n + 1) * DAY_MS).toISOString().slice(0, 10);
}

export type RangeProblem = 'invalid' | 'inverted' | 'tooLong';

/** `null` = el rango es válido o está incompleto (un solo extremo). El servidor igualmente lo valida (400). */
export function rangeProblem(from: string | null, to: string | null): RangeProblem | null {
  const a = from ? dayNumber(from) : null;
  const b = to ? dayNumber(to) : null;
  if ((from && a === null) || (to && b === null)) return 'invalid';
  if (a === null || b === null) return null;
  if (b < a) return 'inverted';
  // `to` es exclusivo en la API: se envía el día siguiente, por eso el rango incluye ambos extremos.
  return b - a + 1 > MAX_RANGE_DAYS ? 'tooLong' : null;
}

/** Filtros de pantalla → parámetros de `listMyOrders`. Las fechas se envían como instantes CON zona (America/Guatemala). */
export function toListFilters(filters: OrderHistoryFilters): MyOrderFilters {
  const valid = rangeProblem(filters.from, filters.to) === null;
  const to = valid && filters.to ? nextDay(filters.to) : null;
  return {
    status: filters.tab === 'active' ? ACTIVE_STATUSES : HISTORY_STATUSES,
    branchId: filters.branchId ?? undefined,
    from: valid && filters.from ? `${filters.from}T00:00:00${GT_OFFSET}` : undefined,
    to: to ? `${to}T00:00:00${GT_OFFSET}` : undefined,
    limit: PAGE_SIZE,
  };
}

/** ¿Hay algún filtro opcional activo (sucursal o fechas)? */
export const hasActiveFilters = (f: OrderHistoryFilters): boolean =>
  f.branchId !== null || f.from !== null || f.to !== null;

/** Páginas → filas, sin repetir ids (un `Cargar más` tras un refetch no duplica filas). Conserva el orden del servidor. */
export function mergePages(
  pages: readonly { items: readonly MyOrderSummary[] }[] | undefined,
): MyOrderSummary[] {
  const seen = new Set<string>();
  const rows: MyOrderSummary[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(item);
    }
  }
  return rows;
}

/** Acciones de una fila (spec 024 §9.2): «Seguimiento» solo si no es terminal; detalle, recibo y reorden siempre. */
export function rowActions(order: Pick<MyOrderSummary, 'terminal'>) {
  return { tracking: !order.terminal, detail: true, receipt: true, reorder: true };
}

/** El historial solo se pide con una identidad de cliente RESUELTA (sin sesión nunca llama a la API). */
export type HistoryGate = 'ready' | 'pending' | 'signed-out';
