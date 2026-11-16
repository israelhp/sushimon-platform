import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import type { Env } from '../config/env.js';
import type { StaffContext } from '../identity/identity.types.js';
import { translateProductDbError } from './product-db-errors.js';
import {
  categoryInvalid,
  diffProduct,
  normalizeDescription,
  normalizeMedia,
  normalizeName,
  normalizePrice,
  normalizeSku,
  normalizeSlug,
  normalizeUpdate,
  notFound,
  slugify,
  slugSearchPrefix,
  toAdminView,
  uniqueSlug,
  type UpdateProductInput,
} from './product-policy.js';
import { toAdminCategory } from './products-query.service.js';
import { ProductsRepository, type ProductTx } from './products.repository.js';
import type { AdminProductView, MediaRow, ProductPatch, ProductRow } from './products.types.js';

const ENTITY = 'product';

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
  ) {}

  /** Hosts de imagen permitidos (`PRODUCT_MEDIA_ALLOWED_HOSTS`); vacío = cualquier host https público. */
  private get allowedHosts(): readonly string[] {
    return this.config.get('PRODUCT_MEDIA_ALLOWED_HOSTS', { infer: true }) ?? [];
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
        const mediaRows = media.length > 0 ? await this.repo.replaceMedia(tx, row.id, media) : [];
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
      const diff = diffProduct(current, currentMedia, patch);
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
