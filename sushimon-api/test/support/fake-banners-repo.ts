import type { BannerTx, BannersRepository } from '../../src/banners/banners.repository.js';
import type {
  BannersReadRepository,
  CandidateQuery,
} from '../../src/banners/banners-read.repository.js';
import type {
  BannerAssetRow,
  BannerCta,
  BannerLists,
  BannerOrderRow,
  BannerPageFilter,
  BannerRecord,
  BannerScalars,
  BannerText,
  LinkedPromotion,
  NewBanner,
  StoreCandidate,
} from '../../src/banners/banners.types.js';
import { fold } from '../../src/products/product-policy.js';
import { likeToRegExp } from './fake-products-repo.js';

export const bnid = (n: number) => `00000000-0000-4000-8000-${String(n + 12000).padStart(12, '0')}`;
export const assetid = (n: number) =>
  `00000000-0000-4000-8000-${String(n + 13000).padStart(12, '0')}`;
export const catid = (n: number) =>
  `00000000-0000-4000-8000-${String(n + 14000).padStart(12, '0')}`;
export const prodid = (n: number) =>
  `00000000-0000-4000-8000-${String(n + 15000).padStart(12, '0')}`;
export const promoid = (n: number) =>
  `00000000-0000-4000-8000-${String(n + 16000).padStart(12, '0')}`;
export const T0 = new Date('2026-01-01T00:00:00Z');

export interface StoredBanner {
  id: string;
  code: string;
  active: boolean;
  sortOrder: number;
  version: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  imageAssetId: string;
  cta: BannerCta;
  promotionId: string | null;
  branchIds: string[];
  es: BannerText | null;
  en: BannerText | null;
}

export interface FakeAsset extends BannerAssetRow {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
}

export const text = (over: Partial<BannerText> = {}): BannerText => ({
  title: 'Título',
  subtitle: null,
  ctaLabel: null,
  imageAlt: 'Texto alternativo',
  ...over,
});

export const uniqueCodeError = () =>
  Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
    code: 'P2002',
    meta: { target: ['banners_code_key'] },
  });

const copy = (b: StoredBanner): StoredBanner => ({
  ...b,
  cta: { ...b.cta },
  branchIds: [...b.branchIds],
  es: b.es ? { ...b.es } : null,
  en: b.en ? { ...b.en } : null,
});

/**
 * Doble en memoria de `BannersRepository` Y `BannersReadRepository` (misma superficie de ambos). Emula COMMIT/ROLLBACK por
 * instantánea, el UNIQUE de `code`, el candado de fila/orden y los filtros de la lectura pública y del listado. El mundo
 * (sucursales, activos, categorías, productos, promociones) se siembra con los métodos `seed*`. Cuenta llamadas.
 */
export class FakeBannersRepo {
  banners = new Map<string, StoredBanner>();
  assets = new Map<string, FakeAsset>();
  categories = new Map<string, { id: string; name: string; slug: string; active: boolean }>();
  products = new Map<string, { id: string; name: string; active: boolean }>();
  promotions = new Map<string, LinkedPromotion>();
  branches = new Map<string, { id: string; name: string; active: boolean }>();
  audit: Record<string, unknown>[] = [];
  calls: string[] = [];
  failTransactionWith: unknown = null;
  failReadWith: unknown = null;
  /** Se ejecuta tras bloquear (simula una escritura concurrente entre la lectura y el PATCH). */
  afterLock: (() => void) | null = null;
  /** Se ejecuta tras tomar el candado de orden. */
  afterOrderLock: (() => void) | null = null;
  private counter = 0;

  count = (name: string) => this.calls.filter((c) => c === name).length;
  asRepository = () => this as unknown as BannersRepository;
  asReadRepository = () => this as unknown as BannersReadRepository;

  seedBranch(id: string, name: string, active = true): void {
    this.branches.set(id, { id, name, active });
  }

  seedAsset(n: number, over: Partial<FakeAsset> = {}): FakeAsset {
    const id = assetid(n);
    const asset: FakeAsset = {
      id,
      kind: 'BANNER_IMAGE',
      status: 'READY',
      objectKey: `banners/2026/${id}.webp`,
      mimeType: 'image/webp',
      sizeBytes: 200_000,
      ...over,
    };
    this.assets.set(id, asset);
    return asset;
  }

  seedCategory(n: number, over: Partial<{ name: string; slug: string; active: boolean }> = {}) {
    const row = {
      id: catid(n),
      name: `Categoría ${n}`,
      slug: `categoria-${n}`,
      active: true,
      ...over,
    };
    this.categories.set(row.id, row);
    return row;
  }

  seedProduct(n: number, over: Partial<{ name: string; active: boolean }> = {}) {
    const row = { id: prodid(n), name: `Producto ${n}`, active: true, ...over };
    this.products.set(row.id, row);
    return row;
  }

  seedPromotion(n: number, over: Partial<LinkedPromotion> = {}): LinkedPromotion {
    const row: LinkedPromotion = {
      id: promoid(n),
      name: `Promo ${n}`,
      active: true,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2027-01-01T00:00:00Z'),
      branchIds: [],
      schedule: [],
      ...over,
    };
    this.promotions.set(row.id, row);
    return row;
  }

  seed(over: Partial<StoredBanner> = {}): StoredBanner {
    this.counter += 1;
    const n = this.counter;
    const asset = [...this.assets.values()][0] ?? this.seedAsset(n);
    const row: StoredBanner = {
      id: bnid(n),
      code: `banner-${n}`,
      active: true,
      sortOrder: n - 1,
      version: 1,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(T0.getTime() + n * 1000),
      updatedAt: T0,
      imageAssetId: asset.id,
      cta: { type: 'NONE', categoryId: null, productId: null, page: null },
      promotionId: null,
      branchIds: [],
      es: text({ title: `Banner ${n}` }),
      en: null,
      ...over,
    };
    this.banners.set(row.id, row);
    return row;
  }

  // ---------- transacciones y candados ----------

  /** Candado de orden emulado: serializa las transacciones que lo toman hasta su fin (como `pg_advisory_xact_lock`). */
  private orderMutex: Promise<void> = Promise.resolve();

  async transaction<T>(fn: (tx: BannerTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const snapshot = new Map([...this.banners].map(([k, v]) => [k, copy(v)]));
    const auditLength = this.audit.length;
    const state: { dirty: boolean; release: (() => void) | null } = { dirty: false, release: null };
    const tx = {
      __state: state,
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as BannerTx;
    try {
      return await fn(tx);
    } catch (error) {
      // Solo revierte si ESTA transacción escribió (otra concurrente pudo confirmar mientras tanto).
      if (state.dirty) {
        this.audit.length = auditLength;
        this.banners = snapshot;
      }
      throw error;
    } finally {
      state.release?.();
    }
  }

  private markDirty(tx: unknown): void {
    const state = (tx as { __state?: { dirty: boolean } } | undefined)?.__state;
    if (state) state.dirty = true;
  }

  lockBanner(_tx: unknown, id: string): Promise<boolean> {
    this.calls.push('lockBanner');
    const found = this.banners.has(id);
    this.afterLock?.();
    return Promise.resolve(found);
  }

  async lockOrder(tx?: unknown): Promise<void> {
    this.calls.push('lockOrder');
    const state = (tx as { __state?: { release: (() => void) | null } } | undefined)?.__state;
    if (state && !state.release) {
      const previous = this.orderMutex;
      let release!: () => void;
      this.orderMutex = new Promise<void>((resolve) => (release = resolve));
      state.release = release;
      await previous;
    }
    this.afterOrderLock?.();
  }

  // ---------- lecturas ----------

  private guardRead(): void {
    if (this.failReadWith) throw this.failReadWith as Error;
  }

  findBranchStatus(id: string): Promise<{ id: string; active: boolean } | null> {
    this.calls.push('findBranchStatus');
    const b = this.branches.get(id);
    return Promise.resolve(b ? { id: b.id, active: b.active } : null);
  }

  findBranches(ids: readonly string[]): Promise<{ id: string; name: string }[]> {
    this.calls.push('findBranches');
    return Promise.resolve(
      ids.flatMap((id) => {
        const b = this.branches.get(id);
        return b ? [{ id: b.id, name: b.name }] : [];
      }),
    );
  }

  findAsset(id: string): Promise<BannerAssetRow | null> {
    this.calls.push('findAsset');
    const a = this.assets.get(id);
    return Promise.resolve(a ? { id: a.id, kind: a.kind, status: a.status } : null);
  }

  findCtaTargets(ids: { categoryId: string | null; productId: string | null }) {
    this.calls.push('findCtaTargets');
    const category = ids.categoryId ? (this.categories.get(ids.categoryId) ?? null) : null;
    const product = ids.productId ? (this.products.get(ids.productId) ?? null) : null;
    return Promise.resolve({
      category: category ? { active: category.active } : null,
      product: product ? { active: product.active } : null,
    });
  }

  findPromotionScope(id: string): Promise<{ id: string; branchIds: string[] } | null> {
    this.calls.push('findPromotionScope');
    const p = this.promotions.get(id);
    return Promise.resolve(p ? { id: p.id, branchIds: [...p.branchIds] } : null);
  }

  findRecords(ids: readonly string[]): Promise<BannerRecord[]> {
    this.calls.push('findRecords');
    this.guardRead();
    return Promise.resolve(
      ids.flatMap((id) => {
        const s = this.banners.get(id);
        return s ? [this.toRecord(s)] : [];
      }),
    );
  }

  private toRecord(s: StoredBanner): BannerRecord {
    const asset = this.assets.get(s.imageAssetId) as FakeAsset;
    const target =
      s.cta.type === 'CATEGORY' && s.cta.categoryId
        ? this.categories.get(s.cta.categoryId)
        : s.cta.type === 'PRODUCT' && s.cta.productId
          ? this.products.get(s.cta.productId)
          : undefined;
    return {
      id: s.id,
      code: s.code,
      active: s.active,
      sortOrder: s.sortOrder,
      version: s.version,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      image: {
        assetId: asset.id,
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      },
      cta: {
        ...s.cta,
        targetLabel: target ? target.name : null,
        targetActive: target ? target.active : null,
      },
      promotion: s.promotionId ? (this.promotions.get(s.promotionId) ?? null) : null,
      branches: s.branchIds
        .map((id) => ({ id, name: this.branches.get(id)?.name ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      translations: { es: s.es ? { ...s.es } : null, en: s.en ? { ...s.en } : null },
    };
  }

  private byPriority = (a: StoredBanner, b: StoredBanner): number =>
    a.sortOrder - b.sortOrder ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  findNonExpired(_tx: unknown, now: Date): Promise<BannerOrderRow[]> {
    this.calls.push('findNonExpired');
    return Promise.resolve(
      [...this.banners.values()]
        .filter((b) => b.endsAt === null || b.endsAt.getTime() > now.getTime())
        .sort(this.byPriority)
        .map((b) => ({ id: b.id, sortOrder: b.sortOrder, version: b.version })),
    );
  }

  nonExpiredStats(
    _tx: unknown,
    now: Date,
    excludeId?: string,
  ): Promise<{ count: number; maxSortOrder: number | null }> {
    this.calls.push('nonExpiredStats');
    const rows = [...this.banners.values()].filter(
      (b) => (b.endsAt === null || b.endsAt.getTime() > now.getTime()) && b.id !== excludeId,
    );
    return Promise.resolve({
      count: rows.length,
      maxSortOrder: rows.length === 0 ? null : Math.max(...rows.map((r) => r.sortOrder)),
    });
  }

  // ---------- escrituras ----------

  applySortOrders(
    tx: unknown,
    changes: readonly { id: string; sortOrder: number }[],
    now: Date,
  ): Promise<{ id: string; version: number }[]> {
    this.calls.push('applySortOrders');
    this.markDirty(tx);
    return Promise.resolve(
      changes.map((c) => {
        const cur = this.banners.get(c.id) as StoredBanner;
        const next = { ...cur, sortOrder: c.sortOrder, version: cur.version + 1, updatedAt: now };
        this.banners.set(c.id, next);
        return { id: c.id, version: next.version };
      }),
    );
  }

  createBanner(tx: unknown, data: NewBanner, now: Date): Promise<string> {
    this.calls.push('createBanner');
    this.markDirty(tx);
    if ([...this.banners.values()].some((b) => b.code === data.code))
      return Promise.reject(uniqueCodeError());
    this.counter += 1;
    const id = bnid(this.counter);
    this.banners.set(id, {
      id,
      code: data.code,
      active: data.active,
      sortOrder: data.sortOrder,
      version: 1,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      createdAt: now,
      updatedAt: now,
      imageAssetId: data.imageAssetId,
      cta: { ...data.cta },
      promotionId: data.promotionId,
      branchIds: [...data.branchIds],
      es: { ...data.translations.es },
      en: data.translations.en ? { ...data.translations.en } : null,
    });
    return Promise.resolve(id);
  }

  saveBanner(
    tx: unknown,
    id: string,
    scalars: BannerScalars,
    lists: BannerLists,
    now: Date,
  ): Promise<void> {
    this.calls.push('saveBanner');
    this.markDirty(tx);
    const cur = this.banners.get(id);
    if (!cur) return Promise.reject(new Error('fila inexistente'));
    const next: StoredBanner = { ...copy(cur), version: cur.version + 1, updatedAt: now };
    if (scalars.imageAssetId !== undefined) next.imageAssetId = scalars.imageAssetId;
    if (scalars.cta !== undefined) next.cta = { ...scalars.cta };
    if (scalars.promotionId !== undefined) next.promotionId = scalars.promotionId;
    if (scalars.startsAt !== undefined) next.startsAt = scalars.startsAt;
    if (scalars.endsAt !== undefined) next.endsAt = scalars.endsAt;
    if (scalars.sortOrder !== undefined) next.sortOrder = scalars.sortOrder;
    if (scalars.active !== undefined) next.active = scalars.active;
    if (lists.branchIds) next.branchIds = [...lists.branchIds];
    if (lists.translations?.es) next.es = { ...lists.translations.es };
    if (lists.translations && 'en' in lists.translations)
      next.en = lists.translations.en ? { ...lists.translations.en } : null;
    this.banners.set(id, next);
    return Promise.resolve();
  }

  // ---------- listado ----------

  private appliesTo(s: StoredBanner, branchIds: readonly string[]): boolean {
    return s.branchIds.length === 0 || s.branchIds.some((b) => branchIds.includes(b));
  }

  findPage(f: BannerPageFilter): Promise<{ ids: string[]; total: number }> {
    this.calls.push('findPage');
    this.guardRead();
    if (f.scopeBranchIds !== null && f.scopeBranchIds.length === 0)
      return Promise.resolve({ ids: [], total: 0 });
    const regex = f.pattern ? likeToRegExp(f.pattern) : null;
    const now = f.now.getTime();
    const lifecycle = (s: StoredBanner): string =>
      !s.active
        ? 'INACTIVE'
        : s.endsAt !== null && s.endsAt.getTime() <= now
          ? 'EXPIRED'
          : s.startsAt !== null && s.startsAt.getTime() > now
            ? 'SCHEDULED'
            : 'PUBLISHED';
    const rows = [...this.banners.values()]
      .filter((s) => f.scopeBranchIds === null || this.appliesTo(s, f.scopeBranchIds))
      .filter((s) => f.branchId === undefined || this.appliesTo(s, [f.branchId]))
      .filter((s) => f.lifecycle === undefined || lifecycle(s) === f.lifecycle)
      .filter(
        (s) =>
          !regex || [s.code, s.es?.title ?? '', s.en?.title ?? ''].some((t) => regex.test(fold(t))),
      );
    const dir = f.order === 'asc' ? 1 : -1;
    const time = (d: Date | null): number => (d === null ? Number.POSITIVE_INFINITY : d.getTime());
    rows.sort((a, b) => {
      if (f.sort === 'priority') {
        const byPriority =
          (a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()) * dir;
        return byPriority || (a.id < b.id ? -1 : 1);
      }
      const key = (s: StoredBanner): number =>
        f.sort === 'startsAt'
          ? time(s.startsAt)
          : f.sort === 'endsAt'
            ? time(s.endsAt)
            : s.createdAt.getTime();
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb)
        return ka === Number.POSITIVE_INFINITY
          ? 1
          : kb === Number.POSITIVE_INFINITY
            ? -1
            : (ka < kb ? -1 : 1) * dir;
      return this.byPriority(a, b);
    });
    const start = (f.page - 1) * f.pageSize;
    return Promise.resolve({
      ids: rows.slice(start, start + f.pageSize).map((s) => s.id),
      total: rows.length,
    });
  }

  // ---------- lectura pública ----------

  findStoreCandidates(q: CandidateQuery): Promise<StoreCandidate[]> {
    this.calls.push('findStoreCandidates');
    this.guardRead();
    const now = q.now.getTime();
    return Promise.resolve(
      [...this.banners.values()]
        .filter((b) => b.active)
        .filter((b) => b.endsAt === null || b.endsAt.getTime() > now)
        .filter((b) => b.startsAt === null || b.startsAt.getTime() <= q.horizon.getTime())
        .filter(
          (b) =>
            b.branchIds.length === 0 || (q.branchId !== null && b.branchIds.includes(q.branchId)),
        )
        .filter((b) => {
          const a = this.assets.get(b.imageAssetId);
          return a !== undefined && a.status === 'READY' && a.kind === 'BANNER_IMAGE';
        })
        .filter((b) => b.es !== null && b.es.title !== null && b.es.imageAlt !== null)
        .sort(this.byPriority)
        .slice(0, q.limit)
        .map((b) => {
          const asset = this.assets.get(b.imageAssetId) as FakeAsset;
          const category = b.cta.categoryId ? this.categories.get(b.cta.categoryId) : undefined;
          const product = b.cta.productId ? this.products.get(b.cta.productId) : undefined;
          return {
            id: b.id,
            sortOrder: b.sortOrder,
            createdAt: b.createdAt,
            startsAt: b.startsAt,
            endsAt: b.endsAt,
            ctaType: b.cta.type,
            categorySlug: category ? category.slug : null,
            productId: b.cta.productId,
            page: b.cta.page,
            targetActive:
              b.cta.type === 'CATEGORY'
                ? (category?.active ?? false)
                : b.cta.type === 'PRODUCT'
                  ? (product?.active ?? false)
                  : null,
            promotionId: b.promotionId,
            imageObjectKey: asset.objectKey,
            imageMimeType: asset.mimeType,
            translations: { es: b.es ? { ...b.es } : null, en: b.en ? { ...b.en } : null },
          };
        }),
    );
  }

  findLinkedPromotions(ids: readonly string[]): Promise<Map<string, LinkedPromotion>> {
    this.calls.push('findLinkedPromotions');
    const out = new Map<string, LinkedPromotion>();
    for (const id of ids) {
      const p = this.promotions.get(id);
      if (p) out.set(id, p);
    }
    return Promise.resolve(out);
  }
}
