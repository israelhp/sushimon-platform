import type { DeliveryProvider, DraftOrder } from '@/lib/data-access/models';
import { toBackofficeLogistics, type BackofficeLogisticsKey } from '@/lib/order-status';
import { addDaysISO, localDate, localTime, minutesBetween } from '@/lib/time';

/**
 * Lógica pura de la pantalla Entregas (`deliveriesView` del prototipo). Nada lee el reloj ni la red: el "ahora" y
 * los pedidos llegan por parámetro. Los horarios de llegada de PedidosYa son SIMULADOS y estimados.
 */

/** Días de historial disponibles (HIST_DAYS del prototipo). */
export const DELIVERY_HISTORY_DAYS = 60;
/** Paso de la paginación "Mostrar N más". */
export const DELIVERY_PAGE_SIZE = 25;

// ── Periodo ────────────────────────────────────────────────────────────────────────────────

export type QuickRange = 'hoy' | 'ayer' | '7d' | '30d' | 'mes' | 'custom';

/** Rango de un atajo del periodo (setERange del prototipo). `today` = YYYY-MM-DD local. */
export function quickRange(range: Exclude<QuickRange, 'custom'>, today: string) {
  switch (range) {
    case 'ayer': {
      const d = addDaysISO(today, -1);
      return { from: d, to: d };
    }
    case '7d':
      return { from: addDaysISO(today, -6), to: today };
    case '30d':
      return { from: addDaysISO(today, -29), to: today };
    case 'mes':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: today, to: today };
  }
}

export interface PeriodInfo {
  /** Rango efectivo (ya recortado, `from <= to`). */
  from: string;
  to: string;
  /** Primer día con datos y hoy. */
  min: string;
  today: string;
  days: number;
  /** Se ajustó el rango pedido al disponible. */
  clipped: boolean;
}

/** Normaliza el rango (invierte si hace falta y lo recorta al historial disponible). */
export function clampPeriod(from: string, to: string, today: string): PeriodInfo {
  let a = from;
  let b = to;
  if (b < a) [a, b] = [b, a];
  const min = addDaysISO(today, -(DELIVERY_HISTORY_DAYS - 1));
  const clipped = a < min || b > today;
  if (a < min) a = min;
  if (b > today) b = today;
  let days = 0;
  for (let d = a; d <= b && days < DELIVERY_HISTORY_DAYS; d = addDaysISO(d, 1)) days += 1;
  return { from: a, to: b, min, today, days, clipped };
}

// ── Filas ──────────────────────────────────────────────────────────────────────────────────

/** Estado agrupado para el filtro "Estado logístico" (`stKey` del prototipo). */
export type DeliveryState = 'sin' | 'proceso' | 'entregado' | 'cancelado';

export interface DeliveryRow {
  order: DraftOrder;
  id: string;
  dateISO: string;
  /** HH:mm local de creación del pedido. */
  time: string;
  stKey: DeliveryState;
  logistics: BackofficeLogisticsKey;
  provider: DeliveryProvider | null;
  /** Zona de entrega: clave de agrupación y partes para etiquetarla. */
  zoneKey: string;
  zoneNumber: string;
  municipality: string;
  /** Minutos del pedido a la entrega (null si aún no se entrega). */
  duration: number | null;
  /** Pendiente de repartidor o en ruta hoy (muestra "N min · en curso"). */
  live: boolean;
  /** Minutos transcurridos desde el pedido (para `live`). */
  elapsed: number;
  /** Costo PedidosYa (null = repartidor propio o sin logística). */
  cost: number | null;
  /** Costo PedidosYa − envío cobrado (null sin costo). */
  diff: number | null;
  /** Nombre corto del repartidor (null = sin asignar / cancelado). */
  riderName: string | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

function stateOf(order: DraftOrder): DeliveryState {
  if (order.status === 'rejected' || order.status === 'cancelled') return 'cancelado';
  const d = order.delivery;
  if (d) {
    if (d.status === 'delivered') return 'entregado';
    return d.status === 'failed' ? 'sin' : 'proceso';
  }
  return order.status === 'delivered' ? 'entregado' : 'sin';
}

export function toDeliveryRow(order: DraftOrder, today: string, now: Date | null): DeliveryRow {
  const d = order.delivery;
  const created = new Date(order.createdAt);
  const dateISO = localDate(created);
  const stKey = stateOf(order);
  const doneAt = d ? (d.deliveredAt ?? (d.status === 'delivered' ? d.etaAt : null)) : null;
  const duration = doneAt ? Math.max(0, minutesBetween(order.createdAt, doneAt)) : null;
  const cost = d && d.provider === 'pedidosya' ? d.cost : null;
  const zone = order.address?.zone ?? '';
  const municipality = order.address?.municipality ?? '';
  const riderName = d?.riderName ? (d.riderName.split(' · ')[0] ?? null) : null;
  return {
    order,
    id: order.id,
    dateISO,
    time: localTime(created),
    stKey,
    logistics: toBackofficeLogistics(order),
    provider: d ? d.provider : null,
    zoneKey: zone ? `z:${zone}` : `m:${municipality || '-'}`,
    zoneNumber: zone,
    municipality,
    duration,
    live: (stKey === 'proceso' || stKey === 'sin') && dateISO === today,
    elapsed: now ? Math.max(0, minutesBetween(order.createdAt, now)) : 0,
    cost,
    diff: cost != null ? round2(cost - order.deliveryFee) : null,
    riderName,
  };
}

/** Solo envíos a domicilio, decorados. */
export function toDeliveryRows(
  orders: readonly DraftOrder[],
  today: string,
  now: Date | null,
): DeliveryRow[] {
  return orders
    .filter((o) => o.fulfillment === 'delivery')
    .map((o) => toDeliveryRow(o, today, now));
}

export const hasDiff = (row: Pick<DeliveryRow, 'diff'>) => !!row.diff;

// ── Filtros ────────────────────────────────────────────────────────────────────────────────

export type ProviderFilter = 'todos' | DeliveryProvider;
export type StateFilter = 'todos' | DeliveryState;
export type TimeFilter = 'todos' | 'rapido' | 'normal' | 'lento';
export type CostFilter = 'todos' | 'dif' | 'igual';
export type SortKey = 'recientes' | 'antiguos' | 'tiempo' | 'diferencia';

export interface DeliveryFilters {
  query: string;
  provider: ProviderFilter;
  state: StateFilter;
  rider: 'all' | string;
  zone: 'all' | string;
  time: TimeFilter;
  cost: CostFilter;
  sort: SortKey;
}

export const DEFAULT_DELIVERY_FILTERS: DeliveryFilters = {
  query: '',
  provider: 'todos',
  state: 'todos',
  rider: 'all',
  zone: 'all',
  time: 'todos',
  cost: 'todos',
  sort: 'recientes',
};

/** Cantidad de filtros activos (el orden no cuenta). */
export function activeFilterCount(f: DeliveryFilters): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.provider !== 'todos' ? 1 : 0) +
    (f.state !== 'todos' ? 1 : 0) +
    (f.rider !== 'all' ? 1 : 0) +
    (f.zone !== 'all' ? 1 : 0) +
    (f.time !== 'todos' ? 1 : 0) +
    (f.cost !== 'todos' ? 1 : 0)
  );
}

/** Todos los filtros salvo el de repartidor (alimenta "Repartidores del periodo"). */
export function filterBase(rows: readonly DeliveryRow[], f: DeliveryFilters): DeliveryRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = [
        r.id,
        r.order.customer.name,
        r.order.address?.line ?? '',
        r.order.delivery?.reference ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.state !== 'todos' && r.stKey !== f.state) return false;
    if (f.provider !== 'todos' && r.provider !== f.provider) return false;
    if (f.zone !== 'all' && r.zoneKey !== f.zone) return false;
    const dur = r.duration;
    if (f.time === 'rapido' && !(dur != null && dur <= 35)) return false;
    if (f.time === 'normal' && !(dur != null && dur > 35 && dur <= 50)) return false;
    if (f.time === 'lento' && !(dur != null && dur > 50)) return false;
    if (f.cost === 'dif' && !hasDiff(r)) return false;
    if (f.cost === 'igual' && (hasDiff(r) || r.cost == null)) return false;
    return true;
  });
}

export function filterRows(rows: readonly DeliveryRow[], f: DeliveryFilters): DeliveryRow[] {
  return filterBase(rows, f).filter((r) => f.rider === 'all' || r.riderName === f.rider);
}

const recencyKey = (r: DeliveryRow) => `${r.order.createdAt} ${r.id}`;

export function sortRows(rows: readonly DeliveryRow[], sort: SortKey): DeliveryRow[] {
  const out = [...rows];
  if (sort === 'recientes') out.sort((a, b) => (recencyKey(a) < recencyKey(b) ? 1 : -1));
  else if (sort === 'antiguos') out.sort((a, b) => (recencyKey(a) < recencyKey(b) ? -1 : 1));
  else if (sort === 'tiempo') out.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  else out.sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0));
  return out;
}

// ── Indicadores ────────────────────────────────────────────────────────────────────────────

export interface DeliveryStats {
  total: number;
  own: number;
  pedidosya: number;
  delivered: number;
  withoutRider: number;
  inProgress: number;
  /** Promedio (min) pedido → entrega; 0 si no hay entregados. */
  avgMinutes: number;
  /** Costo PedidosYa de los envíos que lo tienen. */
  cost: number;
  /** Envío cobrado de esos mismos envíos. */
  charged: number;
  /** cost − charged. */
  difference: number;
  withDifference: number;
}

export function deliveryStats(rows: readonly DeliveryRow[]): DeliveryStats {
  const delivered = rows.filter((r) => r.duration != null);
  const priced = rows.filter((r) => r.cost != null);
  const cost = round2(priced.reduce((s, r) => s + (r.cost ?? 0), 0));
  const charged = round2(priced.reduce((s, r) => s + r.order.deliveryFee, 0));
  return {
    total: rows.length,
    own: rows.filter((r) => r.provider === 'own').length,
    pedidosya: rows.filter((r) => r.provider === 'pedidosya').length,
    delivered: delivered.length,
    withoutRider: rows.filter((r) => r.stKey === 'sin').length,
    inProgress: rows.filter((r) => r.stKey === 'proceso').length,
    avgMinutes: delivered.length
      ? Math.round(delivered.reduce((s, r) => s + (r.duration ?? 0), 0) / delivered.length)
      : 0,
    cost,
    charged,
    difference: round2(cost - charged),
    withDifference: rows.filter(hasDiff).length,
  };
}

export interface PeriodRider {
  name: string;
  provider: DeliveryProvider;
  count: number;
  /** Promedio (min) o null si no hay entregas completadas. */
  avgMinutes: number | null;
  /** Ancho de la barra (0–100) relativo al repartidor con más envíos. */
  width: number;
}

/** "Repartidores del periodo": agrupa por nombre las filas con repartidor, de más a menos envíos. */
export function ridersOfPeriod(rows: readonly DeliveryRow[]): PeriodRider[] {
  const map = new Map<string, { n: number; t: number; d: number; provider: DeliveryProvider }>();
  for (const r of rows) {
    if (!r.riderName || !r.provider) continue;
    const e = map.get(r.riderName) ?? { n: 0, t: 0, d: 0, provider: r.provider };
    e.n += 1;
    if (r.duration != null) {
      e.t += r.duration;
      e.d += 1;
    }
    map.set(r.riderName, e);
  }
  const names = [...map.keys()].sort((a, b) => map.get(b)!.n - map.get(a)!.n || a.localeCompare(b));
  const max = names.length ? map.get(names[0]!)!.n : 1;
  return names.map((name) => {
    const e = map.get(name)!;
    return {
      name,
      provider: e.provider,
      count: e.n,
      avgMinutes: e.d ? Math.round(e.t / e.d) : null,
      width: Math.round((e.n / max) * 100),
    };
  });
}

export interface ZoneOption {
  key: string;
  zoneNumber: string;
  municipality: string;
  count: number;
}

/** Zonas presentes, ordenadas por número de zona (las sin número al final). */
export function zoneOptions(rows: readonly DeliveryRow[]): ZoneOption[] {
  const map = new Map<string, ZoneOption>();
  for (const r of rows) {
    const e = map.get(r.zoneKey) ?? {
      key: r.zoneKey,
      zoneNumber: r.zoneNumber,
      municipality: r.municipality,
      count: 0,
    };
    e.count += 1;
    map.set(r.zoneKey, e);
  }
  const num = (z: ZoneOption) => parseInt(z.zoneNumber.replace(/\D/g, ''), 10) || 99;
  return [...map.values()].sort(
    (a, b) => num(a) - num(b) || a.municipality.localeCompare(b.municipality),
  );
}

/** Opciones de repartidor (nombre → cantidad de envíos), alfabético. */
export function riderOptions(rows: readonly DeliveryRow[]): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) if (r.riderName) map.set(r.riderName, (map.get(r.riderName) ?? 0) + 1);
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

/** Columna del pedido para el pill de la fila (cancelado = "Pedido cancelado"). */
export const isCancelledRow = (r: Pick<DeliveryRow, 'stKey'>) => r.stKey === 'cancelado';
