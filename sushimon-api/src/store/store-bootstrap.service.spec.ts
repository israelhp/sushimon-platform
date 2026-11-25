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
  it('sin sucursal: branch/availability null, promociones vacías, banners activos, featured vacío', async () => {
    const h = world();
    h.bannersRepo.seed();
    h.promotionsRepo.seed({ value: '10.00' });
    const r = await h.bootstrap.getBootstrap({});
    expect(r).toMatchObject({
      branchId: null,
      branch: null,
      availability: null,
      promotions: [],
      featured: [],
      degraded: [],
      productCount: 2,
      nextChangeAt: null,
    });
    expect(r.banners).toHaveLength(1);
    expect(r).not.toHaveProperty('locale');
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
    h.bannersRepo.seed();
    const r = await h.bootstrap.getBootstrap({ branchId: A });
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

  it('topes: ≤ 5 promociones, ≤ 5 banners, ≤ 30 categorías raíz', async () => {
    const h = world();
    for (let n = 0; n < 8; n += 1) h.promotionsRepo.seed({ name: `P${n}` });
    for (let n = 0; n < 14; n += 1) h.bannersRepo.seed();
    const r = await h.bootstrap.getBootstrap({ branchId: A });
    expect(r.promotions).toHaveLength(5);
    expect(r.banners).toHaveLength(5);
    expect(r.categories.length).toBeLessThanOrEqual(30);
  });

  it('banners: solo activos, en orden de creación; sin título/CTA/idioma (forma {id, image, alt})', async () => {
    const h = world();
    h.bannersRepo.seed({ active: false });
    h.bannersRepo.seed({ imageAlt: 'Primero' });
    h.bannersRepo.seed({ imageAlt: 'Segundo' });
    const r = await h.bootstrap.getBootstrap({});
    expect(r.banners.map((b) => b.alt)).toEqual(['Primero', 'Segundo']);
    expect(Object.keys(r.banners[0] as object).sort()).toEqual(['alt', 'id', 'image']);
    expect(r.banners[0]?.image.url).toMatch(/^https:\/\//);
  });

  it('nextChangeAt = mínimo entre promociones y availability.nextTransitionAt (los banners no intervienen)', async () => {
    const h = world();
    h.promotionsRepo.seed({ endsAt: local('2026-11-16T16:00:30') });
    h.bannersRepo.seed();
    h.availability.state.nextTransitionAt = local('2026-11-16T16:00:40').toISOString();
    expect((await h.bootstrap.getBootstrap({ branchId: A })).nextChangeAt).toBe(
      local('2026-11-16T16:00:30').toISOString(),
    );
    h.availability.state.nextTransitionAt = local('2026-11-16T16:00:05').toISOString();
    const r = await h.bootstrap.getBootstrap({ branchId: A });
    expect(r.nextChangeAt).toBe(local('2026-11-16T16:00:05').toISOString());
    expect(boundedCacheControl(r, 15)).toBe('public, max-age=5, s-maxage=5');
  });

  it('una sección opcional que falla => 200 con la sección vacía y su nombre en degraded; no-store', async () => {
    const h = world();
    h.bannersRepo.failReadWith = new Error('boom');
    h.availability.state.fail = true;
    const r = await h.bootstrap.getBootstrap({ branchId: A });
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
    const r = await h.bootstrap.getBootstrap({ branchId: A });
    expect(r.degraded).toEqual(['promotions']);
    expect(r.promotions).toEqual([]);
  });

  it('sucursal inexistente o inactiva => 404 BRANCH_NOT_FOUND', async () => {
    const h = world();
    for (const id of [MISSING_BRANCH, INACTIVE_BRANCH]) {
      expect(code(await fail(h.bootstrap.getBootstrap({ branchId: id })))).toBe('BRANCH_NOT_FOUND');
    }
  });

  it('crítica (productCount) que falla con error reintentable => 503 STORE_BUSY', async () => {
    const h = world();
    h.catalogRepo.failWith = Object.assign(new Error('x'), { code: '40001' });
    expect(code(await fail(h.bootstrap.getBootstrap({})))).toBe('STORE_BUSY');
  });

  it('consultas acotadas y constantes con 2 vs 100 productos (el catálogo no se carga)', async () => {
    const h = world();
    h.promotionsRepo.seed({});
    h.bannersRepo.seed();
    h.resetCounts();
    await h.bootstrap.getBootstrap({ branchId: A });
    const base = h.queryCount();
    for (let n = 100; n < 200; n += 1) h.addProduct(n, { slug: `p-${n}`, name: `P ${n}` });
    h.resetCounts();
    const r = await h.bootstrap.getBootstrap({ branchId: A });
    expect(r.productCount).toBe(102);
    expect(h.queryCount()).toBe(base);
    // sucursal (1) + categorías (1) + conteo (1) + candidatas de promoción (1) + banners (1 consulta, sin
    // sucursal) (la disponibilidad es 1 consulta de F08, aquí simulada)
    expect(base).toBe(5);
  });

  it('banners: una sola consulta, sin leer la sucursal', async () => {
    const h = world();
    await h.bootstrap.getBootstrap({ branchId: A });
    expect(h.bannersRepo.callCount('findActive')).toBe(1);
    expect(h.bannersRepo.calls).toEqual(['findActive']);
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
        h.bootstrap.getBootstrap({ branchId: A }).then(
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
    expect((await h.bootstrap.getBootstrap({})).productCount).toBe(2);
  });

  it('el semáforo se libera aunque la lectura falle', async () => {
    const h = world();
    h.catalogRepo.failWith = new Error('boom');
    for (let n = 0; n < 5; n += 1) await fail(h.bootstrap.getBootstrap({}));
    expect([h.gate.inFlight, h.gate.waiting]).toEqual([0, 0]);
    h.catalogRepo.failWith = null;
    expect((await h.bootstrap.getBootstrap({})).productCount).toBe(2);
  });

  it('una sección que falla de forma persistente registra una advertencia por minuto, no por solicitud', async () => {
    const h = world();
    const warn = vi.spyOn(Logger.prototype, 'warn');
    warn.mockClear();
    h.availability.state.fail = true;
    for (let n = 0; n < 5; n += 1) await h.bootstrap.getBootstrap({ branchId: A });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('sin sucursal: consultas = categorías + conteo + banners', async () => {
    const h = world();
    h.resetCounts();
    await h.bootstrap.getBootstrap({});
    expect(h.queryCount()).toBe(3);
  });

  it('respuesta sin datos privados: solo claves del contrato', async () => {
    const h = world();
    const r = await h.bootstrap.getBootstrap({ branchId: A });
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
