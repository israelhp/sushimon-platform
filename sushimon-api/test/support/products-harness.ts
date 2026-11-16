import { CategoriesQueryService } from '../../src/categories/categories-query.service.js';
import type { CategoriesRepository } from '../../src/categories/categories.repository.js';
import type { CategoryRow } from '../../src/categories/categories.types.js';
import type { ProductRow } from '../../src/products/products.types.js';
import { FakeProductsRepo } from './fake-products-repo.js';

export const CAT = {
  rolls: '00000000-0000-4000-8000-0000000000a1', // raíz activa
  frios: '00000000-0000-4000-8000-0000000000a2', // hija de rolls
  veganos: '00000000-0000-4000-8000-0000000000a3', // hija de frios (nivel 3)
  calientes: '00000000-0000-4000-8000-0000000000a4', // hija de rolls, INACTIVA
  bebidas: '00000000-0000-4000-8000-0000000000a5', // raíz activa
  hijaDeInactiva: '00000000-0000-4000-8000-0000000000a6', // activa, pero su padre (calientes) no
} as const;

export const categoryRow = (
  id: string,
  parentId: string | null,
  slug: string,
  over: Partial<CategoryRow> = {},
): CategoryRow => ({
  id,
  parentId,
  slug,
  name: slug.charAt(0).toUpperCase() + slug.slice(1),
  description: null,
  sortOrder: 0,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

export const seedCategories = (): CategoryRow[] => [
  categoryRow(CAT.rolls, null, 'rolls'),
  categoryRow(CAT.frios, CAT.rolls, 'frios'),
  categoryRow(CAT.veganos, CAT.frios, 'veganos'),
  categoryRow(CAT.calientes, CAT.rolls, 'calientes', { active: false, sortOrder: 1 }),
  categoryRow(CAT.bebidas, null, 'bebidas', { sortOrder: 1 }),
  categoryRow(CAT.hijaDeInactiva, CAT.calientes, 'tempura'),
];

export const productRow = (id: string, over: Partial<ProductRow> = {}): ProductRow => ({
  id,
  sku: null,
  categoryId: CAT.frios,
  slug: `prod-${id.slice(-3)}`,
  name: `Producto ${id.slice(-3)}`,
  description: null,
  basePrice: '50.00',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

export const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Repositorio de productos en memoria + `CategoriesQueryService` REAL sobre un repositorio de categorías en memoria. */
export function productsHarness(categories: CategoryRow[] = seedCategories()) {
  const repo = new FakeProductsRepo();
  for (const c of categories) repo.categories.set(c.id, { id: c.id, active: c.active });
  const categoriesRepo = {
    findAllNodes: vi.fn(() => Promise.resolve(categories.map((c) => ({ ...c })))),
    findAllRows: vi.fn(() => Promise.resolve(categories.map((c) => ({ ...c })))),
  };
  const categoriesQuery = new CategoriesQueryService(
    categoriesRepo as unknown as CategoriesRepository,
  );
  return { repo, categoriesRepo, categoriesQuery, categories };
}
