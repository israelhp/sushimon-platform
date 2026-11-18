import { describe, expect, it } from 'vitest';
import type { DraftOrder, Product } from '@/lib/data-access/models';
import { createSeedStore } from '@/mocks/seed';
import { planReorder } from './account/reorder';
import { priceToNumber } from '@/lib/product-rules';
import { DEFAULT_ORDER_MODE, normalizeSchedule, parseOrderMode } from './order-mode/order-mode';

describe('modo de pedido', () => {
  it('lee preferencias válidas y descarta basura', () => {
    expect(parseOrderMode(null)).toEqual(DEFAULT_ORDER_MODE);
    expect(parseOrderMode('{"type":"x"}')).toEqual(DEFAULT_ORDER_MODE);
    expect(
      parseOrderMode(
        '{"type":"delivery","when":{"kind":"scheduled","date":"2026-11-12","time":"13:00"},"branchId":"sucursal-1","address":{"department":"Guatemala","municipality":"Guatemala","zone":"10"}}',
      ),
    ).toEqual({
      type: 'delivery',
      when: { kind: 'scheduled', date: '2026-11-12', time: '13:00' },
      branchId: 'sucursal-1',
      address: {
        department: 'Guatemala',
        municipality: 'Guatemala',
        zone: '10',
        line: '',
        references: '',
      },
    });
  });

  it('vuelve a "ahora" si el horario programado ya no es válido', () => {
    const mode = {
      ...DEFAULT_ORDER_MODE,
      type: 'pickup' as const,
      when: { kind: 'scheduled' as const, date: '2026-11-01', time: '13:00' },
    };
    expect(normalizeSchedule(mode, () => false).when).toEqual({ kind: 'now' });
    expect(normalizeSchedule(mode, () => true)).toBe(mode);
  });
});

describe('repetir pedido', () => {
  const store = createSeedStore();
  const products: Product[] = store.products.map((p) => ({
    ...p,
    description: p.description ?? '',
    price: priceToNumber(p.basePrice),
    available: true,
    availability: [],
  }));
  const old = store.orders.find((o) => o.id === 'MON-479850') as DraftOrder;

  it('informa productos que no se agregarán y cambios de precio', () => {
    const plan = planReorder(old, products);
    expect(plan.lines.map((l) => l.productId)).toEqual([
      'la-suegra-roll',
      'loco-ribs',
      'helados-asiaticos',
    ]);
    expect(plan.skippedCount).toBe(1);
    expect(plan.skipped[0]?.name).toBe('Roll de Temporada');
    expect(plan.priceChanges).toEqual([
      { productId: 'loco-ribs', name: 'Loco Ribs', before: 42, now: 46 },
    ]);
  });

  it('no agrega productos no disponibles', () => {
    const unavailable = products.map((p) =>
      p.id === 'loco-ribs' ? { ...p, available: false } : p,
    );
    expect(planReorder(old, unavailable).skippedCount).toBe(2);
  });
});
