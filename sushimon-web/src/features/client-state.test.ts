import { describe, expect, it } from 'vitest';
import type { Order, Product } from '@/lib/data-access/models';
import { createSeedStore } from '@/mocks/seed';
import { mergeIntoCart, planReorder } from './account/reorder';
import {
  addLine,
  changeQuantity,
  estimateSubtotal,
  itemCount,
  parseCart,
  quantityOf,
  removeOne,
  setNote,
} from './cart/cart';
import { priceToNumber } from '@/lib/product-rules';
import { DEFAULT_ORDER_MODE, normalizeSchedule, parseOrderMode } from './order-mode/order-mode';

describe('carrito', () => {
  it('suma la misma combinación producto+nota y limita a 99', () => {
    let lines = addLine([], 'california-roll', 2, ' Sin pepino ');
    lines = addLine(lines, 'california-roll', 1, 'Sin pepino');
    lines = addLine(lines, 'california-roll', 1);
    expect(lines).toEqual([
      { productId: 'california-roll', quantity: 3, note: 'Sin pepino' },
      { productId: 'california-roll', quantity: 1, note: '' },
    ]);
    expect(quantityOf(lines, 'california-roll')).toBe(4);
    expect(itemCount(addLine(lines, 'california-roll', 500, 'Sin pepino'))).toBe(100);
    expect(addLine([], 'x', 0)).toEqual([]);
  });

  it('incrementa, decrementa, elimina en 0 y quita una unidad', () => {
    let lines = addLine(addLine([], 'a', 1), 'b', 2);
    lines = changeQuantity(lines, 0, -1);
    expect(lines).toEqual([{ productId: 'b', quantity: 2, note: '' }]);
    lines = removeOne(lines, 'b');
    expect(lines[0]?.quantity).toBe(1);
    expect(setNote(lines, 0, 'x'.repeat(200))[0]?.note).toHaveLength(140);
    expect(estimateSubtotal(addLine(lines, 'c', 2), { b: 57, c: 22.5 })).toBe(102);
  });

  it('sanea lo guardado', () => {
    expect(parseCart('no-json')).toEqual([]);
    expect(parseCart('{"a":1}')).toEqual([]);
    expect(
      parseCart('[{"productId":"a","quantity":"3"},{"quantity":2},{"productId":"b","quantity":0}]'),
    ).toEqual([{ productId: 'a', quantity: 3, note: '' }]);
  });
});

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
  }));
  const old = store.orders.find((o) => o.id === 'MON-479850') as Order;

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

  it('no agrega productos no disponibles y fusiona en modo agregar', () => {
    const unavailable = products.map((p) =>
      p.id === 'loco-ribs' ? { ...p, available: false } : p,
    );
    expect(planReorder(old, unavailable).skippedCount).toBe(2);
    const merged = mergeIntoCart(
      [{ productId: 'la-suegra-roll', quantity: 1, note: 'Salsa aparte' }],
      planReorder(old, products).lines,
    );
    expect(merged[0]).toEqual({ productId: 'la-suegra-roll', quantity: 2, note: 'Salsa aparte' });
  });
});
