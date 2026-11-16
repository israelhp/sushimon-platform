import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { folded } from '../products/products.repository.js';
import { loadLinkedPromotions } from './linked-promotions.query.js';
import type {
  BannerAssetRow,
  BannerCtaType,
  BannerLists,
  BannerOrderRow,
  BannerPage,
  BannerPageFilter,
  BannerRecord,
  BannerScalars,
  BannerSort,
  BannerText,
  NewBanner,
} from './banners.types.js';

export type BannerTx = Prisma.TransactionClient;

const INCLUDE = {
  image: { select: { id: true, objectKey: true, mimeType: true, sizeBytes: true } },
  translations: true,
  branches: { select: { branch: { select: { id: true, name: true } } } },
  ctaCategory: { select: { name: true, active: true } },
  ctaProduct: { select: { name: true, active: true } },
} satisfies Prisma.BannerInclude;

const SORT_COLUMNS: Record<Exclude<BannerSort, 'priority'>, string> = {
  startsAt: 'b.starts_at',
  endsAt: 'b.ends_at',
  createdAt: 'b.created_at',
};

const toText = (t: {
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string | null;
}): BannerText => ({
  title: t.title,
  subtitle: t.subtitle,
  ctaLabel: t.ctaLabel,
  imageAlt: t.imageAlt,
});

/**
 * Único punto de acceso a datos de la ADMINISTRACIÓN de banners. Una consulta por lectura (más una acotada para las
 * promociones vinculadas); sin N+1. El reordenado usa un único UPDATE ... FROM unnest.
 */
@Injectable()
export class BannersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** READ COMMITTED explícito; `lock_timeout` local: la espera vence como 55P03 (=> 503 `BANNERS_BUSY`). */
  transaction<T>(fn: (tx: BannerTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
        return fn(tx);
      },
      {
        timeout: 15_000,
        maxWait: 5_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  async findBranchStatus(
    id: string,
    tx?: BannerTx,
  ): Promise<{ id: string; active: boolean } | null> {
    return (tx ?? this.prisma).branch.findUnique({
      where: { id },
      select: { id: true, active: true },
    });
  }

  /** Sucursales existentes entre `ids` (una consulta). */
  async findBranches(
    ids: readonly string[],
    tx?: BannerTx,
  ): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return [];
    return (tx ?? this.prisma).branch.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  }

  async findAsset(id: string, tx?: BannerTx): Promise<BannerAssetRow | null> {
    return (tx ?? this.prisma).mediaAsset.findUnique({
      where: { id },
      select: { id: true, kind: true, status: true },
    });
  }

  /** Destino de catálogo (solo el `active` directo, spec D3). */
  async findCtaTargets(
    ids: { categoryId: string | null; productId: string | null },
    tx?: BannerTx,
  ): Promise<{ category: { active: boolean } | null; product: { active: boolean } | null }> {
    const db = tx ?? this.prisma;
    const [category, product] = await Promise.all([
      ids.categoryId
        ? db.category.findUnique({ where: { id: ids.categoryId }, select: { active: true } })
        : Promise.resolve(null),
      ids.productId
        ? db.product.findUnique({ where: { id: ids.productId }, select: { active: true } })
        : Promise.resolve(null),
    ]);
    return { category, product };
  }

  /** Promoción para validar el alcance (existencia + sucursales). Nunca lee datos del descuento. */
  async findPromotionScope(
    id: string,
    tx?: BannerTx,
  ): Promise<{ id: string; branchIds: string[] } | null> {
    const row = await (tx ?? this.prisma).promotion.findUnique({
      where: { id },
      select: { id: true, branches: { select: { branchId: true } } },
    });
    return row ? { id: row.id, branchIds: row.branches.map((b) => b.branchId) } : null;
  }

  /** Bloquea la fila hasta el fin de la transacción (serializa PATCH concurrentes); `false` si no existe. */
  async lockBanner(tx: BannerTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM app.banners WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  /**
   * Bloqueo transaccional del ORDEN (clave propia, distinta de la jerarquía de categorías 1100110 y del guardián de
   * administradores). Serializa los reordenados: gana uno de los dos órdenes, nunca una mezcla.
   */
  async lockOrder(tx: BannerTx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('app:banners-order', 0))`;
  }

  /** Banners con todas sus hijas y las promociones vinculadas. Orden no garantizado: el llamador reordena. */
  async findRecords(ids: readonly string[], tx?: BannerTx): Promise<BannerRecord[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.prisma;
    const rows = await db.banner.findMany({
      where: { id: { in: [...ids] } },
      include: INCLUDE,
    });
    const promotionIds = [
      ...new Set(rows.flatMap((r) => (r.promotionId === null ? [] : [r.promotionId]))),
    ];
    const promotions = await loadLinkedPromotions(db, promotionIds);
    return rows.map((r) => {
      const es = r.translations.find((t) => t.locale === 'es');
      const en = r.translations.find((t) => t.locale === 'en');
      const target =
        r.ctaType === 'CATEGORY' ? r.ctaCategory : r.ctaType === 'PRODUCT' ? r.ctaProduct : null;
      return {
        id: r.id,
        code: r.code,
        active: r.active,
        sortOrder: r.sortOrder,
        version: r.version,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        image: {
          assetId: r.image.id,
          objectKey: r.image.objectKey,
          mimeType: r.image.mimeType,
          sizeBytes: Number(r.image.sizeBytes),
        },
        cta: {
          type: r.ctaType as BannerCtaType,
          categoryId: r.ctaCategoryId,
          productId: r.ctaProductId,
          page: r.ctaPage as BannerPage | null,
          targetLabel: target ? target.name : null,
          targetActive: target ? target.active : null,
        },
        promotion: r.promotionId === null ? null : (promotions.get(r.promotionId) ?? null),
        branches: r.branches
          .map((b) => b.branch)
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        translations: { es: es ? toText(es) : null, en: en ? toText(en) : null },
      } satisfies BannerRecord;
    });
  }

  /** Banners NO vencidos (`ends_at` nulo o futuro), en orden de prioridad. Acotado por seguridad. */
  async findNonExpired(tx: BannerTx, now: Date): Promise<BannerOrderRow[]> {
    const rows = await tx.$queryRaw<{ id: string; sort_order: number; version: number }[]>`
      SELECT id::text AS id, sort_order, version FROM app.banners
       WHERE ends_at IS NULL OR ends_at > ${now}::timestamptz
       ORDER BY sort_order ASC, created_at ASC, id ASC
       LIMIT 1000`;
    return rows.map((r) => ({
      id: r.id,
      sortOrder: Number(r.sort_order),
      version: Number(r.version),
    }));
  }

  /** Cuántos banners no vencidos hay (excluyendo opcionalmente uno) y el mayor `sort_order` entre ellos. */
  async nonExpiredStats(
    tx: BannerTx,
    now: Date,
    excludeId?: string,
  ): Promise<{ count: number; maxSortOrder: number | null }> {
    const rows = await tx.$queryRaw<{ count: number; max_sort: number | null }[]>`
      SELECT count(*)::int AS count, max(sort_order)::int AS max_sort FROM app.banners
       WHERE (ends_at IS NULL OR ends_at > ${now}::timestamptz)
         AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)`;
    const row = rows[0];
    return { count: row?.count ?? 0, maxSortOrder: row?.max_sort ?? null };
  }

  /** Fija `sort_order` de varios banners en UN statement, sube su `version` en 1 y devuelve la `version` resultante. */
  async applySortOrders(
    tx: BannerTx,
    changes: readonly { id: string; sortOrder: number }[],
    now: Date,
  ): Promise<{ id: string; version: number }[]> {
    if (changes.length === 0) return [];
    const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
      UPDATE app.banners b
         SET sort_order = t.so, version = b.version + 1, updated_at = ${now}::timestamptz
        FROM unnest(${changes.map((c) => c.id)}::uuid[], ${changes.map((c) => c.sortOrder)}::int[]) AS t(id, so)
       WHERE b.id = t.id
      RETURNING b.id::text AS id, b.version`;
    return rows.map((r) => ({ id: r.id, version: Number(r.version) }));
  }

  async createBanner(tx: BannerTx, data: NewBanner, now: Date): Promise<string> {
    const translations = [
      { locale: 'es', ...data.translations.es },
      ...(data.translations.en ? [{ locale: 'en', ...data.translations.en }] : []),
    ];
    const created = await tx.banner.create({
      data: {
        code: data.code,
        imageAssetId: data.imageAssetId,
        ctaType: data.cta.type,
        ctaCategoryId: data.cta.categoryId,
        ctaProductId: data.cta.productId,
        ctaPage: data.cta.page,
        promotionId: data.promotionId,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        active: data.active,
        sortOrder: data.sortOrder,
        createdAt: now,
        updatedAt: now,
        translations: { create: translations },
        branches: { create: data.branchIds.map((branchId) => ({ branchId })) },
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Aplica los cambios y sube `version` en 1 (el llamador ya tiene la fila bloqueada). */
  async saveBanner(
    tx: BannerTx,
    id: string,
    scalars: BannerScalars,
    lists: BannerLists,
    now: Date,
  ): Promise<void> {
    await tx.banner.update({
      where: { id },
      data: {
        ...(scalars.imageAssetId !== undefined ? { imageAssetId: scalars.imageAssetId } : {}),
        ...(scalars.cta !== undefined
          ? {
              ctaType: scalars.cta.type,
              ctaCategoryId: scalars.cta.categoryId,
              ctaProductId: scalars.cta.productId,
              ctaPage: scalars.cta.page,
            }
          : {}),
        ...(scalars.promotionId !== undefined ? { promotionId: scalars.promotionId } : {}),
        ...(scalars.startsAt !== undefined ? { startsAt: scalars.startsAt } : {}),
        ...(scalars.endsAt !== undefined ? { endsAt: scalars.endsAt } : {}),
        ...(scalars.sortOrder !== undefined ? { sortOrder: scalars.sortOrder } : {}),
        ...(scalars.active !== undefined ? { active: scalars.active } : {}),
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (lists.branchIds) {
      await tx.bannerBranch.deleteMany({ where: { bannerId: id } });
      if (lists.branchIds.length > 0) {
        await tx.bannerBranch.createMany({
          data: lists.branchIds.map((branchId) => ({ bannerId: id, branchId })),
        });
      }
    }
    for (const locale of ['es', 'en'] as const) {
      const text = lists.translations?.[locale];
      if (text === undefined) continue;
      if (text === null) {
        await tx.bannerTranslation.deleteMany({ where: { bannerId: id, locale } });
        continue;
      }
      await tx.bannerTranslation.upsert({
        where: { bannerId_locale: { bannerId: id, locale } },
        create: { bannerId: id, locale, ...text },
        update: { ...text },
      });
    }
  }

  /** Página de ids (orden pedido, `id` desempata) + total. Búsqueda con patrón ya escapado (comodines literales). */
  async findPage(f: BannerPageFilter): Promise<{ ids: string[]; total: number }> {
    if (f.scopeBranchIds !== null && f.scopeBranchIds.length === 0) return { ids: [], total: 0 };
    const conditions: Prisma.Sql[] = [];
    const appliesTo = (branchIds: readonly string[]): Prisma.Sql =>
      Prisma.sql`(NOT EXISTS (SELECT 1 FROM app.banner_branches bb0 WHERE bb0.banner_id = b.id)
        OR EXISTS (SELECT 1 FROM app.banner_branches bb1
                    WHERE bb1.banner_id = b.id AND bb1.branch_id = ANY(${[...branchIds]}::uuid[])))`;
    if (f.scopeBranchIds !== null) conditions.push(appliesTo(f.scopeBranchIds));
    if (f.branchId !== undefined) conditions.push(appliesTo([f.branchId]));
    const now = f.now;
    switch (f.lifecycle) {
      case 'INACTIVE':
        conditions.push(Prisma.sql`NOT b.active`);
        break;
      case 'EXPIRED':
        conditions.push(
          Prisma.sql`b.active AND b.ends_at IS NOT NULL AND b.ends_at <= ${now}::timestamptz`,
        );
        break;
      case 'SCHEDULED':
        conditions.push(
          Prisma.sql`b.active AND (b.ends_at IS NULL OR b.ends_at > ${now}::timestamptz)
            AND b.starts_at IS NOT NULL AND b.starts_at > ${now}::timestamptz`,
        );
        break;
      case 'PUBLISHED':
        conditions.push(
          Prisma.sql`b.active AND (b.ends_at IS NULL OR b.ends_at > ${now}::timestamptz)
            AND (b.starts_at IS NULL OR b.starts_at <= ${now}::timestamptz)`,
        );
        break;
      default:
    }
    if (f.pattern) {
      conditions.push(
        Prisma.sql`(${folded('b.code')} LIKE ${f.pattern}::text
          OR EXISTS (SELECT 1 FROM app.banner_translations t
                      WHERE t.banner_id = b.id AND ${folded("coalesce(t.title, '')")} LIKE ${f.pattern}::text))`,
      );
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const direction = Prisma.raw(f.order === 'asc' ? 'ASC' : 'DESC');
    const orderBy =
      f.sort === 'priority'
        ? Prisma.sql`b.sort_order ${direction}, b.created_at ${direction}, b.id ASC`
        : Prisma.sql`${Prisma.raw(SORT_COLUMNS[f.sort])} ${direction} NULLS LAST, b.sort_order ASC, b.created_at ASC, b.id ASC`;
    const offset = (f.page - 1) * f.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT b.id::text AS id FROM app.banners b ${where}
         ORDER BY ${orderBy}
         LIMIT ${f.pageSize}::int OFFSET ${offset}::int`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM app.banners b ${where}`,
    ]);
    return { ids: rows.map((r) => r.id), total: count[0]?.total ?? 0 };
  }
}
