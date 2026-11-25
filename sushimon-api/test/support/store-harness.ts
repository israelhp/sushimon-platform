import { NotFoundException } from '@nestjs/common';
import { PublicBannersReader } from '../../src/banners/public-banners.reader.js';
import { BranchOffersService } from '../../src/branch-products/branch-offers.service.js';
import type { BranchProductsRepository } from '../../src/branch-products/branch-products.repository.js';
import type { BranchAvailabilityService } from '../../src/branch-schedule/branch-availability.service.js';
import type { BranchAvailabilityDto } from '../../src/branch-schedule/dto/branch-schedule-responses.dto.js';
import type { BranchesQueryService } from '../../src/branches/branches-query.service.js';
import { MediaUrlService } from '../../src/media/media-url.service.js';
import { ModifiersQueryService } from '../../src/modifiers/modifiers-query.service.js';
import type { ModifiersRepository } from '../../src/modifiers/modifiers.repository.js';
import { ProductsQueryService } from '../../src/products/products-query.service.js';
import type { ProductsRepository } from '../../src/products/products.repository.js';
import { PromotionTimeService } from '../../src/promotions/promotion-time.service.js';
import { PublicPromotionsService } from '../../src/promotions/public-promotions.service.js';
import { StoreDbGate } from '../../src/store/concurrency.js';
import { StoreBootstrapService } from '../../src/store/store-bootstrap.service.js';
import { StoreCatalogService } from '../../src/store/store-catalog.service.js';
import { StoreProductService } from '../../src/store/store-product.service.js';
import { bid, bpid, fakeProduct, FakeBranchProductsRepo } from './fake-branch-products-repo.js';
import { FakeBannersRepo } from './fake-banners-repo.js';
import { FakeModifiersRepo } from './fake-modifiers-repo.js';
import { FakePromotionsRepo } from './fake-promotions-repo.js';
import { FakeStoreCatalogRepo } from './fake-store-catalog-repo.js';
import { mediaConfig } from './media-harness.js';
import { CAT, productRow, productsHarness } from './products-harness.js';
import { MutableClock, NOW, TZ } from './promotions-harness.js';

export { CAT, NOW, TZ, bid, bpid };
export const A = bid(1);
export const B = bid(2);
export const C = bid(3);
export const INACTIVE_BRANCH = bid(4);
export const MISSING_BRANCH = bid(99);

/** Disponibilidad simulada: sin horarios reales, la prueba fija el próximo cambio. */
export function availabilityStub(nextTransitionAt: string | null = null) {
  const state = { nextTransitionAt, fail: false };
  const getPublic = vi.fn((branchId: string): Promise<BranchAvailabilityDto> => {
    if (state.fail) return Promise.reject(new Error('horarios no disponibles'));
    return Promise.resolve({
      branchId,
      timezone: TZ,
      serverTime: NOW.toISOString(),
      isOpenNow: true,
      isAcceptingOrders: true,
      reason: 'OPEN',
      nextOpensAt: null,
      nextClosesAt: state.nextTransitionAt,
      nextTransitionAt: state.nextTransitionAt,
    } as BranchAvailabilityDto);
  });
  return { state, getPublic, service: { getPublic } as unknown as BranchAvailabilityService };
}

/**
 * Mundo de tienda F17: categorías reales de F10 (rolls > frios > veganos; calientes INACTIVA > tempura; bebidas),
 * sucursales, productos, promociones y banners en memoria, con los servicios REALES de F10/F11/F13/F15/F16/F17.
 * Solo la disponibilidad (F08) y la lectura de sucursales (F07) son dobles mínimos.
 */
export function storeHarness(opts: { concurrency?: number } = {}) {
  const world = new FakeBranchProductsRepo();
  world.seedBranch(A, { name: 'Zona 10' });
  world.seedBranch(B, { name: 'Antigua' });
  world.seedBranch(C, { name: 'Escuintla' });
  world.seedBranch(INACTIVE_BRANCH, { name: 'Cerrada', active: false });
  const catalogRepo = new FakeStoreCatalogRepo(world);
  const productsRepo = (() => {
    const h = productsHarness();
    return h;
  })();
  const { categoriesQuery, categoriesRepo } = productsRepo;
  const clock = new MutableClock(NOW);

  const branches = {
    getStatus: vi.fn((id: string) => {
      const b = world.branches.get(id);
      return Promise.resolve(b ? { id: b.id, active: b.active } : null);
    }),
    getPublicById: vi.fn((id: string) => {
      const b = world.branches.get(id);
      if (!b?.active) return Promise.reject(new NotFoundException('Sucursal no encontrada'));
      return Promise.resolve({
        id: b.id,
        code: b.code,
        name: b.name,
        address: 'Calle 1',
        phone: null,
        latitude: null,
        longitude: null,
      });
    }),
  };

  const promotionsRepo = new FakePromotionsRepo(world);
  const time = new PromotionTimeService(clock, TZ);
  const offers = new BranchOffersService(
    world as unknown as BranchProductsRepository,
    categoriesQuery,
  );
  const promotions = new PublicPromotionsService(
    promotionsRepo.asRepository(),
    time,
    offers,
    categoriesQuery,
  );

  const bannersRepo = new FakeBannersRepo();
  bannersRepo.seedAsset(1);
  const urls = new MediaUrlService(mediaConfig());
  const banners = new PublicBannersReader(bannersRepo.asReadRepository(), urls);

  const availability = availabilityStub();
  const modifiersRepo = new FakeModifiersRepo();
  const offerSpy = vi.spyOn(modifiersRepo, 'findOffer');
  const modifiers = new ModifiersQueryService(modifiersRepo as unknown as ModifiersRepository);
  const productsQuery = new ProductsQueryService(
    productsRepo.repo as unknown as ProductsRepository,
    categoriesQuery,
    modifiers,
  );

  const catalog = new StoreCatalogService(
    catalogRepo.asRepository(),
    categoriesQuery,
    branches as unknown as BranchesQueryService,
    promotions,
    clock,
  );
  const gate = new StoreDbGate(opts.concurrency ?? 2, 8, 1_500);
  const bootstrap = new StoreBootstrapService(
    branches as unknown as BranchesQueryService,
    categoriesQuery,
    catalogRepo.asRepository(),
    availability.service,
    promotions,
    banners,
    clock,
    gate,
  );
  const detail = new StoreProductService(
    productsQuery,
    branches as unknown as BranchesQueryService,
    offers,
    promotions,
    clock,
  );

  /** Siembra un producto en TODOS los dobles (sucursales/precios, catálogo F11 y tarjetas). */
  function addProduct(
    n: number,
    over: {
      name?: string;
      slug?: string;
      basePrice?: string;
      categoryId?: string;
      active?: boolean;
      description?: string | null;
      image?: { url: string; alt?: string | null } | null;
    } = {},
  ) {
    const f = fakeProduct(n, {
      name: over.name ?? `Producto ${n}`,
      slug: over.slug ?? `producto-${n}`,
      basePrice: over.basePrice ?? '50.00',
      categoryId: over.categoryId ?? CAT.frios,
      active: over.active ?? true,
    });
    world.seedProduct(f);
    productsRepo.repo.seed(
      productRow(f.id, {
        name: f.name,
        slug: f.slug,
        basePrice: f.basePrice,
        categoryId: f.categoryId,
        active: f.active,
        description: over.description ?? null,
      }),
      over.image ? [{ url: over.image.url, altText: over.image.alt ?? null }] : [],
    );
    if (over.description) catalogRepo.descriptions.set(f.id, over.description);
    if (over.image)
      catalogRepo.images.set(f.id, { url: over.image.url, alt: over.image.alt ?? null });
    return f;
  }

  return {
    world,
    catalogRepo,
    productsRepo: productsRepo.repo,
    categoriesRepo,
    clock,
    branches,
    promotionsRepo,
    promotions,
    bannersRepo,
    banners,
    availability,
    catalog,
    bootstrap,
    gate,
    detail,
    addProduct,
    /** Consultas de BD por solicitud: cada llamada a un repositorio = UNA consulta (ver spec F17, «Antes/Después»). */
    resetCounts: () => {
      for (const list of [
        catalogRepo.calls,
        world.calls,
        promotionsRepo.calls,
        bannersRepo.calls,
        productsRepo.repo.calls,
      ]) {
        list.length = 0;
      }
      offerSpy.mockClear();
      categoriesRepo.findAllNodes.mockClear();
      branches.getStatus.mockClear();
      branches.getPublicById.mockClear();
    },
    queryCount: () =>
      catalogRepo.calls.length +
      world.calls.length +
      promotionsRepo.calls.length +
      bannersRepo.calls.length +
      productsRepo.repo.calls.length +
      offerSpy.mock.calls.length +
      categoriesRepo.findAllNodes.mock.calls.length +
      branches.getStatus.mock.calls.length +
      branches.getPublicById.mock.calls.length,
  };
}
