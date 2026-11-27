import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { BannerAssetRow, BannerRecord, BannerScalars, NewBanner } from './banners.types.js';

export type BannerTx = Prisma.TransactionClient;

/** Cota de seguridad del listado: el tope es 5, pero filas históricas podrían exceder (el trigger solo frena INSERT). */
const LIST_LIMIT = 100;

const INCLUDE = {
  image: { select: { id: true, objectKey: true, mimeType: true, sizeBytes: true } },
  translations: { where: { locale: 'es' }, select: { imageAlt: true } },
} satisfies Prisma.BannerInclude;

type BannerRow = Prisma.BannerGetPayload<{ include: typeof INCLUDE }>;

const toRecord = (r: BannerRow): BannerRecord => ({
  id: r.id,
  active: r.active,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  imageAlt: r.translations[0]?.imageAlt ?? '',
  image: {
    assetId: r.image.id,
    objectKey: r.image.objectKey,
    mimeType: r.image.mimeType,
    sizeBytes: Number(r.image.sizeBytes),
  },
});

/**
 * Único punto de acceso a datos de la ADMINISTRACIÓN de banners. Una consulta por lectura; sin N+1. Ignora las columnas
 * en desuso (cta_*, fechas, sucursales, promoción, traducción `en`). El tope de 5 lo respalda un trigger de BD (0023).
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

  async findAsset(id: string, tx?: BannerTx): Promise<BannerAssetRow | null> {
    return (tx ?? this.prisma).mediaAsset.findUnique({
      where: { id },
      select: { id: true, kind: true, status: true },
    });
  }

  /** Bloquea la fila hasta el fin de la transacción (serializa PATCH/DELETE concurrentes); `false` si no existe. */
  async lockBanner(tx: BannerTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM app.banners WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  /** Cuántos banners hay (activos e inactivos). */
  count(tx: BannerTx): Promise<number> {
    return tx.banner.count();
  }

  /** Todos los banners en orden de creación (`created_at`, `id`). */
  async findAll(): Promise<BannerRecord[]> {
    const rows = await this.prisma.banner.findMany({
      include: INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LIST_LIMIT,
    });
    return rows.map(toRecord);
  }

  async findById(id: string, tx?: BannerTx): Promise<BannerRecord | null> {
    const row = await (tx ?? this.prisma).banner.findUnique({ where: { id }, include: INCLUDE });
    return row ? toRecord(row) : null;
  }

  /** `cta_type='NONE'`, sin fechas, `sort_order` 0, sin sucursales ni promoción y solo la traducción `es` (alt). */
  async createBanner(tx: BannerTx, data: NewBanner): Promise<void> {
    await tx.banner.create({
      data: {
        id: data.id,
        code: data.code,
        imageAssetId: data.imageAssetId,
        ctaType: 'NONE',
        active: data.active,
        sortOrder: 0,
        translations: { create: [{ locale: 'es', imageAlt: data.imageAlt }] },
      },
      select: { id: true },
    });
  }

  /** Aplica los cambios y sube `version` en 1 (el llamador ya tiene la fila bloqueada). */
  async saveBanner(tx: BannerTx, id: string, scalars: BannerScalars, now: Date): Promise<void> {
    await tx.banner.update({
      where: { id },
      data: {
        ...(scalars.imageAssetId !== undefined ? { imageAssetId: scalars.imageAssetId } : {}),
        ...(scalars.active !== undefined ? { active: scalars.active } : {}),
        version: { increment: 1 },
        updatedAt: now,
      },
      select: { id: true },
    });
    if (scalars.imageAlt !== undefined) {
      await tx.bannerTranslation.upsert({
        where: { bannerId_locale: { bannerId: id, locale: 'es' } },
        create: { bannerId: id, locale: 'es', imageAlt: scalars.imageAlt },
        update: { imageAlt: scalars.imageAlt },
      });
    }
  }

  /** Borrado FÍSICO: las hijas caen en cascada (FK). NO toca el asset (la FK RESTRICT exige borrar antes el banner). */
  async deleteBanner(tx: BannerTx, id: string): Promise<void> {
    await tx.banner.delete({ where: { id }, select: { id: true } });
  }
}
