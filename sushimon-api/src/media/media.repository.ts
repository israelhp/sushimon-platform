import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  MediaAssetRow,
  MediaKind,
  MediaBannerUsageRow,
  MediaPageFilter,
  MediaStatus,
  MediaUsageRow,
  NewPendingAsset,
} from './media.types.js';

export type MediaTx = Prisma.TransactionClient;

const ASSET_SELECT = {
  id: true,
  kind: true,
  objectKey: true,
  bucket: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  status: true,
  createdByStaffId: true,
  createdAt: true,
  confirmedAt: true,
  expiresAt: true,
  // Conteo de usos en la MISMA consulta (sin N+1).
  _count: { select: { productMedia: true, banners: true } },
} satisfies Prisma.MediaAssetSelect;

type DbAsset = Prisma.MediaAssetGetPayload<{ select: typeof ASSET_SELECT }>;

const toRow = (a: DbAsset): MediaAssetRow => ({
  id: a.id,
  kind: a.kind as MediaKind,
  objectKey: a.objectKey,
  bucket: a.bucket,
  mimeType: a.mimeType,
  sizeBytes: Number(a.sizeBytes),
  checksumSha256: a.checksumSha256,
  status: a.status as MediaStatus,
  createdByStaffId: a.createdByStaffId,
  createdAt: a.createdAt,
  confirmedAt: a.confirmedAt,
  expiresAt: a.expiresAt,
  usageCount: a._count.productMedia + a._count.banners,
});

/** Único punto de acceso a datos de `app.media_assets`. */
@Injectable()
export class MediaRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** READ COMMITTED explícito y `lock_timeout` local: la espera es corta y vence como 55P03 (=> 503 `MEDIA_BUSY`). */
  transaction<T>(fn: (tx: MediaTx) => Promise<T>): Promise<T> {
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

  async findById(id: string, tx?: MediaTx): Promise<MediaAssetRow | null> {
    const row = await (tx ?? this.prisma).mediaAsset.findUnique({
      where: { id },
      select: ASSET_SELECT,
    });
    return row ? toRow(row) : null;
  }

  async findReadyByChecksum(
    kind: MediaKind,
    checksumSha256: string,
    tx?: MediaTx,
  ): Promise<MediaAssetRow | null> {
    const row = await (tx ?? this.prisma).mediaAsset.findFirst({
      where: { kind, checksumSha256, status: 'READY' },
      select: ASSET_SELECT,
    });
    return row ? toRow(row) : null;
  }

  /**
   * Serializa los intents del MISMO empleado hasta el COMMIT (`pg_advisory_xact_lock`, clave = hash del id): el conteo de
   * PENDING y el INSERT quedan atómicos y el tope no se rebasa por concurrencia. Otros empleados no se bloquean.
   */
  async lockStaffIntents(tx: MediaTx, staffId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-intents:${staffId}`}))`;
  }

  /** PENDING vigentes (no caducados) del empleado. */
  countPendingByStaff(tx: MediaTx, staffId: string, now: Date): Promise<number> {
    return tx.mediaAsset.count({
      where: { createdByStaffId: staffId, status: 'PENDING', expiresAt: { gt: now } },
    });
  }

  async insertPending(tx: MediaTx, data: NewPendingAsset): Promise<MediaAssetRow> {
    const row = await tx.mediaAsset.create({
      data: { ...data, sizeBytes: BigInt(data.sizeBytes), status: 'PENDING' },
      select: ASSET_SELECT,
    });
    return toRow(row);
  }

  /**
   * PENDING -> READY SOLO si el intent no ha caducado (`expires_at > now`): evita la carrera con la purga. `false` si ya
   * no estaba PENDING o ya caducó (otro `complete` ganó, o venció). 23505 = carrera por checksum.
   */
  async markReady(tx: MediaTx, id: string, now: Date): Promise<boolean> {
    const result = await tx.mediaAsset.updateMany({
      where: { id, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'READY', confirmedAt: now, expiresAt: null },
    });
    return result.count > 0;
  }

  /**
   * Rechazo: el asset deja de ser confirmable (caduca YA) pero la fila PENDING se conserva hasta que la purga (tras el
   * margen del TTL) borre también el objeto, por si el PUT firmado aún vigente lo recrea.
   */
  async expirePending(tx: MediaTx, id: string, now: Date): Promise<boolean> {
    const result = await tx.mediaAsset.updateMany({
      where: { id, status: 'PENDING' },
      data: { expiresAt: now },
    });
    return result.count > 0;
  }

  /** Borra solo si sigue PENDING (rechazo y limpieza de duplicados). */
  async deletePending(tx: MediaTx, id: string): Promise<boolean> {
    const result = await tx.mediaAsset.deleteMany({ where: { id, status: 'PENDING' } });
    return result.count > 0;
  }

  /** Borra el asset sin importar el estado. La FK RESTRICT (23503) impide borrarlo si está en uso. */
  async deleteById(tx: MediaTx, id: string): Promise<boolean> {
    const result = await tx.mediaAsset.deleteMany({ where: { id } });
    return result.count > 0;
  }

  /** PENDING cuyo `expires_at` es anterior a `before` (el llamador ya restó el margen), más antiguos primero, acotado. */
  findExpiredPending(before: Date, limit: number): Promise<{ id: string; objectKey: string }[]> {
    return this.prisma.mediaAsset.findMany({
      where: { status: 'PENDING', expiresAt: { lt: before } },
      select: { id: true, objectKey: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
  }

  /** Borra esas filas si siguen PENDING y caducadas antes de `before`; devuelve cuántas. */
  async deleteExpiredPending(ids: readonly string[], before: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.mediaAsset.deleteMany({
      where: { id: { in: [...ids] }, status: 'PENDING', expiresAt: { lt: before } },
    });
    return result.count;
  }

  /** Una página (orden `createdAt desc, id`) con su conteo de usos incluido, más el total. */
  async findPage(filter: MediaPageFilter): Promise<{ rows: MediaAssetRow[]; total: number }> {
    const where: Prisma.MediaAssetWhereInput = {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.unreferenced === true
        ? { productMedia: { none: {} }, banners: { none: {} } }
        : {}),
      ...(filter.unreferenced === false
        ? { OR: [{ productMedia: { some: {} } }, { banners: { some: {} } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where,
        select: ASSET_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);
    return { rows: rows.map(toRow), total };
  }

  /** Dónde se usa el asset: producto y fila de `product_media` (una consulta). */
  async findUsages(assetId: string): Promise<MediaUsageRow[]> {
    const rows = await this.prisma.productMedia.findMany({
      where: { assetId },
      select: { id: true, productId: true, product: { select: { name: true } } },
      orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
      take: 500,
    });
    return rows.map((r) => ({
      productId: r.productId,
      productName: r.product.name,
      productMediaId: r.id,
    }));
  }

  /** Banners (F16) que usan el asset como imagen (una consulta; acotada). */
  async findBannerUsages(assetId: string): Promise<MediaBannerUsageRow[]> {
    const rows = await this.prisma.banner.findMany({
      where: { imageAssetId: assetId },
      select: { id: true, translations: { where: { locale: 'es' }, select: { imageAlt: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map((r) => ({ bannerId: r.id, bannerAlt: r.translations[0]?.imageAlt ?? '' }));
  }
}
