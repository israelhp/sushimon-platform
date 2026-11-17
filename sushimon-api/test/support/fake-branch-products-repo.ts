import { fold } from '../../src/products/product-policy.js';
import type { BranchProductTx } from '../../src/branch-products/branch-products.repository.js';
import type {
  BranchProductRow,
  BranchStatus,
  MatrixFilter,
  MatrixRow,
  ProductBranchRow,
  ProductFacts,
  ResolveRow,
} from '../../src/branch-products/branch-products.types.js';
import { likeToRegExp } from './fake-products-repo.js';

export const bid = (n: number) => `00000000-0000-4000-8000-${String(n + 7000).padStart(12, '0')}`;
export const bpid = (n: number) => `00000000-0000-4000-8000-${String(n + 8000).padStart(12, '0')}`;
export const T0 = new Date('2026-01-01T00:00:00Z');

export interface FakeProduct extends ProductFacts {
  sku: string | null;
  slug: string;
  name: string;
}

export const fakeProduct = (n: number, over: Partial<FakeProduct> = {}): FakeProduct => ({
  id: bpid(n),
  sku: null,
  slug: `prod-${n}`,
  name: `Producto ${n}`,
  basePrice: '50.00',
  active: true,
  categoryId: '00000000-0000-4000-8000-0000000000a2', // CAT.frios (visible)
  ...over,
});

/**
 * Doble en memoria de `BranchProductsRepository` (misma superficie). Emula COMMIT/ROLLBACK por instantánea y el
 * `ON CONFLICT` por columna. Cuenta las llamadas para verificar "sin N+1".
 */
export class FakeBranchProductsRepo {
  branches = new Map<string, BranchStatus & { code: string; name: string }>();
  products = new Map<string, FakeProduct>();
  rows = new Map<string, BranchProductRow>(); // clave `branchId|productId`
  calls: string[] = [];
  audit: Record<string, unknown>[] = [];
  failTransactionWith: unknown = null;
  /** Se ejecuta tras `findRow` (simula una escritura concurrente entre la lectura y el upsert). */
  afterFindRow: (() => void) | null = null;

  count = (name: string) => this.calls.filter((c) => c === name).length;
  key = (b: string, p: string) => `${b}|${p}`;

  seedBranch(id: string, over: Partial<{ active: boolean; name: string; code: string }> = {}) {
    this.branches.set(id, {
      id,
      active: true,
      code: `s-${id.slice(-3)}`,
      name: `Suc ${id.slice(-3)}`,
      ...over,
    });
  }
  seedProduct(p: FakeProduct) {
    this.products.set(p.id, { ...p });
  }
  seedRow(b: string, p: string, over: Partial<BranchProductRow> = {}) {
    this.rows.set(this.key(b, p), { priceOverride: null, available: true, updatedAt: T0, ...over });
  }
  rowOf = (b: string, p: string) => this.rows.get(this.key(b, p));

  async transaction<T>(fn: (tx: BranchProductTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const snapshot = new Map([...this.rows].map(([k, v]) => [k, { ...v }]));
    const auditLength = this.audit.length;
    const tx = {
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as BranchProductTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.audit.length = auditLength;
      this.rows = snapshot;
      throw error;
    }
  }

  findBranchStatus(id: string): Promise<BranchStatus | null> {
    this.calls.push('findBranchStatus');
    const b = this.branches.get(id);
    return Promise.resolve(b ? { id: b.id, active: b.active } : null);
  }

  findProduct(id: string): Promise<ProductFacts | null> {
    this.calls.push('findProduct');
    const p = this.products.get(id);
    return Promise.resolve(
      p ? { id: p.id, basePrice: p.basePrice, active: p.active, categoryId: p.categoryId } : null,
    );
  }

  findRow(_tx: unknown, b: string, p: string): Promise<BranchProductRow | null> {
    this.calls.push('findRow');
    const r = this.rowOf(b, p);
    const out = r ? { ...r } : null;
    this.afterFindRow?.();
    return Promise.resolve(out);
  }

  upsertPrice(
    _tx: unknown,
    b: string,
    p: string,
    price: string | null,
    now: Date,
  ): Promise<BranchProductRow> {
    this.calls.push('upsertPrice');
    const cur = this.rowOf(b, p) ?? { priceOverride: null, available: true, updatedAt: now };
    const next = { ...cur, priceOverride: price, updatedAt: now };
    this.rows.set(this.key(b, p), next);
    return Promise.resolve({ ...next });
  }

  upsertAvailability(
    _tx: unknown,
    b: string,
    p: string,
    available: boolean,
    now: Date,
  ): Promise<BranchProductRow> {
    this.calls.push('upsertAvailability');
    const cur = this.rowOf(b, p) ?? { priceOverride: null, available: true, updatedAt: now };
    const next = { ...cur, available, updatedAt: now };
    this.rows.set(this.key(b, p), next);
    return Promise.resolve({ ...next });
  }

  deleteIfDefault(_tx: unknown, b: string, p: string): Promise<boolean> {
    this.calls.push('deleteIfDefault');
    const r = this.rowOf(b, p);
    if (r && r.priceOverride === null && r.available) {
      this.rows.delete(this.key(b, p));
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  findMatrix(
    branchId: string,
    filter: MatrixFilter,
  ): Promise<{ rows: MatrixRow[]; total: number }> {
    this.calls.push('findMatrix');
    const regex = filter.pattern ? likeToRegExp(filter.pattern) : null;
    const all = [...this.products.values()]
      .map((p) => ({ p, r: this.rowOf(branchId, p.id) }))
      .filter(({ p }) => filter.categoryId === undefined || p.categoryId === filter.categoryId)
      .filter(
        ({ r }) => filter.available === undefined || (r?.available ?? true) === filter.available,
      )
      .filter(
        ({ r }) =>
          filter.hasOverride === undefined || (r?.priceOverride != null) === filter.hasOverride,
      )
      .filter(
        ({ p }) => !regex || [p.name, p.slug, p.sku ?? ''].some((text) => regex.test(fold(text))),
      )
      .sort((a, b) =>
        a.p.name < b.p.name ? -1 : a.p.name > b.p.name ? 1 : a.p.id < b.p.id ? -1 : 1,
      );
    const start = (filter.page - 1) * filter.pageSize;
    return Promise.resolve({
      rows: all.slice(start, start + filter.pageSize).map(({ p, r }) => ({
        id: p.id,
        sku: p.sku,
        slug: p.slug,
        name: p.name,
        categoryId: p.categoryId,
        active: p.active,
        basePrice: p.basePrice,
        priceOverride: r?.priceOverride ?? null,
        available: r?.available ?? true,
        updatedAt: r?.updatedAt ?? null,
      })),
      total: all.length,
    });
  }

  findProductBranches(
    productId: string,
    branchIds: readonly string[] | null,
  ): Promise<ProductBranchRow[]> {
    this.calls.push('findProductBranches');
    return Promise.resolve(
      [...this.branches.values()]
        .filter((b) => branchIds === null || branchIds.includes(b.id))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
        .map((b) => {
          const r = this.rowOf(b.id, productId);
          return {
            branchId: b.id,
            code: b.code,
            name: b.name,
            active: b.active,
            priceOverride: r?.priceOverride ?? null,
            available: r?.available ?? true,
            updatedAt: r?.updatedAt ?? null,
          };
        }),
    );
  }

  resolveMany(branchId: string, productIds: readonly string[]): Promise<ResolveRow[]> {
    this.calls.push('resolveMany');
    return Promise.resolve(
      productIds
        .map((id) => this.products.get(id))
        .filter((p): p is FakeProduct => p !== undefined)
        .map((p) => {
          const r = this.rowOf(branchId, p.id);
          return {
            id: p.id,
            active: p.active,
            categoryId: p.categoryId,
            basePrice: p.basePrice,
            price: r?.priceOverride ?? p.basePrice,
            available: r?.available ?? true,
          };
        }),
    );
  }
}
