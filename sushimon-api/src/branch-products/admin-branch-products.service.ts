import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { buildSearchPattern } from '../products/product-policy.js';
import { translateBranchProductDbError } from './branch-product-db-errors.js';
import {
  availabilityAudit,
  branchNotFound,
  isDefaultRow,
  normalizePriceOverride,
  parsePriceInput,
  planAvailability,
  planPricing,
  priceAudit,
  productNotFound,
  stateView,
} from './branch-product-policy.js';
import { BranchProductsRepository, type BranchProductTx } from './branch-products.repository.js';
import type {
  AdminBranchProductPageView,
  AdminProductBranchesView,
  BranchProductRow,
  BranchProductStateView,
  ProductFacts,
} from './branch-products.types.js';

const ENTITY = 'branch_product';
export const READ = 'catalog.read';
export const UPDATE = 'catalog.update';
export const MANAGE_AVAILABILITY = 'catalog.manage_availability';

export interface AdminBranchProductsQuery {
  q?: string;
  categoryId?: string;
  available?: boolean;
  hasOverride?: boolean;
  page: number;
  pageSize: number;
}

/**
 * Matrices y escrituras de precio/disponibilidad por sucursal (spec F13 D7-D10). Alcance POR SUCURSAL con
 * `canAccess` (fuera de alcance = inexistente = 404 `BRANCH_NOT_FOUND`). Cada escritura audita en su transacción.
 * Orden en escrituras: forma (400) → alcance (404) → producto (404) → regla (422).
 */
@Injectable()
export class AdminBranchProductsService {
  private readonly logger = new Logger(AdminBranchProductsService.name);

  constructor(
    @Inject(BranchProductsRepository) private readonly repo: BranchProductsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
  ) {}

  /** Matriz de una sucursal: todos los productos (activos e inactivos). Dos consultas + categorías (sin N+1). */
  async listForBranch(
    staff: StaffContext,
    branchId: string,
    query: AdminBranchProductsQuery,
  ): Promise<AdminBranchProductPageView> {
    await this.requireBranch(staff, READ, branchId);
    const pattern = buildSearchPattern(query.q);
    const [page, categories] = await Promise.all([
      this.repo.findMatrix(branchId, {
        ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
        ...(query.available !== undefined ? { available: query.available } : {}),
        ...(query.hasOverride !== undefined ? { hasOverride: query.hasOverride } : {}),
        pattern,
        page: query.page,
        pageSize: query.pageSize,
      }),
      this.categories.listAdmin({}),
    ]);
    const byCategory = new Map(categories.items.map((c) => [c.id, c]));
    const items = page.rows.map((row) => {
      const category = byCategory.get(row.categoryId);
      if (!category) throw new Error('Producto con categoría inexistente');
      const stored: BranchProductRow | null = row.updatedAt
        ? { priceOverride: row.priceOverride, available: row.available, updatedAt: row.updatedAt }
        : null;
      const facts: ProductFacts = {
        id: row.id,
        basePrice: row.basePrice,
        active: row.active,
        categoryId: row.categoryId,
      };
      return {
        ...stateView(branchId, facts, stored, category.effectivelyVisible),
        sku: row.sku,
        slug: row.slug,
        name: row.name,
        category: {
          id: category.id,
          slug: category.slug,
          name: category.name,
          active: category.active,
          effectivelyVisible: category.effectivelyVisible,
        },
        active: row.active,
        publiclyVisible: row.active && category.effectivelyVisible,
      };
    });
    return { branchId, items, page: query.page, pageSize: query.pageSize, total: page.total };
  }

  /** Matriz de un producto: solo sucursales dentro de `scopeFor(catalog.read)`. */
  async listForProduct(staff: StaffContext, productId: string): Promise<AdminProductBranchesView> {
    const scope = this.authorization.scopeFor(staff, READ);
    const [product, visibleIds, branches] = await Promise.all([
      this.repo.findProduct(productId),
      this.categories.getVisibleIds(),
      this.repo.findProductBranches(productId, scope.allBranches ? null : scope.branchIds),
    ]);
    if (!product) throw productNotFound();
    const visible = visibleIds.includes(product.categoryId);
    return {
      productId: product.id,
      basePrice: product.basePrice,
      active: product.active,
      publiclyVisible: product.active && visible,
      items: branches.map((b) => {
        const stored: BranchProductRow | null = b.updatedAt
          ? { priceOverride: b.priceOverride, available: b.available, updatedAt: b.updatedAt }
          : null;
        return {
          ...stateView(b.branchId, product, stored, visible),
          branchCode: b.code,
          branchName: b.name,
          branchActive: b.active,
        };
      }),
    };
  }

  async setPricing(
    staff: StaffContext,
    branchId: string,
    productId: string,
    input: { priceOverride: unknown },
  ): Promise<BranchProductStateView> {
    const parsed = parsePriceInput(input.priceOverride); // forma: 400
    this.assertScope(staff, UPDATE, branchId); // alcance: 404
    const result = await this.inTransaction(async (tx) => {
      await this.requireBranchInTx(tx, branchId);
      const product = await this.repo.findProduct(productId, tx);
      if (!product) throw productNotFound();
      const next = normalizePriceOverride(parsed); // regla: 422
      const current = await this.repo.findRow(tx, branchId, productId);
      const plan = planPricing(current, next);
      if (!plan) return { product, row: current, changed: false };
      const written = await this.repo.upsertPrice(tx, branchId, productId, next, new Date());
      const row = await this.settle(tx, branchId, productId, written);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId,
        entityType: ENTITY,
        entityId: productId,
        action: `branch_product.${plan.action}`,
        ...priceAudit(branchId, productId, plan.oldPrice, next),
      });
      return { product, row, changed: true };
    });
    if (result.changed)
      this.logger.log(
        `Precio de sucursal actualizado (branch=${branchId}, product=${productId}, staff=${staff.staffId})`,
      );
    return this.view(branchId, result.product, result.row);
  }

  async setAvailability(
    staff: StaffContext,
    productId: string,
    input: { branchId: string; available: boolean },
  ): Promise<BranchProductStateView> {
    const { branchId, available } = input;
    this.assertScope(staff, MANAGE_AVAILABILITY, branchId);
    const result = await this.inTransaction(async (tx) => {
      await this.requireBranchInTx(tx, branchId);
      const product = await this.repo.findProduct(productId, tx);
      if (!product) throw productNotFound();
      const current = await this.repo.findRow(tx, branchId, productId);
      const plan = planAvailability(current, available);
      if (!plan) return { product, row: current, changed: false };
      const written = await this.repo.upsertAvailability(
        tx,
        branchId,
        productId,
        available,
        new Date(),
      );
      const row = await this.settle(tx, branchId, productId, written);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId,
        entityType: ENTITY,
        entityId: productId,
        action: 'branch_product.availability_changed',
        ...availabilityAudit(branchId, productId, plan.oldAvailable, available),
      });
      return { product, row, changed: true };
    });
    if (result.changed)
      this.logger.log(
        `Disponibilidad de sucursal actualizada (branch=${branchId}, product=${productId}, staff=${staff.staffId})`,
      );
    return this.view(branchId, result.product, result.row);
  }

  /** Si la fila volvió al estado por defecto la elimina (D2) y devuelve `null` (= sin fila). */
  private async settle(
    tx: BranchProductTx,
    branchId: string,
    productId: string,
    written: BranchProductRow,
  ): Promise<BranchProductRow | null> {
    if (!isDefaultRow(written)) return written;
    await this.repo.deleteIfDefault(tx, branchId, productId);
    return null;
  }

  private async view(
    branchId: string,
    product: ProductFacts,
    row: BranchProductRow | null,
  ): Promise<BranchProductStateView> {
    const visibleIds = await this.categories.getVisibleIds();
    return stateView(branchId, product, row, visibleIds.includes(product.categoryId));
  }

  /** Fuera de alcance = 404 sin distinguir inexistente. */
  private assertScope(staff: StaffContext, permission: string, branchId: string): void {
    if (!this.authorization.canAccess(staff, permission, branchId)) throw branchNotFound();
  }

  private async requireBranch(
    staff: StaffContext,
    permission: string,
    branchId: string,
  ): Promise<void> {
    this.assertScope(staff, permission, branchId);
    if (!(await this.repo.findBranchStatus(branchId))) throw branchNotFound();
  }

  private async requireBranchInTx(tx: BranchProductTx, branchId: string): Promise<void> {
    if (!(await this.repo.findBranchStatus(branchId, tx))) throw branchNotFound();
  }

  private async inTransaction<T>(fn: (tx: BranchProductTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateBranchProductDbError(error);
    }
  }
}
