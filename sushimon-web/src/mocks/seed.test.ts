import { describe, expect, it } from 'vitest';
import { DEMO_BASE_TIME, createFixedClock } from './clock';
import { generateDayOrders, historyMinDate, clampRange } from './factories/history';
import { hashSeed, mulberry32, rngFor } from './factories/random';
import { BRANCH_SEEDS } from './fixtures/branches';
import { PRODUCT_SEEDS } from './fixtures/products';
import { createSeedStore } from './seed';
import { localDate, localTime } from '@/lib/time';

describe('PRNG y reloj', () => {
  it('mulberry32 es determinista por semilla', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, mulberry32(43))).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(hashSeed('x')).toBe(hashSeed('x'));
    expect(rngFor('k')()).toBe(rngFor('k')());
  });

  it('la fecha base es miércoles 11/11/2026 14:25 en Guatemala, sin importar la TZ local', () => {
    const clock = createFixedClock();
    expect(clock.now().toISOString()).toBe(DEMO_BASE_TIME);
    expect(localDate(clock.now())).toBe('2026-11-11');
    expect(localTime(clock.now())).toBe('14:25');
    clock.advance(60_000);
    expect(localTime(clock.now())).toBe('14:26');
  });
});

describe('createSeedStore', () => {
  it('es determinista', () => {
    expect(createSeedStore('default')).toEqual(createSeedStore('default'));
  });

  it('siembra el modelo conciliado', () => {
    const s = createSeedStore();
    // 29 del menú + 2 de demostración de visibilidad (uno inactivo, otro bajo categoría oculta).
    expect(s.products).toHaveLength(31);
    expect(PRODUCT_SEEDS).toHaveLength(29);
    expect(s.categories.map((c) => c.id)).toEqual([
      'entradas',
      'monchis',
      'rolls',
      'espirituosas',
      'relax',
      'postres',
      'happy',
    ]);
    expect(s.branches.filter((b) => b.status === 'active').map((b) => b.id)).toEqual([
      'sucursal-1',
      'sucursal-2',
      'sucursal-3',
    ]);
    expect(s.branches).toHaveLength(5);
    expect(s.promotions).toHaveLength(3);
    expect(s.promotions[0]?.items).toHaveLength(8);
    expect(s.staff).toHaveLength(11);
    expect(s.roles.map((r) => r.code)).toEqual(['admin', 'manager', 'kitchen', 'staff']);
    expect(s.riders).toHaveLength(6);
    // 15 pedidos del backoffice + 3 de la tienda
    expect(s.orders).toHaveLength(18);
    expect(s.orders.map((o) => o.id)).toContain('MON-490217');
  });

  it('los totales de los pedidos sembrados cuadran y usan el catálogo canónico', () => {
    const s = createSeedStore();
    const ids = new Set(PRODUCT_SEEDS.map((p) => p.id));
    for (const o of s.orders) {
      const sub = o.lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
      expect(o.subtotal).toBeCloseTo(sub, 2);
      expect(o.total).toBeCloseTo(o.subtotal + o.deliveryFee, 2);
      expect(o.payment.amount).toBe(o.total);
      // F09: sin niveles; el envío es el `baseFee` de la zona propia sembrada (instantánea del pedido).
      if (o.fulfillment === 'delivery') expect(o.deliveryFee).toBeGreaterThan(0);
      else expect(o.deliveryFee).toBe(0);
      if (o.id !== 'MON-479850') for (const l of o.lines) expect(ids.has(l.productId)).toBe(true);
    }
    const demo = s.orders.find((o) => o.id === 'MON-490217');
    // 67 + 62 + 2×22 = 173; zona 10 desde sucursal-1 = Q15.00 (baseFee de la zona)
    expect(demo?.subtotal).toBe(173);
    expect(demo?.deliveryFee).toBe(15);
    expect(demo?.total).toBe(188);
    expect(demo?.payment).toMatchObject({ method: 'card', status: 'approved', cardLast4: '4242' });
  });

  it('nunca guarda datos sensibles de tarjeta', () => {
    const json = JSON.stringify(createSeedStore());
    expect(json).not.toMatch(/4242424242424242|cvv|"pin"/i);
  });

  it('aplica los escenarios de dominio en la siembra', () => {
    const empty = createSeedStore('empty');
    expect(empty.products).toHaveLength(0);
    expect(empty.orders).toHaveLength(0);
    expect(empty.promotions).toHaveLength(0);
    expect(empty.historyEnabled).toBe(false);

    const closed = createSeedStore('branch-closed');
    // F08: `branch-closed` = cierre extraordinario en curso en cada sucursal activa (no un booleano).
    const activeIds = closed.branches.filter((b) => b.active).map((b) => b.id);
    expect(activeIds.length).toBeGreaterThan(0);
    for (const id of activeIds) {
      expect(
        closed.closures.some(
          (c) => c.branchId === id && c.startsAt <= DEMO_BASE_TIME && DEMO_BASE_TIME < c.endsAt,
        ),
      ).toBe(true);
    }

    const expired = createSeedStore('promotion-expired');
    expect(expired.promotions.every((p) => p.validTo < '2026-11-11')).toBe(true);

    const unavailable = createSeedStore('product-unavailable');
    const cal = unavailable.products.find((p) => p.id === 'calientito-roll');
    expect(cal?.availability.every((a) => !a.available)).toBe(true);

    const pending = createSeedStore('order-pending');
    expect(pending.orders.find((o) => o.id === 'MON-490217')?.payment.status).toBe('review');
  });
});

describe('historial generado', () => {
  const today = '2026-11-11';

  it('es determinista y cubre 60 días', () => {
    const a = generateDayOrders('2026-11-05', today);
    expect(generateDayOrders('2026-11-05', today)).toEqual(a);
    expect(a.length).toBeGreaterThan(60);
    expect(historyMinDate(today)).toBe('2026-09-13');
    expect(generateDayOrders('2026-09-12', today)).toEqual([]);
    expect(generateDayOrders('2026-11-12', today)).toEqual([]);
  });

  it('hoy solo trae los pedidos previos (82: 80 entregados + 2 rechazados) antes de las 13:10', () => {
    const list = generateDayOrders(today, today);
    expect(list).toHaveLength(82);
    expect(list.filter((o) => o.status === 'rejected')).toHaveLength(2);
    expect(list.every((o) => localTime(new Date(o.createdAt)) < '13:10')).toBe(true);
    expect(list.at(-1)?.id).toBe('MON-307043');
  });

  it('los pedidos generados son coherentes (totales, cobertura, ids únicos)', () => {
    const seen = new Set<string>();
    for (const d of clampRange('2026-10-01', today, today).days) {
      for (const o of generateDayOrders(d, today)) {
        expect(seen.has(o.id)).toBe(false);
        seen.add(o.id);
        expect(o.total).toBeCloseTo(o.subtotal + o.deliveryFee, 2);
        if (o.fulfillment === 'delivery') {
          expect(o.deliveryFee).toBeGreaterThan(0);
          expect(BRANCH_SEEDS.some((b) => b.id === o.branchId)).toBe(true);
        }
      }
    }
  });

  it('clampRange recorta e invierte rangos', () => {
    const r = clampRange('2026-11-20', '2026-01-01', today);
    expect(r.clipped).toBe(true);
    expect(r.from).toBe('2026-09-13');
    expect(r.to).toBe(today);
    expect(r.days).toHaveLength(60);
  });
});
