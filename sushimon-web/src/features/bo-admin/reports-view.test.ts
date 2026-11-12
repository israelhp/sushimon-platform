import { describe, expect, it } from 'vitest';
import type { Branch, Order, ReportSummary } from '@/lib/data-access/models';
import { daysInRange, dayLong, dayShort, dayWithMonth, formatMoneyCompact } from './format';
import {
  DEFAULT_HISTORY_FILTERS,
  activeFilterCount,
  buildReportCharts,
  filterHistory,
  groupByDay,
  historyTotals,
  presetRange,
  sortHistory,
  summaryKpis,
} from './reports-view';

const TODAY = '2026-11-11';

let seq = 0;
function order(over: Partial<Order> & { at?: string }): Order {
  seq += 1;
  const { at = '2026-11-11T19:00:00Z', ...rest } = over;
  return {
    id: `MON-${seq}`,
    createdAt: at,
    branchId: 'sucursal-1',
    fulfillment: 'pickup',
    status: 'delivered',
    total: 100,
    deliveryFee: 0,
    customer: { name: 'Cliente Uno', phone: '+502 5555-1234', email: 'c@x.gt' },
    lines: [
      { productId: 'roll', name: 'Roll Mon', quantity: 1, note: '', unitPrice: 100, subtotal: 100 },
    ],
    rejectionReason: null,
    ...rest,
  } as Order;
}

describe('formatos de fecha y dinero', () => {
  it('usa las tablas del prototipo', () => {
    expect(dayShort('2026-11-05')).toBe('Jue 5');
    expect(dayWithMonth('2026-11-05')).toBe('Jue 5 nov');
    expect(dayLong('2026-11-11')).toBe('Miércoles 11 de noviembre de 2026');
    expect(formatMoneyCompact(6812)).toBe('Q6.8k');
    expect(formatMoneyCompact(842.4)).toBe('Q842');
    expect(daysInRange('2026-11-05', '2026-11-11')).toBe(7);
    expect(daysInRange('2026-11-11', '2026-11-11')).toBe(1);
  });
});

describe('presetRange', () => {
  it('calcula los atajos con el reloj de la demo', () => {
    expect(presetRange('hoy', TODAY)).toEqual({ key: 'hoy', from: TODAY, to: TODAY });
    expect(presetRange('ayer', TODAY)).toMatchObject({ from: '2026-11-10', to: '2026-11-10' });
    expect(presetRange('7d', TODAY)).toMatchObject({ from: '2026-11-05', to: TODAY });
    expect(presetRange('30d', TODAY)).toMatchObject({ from: '2026-10-13', to: TODAY });
    expect(presetRange('mes', TODAY)).toMatchObject({ from: '2026-11-01', to: TODAY });
  });
});

describe('historial', () => {
  const orders = [
    order({ total: 200, fulfillment: 'delivery', deliveryFee: 25 }),
    order({ total: 80, status: 'cancelled', rejectionReason: 'Agotado' }),
    order({ total: 60, status: 'received' }),
    order({ total: 140, at: '2026-11-10T15:00:00Z' }),
  ];

  it('los totales salen solo de las filas: ventas = suma de las que cuentan como venta', () => {
    const totals = historyTotals(orders);
    expect(totals.count).toBe(4);
    expect(totals.cancelled).toBe(1);
    expect(totals.delivery).toBe(1);
    // recibido sin aceptar y cancelado no suman
    expect(totals.sales).toBe(340);
    expect(totals.ticket).toBeCloseTo(340 / 3, 2);
    expect(totals.cancelledPct).toBe(25);
    expect(totals.deliveryPct).toBe(25);
    expect(historyTotals([])).toMatchObject({ count: 0, sales: 0, ticket: 0, cancelledPct: 0 });
  });

  it('filtra por estado, tipo, franja, monto y búsqueda', () => {
    const f = DEFAULT_HISTORY_FILTERS;
    expect(filterHistory(orders, { ...f, status: 'cancelado' })).toHaveLength(1);
    expect(filterHistory(orders, { ...f, status: 'curso' })).toHaveLength(1);
    expect(filterHistory(orders, { ...f, type: 'delivery' })).toHaveLength(1);
    expect(filterHistory(orders, { ...f, min: '100' })).toHaveLength(2);
    expect(filterHistory(orders, { ...f, max: '70' })).toHaveLength(1);
    expect(filterHistory(orders, { ...f, product: 'otro' })).toHaveLength(0);
    // 19:00 UTC = 13:00 en Guatemala (almuerzo); 15:00 UTC = 09:00
    expect(filterHistory(orders, { ...f, slot: 'almuerzo' })).toHaveLength(4);
    expect(filterHistory(orders, { ...f, slot: 'noche' })).toHaveLength(0);
    expect(filterHistory(orders, { ...f, search: 'cliente uno' })).toHaveLength(4);
    expect(filterHistory(orders, { ...f, search: '5555' })).toHaveLength(4);
    expect(filterHistory(orders, { ...f, search: '555' })).toHaveLength(0);
    expect(activeFilterCount({ ...f, status: 'cancelado', min: '10', search: 'a' })).toBe(3);
  });

  it('ordena y agrupa por día con totales del día completos', () => {
    const sorted = sortHistory(orders, 'recientes');
    expect(sorted[sorted.length - 1]?.total).toBe(140);
    expect(sortHistory(orders, 'mayor')[0]?.total).toBe(200);
    expect(sortHistory(orders, 'menor')[0]?.total).toBe(60);

    const groups = groupByDay(sorted, 2);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ day: TODAY, count: 3, sales: 200, cancelled: 1 });
    expect(groups[0]?.rows).toHaveLength(2);
    const all = groupByDay(sorted, 25);
    expect(all.map((g) => g.day)).toEqual([TODAY, '2026-11-10']);
    expect(all.reduce((n, g) => n + g.rows.length, 0)).toBe(4);
    expect(all.reduce((s, g) => s + g.sales, 0)).toBe(historyTotals(orders).sales);
  });
});

describe('gráficos del resumen', () => {
  const branches = [
    { id: 's1', name: 'Sucursal 1', zoneLabel: 'Zona 4 · Cuatro Grados' },
    { id: 's2', name: 'Sucursal 2', zoneLabel: 'Zona 10 · Oakland' },
  ] as Branch[];
  const summary: ReportSummary = {
    from: '2026-11-10',
    to: '2026-11-11',
    branchId: null,
    unit: 'day',
    clipped: false,
    minDate: '2026-09-13',
    groups: [
      {
        key: '2026-11-10',
        orders: 30,
        sales: 3000,
        byBranch: [
          { branchId: 's1', orders: 20, sales: 2000 },
          { branchId: 's2', orders: 10, sales: 1000 },
        ],
      },
      {
        key: '2026-11-11',
        orders: 15,
        sales: 1500,
        byBranch: [
          { branchId: 's1', orders: 5, sales: 500 },
          { branchId: 's2', orders: 10, sales: 1000 },
        ],
      },
    ],
    byBranch: [
      { branchId: 's1', orders: 25, sales: 2500 },
      { branchId: 's2', orders: 20, sales: 2000 },
    ],
    topProducts: [
      { productId: 'a', name: 'Roll A', quantity: 40 },
      { productId: 'b', name: 'Roll B', quantity: 10 },
    ],
    orders: 45,
    cancelled: 3,
    sales: 4500,
    averageTicket: 107.14,
    deliveryOrders: 9,
  };

  it('arma barras, etiquetas y porcentajes', () => {
    const charts = buildReportCharts(summary, branches, TODAY);
    expect(charts.many).toBe(false);
    expect(charts.orderGroups.map((g) => g.label)).toEqual(['Mar 10', 'Mié 11']);
    expect(charts.orderGroups[0]?.total).toBe('30');
    expect(charts.orderGroups[0]?.bars[0]).toMatchObject({ h: 100, color: 'var(--bo-primary)' });
    expect(charts.orderGroups[0]?.bars[1]).toMatchObject({ h: 50, color: 'var(--bo-secondary)' });
    expect(charts.salesBars.map((s) => s.today)).toEqual([false, true]);
    expect(charts.salesBars[1]).toMatchObject({ h: 50, value: 'Q1.5k' });
    expect(charts.byBranch[0]).toMatchObject({
      name: 'Sucursal 1 · Zona 4',
      pct: 100,
      salesLabel: 'Q2.5k',
    });
    expect(charts.top.map((t) => t.pct)).toEqual([100, 25]);
    expect(charts.legend.map((l) => l.name)).toEqual(['Sucursal 1', 'Sucursal 2']);
  });

  it('con muchas columnas oculta cifras y acorta etiquetas', () => {
    const many = {
      ...summary,
      groups: Array.from({ length: 12 }, (_, i) => ({
        key: `2026-11-${String(i + 1).padStart(2, '0')}`,
        orders: 1,
        sales: 10,
        byBranch: [{ branchId: 's1', orders: 1, sales: 10 }],
      })),
    };
    const charts = buildReportCharts(many, branches, TODAY);
    expect(charts.many).toBe(true);
    expect(charts.orderGroups[0]).toMatchObject({ label: '1', total: '' });
    expect(charts.minWidth).toBe(12 * 34);
    expect(charts.gap).toBe(4);
  });

  it('por hora usa etiquetas "12h" y no marca hoy', () => {
    const hourly = {
      ...summary,
      unit: 'hour' as const,
      groups: [
        { key: '12', orders: 2, sales: 20, byBranch: [{ branchId: 's1', orders: 2, sales: 20 }] },
      ],
    };
    const charts = buildReportCharts(hourly, branches, TODAY);
    expect(charts.orderGroups[0]?.label).toBe('12h');
    expect(charts.salesBars[0]?.today).toBe(false);
  });

  it('calcula los KPIs del resumen', () => {
    expect(summaryKpis(summary)).toMatchObject({ orders: 45, deliveryPct: 20, cancelled: 3 });
    expect(summaryKpis({ ...summary, orders: 0, deliveryOrders: 0 }).deliveryPct).toBe(0);
  });
});
