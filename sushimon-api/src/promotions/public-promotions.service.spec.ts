import { Logger } from '@nestjs/common';
import {
  A,
  B,
  HIDDEN,
  INACTIVE,
  local,
  NOW,
  P1,
  P2,
  P3,
  promotionsHarness,
} from '../../test/support/promotions-harness.js';
import { promotionsCacheControl } from './promotions-cache.js';

const code = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code;
const happy = (over = {}) => ({
  name: 'Happy Hour',
  schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
  productIds: [P1, P2],
  value: '20.00',
  ...over,
});

describe('PublicPromotionsService', () => {
  it('Happy Hour vigente: isHappyHour derivado, items indicativos con precio de sucursal y fechas ISO', async () => {
    const h = promotionsHarness();
    h.world.seedRow(A, P1, { priceOverride: '70.00' });
    const p = h.repo.seed(happy());
    const out = await h.store.list(A, 'live');
    expect(out.branchId).toBe(A);
    expect(out.generatedAt).toBe(NOW.toISOString());
    expect(out.items).toHaveLength(1);
    const item = out.items[0]!;
    expect(item).toMatchObject({
      id: p.id,
      isHappyHour: true,
      requiresCode: false,
      dineInOnly: false,
      state: 'live',
      kind: 'PERCENT',
      value: '20.00',
      productScope: 'SELECTED',
      productIds: [P1, P2],
      nextEndsAt: local('2026-11-16T18:00:00').toISOString(),
      nextStartsAt: local('2026-11-23T15:00:00').toISOString(),
    });
    // precio de SUCURSAL (70.00), no el base (85.00); 20% => 56.00; Edamame 30.00 => 24.00
    expect(item.items).toEqual([
      { productId: P2, regularPrice: '30.00', promoPrice: '24.00' },
      { productId: P1, regularPrice: '70.00', promoPrice: '56.00' },
    ]);
    expect(out.nextChangeAt).toBe(local('2026-11-16T18:00:00').toISOString());
  });

  it('el precio indicativo coincide con el evaluador (misma función)', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed(happy({ kind: 'FIXED_AMOUNT', value: '10.00' }));
    const out = await h.store.list(A, 'live');
    const evaluated = h.evaluator.evaluate({
      at: NOW,
      branchId: A,
      mode: 'pickup',
      lines: [{ productId: P1, unitPrice: '85.00', quantity: 1 }],
      promotions: (await h.candidates.load(A, NOW)).promotions,
    });
    const indicative = out.items[0]?.items?.find((i) => i.productId === P1);
    expect(indicative?.promoPrice).toBe(evaluated.lines[0]?.finalPrice);
    expect(evaluated.lines[0]?.promotionId).toBe(p.id);
  });

  it('cupón: requiresCode=true, sin code, kind, value, productIds ni items', async () => {
    const h = promotionsHarness();
    h.repo.seed({ code: 'SECRETO10', value: '50.00', productIds: [P1] });
    const out = await h.store.list(A, 'live');
    const c = out.items[0]!;
    expect(c.requiresCode).toBe(true);
    expect(c).not.toHaveProperty('kind');
    expect(c).not.toHaveProperty('value');
    expect(c).not.toHaveProperty('productIds');
    expect(c).not.toHaveProperty('items');
    expect(c.isHappyHour).toBe(false);
    const raw = JSON.stringify(out);
    expect(raw).not.toContain('SECRETO10');
    expect(raw).not.toContain('50.00');
    expect(raw).not.toContain('"code"');
  });

  it('cupón con horario semanal tampoco es Happy Hour (solo automáticas)', async () => {
    const h = promotionsHarness();
    h.repo.seed({
      code: 'HORARIO',
      schedule: [{ weekday: 1, startsAt: '00:00', endsAt: '24:00' }],
    });
    expect((await h.store.list(A, 'live')).items[0]?.isHappyHour).toBe(false);
  });

  it('fuera del tramo: no está en live y sí en upcoming con nextStartsAt', async () => {
    const h = promotionsHarness();
    h.clock.current = local('2026-11-16T10:00:00');
    const p = h.repo.seed(happy());
    expect((await h.store.list(A, 'live')).items).toEqual([]);
    const up = await h.store.list(A, 'upcoming');
    expect(up.items.map((i) => i.id)).toEqual([p.id]);
    expect(up.items[0]).toMatchObject({
      state: 'upcoming',
      nextStartsAt: local('2026-11-16T15:00:00').toISOString(),
      nextEndsAt: null,
    });
    expect(up.nextChangeAt).toBe(local('2026-11-16T15:00:00').toISOString());
  });

  it('límites exactos: 15:00:00 live; 18:00:00 ya no', async () => {
    const h = promotionsHarness();
    h.repo.seed(happy());
    h.clock.current = local('2026-11-16T15:00:00');
    expect((await h.store.list(A, 'live')).items).toHaveLength(1);
    h.clock.current = local('2026-11-16T17:59:59');
    expect((await h.store.list(A, 'live')).items).toHaveLength(1);
    h.clock.current = local('2026-11-16T18:00:00');
    expect((await h.store.list(A, 'live')).items).toHaveLength(0);
  });

  it('desactivada, vencida o más allá de 14 días: nunca aparece', async () => {
    const h = promotionsHarness();
    h.repo.seed({ active: false });
    h.repo.seed({ endsAt: NOW });
    h.repo.seed({ startsAt: local('2026-12-10T00:00:00'), endsAt: local('2026-12-20T00:00:00') });
    expect((await h.store.list(A, 'live')).items).toEqual([]);
    expect((await h.store.list(A, 'upcoming')).items).toEqual([]);
  });

  it('solo promociones que aplican a la sucursal (propias y «todas»)', async () => {
    const h = promotionsHarness();
    const all = h.repo.seed({ name: 'Todas' });
    h.repo.seed({ name: 'Solo B', branchIds: [B] });
    const own = h.repo.seed({ name: 'Solo A', branchIds: [A] });
    expect((await h.store.list(A, 'live')).items.map((i) => i.id).sort()).toEqual(
      [all.id, own.id].sort(),
    );
  });

  it('dineInOnly se informa tal cual', async () => {
    const h = promotionsHarness();
    h.repo.seed({ dineInOnly: true });
    expect((await h.store.list(A, 'live')).items[0]?.dineInOnly).toBe(true);
  });

  it('items: solo productos visibles y disponibles; sin ahorro no se listan', async () => {
    const h = promotionsHarness();
    h.world.seedRow(A, P2, { available: false });
    h.repo.seed(happy({ productIds: [P1, P2, P3, HIDDEN] }));
    const items = (await h.store.list(A, 'live')).items[0]?.items ?? [];
    expect(items.map((i) => i.productId)).toEqual([P3, P1]); // Cerveza, Roll; Edamame agotado; Oculto invisible
    const tiny = promotionsHarness();
    tiny.world.seedRow(A, P3, { priceOverride: '0.04' });
    tiny.repo.seed(happy({ productIds: [P3], value: '5.00' }));
    expect((await tiny.store.list(A, 'live')).items[0]?.items).toEqual([]);
  });

  it('promoción con todos los productos: productScope ALL y sin items', async () => {
    const h = promotionsHarness();
    h.repo.seed({});
    const out = await h.store.list(A, 'live');
    expect(out.items[0]).toMatchObject({ productScope: 'ALL' });
    expect(out.items[0]).not.toHaveProperty('items');
    expect(out.items[0]).not.toHaveProperty('productIds');
  });

  it('sucursal inexistente o inactiva => 404 BRANCH_NOT_FOUND idéntico', async () => {
    const h = promotionsHarness();
    const run = (id: string) => h.store.list(id, 'live').catch((e: unknown) => e);
    const inactive = await run(INACTIVE);
    const missing = await run('00000000-0000-4000-8000-0000000000ff');
    expect(code(inactive)).toBe('BRANCH_NOT_FOUND');
    expect((inactive as { getStatus: () => number }).getStatus()).toBe(404);
    expect(JSON.stringify((inactive as { getResponse: () => unknown }).getResponse())).toBe(
      JSON.stringify((missing as { getResponse: () => unknown }).getResponse()),
    );
  });

  it('T17: nextChangeAt = el menor entre varias promociones; caché acotada', async () => {
    const h = promotionsHarness();
    h.repo.seed({ endsAt: new Date(NOW.getTime() + 20_000) });
    h.repo.seed({ endsAt: new Date(NOW.getTime() + 8_500) });
    const out = await h.store.list(A, 'live');
    expect(out.nextChangeAt).toBe(new Date(NOW.getTime() + 8_500).toISOString());
    expect(promotionsCacheControl(out)).toBe('public, max-age=5, s-maxage=8');
  });

  it('sin cambios próximos: nextChangeAt null y caché de 30 s', async () => {
    const h = promotionsHarness();
    h.repo.seed({});
    const out = await h.store.list(A, 'live');
    expect(out.nextChangeAt).toBeNull();
    expect(promotionsCacheControl(out)).toBe('public, max-age=5, s-maxage=30');
  });

  it('una promoción futura también acota nextChangeAt (el conjunto vigente cambiará)', async () => {
    const h = promotionsHarness();
    h.repo.seed({ name: 'Ahora' });
    h.repo.seed({
      name: 'En 2 min',
      startsAt: new Date(NOW.getTime() + 120_000),
      endsAt: local('2026-12-01T00:00:00'),
    });
    const out = await h.store.list(A, 'live');
    expect(out.nextChangeAt).toBe(new Date(NOW.getTime() + 120_000).toISOString());
  });

  it('máximo 100 promociones: truncated=true y orden por inicio, id', async () => {
    const h = promotionsHarness();
    for (let i = 0; i < 105; i += 1) h.repo.seed({ name: `P${i}` });
    const out = await h.store.list(A, 'live');
    expect(out.items).toHaveLength(100);
    expect(out.truncated).toBe(true);
    const starts = out.items.map((i) => i.validFrom + i.id);
    expect([...starts].sort()).toEqual(starts);
  });

  it('sin N+1: una consulta de candidatas, una de productos y una de F13 por tanda', async () => {
    const h = promotionsHarness();
    for (let i = 0; i < 10; i += 1) h.repo.seed(happy({ name: `HH ${i}` }));
    await h.store.list(A, 'live');
    expect(h.repo.count('findCandidates')).toBe(1);
    expect(h.repo.count('findProductBasics')).toBe(1);
    expect(h.world.count('resolveMany')).toBe(1);
  });
});

describe('PublicPromotionsService: rendimiento y alcance de lectura', () => {
  it('cupón con productos: productScope SELECTED sin leer ni publicar sus ids (omitCouponProducts)', async () => {
    const h = promotionsHarness();
    h.repo.seed({ code: 'CUP12345', productIds: [P1] });
    const out = await h.store.list(A, 'live');
    expect(out.items[0]).toMatchObject({ requiresCode: true, productScope: 'SELECTED' });
    expect(out.items[0]).not.toHaveProperty('productIds');
    expect(h.repo.count('findProductBasics')).toBe(0);
  });

  it('solo se piden los primeros 50 productos de cada promoción y en lotes de <= 1000', async () => {
    const h = promotionsHarness();
    const spy = vi.spyOn(h.repo, 'findProductBasics');
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n + 500000).padStart(12, '0')}`;
    for (let i = 0; i < 30; i += 1) {
      h.repo.seed({ productIds: Array.from({ length: 200 }, (_, k) => uuid(i * 1000 + k)) });
    }
    await h.store.list(A, 'live');
    const sizes = spy.mock.calls.map((c) => c[0].length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(30 * 50);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1000);
    expect(sizes.length).toBe(2);
  });
});

describe('PromotionCandidatesService', () => {
  it('devuelve automáticas y solo el cupón enviado (normalizado); en 1 consulta', async () => {
    const h = promotionsHarness();
    const auto = h.repo.seed({ name: 'Auto' });
    const cup = h.repo.seed({ code: 'VERANO10' });
    h.repo.seed({ code: 'OTRO' });
    h.repo.seed({ active: false });
    h.repo.seed({ endsAt: NOW });
    h.repo.seed({ branchIds: [B] });
    const without = (await h.candidates.load(A, NOW)).promotions;
    expect(without.map((p) => p.id)).toEqual([auto.id]);
    const withCode = (await h.candidates.load(A, NOW, '  verano10 ')).promotions;
    expect(withCode.map((p) => p.id).sort()).toEqual([auto.id, cup.id].sort());
    expect(h.repo.count('findCandidates')).toBe(2);
    expect(withCode[0]).toMatchObject({ branchIds: 'ALL', productIds: 'ALL' });
  });

  it('mapea alcance explícito y deja el horario al evaluador', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed({
      branchIds: [A],
      productIds: [P1],
      schedule: [{ weekday: 2, startsAt: '10:00', endsAt: '11:00' }],
    });
    const [c] = (await h.candidates.load(A, NOW)).promotions;
    expect(c).toMatchObject({ id: p.id, branchIds: [A], productIds: [P1] });
    expect(c?.schedule).toHaveLength(1); // aunque hoy sea lunes: lo decide el evaluador
  });

  it('tope 200: pide 201, expone truncated y registra un warning sin códigos ni PII', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const h = promotionsHarness();
    for (let i = 0; i < 201; i += 1) h.repo.seed({ name: `P${i}` });
    h.repo.seed({ code: 'CUPONSECRETO' });
    const out = await h.candidates.load(A, NOW, 'cuponsecreto');
    expect(out.truncated).toBe(true);
    expect(out.promotions).toHaveLength(200);
    // el cupón pedido va primero: un recorte jamás lo descarta
    expect(out.promotions.some((p) => p.code === 'CUPONSECRETO')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('CUPONSECRETO');
    const small = promotionsHarness();
    small.repo.seed({});
    expect((await small.candidates.load(A, NOW)).truncated).toBe(false);
  });

  it('entradas inválidas => lista vacía (nunca llega a la BD)', async () => {
    const h = promotionsHarness();
    expect((await h.candidates.load('no-uuid', NOW)).promotions).toEqual([]);
    expect((await h.candidates.load(A, new Date('x'))).promotions).toEqual([]);
    expect(h.repo.count('findCandidates')).toBe(0);
  });

  it('flujo completo F19: cargador + evaluador; cupón desconocido == cupón vencido', async () => {
    const h = promotionsHarness();
    h.repo.seed({ code: 'VIEJO', endsAt: new Date(NOW.getTime() - 1000) });
    h.repo.seed({ code: 'BUENO', value: '25.00' });
    const evalWith = async (coupon: string) =>
      h.evaluator.evaluate({
        at: NOW,
        branchId: A,
        mode: 'delivery',
        lines: [{ productId: P1, unitPrice: '85.00', quantity: 1 }],
        couponCode: coupon,
        promotions: (await h.candidates.load(A, NOW, coupon)).promotions,
      });
    expect((await evalWith('VIEJO')).coupon).toEqual((await evalWith('NOEXISTE')).coupon);
    const ok = await evalWith('bueno');
    expect(ok.coupon).toEqual({ status: 'APPLIED' });
    expect(ok.lines[0]).toMatchObject({ discountAmount: '21.25', finalPrice: '63.75' });
  });
});

describe('PublicPromotionsService (F17, aditivo)', () => {
  it('compact: sin items ni productIds, con límite y sin leer productos; nextChangeAt usa todas las candidatas', async () => {
    const h = promotionsHarness();
    h.repo.seed(happy({ name: 'Una' }));
    h.repo.seed({ name: 'Dos', endsAt: local('2026-11-16T16:30:00') });
    h.repo.seed({ name: 'Tres' });
    h.repo.calls.length = 0;
    const out = await h.store.list(A, 'live', { compact: true, limit: 2, branchValidated: true });
    expect(out.items).toHaveLength(2);
    expect(out.truncated).toBe(true);
    for (const item of out.items) {
      expect(item).not.toHaveProperty('items');
      expect(item).not.toHaveProperty('productIds');
    }
    expect(h.repo.count('findBranchStatus')).toBe(0);
    expect(h.repo.count('findProductBasics')).toBe(0);
    expect(out.nextChangeAt).toBe(local('2026-11-16T16:30:00').toISOString());
  });

  it('sin opciones el comportamiento de F15 no cambia (valida sucursal y devuelve items)', async () => {
    const h = promotionsHarness();
    h.repo.seed(happy());
    const out = await h.store.list(A, 'live');
    expect(out.items[0]?.items).toBeDefined();
    expect(out.items[0]?.productIds).toEqual([P1, P2]);
    expect(h.repo.count('findBranchStatus')).toBe(1);
  });

  it('findIndicativeForProducts: una consulta, solo automáticas vigentes, mayor ahorro primero, agotado sin promo', async () => {
    const h = promotionsHarness();
    h.repo.seed({ name: 'Q5', kind: 'FIXED_AMOUNT', value: '5.00' });
    h.repo.seed({ name: '30%', value: '30.00', productIds: [P1] });
    h.repo.seed({ name: 'Cupón', code: 'ABC123', value: '90.00' });
    h.repo.calls.length = 0;
    const out = await h.store.findIndicativeForProducts(A, [
      { id: P1, price: '85.00' },
      { id: P2, price: '30.00' },
      { id: P3, price: '25.00', available: false },
    ]);
    expect(h.repo.count('findCandidates')).toBe(1);
    expect(out.byProduct.get(P1)?.map((p) => [p.name, p.promoPrice])).toEqual([
      ['30%', '59.50'],
      ['Q5', '80.00'],
    ]);
    expect(out.byProduct.get(P2)?.map((p) => p.name)).toEqual(['Q5']);
    expect(out.byProduct.has(P3)).toBe(false);
    expect(JSON.stringify([...out.byProduct])).not.toContain('ABC123');
    expect((await h.store.findIndicativeForProducts(A, [])).byProduct.size).toBe(0);
  });
});
