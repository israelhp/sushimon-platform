import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  alreadyAttached,
  assetNotReady,
  mediaNotFound,
  productMediaNotFound,
  reorderMismatch,
} from '../media/media-policy.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { translateProductDbError } from './product-db-errors.js';
import { MEDIA_MAX, mediaInvalid, normalizeAltText, notFound } from './product-policy.js';
import { ProductsRepository, type ProductTx } from './products.repository.js';
import type { AdminProductMediaView, MediaRow } from './products.types.js';

const ENTITY = 'product';

const view = (m: MediaRow): AdminProductMediaView => ({
  id: m.id,
  url: m.url,
  altText: m.altText,
  sortOrder: m.sortOrder,
  assetId: m.assetId ?? null,
});

/**
 * Imágenes de un producto (F14): adjuntar un asset READY, editar el texto alternativo, reordenar y desvincular. Mismo
 * mecanismo que `PATCH` de F11: alcance GLOBAL (403 antes de leer), transacción READ COMMITTED bajo bloqueo de la fila
 * del producto (`FOR NO KEY UPDATE`; serializa las escrituras de media del mismo producto), auditoría en la misma
 * transacción y `PRODUCTS_BUSY` por timeout. Desvincular NO borra el asset ni el objeto.
 */
@Injectable()
export class ProductMediaService {
  private readonly logger = new Logger(ProductMediaService.name);

  constructor(
    @Inject(ProductsRepository) private readonly repo: ProductsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(MediaUrlService) private readonly urls: MediaUrlService,
  ) {}

  async attach(
    staff: StaffContext,
    productId: string,
    input: { assetId: string; altText?: string | null },
  ): Promise<AdminProductMediaView> {
    this.assertGlobal(staff);
    const created = await this.inTransaction(async (tx) => {
      await this.lock(tx, productId);
      const asset = await this.repo.findAsset(tx, input.assetId);
      if (!asset) throw mediaNotFound();
      if (asset.kind !== 'PRODUCT_IMAGE')
        throw mediaInvalid('assetId', 'El medio no es una imagen de producto');
      if (asset.status !== 'READY') throw assetNotReady();
      const current = await this.repo.findMediaInTx(tx, productId);
      if (current.some((m) => m.assetId === asset.id)) throw alreadyAttached();
      if (current.length >= MEDIA_MAX)
        throw mediaInvalid('media', `Un producto admite como máximo ${MEDIA_MAX} imágenes`);
      const altText = normalizeAltText(input.altText, 'altText');
      const row = await this.repo.insertMedia(tx, {
        productId,
        mediaUrl: this.urls.publicUrl(asset.objectKey),
        altText,
        sortOrder: current.length,
        assetId: asset.id,
      });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: productId,
        action: 'product.media_attached',
        newValues: { productId, assetId: asset.id, mediaId: row.id, sortOrder: row.sortOrder },
      });
      return row;
    });
    this.logger.log(`Imagen adjuntada (product=${productId}, staff=${staff.staffId})`);
    return view(created);
  }

  async updateAlt(
    staff: StaffContext,
    productId: string,
    mediaId: string,
    input: { altText: string | null },
  ): Promise<AdminProductMediaView> {
    this.assertGlobal(staff);
    return this.inTransaction(async (tx) => {
      await this.lock(tx, productId);
      const current = await this.repo.findMediaInTx(tx, productId);
      const found = current.find((m) => m.id === mediaId);
      if (!found) throw productMediaNotFound();
      const altText = normalizeAltText(input.altText, 'altText');
      if (altText === found.altText) return view(found); // sin cambio: ni escritura ni auditoría
      const row = await this.repo.updateMediaAlt(tx, mediaId, altText);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: productId,
        action: 'product.media_updated',
        newValues: { productId, mediaId, changedFields: ['altText'] },
      });
      return view(row);
    });
  }

  async reorder(
    staff: StaffContext,
    productId: string,
    orderedIds: readonly string[],
  ): Promise<{ items: AdminProductMediaView[] }> {
    this.assertGlobal(staff);
    return this.inTransaction(async (tx) => {
      await this.lock(tx, productId);
      const current = await this.repo.findMediaInTx(tx, productId);
      const ids = new Set(orderedIds);
      const exact =
        ids.size === orderedIds.length &&
        orderedIds.length === current.length &&
        current.every((m) => ids.has(m.id));
      if (!exact) throw reorderMismatch();
      const same = current.every((m, i) => orderedIds[i] === m.id && m.sortOrder === i);
      if (same) return { items: current.map(view) }; // idempotente: sin escritura ni auditoría
      await this.repo.setMediaOrder(tx, productId, orderedIds);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: productId,
        action: 'product.media_reordered',
        newValues: { productId, count: orderedIds.length },
      });
      const next = await this.repo.findMediaInTx(tx, productId);
      return { items: next.map(view) };
    });
  }

  async detach(staff: StaffContext, productId: string, mediaId: string): Promise<void> {
    this.assertGlobal(staff);
    await this.inTransaction(async (tx) => {
      await this.lock(tx, productId);
      const current = await this.repo.findMediaInTx(tx, productId);
      const found = current.find((m) => m.id === mediaId);
      if (!found) throw productMediaNotFound();
      await this.repo.deleteMedia(tx, mediaId);
      // Renumera 0..n-1 (UNIQUE diferible: se comprueba al COMMIT).
      const rest = current.filter((m) => m.id !== mediaId);
      if (rest.some((m, i) => m.sortOrder !== i)) {
        await this.repo.setMediaOrder(
          tx,
          productId,
          rest.map((m) => m.id),
        );
      }
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: productId,
        action: 'product.media_detached',
        newValues: { productId, assetId: found.assetId ?? null, mediaId },
      });
    });
    this.logger.log(`Imagen desvinculada (product=${productId}, staff=${staff.staffId})`);
  }

  private async lock(tx: ProductTx, productId: string): Promise<void> {
    if (!(await this.repo.lockProduct(tx, productId))) throw notFound();
  }

  /** Los productos son globales: un alcance solo por sucursal no basta (403 antes que cualquier 404/422). */
  private assertGlobal(staff: StaffContext): void {
    if (!this.authorization.scopeFor(staff, 'catalog.update').allBranches) {
      throw new ForbiddenException('Acceso denegado');
    }
  }

  /** Transacción READ COMMITTED con tope de tiempo; timeout/bloqueo => 503 `PRODUCTS_BUSY`. */
  private async inTransaction<T>(fn: (tx: ProductTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateProductDbError(error);
    }
  }
}
