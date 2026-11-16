import type { PromotionTx, CandidateQuery } from '../../src/promotions/promotions.repository.js';
import type { PromotionsRepository } from '../../src/promotions/promotions.repository.js';
import type {
  NewPromotion,
  ProductBasics,
  PromotionLists,
  PromotionPageFilter,
  PromotionRecord,
  PromotionScalars,
  ScheduleSlot,
  StoreCandidateRecord,
} from '../../src/promotions/promotions.types.js';
import { fold } from '../../src/products/product-policy.js';
import type { FakeBranchProductsRepo } from './fake-branch-products-repo.js';
import { likeToRegExp } from './fake-products-repo.js';

export const prid = (n: number) => `00000000-0000-4000-8000-${String(n + 9000).padStart(12, '0')}`;
export const T0 = new Date('2026-01-01T00:00:00Z');

interface Stored extends Omit<PromotionRecord, 'branches' | 'products' | 'productCount'> {
  branchIds: string[];
  productIds: string[];
}

export const uniqueCode = () =>
  Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
    code: 'P2002',
    meta: { target: ['promotions_code_key'] },
  });

/**
 * Doble en memoria de `PromotionsRepository` (misma superficie). Emula COMMIT/ROLLBACK por instantánea, el UNIQUE de
 * `code`, `lockPromotion` y los filtros del listado. Sucursales y productos salen del `FakeBranchProductsRepo`
 * compartido (el mismo «mundo» que usa `BranchOffersService`). Cuenta llamadas para verificar «sin N+1».
 */
export class FakePromotionsRepo {
  promotions = new Map<string, Stored>();
  audit: Record<string, unknown>[] = [];
  calls: string[] = [];
  failTransactionWith: unknown = null;
  /** Se ejecuta tras bloquear (simula una escritura concurrente entre la lectura y el PATCH). */
  afterLock: (() => void) | null = null;
  private counter = 0;

  constructor(private readonly world: FakeBranchProductsRepo) {}

  count = (name: string) => this.calls.filter((c) => c === name).length;
  asRepository = () => this as unknown as PromotionsRepository;

  seed(over: Partial<Stored> & { id?: string } = {}): Stored {
    this.counter += 1;
    const row: Stored = {
      id: prid(this.counter),
      code: null,
      name: `Promo ${this.counter}`,
      description: null,
      kind: 'PERCENT',
      value: '10.00',
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2027-01-01T00:00:00Z'),
      dineInOnly: false,
      active: true,
      version: 1,
      createdAt: new Date(T0.getTime() + this.counter * 1000),
      updatedAt: T0,
      branchIds: [],
      productIds: [],
      schedule: [],
      ...over,
    };
    this.promotions.set(row.id, row);
    return row;
  }

  async transaction<T>(fn: (tx: PromotionTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const snapshot = new Map(
      [...this.promotions].map(([k, v]) => [
        k,
        {
          ...v,
          branchIds: [...v.branchIds],
          productIds: [...v.productIds],
          schedule: v.schedule.map((s) => ({ ...s })),
        },
      ]),
    );
    const auditLength = this.audit.length;
    const tx = {
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as PromotionTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.audit.length = auditLength;
      this.promotions = snapshot;
      throw error;
    }
  }

  findBranchStatus(id: string): Promise<{ id: string; active: boolean } | null> {
    this.calls.push('findBranchStatus');
    const b = this.world.branches.get(id);
    return Promise.resolve(b ? { id: b.id, active: b.active } : null);
  }

  findBranches(ids: readonly string[]): Promise<{ id: string; name: string }[]> {
    this.calls.push('findBranches');
    return Promise.resolve(
      ids.flatMap((id) => {
        const b = this.world.branches.get(id);
        return b ? [{ id: b.id, name: b.name }] : [];
      }),
    );
  }

  findExistingProductIds(ids: readonly string[]): Promise<string[]> {
    this.calls.push('findExistingProductIds');
    return Promise.resolve(ids.filter((id) => this.world.products.has(id)));
  }

  findProductBasics(ids: readonly string[]): Promise<ProductBasics[]> {
    this.calls.push('findProductBasics');
    return Promise.resolve(
      ids
        .flatMap((id) => {
          const p = this.world.products.get(id);
          return p ? [{ id: p.id, name: p.name, active: p.active, categoryId: p.categoryId }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    );
  }

  lockPromotion(_tx: unknown, id: string): Promise<boolean> {
    this.calls.push('lockPromotion');
    const found = this.promotions.has(id);
    this.afterLock?.();
    return Promise.resolve(found);
  }

  findRecords(ids: readonly string[], opts: { withProducts: boolean }): Promise<PromotionRecord[]> {
    this.calls.push('findRecords');
    return Promise.resolve(
      ids.flatMap((id) => {
        const s = this.promotions.get(id);
        return s ? [this.toRecord(s, opts.withProducts)] : [];
      }),
    );
  }

  private toRecord(s: Stored, withProducts: boolean): PromotionRecord {
    const { branchIds, productIds, ...rest } = s;
    return {
      ...rest,
      schedule: s.schedule.map((x) => ({ ...x })),
      branches: branchIds
        .map((id) => ({ id, name: this.world.branches.get(id)?.name ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      products: withProducts
        ? productIds
            .map((id) => {
              const p = this.world.products.get(id);
              return { id, name: p?.name ?? id, slug: p?.slug ?? id };
            })
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        : [],
      productCount: productIds.length,
    };
  }

  createPromotion(_tx: unknown, data: NewPromotion, now: Date): Promise<string> {
    this.calls.push('createPromotion');
    if (data.code !== null && [...this.promotions.values()].some((p) => p.code === data.code)) {
      return Promise.reject(uniqueCode());
    }
    this.counter += 1;
    const id = prid(this.counter);
    this.promotions.set(id, {
      id,
      code: data.code,
      name: data.name,
      description: data.description,
      kind: data.kind,
      value: data.value,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      dineInOnly: data.dineInOnly,
      active: data.active,
      version: 1,
      createdAt: now,
      updatedAt: now,
      branchIds: [...data.branchIds],
      productIds: [...data.productIds],
      schedule: data.schedule.map((s) => ({ ...s })),
    });
    return Promise.resolve(id);
  }

  savePromotion(
    _tx: unknown,
    id: string,
    scalars: PromotionScalars,
    lists: PromotionLists,
    now: Date,
  ): Promise<void> {
    this.calls.push('savePromotion');
    const cur = this.promotions.get(id);
    if (!cur) return Promise.reject(new Error('fila inexistente'));
    if (
      scalars.code != null &&
      [...this.promotions.values()].some((p) => p.id !== id && p.code === scalars.code)
    ) {
      return Promise.reject(uniqueCode());
    }
    const next: Stored = { ...cur, version: cur.version + 1, updatedAt: now };
    for (const [k, v] of Object.entries(scalars)) {
      if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
    }
    if (lists.branchIds) next.branchIds = [...lists.branchIds];
    if (lists.productIds) next.productIds = [...lists.productIds];
    if (lists.schedule) next.schedule = lists.schedule.map((s: ScheduleSlot) => ({ ...s }));
    this.promotions.set(id, next);
    return Promise.resolve();
  }

  private appliesTo(s: Stored, branchIds: readonly string[]): boolean {
    return s.branchIds.length === 0 || s.branchIds.some((b) => branchIds.includes(b));
  }

  findPage(f: PromotionPageFilter): Promise<{ ids: string[]; total: number }> {
    this.calls.push('findPage');
    if (f.scopeBranchIds !== null && f.scopeBranchIds.length === 0)
      return Promise.resolve({ ids: [], total: 0 });
    const regex = f.pattern ? likeToRegExp(f.pattern) : null;
    const now = f.now.getTime();
    const rows = [...this.promotions.values()]
      .filter((s) => f.scopeBranchIds === null || this.appliesTo(s, f.scopeBranchIds))
      .filter((s) => f.branchId === undefined || this.appliesTo(s, [f.branchId]))
      .filter((s) => f.kind === undefined || s.kind === f.kind)
      .filter((s) => {
        switch (f.status) {
          case 'active':
            return s.active;
          case 'inactive':
            return !s.active;
          case 'scheduled':
            return s.active && s.startsAt.getTime() > now;
          case 'running':
            return s.active && s.startsAt.getTime() <= now && s.endsAt.getTime() > now;
          case 'expired':
            return s.active && s.endsAt.getTime() <= now;
          default:
            return true;
        }
      })
      .filter((s) => f.from === undefined || s.endsAt.getTime() > f.from.getTime())
      .filter((s) => f.to === undefined || s.startsAt.getTime() < f.to.getTime())
      .filter((s) => !regex || [s.name, s.code ?? ''].some((t) => regex.test(fold(t))));
    const dir = f.order === 'asc' ? 1 : -1;
    const key = (s: Stored): string | number =>
      f.sort === 'name'
        ? s.name
        : f.sort === 'endsAt'
          ? s.endsAt.getTime()
          : f.sort === 'createdAt'
            ? s.createdAt.getTime()
            : s.startsAt.getTime();
    rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return (ka < kb ? -1 : 1) * dir;
      return a.id < b.id ? -1 : 1;
    });
    const start = (f.page - 1) * f.pageSize;
    return Promise.resolve({
      ids: rows.slice(start, start + f.pageSize).map((s) => s.id),
      total: rows.length,
    });
  }

  findCandidates(q: CandidateQuery): Promise<StoreCandidateRecord[]> {
    this.calls.push('findCandidates');
    return Promise.resolve(
      [...this.promotions.values()]
        .filter((s) => s.active)
        .filter((s) => s.startsAt.getTime() <= q.startsBefore.getTime())
        .filter((s) => s.endsAt.getTime() > q.endsAfter.getTime())
        .filter((s) => this.appliesTo(s, [q.branchId]))
        .filter(
          (s) =>
            q.codes === 'all' ||
            s.code === null ||
            (q.codes.coupon !== null && s.code === q.codes.coupon),
        )
        .sort(
          (a, b) =>
            (q.codes === 'all' ? 0 : Number(a.code === null) - Number(b.code === null)) ||
            a.startsAt.getTime() - b.startsAt.getTime() ||
            (a.id < b.id ? -1 : 1),
        )
        .slice(0, q.limit)
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          description: s.description,
          kind: s.kind,
          value: s.value,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          dineInOnly: s.dineInOnly,
          active: s.active,
          branchIds: [...s.branchIds],
          productIds: q.omitCouponProducts && s.code !== null ? [] : [...s.productIds],
          hasProducts: s.productIds.length > 0,
          schedule: s.schedule.map((x) => ({ ...x })),
        })),
    );
  }
}
