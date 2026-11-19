import { fold } from '../../src/products/product-policy.js';
import type { ProductTx } from '../../src/products/products.repository.js';
import type {
  MediaInput,
  MediaRow,
  NewProductData,
  ProductPageFilter,
  ProductPatch,
  ProductRow,
} from '../../src/products/products.types.js';

/** Convierte un patrón LIKE (con `\` como escape) en una RegExp equivalente. */
export function likeToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern.charAt(i);
    if (ch === '\\') {
      i += 1;
      out += (pattern.charAt(i) || '\\').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '%') out += '[\\s\\S]*';
    else if (ch === '_') out += '[\\s\\S]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export const uniqueViolation = (target: string) =>
  Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: [target] },
  });

/**
 * Doble en memoria de `ProductsRepository` (misma superficie). Emula COMMIT/ROLLBACK por instantánea, el filtro LIKE de
 * la búsqueda y los índices únicos de slug/sku. Cuenta las llamadas para verificar "sin N+1".
 */
export class FakeProductsRepo {
  products = new Map<string, ProductRow>();
  media = new Map<string, MediaRow[]>();
  /** `id -> active` de categorías (las lee `findCategoryState`). */
  categories = new Map<string, { id: string; active: boolean }>();
  calls: string[] = [];
  /** Eventos que `AuditService` escribe vía `tx.auditEvent.create` (se revierten con el ROLLBACK). */
  audit: Record<string, unknown>[] = [];
  /** Si se define, la siguiente escritura (insert/update/replaceMedia) lanza este error. */
  failNextWriteWith: unknown = null;
  failTransactionWith: unknown = null;
  /** F14: assets (`media_assets`) visibles para adjuntar y para enlazar URL de R2. */
  assetSource: () => Iterable<{ id: string; status: string; objectKey: string; kind?: string }> =
    () => [];
  private counter = 1000;

  /** Ids con forma de UUID: las rutas de F14 validan `:mediaId` con ParseUUIDPipe. */
  private nextMediaId(): string {
    return `00000000-0000-4000-9000-${String(++this.counter).padStart(12, '0')}`;
  }

  count = (name: string) => this.calls.filter((c) => c === name).length;

  seed(
    row: ProductRow,
    media: Array<{ url: string; altText?: string | null; assetId?: string | null }> = [],
  ): void {
    this.products.set(row.id, { ...row });
    this.media.set(
      row.id,
      media.map((m, i) => ({
        id: this.nextMediaId(),
        productId: row.id,
        url: m.url,
        altText: m.altText ?? null,
        sortOrder: i,
        assetId: m.assetId ?? null,
      })),
    );
  }

  async transaction<T>(fn: (tx: ProductTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const snapshot = new Map([...this.products].map(([k, v]) => [k, { ...v }]));
    const mediaSnapshot = new Map([...this.media].map(([k, v]) => [k, v.map((m) => ({ ...m }))]));
    const auditLength = this.audit.length;
    const tx = {
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as ProductTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.audit.length = auditLength;
      this.products = snapshot;
      this.media = mediaSnapshot;
      throw error;
    }
  }

  findPage(filter: ProductPageFilter): Promise<{ rows: ProductRow[]; total: number }> {
    this.calls.push('findPage');
    const regex = filter.pattern ? likeToRegExp(filter.pattern) : null;
    let rows = [...this.products.values()]
      .filter((p) => filter.categoryIds === undefined || filter.categoryIds.includes(p.categoryId))
      .filter((p) => filter.active === undefined || p.active === filter.active)
      .filter((p) => {
        if (!regex) return true;
        const fields = [p.name, p.description ?? ''];
        if (filter.searchSku) fields.push(p.sku ?? '');
        if (filter.searchSlug) fields.push(p.slug);
        return fields.some((f) => regex.test(fold(f)));
      });
    const dir = filter.order === 'desc' ? -1 : 1;
    const key = (p: ProductRow): string | number =>
      filter.sort === 'basePrice'
        ? Number(p.basePrice)
        : filter.sort === 'createdAt'
          ? p.createdAt.getTime()
          : p.name;
    rows = rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const primary = ka < kb ? -1 : ka > kb ? 1 : 0;
      return primary * dir || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    const start = (filter.page - 1) * filter.pageSize;
    return Promise.resolve({
      rows: rows.slice(start, start + filter.pageSize).map((r) => ({ ...r })),
      total: rows.length,
    });
  }

  findBySlug(slug: string): Promise<ProductRow | null> {
    this.calls.push('findBySlug');
    const found = [...this.products.values()].find((p) => p.slug === slug);
    return Promise.resolve(found ? { ...found } : null);
  }

  findById(id: string): Promise<ProductRow | null> {
    this.calls.push('findById');
    const found = this.products.get(id);
    return Promise.resolve(found ? { ...found } : null);
  }

  findActiveByIds(
    ids: readonly string[],
    categoryIds: readonly string[],
  ): Promise<{ id: string; name: string; categoryId: string }[]> {
    this.calls.push('findActiveByIds');
    return Promise.resolve(
      [...this.products.values()]
        .filter((p) => ids.includes(p.id) && p.active && categoryIds.includes(p.categoryId))
        .map((p) => ({ id: p.id, name: p.name, categoryId: p.categoryId })),
    );
  }

  findSlugsAndNamesByIds(
    ids: readonly string[],
  ): Promise<{ id: string; slug: string; name: string }[]> {
    this.calls.push('findSlugsAndNames');
    return Promise.resolve(
      [...this.products.values()]
        .filter((p) => ids.includes(p.id) && p.active)
        .map((p) => ({ id: p.id, slug: p.slug, name: p.name })),
    );
  }

  findMediaByProductIds(productIds: readonly string[], firstOnly = false): Promise<MediaRow[]> {
    this.calls.push('findMedia');
    const out: MediaRow[] = [];
    for (const id of productIds)
      for (const m of this.media.get(id) ?? [])
        if (!firstOnly || m.sortOrder === 0) out.push({ ...m });
    return Promise.resolve(out);
  }

  findMediaInTx(_tx: ProductTx, productId: string): Promise<MediaRow[]> {
    this.calls.push('findMediaInTx');
    return Promise.resolve((this.media.get(productId) ?? []).map((m) => ({ ...m })));
  }

  findSlugsByPrefix(_tx: ProductTx, prefix: string): Promise<string[]> {
    this.calls.push('findSlugs');
    return Promise.resolve(
      [...this.products.values()].map((p) => p.slug).filter((s) => s.startsWith(prefix)),
    );
  }

  findCategoryState(_tx: ProductTx, id: string): Promise<{ id: string; active: boolean } | null> {
    this.calls.push('findCategory');
    return Promise.resolve(this.categories.get(id) ?? null);
  }

  lockProduct(_tx: ProductTx, id: string): Promise<boolean> {
    this.calls.push('lock');
    return Promise.resolve(this.products.has(id));
  }

  private maybeFail(): void {
    if (this.failNextWriteWith) {
      const error = this.failNextWriteWith;
      this.failNextWriteWith = null;
      throw error as Error;
    }
  }

  insert(_tx: ProductTx, data: NewProductData): Promise<ProductRow> {
    this.calls.push('insert');
    this.maybeFail();
    for (const p of this.products.values()) {
      if (p.slug === data.slug) throw uniqueViolation('products_slug_key');
      if (data.sku !== null && p.sku === data.sku) throw uniqueViolation('products_sku_key');
    }
    this.counter += 1;
    const now = new Date('2026-02-01T00:00:00Z');
    const row: ProductRow = {
      id: `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.products.set(row.id, row);
    this.media.set(row.id, []);
    return Promise.resolve({ ...row });
  }

  update(_tx: ProductTx, id: string, data: ProductPatch): Promise<ProductRow> {
    this.calls.push('update');
    this.maybeFail();
    for (const p of this.products.values()) {
      if (p.id === id) continue;
      if (data.slug !== undefined && p.slug === data.slug)
        throw uniqueViolation('products_slug_key');
      if (data.sku !== undefined && data.sku !== null && p.sku === data.sku)
        throw uniqueViolation('products_sku_key');
    }
    const next = { ...(this.products.get(id) as ProductRow), ...data };
    this.products.set(id, next);
    return Promise.resolve({ ...next });
  }

  replaceMedia(
    _tx: ProductTx,
    productId: string,
    items: readonly MediaInput[],
  ): Promise<MediaRow[]> {
    this.calls.push('replaceMedia');
    this.maybeFail();
    const rows = items.map((m, i) => ({
      id: this.nextMediaId(),
      productId,
      url: m.url,
      altText: m.altText,
      sortOrder: i,
      assetId: m.assetId ?? null,
    }));
    this.media.set(productId, rows);
    return Promise.resolve(rows.map((r) => ({ ...r })));
  }

  // ---------- F14 ----------

  findAsset(
    _tx: ProductTx,
    id: string,
  ): Promise<{ id: string; status: string; kind: string; objectKey: string } | null> {
    this.calls.push('findAsset');
    const found = [...this.assetSource()].find((a) => a.id === id);
    return Promise.resolve(found ? { kind: 'PRODUCT_IMAGE', ...found } : null);
  }

  findReadyAssetsByKeys(
    _tx: ProductTx,
    keys: readonly string[],
  ): Promise<{ id: string; objectKey: string }[]> {
    this.calls.push('findReadyAssetsByKeys');
    return Promise.resolve(
      [...this.assetSource()]
        .filter(
          (a) =>
            a.status === 'READY' &&
            (a.kind ?? 'PRODUCT_IMAGE') === 'PRODUCT_IMAGE' &&
            keys.includes(a.objectKey),
        )
        .map((a) => ({ id: a.id, objectKey: a.objectKey })),
    );
  }

  insertMedia(
    _tx: ProductTx,
    data: {
      productId: string;
      mediaUrl: string;
      altText: string | null;
      sortOrder: number;
      assetId: string;
    },
  ): Promise<MediaRow> {
    this.calls.push('insertMedia');
    this.maybeFail();
    const list = this.media.get(data.productId) ?? [];
    if (list.some((m) => m.sortOrder === data.sortOrder))
      throw uniqueViolation('product_media_product_sort_key');
    const row: MediaRow = {
      id: this.nextMediaId(),
      productId: data.productId,
      url: data.mediaUrl,
      altText: data.altText,
      sortOrder: data.sortOrder,
      assetId: data.assetId,
    };
    this.media.set(data.productId, [...list, row]);
    return Promise.resolve({ ...row });
  }

  updateMediaAlt(_tx: ProductTx, id: string, altText: string | null): Promise<MediaRow> {
    this.calls.push('updateMediaAlt');
    this.maybeFail();
    for (const [productId, list] of this.media) {
      const found = list.find((m) => m.id === id);
      if (found) {
        found.altText = altText;
        this.media.set(productId, list);
        return Promise.resolve({ ...found });
      }
    }
    return Promise.reject(new Error('media inexistente'));
  }

  deleteMedia(_tx: ProductTx, id: string): Promise<void> {
    this.calls.push('deleteMedia');
    this.maybeFail();
    for (const [productId, list] of this.media) {
      if (list.some((m) => m.id === id)) {
        this.media.set(
          productId,
          list.filter((m) => m.id !== id),
        );
      }
    }
    return Promise.resolve();
  }

  setMediaOrder(_tx: ProductTx, productId: string, orderedIds: readonly string[]): Promise<void> {
    this.calls.push('setMediaOrder');
    this.maybeFail();
    const list = this.media.get(productId) ?? [];
    orderedIds.forEach((id, index) => {
      const found = list.find((m) => m.id === id);
      if (found) found.sortOrder = index;
    });
    this.media.set(
      productId,
      [...list].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return Promise.resolve();
  }
}
