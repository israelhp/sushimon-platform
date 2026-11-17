import { Logger } from '@nestjs/common';
import { local } from '../../test/support/promotions-harness.js';
import {
  A,
  CAT,
  INACTIVE_BRANCH,
  MISSING_BRANCH,
  storeHarness,
} from '../../test/support/store-harness.js';
import { boundedCacheControl } from '../common/http/bounded-cache.js';

const code = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code;
const fail = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

function world() {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const h = storeHarness();
  h.addProduct(1, { name: 'Roll', slug: 'roll', categoryId: CAT.frios });
  h.addProduct(2, { name: 'Té', slug: 'te', categoryId: CAT.bebidas });
  h.addProduct(3, { name: 'Oculto', slug: 'oculto', categoryId: CAT.calientes });
  h.addProduct(4, { name: 'Inactivo', slug: 'inactivo', categoryId: CAT.frios, active: false });
  return h;
}

describe('StoreBootstrapService', () => {
  it('sin sucursal: branch/availability null, promociones vacías, banners solo ALL, featured vacío', async () => {
    const h = world();
    h.bannersRepo.seed({ branchIds: [] });
    h.bannersRepo.seed({ branchIds: [A] });
    h.promotionsRepo.seed({ value: '10.00' });
    const r = await h.bootstrap.getBootstrap({ locale: 'es' });
    expect(r).toMatchObject({
      branchId: null,
      branch: null,
      availability: null,
      promotions: [],
      featured: [],
      degraded: [],
      productCount: 2,
      locale: 'es',
      nextChangeAt: null,
    });
    expect(r.banners).toHaveLength(1);
    // raíces visibles del árbol: rolls y bebidas; calientes (inactiva) no está
    expect(r.categories.map((c) => [c.slug, c.hasChildren])).toEqual([
      ['rolls', true],
      ['bebidas', false],
    ]);
  });

  it('con sucursal: branch, availability, promociones vigentes SIN items ni código, banners, productCount', async () => {
    const h = world();
    h.promotionsRepo.seed({ name: 'Happy', value: '20.00', productIds: [] });
    h.promotionsRepo.seed({ name: 'Cupón', code: 'SECRETO10' });
    h.promotionsRepo.seed({ name: 'Vencida', endsAt: new Date('2026-11-01T00:00:00Z') });
    h.promotionsRepo.seed({ name: 'Próxima', startsAt: new Date('2026-11-20T00:00:00Z') });
    h.bannersRepo.seed({ branchIds: [A] });
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(r.branch).toMatchObject({ id: A, name: 'Zona 10' });
    expect(r.availability).toMatchObject({ branchId: A, isOpenNow: true });
    expect(r.promotions.map((p) => p.name)).toEqual(['Happy', 'Cupón']);
    const coupon = r.promotions.find((p) => p.requiresCode);
    expect(coupon).not.toHaveProperty('kind');
    expect(coupon).not.toHaveProperty('value');
    for (const p of r.promotions) {
      expect(p).not.toHaveProperty('items');
      expect(p).not.toHaveProperty('code');
      expect(p.state).toBe('live');
    }
    expect(JSON.stringify(r)).not.toContain('SECRETO10');
    expect(r.banners).toHaveLength(1);
    expect(r.productCount).toBe(2);
  });

  it('topes: ≤ 5 promociones, ≤ 10 banners, ≤ 30 categorías raíz', async () => {
    const h = world();
    for (let n = 0; n < 8; n += 1) h.promotionsRepo.seed({ name: `P${n}` });
    for (let n = 0; n < 14; n += 1) h.bannersRepo.seed({});
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(r.promotions).toHaveLength(5);
    expect(r.banners).toHaveLength(10);
    expect(r.categories.length).toBeLessThanOrEqual(30);
  });

  it('idioma en: banners con respaldo por campo a es', async () => {
    const h = world();
    h.bannersRepo.seed({
      es: { title: 'Hola', subtitle: 'Sub', ctaLabel: null, imageAlt: 'Alt' },
      en: { title: 'Hello', subtitle: null, ctaLabel: null, imageAlt: null },
    });
    const r = await h.bootstrap.getBootstrap({ locale: 'en' });
    expect(r.locale).toBe('en');
    expect(r.banners[0]).toMatchObject({ title: 'Hello', subtitle: 'Sub', imageAlt: 'Alt' });
  });

  it('banners programados y vencidos no salen; activos sí', async () => {
    const h = world();
    h.bannersRepo.seed({ endsAt: new Date('2026-11-01T00:00:00Z') });
    h.bannersRepo.seed({ startsAt: new Date('2026-11-30T00:00:00Z') });
    h.bannersRepo.seed({ active: false });
    h.bannersRepo.seed({});
    expect((await h.bootstrap.getBootstrap({ locale: 'es' })).banners).toHaveLength(1);
  });

  it('nextChangeAt = mínimo entre promociones, banners y availability.nextTransitionAt', async () => {
    const h = world();
    h.promotionsRepo.seed({ endsAt: local('2026-11-16T16:00:30') });
    h.bannersRepo.seed({ endsAt: local('2026-11-16T16:00:20') });
    h.availability.state.nextTransitionAt = local('2026-11-16T16:00:40').toISOString();
    expect((await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' })).nextChangeAt).toBe(
      local('2026-11-16T16:00:20').toISOString(),
    );
    h.availability.state.nextTransitionAt = local('2026-11-16T16:00:05').toISOString();
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(r.nextChangeAt).toBe(local('2026-11-16T16:00:05').toISOString());
    expect(boundedCacheControl(r, 15)).toBe('public, max-age=5, s-maxage=5');
  });

  it('una sección opcional que falla => 200 con la sección vacía y su nombre en degraded; no-store', async () => {
    const h = world();
    h.bannersRepo.failReadWith = new Error('boom');
    h.availability.state.fail = true;
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(r.banners).toEqual([]);
    expect(r.availability).toBeNull();
    expect(r.degraded.sort()).toEqual(['availability', 'banners']);
    expect(r.productCount).toBe(2);
    expect(r.categories.length).toBe(2);
    expect(JSON.stringify(r)).not.toContain('boom');
  });

  it('promociones degradadas (F15 sin migración) no tumban el Inicio', async () => {
    const h = world();
    h.promotionsRepo.seed({});
    vi.spyOn(h.promotions, 'list').mockRejectedValue(
      new Error('relation app.promotions does not exist'),
    );
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(r.degraded).toEqual(['promotions']);
    expect(r.promotions).toEqual([]);
  });

  it('sucursal inexistente o inactiva => 404 BRANCH_NOT_FOUND', async () => {
    const h = world();
    for (const id of [MISSING_BRANCH, INACTIVE_BRANCH]) {
      expect(code(await fail(h.bootstrap.getBootstrap({ branchId: id, locale: 'es' })))).toBe(
        'BRANCH_NOT_FOUND',
      );
    }
  });

  it('crítica (productCount) que falla con error reintentable => 503 STORE_BUSY', async () => {
    const h = world();
    h.catalogRepo.failWith = Object.assign(new Error('x'), { code: '40001' });
    expect(code(await fail(h.bootstrap.getBootstrap({ locale: 'es' })))).toBe('STORE_BUSY');
  });

  it('consultas acotadas y constantes con 2 vs 100 productos (el catálogo no se carga)', async () => {
    const h = world();
    h.promotionsRepo.seed({});
    h.bannersRepo.seed({});
    h.resetCounts();
    await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    const base = h.queryCount();
    for (let n = 100; n < 200; n += 1) h.addProduct(n, { slug: `p-${n}`, name: `P ${n}` });
    h.resetCounts();
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(r.productCount).toBe(102);
    expect(h.queryCount()).toBe(base);
    // sucursal (1) + categorías (1) + conteo (1) + candidatas de promoción (1) + banners (candidatos: 1; la
    // sucursal ya validada NO se relee) (la disponibilidad es 1 consulta de F08, aquí simulada)
    expect(base).toBe(5);
  });

  it('banners no revalidan la sucursal (una consulta menos que antes del ajuste)', async () => {
    const h = world();
    await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(h.bannersRepo.count('findBranchStatus')).toBe(0);
    expect(h.bannersRepo.count('findStoreCandidates')).toBe(1);
  });

  it('N bootstraps concurrentes: siempre 200 o 503 STORE_BUSY, nunca se cuelga; el semáforo termina libre', async () => {
    const h = world();
    // cupo 2, cola 8, espera 1,5 s: 40 solicitudes simultáneas con lecturas lentas
    const slow = vi.spyOn(h.catalogRepo, 'countVisible').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 2;
    });
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        h.bootstrap.getBootstrap({ branchId: A, locale: 'es' }).then(
          () => 200,
          (e: unknown) => (code(e) === 'STORE_BUSY' ? 503 : 500),
        ),
      ),
    );
    expect(results.every((r) => r === 200 || r === 503)).toBe(true);
    expect(results).toContain(200);
    expect(results).toContain(503);
    expect([h.gate.inFlight, h.gate.waiting]).toEqual([0, 0]);
    slow.mockRestore();
    expect((await h.bootstrap.getBootstrap({ locale: 'es' })).productCount).toBe(2);
  });

  it('el semáforo se libera aunque la lectura falle', async () => {
    const h = world();
    h.catalogRepo.failWith = new Error('boom');
    for (let n = 0; n < 5; n += 1) await fail(h.bootstrap.getBootstrap({ locale: 'es' }));
    expect([h.gate.inFlight, h.gate.waiting]).toEqual([0, 0]);
    h.catalogRepo.failWith = null;
    expect((await h.bootstrap.getBootstrap({ locale: 'es' })).productCount).toBe(2);
  });

  it('una sección que falla de forma persistente registra una advertencia por minuto, no por solicitud', async () => {
    const h = world();
    const warn = vi.spyOn(Logger.prototype, 'warn');
    warn.mockClear();
    h.availability.state.fail = true;
    for (let n = 0; n < 5; n += 1) await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('sin sucursal: consultas = categorías + conteo + banners', async () => {
    const h = world();
    h.resetCounts();
    await h.bootstrap.getBootstrap({ locale: 'es' });
    expect(h.queryCount()).toBe(3);
  });

  it('respuesta sin datos privados: solo claves del contrato', async () => {
    const h = world();
    const r = await h.bootstrap.getBootstrap({ branchId: A, locale: 'es' });
    expect(Object.keys(r).sort()).toEqual(
      [
        'availability',
        'banners',
        'branch',
        'branchId',
        'categories',
        'degraded',
        'featured',
        'generatedAt',
        'locale',
        'nextChangeAt',
        'productCount',
        'promotions',
      ].sort(),
    );
    expect(Object.keys(r.branch!).sort()).toEqual(
      ['address', 'code', 'id', 'latitude', 'longitude', 'name', 'phone'].sort(),
    );
  });
});
