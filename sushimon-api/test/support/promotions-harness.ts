import { AuditService } from '../../src/audit/audit.service.js';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import { BranchOffersService } from '../../src/branch-products/branch-offers.service.js';
import type { BranchProductsRepository } from '../../src/branch-products/branch-products.repository.js';
import type { Clock } from '../../src/branch-schedule/clock.js';
import type { CategoriesQueryService } from '../../src/categories/categories-query.service.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { AdminPromotionsService } from '../../src/promotions/admin-promotions.service.js';
import { PromotionCandidatesService } from '../../src/promotions/promotion-candidates.service.js';
import { PromotionEvaluator } from '../../src/promotions/promotion-evaluator.js';
import { PromotionTimeService } from '../../src/promotions/promotion-time.service.js';
import { PublicPromotionsService } from '../../src/promotions/public-promotions.service.js';
import { bid, bpid, fakeProduct, FakeBranchProductsRepo } from './fake-branch-products-repo.js';
import { FakePromotionsRepo } from './fake-promotions-repo.js';

export const TZ = 'America/Guatemala';
export const A = bid(1);
export const B = bid(2);
export const C = bid(3);
export const INACTIVE = bid(4);
export const P1 = bpid(1);
export const P2 = bpid(2);
export const P3 = bpid(3);
export const HIDDEN = bpid(4); // categoría oculta
export const MISSING_PRODUCT = bpid(99);

/** Instante a partir de la hora local de Guatemala (UTC-6, sin horario de verano). */
export const local = (iso: string): Date => new Date(`${iso}-06:00`);
/** Lunes 16 de noviembre de 2026, 16:00 local. */
export const NOW = local('2026-11-16T16:00:00');

export class MutableClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
}

/** Mundo de sucursales/productos (F13) + repositorio de promociones en memoria + servicios REALES. */
export function promotionsHarness(
  visibleCategories: string[] = ['00000000-0000-4000-8000-0000000000a2'],
) {
  const world = new FakeBranchProductsRepo();
  world.seedBranch(A, { name: 'Zona 10' });
  world.seedBranch(B, { name: 'Antigua' });
  world.seedBranch(C, { name: 'Escuintla' });
  world.seedBranch(INACTIVE, { name: 'Cerrada', active: false });
  world.seedProduct(
    fakeProduct(1, { name: 'Roll California', slug: 'roll-california', basePrice: '85.00' }),
  );
  world.seedProduct(fakeProduct(2, { name: 'Edamame', slug: 'edamame', basePrice: '30.00' }));
  world.seedProduct(fakeProduct(3, { name: 'Cerveza', slug: 'cerveza', basePrice: '25.00' }));
  world.seedProduct(
    fakeProduct(4, {
      name: 'Oculto',
      slug: 'oculto',
      categoryId: '00000000-0000-4000-8000-0000000000a9',
    }),
  );
  const repo = new FakePromotionsRepo(world);
  const clock = new MutableClock(NOW);
  const time = new PromotionTimeService(clock, TZ);
  const authorization = new AuthorizationService({} as IdentityService);
  const audit = new AuditService();
  const categories = {
    getVisibleIds: () => Promise.resolve(visibleCategories),
  } as unknown as CategoriesQueryService;
  const offers = new BranchOffersService(world as unknown as BranchProductsRepository, categories);
  const admin = new AdminPromotionsService(repo.asRepository(), audit, authorization, time);
  const store = new PublicPromotionsService(repo.asRepository(), time, offers, categories);
  const candidates = new PromotionCandidatesService(repo.asRepository());
  const evaluator = new PromotionEvaluator(TZ);
  return { world, repo, clock, time, admin, store, candidates, evaluator, authorization };
}
