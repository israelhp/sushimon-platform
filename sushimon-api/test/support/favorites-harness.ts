import { randomUUID } from 'node:crypto';
import type { Principal } from '../../src/auth/auth.types.js';
import {
  CatalogUnavailableError,
  type CatalogProductSummary,
  type CatalogProductsPort,
} from '../../src/favorites/catalog-products.port.js';
import type {
  AddOutcome,
  FavoriteRow,
  FavoritesRepository,
} from '../../src/favorites/favorites.repository.js';

export const P1 = '11111111-1111-4111-8111-111111111111';
export const P2 = '22222222-2222-4222-8222-222222222222';
export const P3 = '33333333-3333-4333-8333-333333333333';
export const P_MISSING = '99999999-9999-4999-8999-999999999999';

export function product(
  id: string,
  over: Partial<CatalogProductSummary> & Record<string, unknown> = {},
): CatalogProductSummary {
  return {
    id,
    name: `Producto ${id.slice(0, 4)}`,
    nameEn: null,
    imageUrl: null,
    categoryId: null,
    status: 'ACTIVE',
    ...over,
  };
}

/** Doble del puerto de catálogo: llamadas registradas, modo caído y retardo configurables. */
export class FakeCatalog implements CatalogProductsPort {
  products = new Map<string, CatalogProductSummary>();
  calls: (readonly string[])[] = [];
  mode: 'ok' | 'unavailable' | 'throws' | 'hangs' = 'ok';

  constructor(items: CatalogProductSummary[] = []) {
    for (const p of items) this.products.set(p.id, p);
  }

  findPublicSummaries(ids: readonly string[]): Promise<ReadonlyMap<string, CatalogProductSummary>> {
    this.calls.push(ids);
    if (this.mode === 'unavailable') return Promise.reject(new CatalogUnavailableError());
    if (this.mode === 'throws') return Promise.reject(new Error('boom interno secreto'));
    if (this.mode === 'hangs') return new Promise(() => undefined);
    const out = new Map<string, CatalogProductSummary>();
    for (const id of ids) {
      const found = this.products.get(id);
      if (found) out.set(id, found);
    }
    return Promise.resolve(out);
  }
}

/**
 * Doble en memoria de `FavoritesRepository` (misma superficie pública). Reproduce el orden
 * `created_at DESC, product_id ASC`, `ON CONFLICT DO NOTHING` y el tope. El SQL real y la concurrencia se cubren en
 * `test/favorites.int-spec.ts`.
 */
export class FakeFavoritesRepo implements Pick<
  FavoritesRepository,
  'list' | 'listProductIds' | 'count' | 'remove' | 'add'
> {
  rows: { customerId: string; productId: string; createdAt: Date }[] = [];
  private tick = 0;
  queries = { list: 0, count: 0, add: 0, remove: 0 };

  seed(customerId: string, productId: string, createdAt?: Date): void {
    this.rows.push({
      customerId,
      productId,
      createdAt: createdAt ?? new Date(Date.UTC(2026, 10, 1) + this.tick++ * 1000),
    });
  }

  private sorted(customerId: string): FavoriteRow[] {
    return this.rows
      .filter((r) => r.customerId === customerId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || a.productId.localeCompare(b.productId),
      )
      .map(({ productId, createdAt }) => ({ productId, createdAt }));
  }

  list(customerId: string, limit: number): Promise<FavoriteRow[]> {
    this.queries.list++;
    return Promise.resolve(this.sorted(customerId).slice(0, limit));
  }

  listProductIds(customerId: string, limit: number): Promise<string[]> {
    return Promise.resolve(
      this.sorted(customerId)
        .slice(0, limit)
        .map((r) => r.productId),
    );
  }

  count(customerId: string): Promise<number> {
    this.queries.count++;
    return Promise.resolve(this.rows.filter((r) => r.customerId === customerId).length);
  }

  remove(customerId: string, productId: string): Promise<void> {
    this.queries.remove++;
    this.rows = this.rows.filter(
      (r) => !(r.customerId === customerId && r.productId === productId),
    );
    return Promise.resolve();
  }

  add(customerId: string, productId: string, limit: number): Promise<AddOutcome> {
    this.queries.add++;
    const mine = this.rows.filter((r) => r.customerId === customerId);
    if (mine.some((r) => r.productId === productId)) return Promise.resolve('EXISTS');
    if (mine.length >= limit) return Promise.resolve('LIMIT');
    this.seed(customerId, productId);
    return Promise.resolve('CREATED');
  }
}

export function principal(over: Partial<Principal> = {}): Principal {
  return {
    authUserId: randomUUID(),
    email: 'cliente@example.com',
    provider: 'google',
    googleOAuth: true,
    aal: 'aal1',
    displayName: 'Cliente Prueba',
    avatarUrl: null,
    ...over,
  };
}
