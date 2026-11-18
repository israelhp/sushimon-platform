import { describe, expect, it } from 'vitest';
import type { Delivery, DraftOrder } from '@/lib/data-access/models';
import { DEMO_BASE_TIME } from '@/mocks/clock';
import { createSeedStore } from '@/mocks/seed';
import {
  DEFAULT_DELIVERY_FILTERS,
  activeFilterCount,
  clampPeriod,
  deliveryStats,
  filterBase,
  filterRows,
  quickRange,
  ridersOfPeriod,
  sortRows,
  toDeliveryRow,
  toDeliveryRows,
  zoneOptions,
  type DeliveryFilters,
} from './deliveries-view';

const NOW = new Date(DEMO_BASE_TIME);
const TODAY = '2026-11-11';
const seed = createSeedStore('default').orders;
const base = seed.find((o) => o.id === 'MON-307051') as DraftOrder; // listo, a domicilio, sin logística

/** Pedido a domicilio de prueba (envío cobrado Q20) creado a las 12:00 (hora de Guatemala). */
function order(
  id: string,
  patch: Partial<DraftOrder> = {},
  delivery: Partial<Delivery> | null = null,
) {
  const fullDelivery: Delivery | null = delivery && {
    provider: 'pedidosya',
    status: 'delivered',
    riderId: null,
    riderName: 'Kevin R. · moto',
    reference: `PY-GT-${id}`,
    cost: 25,
    requestedAt: '2026-11-11T18:05:00.000Z',
    etaAt: '2026-11-11T18:40:00.000Z',
    deliveredAt: '2026-11-11T18:42:00.000Z',
    simulated: true,
    ...delivery,
  };
  return {
    ...base,
    id,
    createdAt: '2026-11-11T18:00:00.000Z',
    deliveryFee: 20,
    status: 'delivered',
    delivery: fullDelivery,
    ...patch,
  } as DraftOrder;
}

const FILTERS = (patch: Partial<DeliveryFilters> = {}): DeliveryFilters => ({
  ...DEFAULT_DELIVERY_FILTERS,
  ...patch,
});

describe('periodo', () => {
  it('atajos del prototipo', () => {
    expect(quickRange('hoy', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(quickRange('ayer', TODAY)).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(quickRange('7d', TODAY)).toEqual({ from: '2026-11-05', to: TODAY });
    expect(quickRange('30d', TODAY)).toEqual({ from: '2026-10-13', to: TODAY });
    expect(quickRange('mes', TODAY)).toEqual({ from: '2026-11-01', to: TODAY });
  });

  it('recorta al historial de 60 días, invierte rangos y avisa del ajuste', () => {
    const ok = clampPeriod('2026-11-05', TODAY, TODAY);
    expect(ok).toMatchObject({ from: '2026-11-05', to: TODAY, days: 7, clipped: false });

    const old = clampPeriod('2025-01-01', TODAY, TODAY);
    expect(old.from).toBe('2026-09-13');
    expect(old.days).toBe(60);
    expect(old.clipped).toBe(true);

    expect(clampPeriod(TODAY, '2026-11-09', TODAY)).toMatchObject({
      from: '2026-11-09',
      to: TODAY,
    });
    expect(clampPeriod(TODAY, '2026-11-20', TODAY)).toMatchObject({ to: TODAY, clipped: true });
  });
});

describe('filas de entregas', () => {
  it('solo incluye pedidos a domicilio', () => {
    const rows = toDeliveryRows(seed, TODAY, NOW);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.order.fulfillment === 'delivery')).toBe(true);
  });

  it('calcula tiempo, costo y diferencia de un envío entregado con PedidosYa', () => {
    const row = toDeliveryRow(order('A1', {}, {}), TODAY, NOW);
    expect(row).toMatchObject({
      stKey: 'entregado',
      provider: 'pedidosya',
      duration: 42,
      cost: 25,
      diff: 5,
      riderName: 'Kevin R.',
      live: false,
    });
  });

  it('el repartidor propio no tiene costo ni diferencia', () => {
    const row = toDeliveryRow(
      order(
        'A2',
        {},
        { provider: 'own', cost: null, riderName: 'Luis Coc · moto', reference: null },
      ),
      TODAY,
      NOW,
    );
    expect(row.provider).toBe('own');
    expect(row.cost).toBeNull();
    expect(row.diff).toBeNull();
    expect(row.riderName).toBe('Luis Coc');
  });

  it('clasifica el estado: sin repartidor, en proceso, entregado y cancelado', () => {
    const none = toDeliveryRow(order('B1', { status: 'ready' }), TODAY, NOW);
    expect(none).toMatchObject({ stKey: 'sin', live: true, logistics: 'none', riderName: null });
    const failed = toDeliveryRow(
      order('B2', { status: 'ready' }, { status: 'failed', riderName: null, deliveredAt: null }),
      TODAY,
      NOW,
    );
    expect(failed).toMatchObject({ stKey: 'sin', logistics: 'fallido' });
    const going = toDeliveryRow(
      order('B3', { status: 'on_the_way' }, { status: 'on_the_way', deliveredAt: null }),
      TODAY,
      NOW,
    );
    expect(going).toMatchObject({ stKey: 'proceso', duration: null, live: true });
    expect(toDeliveryRow(order('B4', { status: 'cancelled' }), TODAY, NOW).stKey).toBe('cancelado');
  });
});

describe('filtros, orden e indicadores', () => {
  const rows = toDeliveryRows(
    [
      order('C1', {}, {}), // PY, entregado 42 min, +5
      order('C2', { deliveryFee: 25 }, { cost: 25, deliveredAt: '2026-11-11T18:30:00.000Z' }), // PY 30 min, sin dif
      order(
        'C3',
        {},
        {
          provider: 'own',
          cost: null,
          riderName: 'Luis Coc · moto',
          deliveredAt: '2026-11-11T19:00:00.000Z',
        },
      ), // propio 60 min
      order('C4', { status: 'ready' }), // sin repartidor
      order('C5', { status: 'cancelled' }),
    ],
    TODAY,
    NOW,
  );

  it('totales: costo PedidosYa vs cobrado y diferencia', () => {
    const stats = deliveryStats(rows);
    expect(stats).toMatchObject({
      total: 5,
      own: 1,
      pedidosya: 2,
      delivered: 3,
      withoutRider: 1,
      inProgress: 0,
      cost: 50,
      charged: 45,
      difference: 5,
      withDifference: 1,
    });
    // (42 + 30 + 60) / 3
    expect(stats.avgMinutes).toBe(44);
  });

  it('filtra por proveedor, estado, tiempo y costo', () => {
    expect(filterRows(rows, FILTERS({ provider: 'own' })).map((r) => r.id)).toEqual(['C3']);
    expect(filterRows(rows, FILTERS({ state: 'sin' })).map((r) => r.id)).toEqual(['C4']);
    expect(filterRows(rows, FILTERS({ time: 'rapido' })).map((r) => r.id)).toEqual(['C2']);
    expect(filterRows(rows, FILTERS({ time: 'normal' })).map((r) => r.id)).toEqual(['C1']);
    expect(filterRows(rows, FILTERS({ time: 'lento' })).map((r) => r.id)).toEqual(['C3']);
    expect(filterRows(rows, FILTERS({ cost: 'dif' })).map((r) => r.id)).toEqual(['C1']);
    expect(filterRows(rows, FILTERS({ cost: 'igual' })).map((r) => r.id)).toEqual(['C2']);
  });

  it('busca por pedido, cliente, dirección o referencia PedidosYa', () => {
    expect(filterRows(rows, FILTERS({ query: 'py-gt-c2' })).map((r) => r.id)).toEqual(['C2']);
    expect(filterRows(rows, FILTERS({ query: 'MON-307051' }))).toHaveLength(0);
    expect(filterRows(rows, FILTERS({ query: base.customer.name.slice(0, 5) }))).toHaveLength(5);
  });

  it('el filtro de repartidor no afecta a "repartidores del periodo"', () => {
    const f = FILTERS({ rider: 'Luis Coc' });
    expect(filterRows(rows, f).map((r) => r.id)).toEqual(['C3']);
    expect(filterBase(rows, f)).toHaveLength(5);
    const riders = ridersOfPeriod(filterBase(rows, f));
    expect(riders.map((r) => [r.name, r.count, r.avgMinutes, r.width])).toEqual([
      ['Kevin R.', 2, 36, 100],
      ['Luis Coc', 1, 60, 50],
    ]);
  });

  it('ordena por recientes, antiguos, tiempo y diferencia', () => {
    const dated = toDeliveryRows(
      [
        order(
          'D1',
          { createdAt: '2026-11-11T17:00:00.000Z' },
          { deliveredAt: '2026-11-11T17:20:00.000Z' },
        ),
        order(
          'D2',
          { createdAt: '2026-11-11T19:00:00.000Z' },
          { deliveredAt: '2026-11-11T20:10:00.000Z', cost: 30 },
        ),
      ],
      TODAY,
      NOW,
    );
    expect(sortRows(dated, 'recientes').map((r) => r.id)).toEqual(['D2', 'D1']);
    expect(sortRows(dated, 'antiguos').map((r) => r.id)).toEqual(['D1', 'D2']);
    expect(sortRows(dated, 'tiempo').map((r) => r.id)).toEqual(['D2', 'D1']);
    expect(sortRows(dated, 'diferencia').map((r) => r.id)).toEqual(['D2', 'D1']);
  });

  it('cuenta filtros activos (el orden no cuenta) y agrupa zonas', () => {
    expect(activeFilterCount(DEFAULT_DELIVERY_FILTERS)).toBe(0);
    expect(activeFilterCount(FILTERS({ query: ' x ', provider: 'own', sort: 'tiempo' }))).toBe(2);
    expect(zoneOptions(rows)).toHaveLength(1);
    expect(zoneOptions(rows)[0]?.count).toBe(5);
  });
});
