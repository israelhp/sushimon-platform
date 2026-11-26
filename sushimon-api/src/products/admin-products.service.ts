import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import type { Env } from '../config/env.js';
import type { StaffContext } from '../identity/identity.types.js';
import { safeErrorLabel } from '../media/guarded-storage.js';
import { AdminMediaService } from '../media/admin-media.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { translateProductDbError, translateProductDeleteError } from './product-db-errors.js';
import {
  categoryInvalid,
  diffProduct,
  isUnused,
  mediaInvalid,
  normalizeDescription,
  normalizeMedia,
  normalizeName,
  normalizePrice,
  normalizeSku,
  normalizeSlug,
  normalizeUpdate,
  notFound,
  productInUse,
  slugify,
  slugSearchPrefix,
  toAdminView,
  uniqueSlug,
  type UpdateProductInput,
} from './product-policy.js';
import { toAdminCategory } from './products-query.service.js';
import { ProductsRepository, type ProductTx } from './products.repository.js';
import type {
  AdminProductView,
  MediaInput,
  MediaRow,
  ProductPatch,
  ProductRow,
} from './products.types.js';

const ENTITY = 'product';

/** Lo único que ADR-0035 necesita de F14 para liberar las imágenes (facilita el doble en pruebas). */
export type ProductImageReleaser = Pick<AdminMediaService, 'removeUnusedAsset'>;

const isSlugTaken = (error: unknown): boolean =>
  (error as { response?: { code?: string } } | null)?.response?.code === 'PRODUCT_SLUG_TAKEN';

export interface CreateProductInput {
  name: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  basePrice: string;
  categoryId: string;
  active?: boolean;
  media?: readonly { url: unknown; altText?: unknown }[];
}

/**
 * Comandos de escritura de productos. Los productos son globales: las escrituras exigen alcance GLOBAL del permiso
 * (403 antes de leer nada). Cada transacción escribe y audita junta (READ COMMITTED). La unicidad de slug/SKU la
 * garantizan los índices únicos; los errores de BD se traducen en `translateProductDbError`.
 */
@Injectable()
export class AdminProductsService {
  private readonly logger = new Logger(AdminProductsService.name);

  constructor(
    @Inject(ProductsRepository) private readonly repo: ProductsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    /** F14. Opcional en construcción manual (pruebas de F11): sin él no hay enlace de URL de R2 con assets. */
    @Inject(MediaUrlService) private readonly mediaUrls?: MediaUrlService,
    /** ADR-0035. Opcional en construcción manual: sin él no se liberan assets tras borrar. */
    @Inject(AdminMediaService) private readonly media?: ProductImageReleaser,
  ) {}

  /**
   * Hosts de imagen permitidos (`PRODUCT_MEDIA_ALLOWED_HOSTS`); vacío = cualquier host https público. Si no está vacía
   * se añade el host de `R2_PUBLIC_BASE_URL` (F14).
   */
  private get allowedHosts(): readonly string[] {
    const configured = this.config.get('PRODUCT_MEDIA_ALLOWED_HOSTS', { infer: true }) ?? [];
    return this.mediaUrls ? this.mediaUrls.effectiveAllowedHosts(configured) : configured;
  }

  /**
   * F14: una URL bajo el host de medios (R2) debe ser EXACTAMENTE la URL pública de un asset READY y se enlaza por
   * `asset_id`; si no => 422 `PRODUCT_MEDIA_INVALID` (evita saltarse las validaciones de la biblioteca). Las URL de
   * otros hosts quedan como en F11 (`asset_id` NULL). Una consulta, solo si hay URL de R2.
   */
  private async linkAssets(tx: ProductTx, media: readonly MediaInput[]): Promise<MediaInput[]> {
    const urls = this.mediaUrls;
    if (!urls?.configured) return [...media];
    const classes = media.map((m) => urls.classify(m.url));
    if (classes.every((c) => c.kind === 'external')) return [...media]; // sin consulta
    const keys = classes.flatMap((c) => (c.kind === 'media' && c.objectKey ? [c.objectKey] : []));
    const assets = new Map(
      (await this.repo.findReadyAssetsByKeys(tx, [...new Set(keys)])).map((a) => [
        a.objectKey,
        a.id,
      ]),
    );
    return media.map((item, index) => {
      const cls = classes[index];
      if (cls?.kind !== 'media') return { ...item };
      const assetId = cls.objectKey ? assets.get(cls.objectKey) : undefined;
      if (!assetId)
        throw mediaInvalid(
          `media[${index}].url`,
          'La URL pertenece al almacenamiento de imágenes y no corresponde a un medio confirmado',
        );
      return { ...item, assetId };
    });
  }

  async create(staff: StaffContext, input: CreateProductInput): Promise<AdminProductView> {
    this.assertGlobal(staff, 'catalog.create');
    const name = normalizeName(input.name);
    const explicitSlug = input.slug === undefined ? undefined : normalizeSlug(input.slug);
    const sku = input.sku === undefined ? null : normalizeSku(input.sku);
    const description =
      input.description === undefined ? null : normalizeDescription(input.description);
    const basePrice = normalizePrice(input.basePrice);
    const media = input.media === undefined ? [] : normalizeMedia(input.media, this.allowedHosts);
    const active = input.active ?? true;

    const attempt = () =>
      this.inTransaction(async (tx) => {
        await this.assertCategoryActive(tx, input.categoryId);
        let slug: string;
        if (explicitSlug !== undefined) {
          slug = explicitSlug;
        } else {
          const base = slugify(name);
          const taken = await this.repo.findSlugsByPrefix(tx, slugSearchPrefix(base));
          slug = uniqueSlug(base, new Set(taken));
        }
        const row = await this.repo.insert(tx, {
          sku,
          categoryId: input.categoryId,
          slug,
          name,
          description,
          basePrice,
          active,
        });
        const mediaRows =
          media.length > 0
            ? await this.repo.replaceMedia(tx, row.id, await this.linkAssets(tx, media))
            : [];
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: row.id,
          action: 'product.created',
          newValues: {
            slug: row.slug,
            sku: row.sku,
            name: row.name,
            basePrice: row.basePrice,
            categoryId: row.categoryId,
            active: row.active,
            mediaCount: mediaRows.length,
          },
        });
        return { row, media: mediaRows };
      });
    // Slug AUTOGENERADO: si otro alta ganó la carrera por el mismo slug, se reintenta UNA vez en una transacción nueva
    // (la desambiguación ya verá el slug confirmado). Un slug explícito repetido es 409 directo.
    let created: Awaited<ReturnType<typeof attempt>>;
    try {
      created = await attempt();
    } catch (error) {
      if (explicitSlug !== undefined || !isSlugTaken(error)) throw error;
      created = await attempt();
    }
    this.logger.log(`Producto creado (id=${created.row.id}, staff=${staff.staffId})`);
    return this.viewOf(created.row, created.media);
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdateProductInput,
  ): Promise<AdminProductView> {
    this.assertGlobal(staff, 'catalog.update');
    const patch = normalizeUpdate(input, this.allowedHosts);

    const result = await this.inTransaction(async (tx) => {
      if (!(await this.repo.lockProduct(tx, id))) throw notFound();
      const current = await this.repo.findById(id, tx);
      if (!current) throw notFound();
      const currentMedia = await this.repo.findMediaInTx(tx, id);
      const linked = patch.media
        ? { ...patch, media: await this.linkAssets(tx, patch.media) }
        : patch;
      const diff = diffProduct(current, currentMedia, linked);
      if (!diff) return { row: current, media: currentMedia, changed: false }; // ni escritura ni auditoría

      // Solo exige categoría ACTIVA si cambia; editar con categoría inactiva sin moverla se permite.
      if (diff.changes.categoryId !== undefined) {
        await this.assertCategoryActive(tx, diff.changes.categoryId);
      }
      const changes: ProductPatch = { ...diff.changes, updatedAt: new Date() };
      const row = await this.repo.update(tx, id, changes);
      const media = diff.media ? await this.repo.replaceMedia(tx, id, diff.media) : currentMedia;

      if (diff.hasFieldChanges) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: id,
          action: 'product.updated',
          oldValues: diff.oldValues,
          newValues: diff.newValues,
        });
      }
      if (diff.changes.active !== undefined) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: id,
          action: diff.changes.active ? 'product.activated' : 'product.deactivated',
          oldValues: { active: current.active },
          newValues: { active: diff.changes.active },
        });
      }
      return { row, media, changed: true };
    });
    if (result.changed) {
      this.logger.log(`Producto actualizado (id=${id}, staff=${staff.staffId})`);
    }
    return this.viewOf(result.row, result.media);
  }

  /**
   * ADR-0035: borrado físico solo sin pedidos, promociones ni banners. Bajo el bloqueo de fila: existe (404) → recuenta
   * (409 `PRODUCT_IN_USE`) → borra `branch_products` → borra el producto (cascada: medios, vínculos de modificadores,
   * favoritos) → audita, todo en una transacción. Un 23503 (carrera con un escritor que no tomó el bloqueo) se traduce
   * recontando fuera de la transacción abortada. DESPUÉS de confirmar se liberan, best-effort, los assets de imagen.
   */
  async remove(staff: StaffContext, id: string): Promise<void> {
    this.assertGlobal(staff, 'catalog.update');
    let assetIds: string[];
    try {
      assetIds = await this.repo.transaction(async (tx) => {
        if (!(await this.repo.lockProduct(tx, id))) throw notFound();
        const current = await this.repo.findById(id, tx);
        if (!current) throw notFound();
        const usage = await this.repo.countUsage(id, tx);
        if (!isUnused(usage)) throw productInUse(usage);
        const media = await this.repo.findMediaInTx(tx, id);
        const offers = await this.repo.findBranchOffers(tx, id);
        await this.repo.deleteBranchOffers(tx, id);
        await this.repo.delete(tx, id);
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: id,
          action: 'product.deleted',
          oldValues: {
            id: current.id,
            slug: current.slug,
            sku: current.sku,
            name: current.name,
            categoryId: current.categoryId,
            active: current.active,
            basePrice: current.basePrice,
            branchOffers: offers.map(
              (o) =>
                `${o.branchId}|${o.priceOverride ?? 'base'}|${o.available ? 'available' : 'unavailable'}`,
            ),
          },
        });
        return [...new Set(media.flatMap((m) => (m.assetId ? [m.assetId] : [])))];
      });
    } catch (error) {
      throw await translateProductDeleteError(error, () => this.repo.countUsage(id));
    }
    this.logger.log(`Producto eliminado (id=${id}, staff=${staff.staffId})`);
    await this.releaseImages(staff, id, assetIds);
  }

  /** Mejor esfuerzo: el producto YA no existe; cualquier fallo solo deja el asset libre en la biblioteca de medios. */
  private async releaseImages(
    staff: StaffContext,
    productId: string,
    assetIds: readonly string[],
  ): Promise<void> {
    if (!this.media) return;
    for (const assetId of assetIds) {
      try {
        await this.media.removeUnusedAsset(staff, assetId, 'PRODUCT_IMAGE');
      } catch (error) {
        const code = (error as { response?: { code?: unknown } } | null)?.response?.code;
        if (code === 'MEDIA_IN_USE') continue; // otro producto o banner la usa: se conserva (esperado)
        this.logger.warn(
          `Imagen de producto eliminado no liberada (producto=${productId}, asset=${assetId}, ${typeof code === 'string' ? code : safeErrorLabel(error)}); queda libre en la biblioteca de medios`,
        );
      }
    }
  }

  /** Los productos son globales: un alcance solo por sucursal no basta (403 antes que cualquier 404/422). */
  private assertGlobal(staff: StaffContext, permission: string): void {
    if (!this.authorization.scopeFor(staff, permission).allBranches) {
      throw new ForbiddenException('Acceso denegado');
    }
  }

  /** Categoría existente y ACTIVA (no se exige visibilidad efectiva). */
  private async assertCategoryActive(tx: ProductTx, categoryId: string): Promise<void> {
    const category = await this.repo.findCategoryState(tx, categoryId);
    if (!category) throw categoryInvalid('La categoría no existe');
    if (!category.active) throw categoryInvalid('La categoría está inactiva');
  }

  private async viewOf(row: ProductRow, media: readonly MediaRow[]): Promise<AdminProductView> {
    const categories = await this.categories.listAdmin({});
    const category = categories.items.find((c) => c.id === row.categoryId);
    if (!category) throw new Error('Producto con categoría inexistente');
    return toAdminView(row, media, toAdminCategory(category));
  }

  /** Transacción READ COMMITTED con tope de tiempo; P2028 => 503 `PRODUCTS_BUSY`. */
  private async inTransaction<T>(fn: (tx: ProductTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateProductDbError(error);
    }
  }
}
