import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SQL_ACCENTS_FROM, SQL_ACCENTS_TO } from './product-policy.js';
import type {
  MediaInput,
  MediaRow,
  NewProductData,
  ProductPageFilter,
  ProductPatch,
  ProductRow,
} from './products.types.js';

export type ProductTx = Prisma.TransactionClient;

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  categoryId: true,
  slug: true,
  name: true,
  description: true,
  basePrice: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

const MEDIA_SELECT = {
  id: true,
  productId: true,
  mediaUrl: true,
  altText: true,
  sortOrder: true,
  assetId: true,
} satisfies Prisma.ProductMediaSelect;

type DbProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type DbMedia = Prisma.ProductMediaGetPayload<{ select: typeof MEDIA_SELECT }>;

const toRow = (p: DbProduct): ProductRow => ({ ...p, basePrice: p.basePrice.toFixed(2) });
const toMedia = (m: DbMedia): MediaRow => ({
  id: m.id,
  productId: m.productId,
  url: m.mediaUrl,
  altText: m.altText,
  sortOrder: m.sortOrder,
  assetId: m.assetId,
});

interface RawProduct {
  id: string;
  sku: string | null;
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

const rawToRow = (r: RawProduct): ProductRow => ({
  id: r.id,
  sku: r.sku,
  categoryId: r.category_id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  basePrice: r.base_price,
  active: r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Columnas permitidas para ordenar (lista blanca: jamás se interpola texto del cliente). */
const SORT_COLUMN = {
  name: Prisma.raw('p.name'),
  basePrice: Prisma.raw('p.base_price'),
  createdAt: Prisma.raw('p.created_at'),
} as const;

/** `lower(translate(col, …))`: contiene sin mayúsculas ni acentos usando solo funciones del núcleo de PostgreSQL. */
export const folded = (column: string): Prisma.Sql =>
  Prisma.sql`lower(translate(${Prisma.raw(column)}, ${SQL_ACCENTS_FROM}::text, ${SQL_ACCENTS_TO}::text))`;

/** Único punto de acceso a datos de productos: una consulta por lectura, selects mínimos. */
@Injectable()
export class ProductsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: ProductTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
  }

  /**
   * Una página (más su total) con filtros de categoría/estado/búsqueda. SQL parametrizado: `pattern` ya viene plegado y
   * con `\ % _` escapados ; el orden sale de una lista blanca; `id` desempata siempre.
   */
  async findPage(filter: ProductPageFilter): Promise<{ rows: ProductRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [];
    if (filter.categoryIds !== undefined) {
      conditions.push(Prisma.sql`p.category_id = ANY(${[...filter.categoryIds]}::uuid[])`);
    }
    if (filter.active !== undefined) conditions.push(Prisma.sql`p.active = ${filter.active}`);
    if (filter.pattern) {
      // LIKE usa `\` como escape por defecto: el patrón ya trae `\%`, `\_` y `\\` escapados.
      const like = (column: string) => Prisma.sql`${folded(column)} LIKE ${filter.pattern}::text`;
      const fields = ['p.name', "coalesce(p.description, '')"];
      if (filter.searchSku) fields.push("coalesce(p.sku, '')");
      if (filter.searchSlug) fields.push('p.slug');
      conditions.push(Prisma.sql`(${Prisma.join(fields.map(like), ' OR ')})`);
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const direction = Prisma.raw(filter.order === 'desc' ? 'DESC' : 'ASC');
    const offset = (filter.page - 1) * filter.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<RawProduct[]>`
        SELECT p.id, p.sku, p.category_id, p.slug, p.name, p.description, p.base_price::text AS base_price,
               p.active, p.created_at, p.updated_at
          FROM app.products p ${where}
         ORDER BY ${SORT_COLUMN[filter.sort]} ${direction}, p.id ASC
         LIMIT ${filter.pageSize}::int OFFSET ${offset}::int`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM app.products p ${where}`,
    ]);
    return { rows: rows.map(rawToRow), total: count[0]?.total ?? 0 };
  }

  async findBySlug(slug: string): Promise<ProductRow | null> {
    const row = await this.prisma.product.findUnique({ where: { slug }, select: PRODUCT_SELECT });
    return row ? toRow(row) : null;
  }

  async findById(id: string, tx?: ProductTx): Promise<ProductRow | null> {
    const row = await (tx ?? this.prisma).product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    return row ? toRow(row) : null;
  }

  /** Productos ACTIVOS de esas categorías, por ids (resumen mínimo para favoritos y futuros consumidores). */
  async findActiveByIds(
    ids: readonly string[],
    categoryIds: readonly string[],
  ): Promise<{ id: string; name: string; categoryId: string }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: [...ids] }, active: true, categoryId: { in: [...categoryIds] } },
      select: { id: true, name: true, categoryId: true },
    });
  }

  /** Media de varios productos en UNA consulta (orden: producto, sort_order). Con `firstOnly`, solo `sort_order = 0`. */
  async findMediaByProductIds(
    productIds: readonly string[],
    firstOnly = false,
  ): Promise<MediaRow[]> {
    if (productIds.length === 0) return [];
    const rows = await this.prisma.productMedia.findMany({
      where: { productId: { in: [...productIds] }, ...(firstOnly ? { sortOrder: 0 } : {}) },
      select: MEDIA_SELECT,
      orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map(toMedia);
  }

  async findMediaInTx(tx: ProductTx, productId: string): Promise<MediaRow[]> {
    const rows = await tx.productMedia.findMany({
      where: { productId },
      select: MEDIA_SELECT,
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toMedia);
  }

  /** Slugs ocupados que empiezan por `prefix` (solo `[a-z0-9-]`: sin comodines). Acotado. */
  async findSlugsByPrefix(tx: ProductTx, prefix: string): Promise<string[]> {
    const rows = await tx.product.findMany({
      where: { slug: { startsWith: prefix } },
      select: { slug: true },
      take: 1000,
    });
    return rows.map((r) => r.slug);
  }

  findCategoryState(tx: ProductTx, id: string): Promise<{ id: string; active: boolean } | null> {
    return tx.category.findUnique({ where: { id }, select: { id: true, active: true } });
  }

  /** Bloquea la fila (serializa PATCH concurrentes y las inserciones de media del mismo producto). `false` si no existe. */
  async lockProduct(tx: ProductTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.products WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  async insert(tx: ProductTx, data: NewProductData): Promise<ProductRow> {
    return toRow(await tx.product.create({ data, select: PRODUCT_SELECT }));
  }

  async update(tx: ProductTx, id: string, data: ProductPatch): Promise<ProductRow> {
    return toRow(await tx.product.update({ where: { id }, data, select: PRODUCT_SELECT }));
  }

  /**
   * Reemplaza TODA la lista: DELETE y luego INSERT en la misma transacción (el trigger de tope exige borrar antes de
   * insertar; la UNIQUE (product_id, sort_order) es DEFERRABLE, así que no hay choque intermedio). Sin upsert/ON CONFLICT.
   */
  async replaceMedia(
    tx: ProductTx,
    productId: string,
    items: readonly MediaInput[],
  ): Promise<MediaRow[]> {
    await tx.productMedia.deleteMany({ where: { productId } });
    if (items.length === 0) return [];
    const rows = await tx.productMedia.createManyAndReturn({
      data: items.map((m, i) => ({
        productId,
        mediaUrl: m.url,
        altText: m.altText,
        sortOrder: i,
        assetId: m.assetId ?? null,
      })),
      select: MEDIA_SELECT,
    });
    return rows.map(toMedia).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // ---------- F14: imágenes individuales (asociar, editar, ordenar, desvincular) ----------

  /** Asset para adjuntar (la fila de `media_assets` solo se lee: su ciclo de vida es de `src/media`). */
  async findAsset(
    tx: ProductTx,
    id: string,
  ): Promise<{ id: string; status: string; objectKey: string } | null> {
    return tx.mediaAsset.findUnique({
      where: { id },
      select: { id: true, status: true, objectKey: true },
    });
  }

  /** Assets READY por clave de objeto (una consulta): enlace automático de URL de R2 en `PATCH media`. */
  findReadyAssetsByKeys(
    tx: ProductTx,
    keys: readonly string[],
  ): Promise<{ id: string; objectKey: string }[]> {
    if (keys.length === 0) return Promise.resolve([]);
    return tx.mediaAsset.findMany({
      where: { objectKey: { in: [...keys] }, status: 'READY' },
      select: { id: true, objectKey: true },
    });
  }

  async insertMedia(
    tx: ProductTx,
    data: {
      productId: string;
      mediaUrl: string;
      altText: string | null;
      sortOrder: number;
      assetId: string;
    },
  ): Promise<MediaRow> {
    return toMedia(await tx.productMedia.create({ data, select: MEDIA_SELECT }));
  }

  async updateMediaAlt(tx: ProductTx, id: string, altText: string | null): Promise<MediaRow> {
    return toMedia(
      await tx.productMedia.update({ where: { id }, data: { altText }, select: MEDIA_SELECT }),
    );
  }

  async deleteMedia(tx: ProductTx, id: string): Promise<void> {
    await tx.productMedia.delete({ where: { id } });
  }

  /**
   * Asigna `sort_order = índice` a cada id (UPDATE por fila, sin upsert/ON CONFLICT). `UNIQUE (product_id, sort_order)`
   * es DEFERRABLE INITIALLY DEFERRED (0012): se comprueba al COMMIT, así que los pasos intermedios no chocan.
   */
  async setMediaOrder(
    tx: ProductTx,
    productId: string,
    orderedIds: readonly string[],
  ): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx.productMedia.updateMany({ where: { id, productId }, data: { sortOrder: index } });
    }
  }
}
