import { fold } from '../../src/products/product-policy.js';
import type { StoreCatalogRepository } from '../../src/store/store-catalog.repository.js';
import type { CardFilter, CardRow } from '../../src/store/store-catalog.types.js';
import type { FakeBranchProductsRepo } from './fake-branch-products-repo.js';
import { likeToRegExp } from './fake-products-repo.js';

/**
 * Doble en memoria de `StoreCatalogRepository` (F17): reproduce las reglas de la consulta SQL (productos activos de las
 * categorías visibles, precio y disponibilidad de ESA sucursal, imagen principal, búsqueda plegada con comodines
 * literales, orden estable, página y total) sobre el «mundo» de `FakeBranchProductsRepo` (productos y filas por sucursal).
 * Cuenta las llamadas para verificar «sin N+1».
 */
export class FakeStoreCatalogRepo {
  descriptions = new Map<string, string>();
  images = new Map<string, { url: string; alt: string | null }>();
  calls: string[] = [];
  /** Si se define, la siguiente lectura lanza este error (503/500). */
  failWith: unknown = null;

  constructor(private readonly world: FakeBranchProductsRepo) {}

  count = (name: string) => this.calls.filter((c) => c === name).length;
  asRepository = () => this as unknown as StoreCatalogRepository;

  private maybeFail(): void {
    if (this.failWith) throw this.failWith as Error;
  }

  private matching(f: CardFilter): CardRow[] {
    const contains = f.search ? likeToRegExp(f.search.contains) : null;
    const ids = new Set(f.categoryIds);
    const rows: CardRow[] = [];
    for (const p of this.world.products.values()) {
      if (!p.active || !ids.has(p.categoryId)) continue;
      const row = f.branchId === null ? undefined : this.world.rowOf(f.branchId, p.id);
      const available = f.branchId === null ? null : (row?.available ?? true);
      if (f.branchId !== null && f.availableOnly && available === false) continue;
      const description = this.descriptions.get(p.id) ?? null;
      if (contains && f.search) {
        const hit =
          contains.test(fold(p.name)) ||
          contains.test(fold(description ?? '')) ||
          f.search.categoryIds.includes(p.categoryId);
        if (!hit) continue;
      }
      const image = this.images.get(p.id);
      rows.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: description === null ? null : description.slice(0, 400),
        categoryId: p.categoryId,
        price: f.branchId === null ? p.basePrice : (row?.priceOverride ?? p.basePrice),
        available,
        imageUrl: image?.url ?? null,
        imageAlt: image?.alt ?? null,
      });
    }
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const dir = f.order === 'desc' ? -1 : 1;
    const rank = (r: CardRow): number => {
      if (!f.search) return 0;
      const name = fold(r.name);
      const prefix = likeToRegExp(f.search.prefix);
      if (prefix.test(name)) return 0;
      return contains?.test(name) ? 1 : 2;
    };
    return rows.sort((a, b) => {
      if (f.sort === 'relevance')
        return rank(a) - rank(b) || cmp(a.name, b.name) || cmp(a.id, b.id);
      if (f.sort === 'name') return dir * cmp(a.name, b.name) || cmp(a.id, b.id);
      if (f.sort === 'price') {
        return dir * (Number(a.price) - Number(b.price)) || cmp(a.id, b.id);
      }
      return (
        f.categoryIds.indexOf(a.categoryId) - f.categoryIds.indexOf(b.categoryId) ||
        cmp(a.name, b.name) ||
        cmp(a.id, b.id)
      );
    });
  }

  findCards(f: CardFilter): Promise<{ rows: CardRow[]; total: number | null }> {
    this.calls.push('findCards');
    this.maybeFail();
    if (f.categoryIds.length === 0) return Promise.resolve({ rows: [], total: 0 });
    const all = this.matching(f);
    const rows = all.slice(f.offset, f.offset + f.limit);
    return Promise.resolve({ rows, total: rows.length === 0 ? null : all.length });
  }

  countCards(f: CardFilter): Promise<number> {
    this.calls.push('countCards');
    this.maybeFail();
    return Promise.resolve(f.categoryIds.length === 0 ? 0 : this.matching(f).length);
  }

  countVisible(categoryIds: readonly string[]): Promise<number> {
    this.calls.push('countVisible');
    this.maybeFail();
    const ids = new Set(categoryIds);
    return Promise.resolve(
      [...this.world.products.values()].filter((p) => p.active && ids.has(p.categoryId)).length,
    );
  }
}

/** Delegado `prisma.branch` mínimo sobre el «mundo» de sucursales (lo usa `BranchesQueryService.getStatus`). */
export const branchDelegate = (world: FakeBranchProductsRepo) => ({
  findUnique: ({ where }: { where: { id: string } }) => {
    const b = world.branches.get(where.id);
    return Promise.resolve(b ? { id: b.id, active: b.active } : null);
  },
});
