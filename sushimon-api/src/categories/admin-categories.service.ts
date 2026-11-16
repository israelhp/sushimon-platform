import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { CategoriesRepository, type CategoryTx } from './categories.repository.js';
import type {
  AdminCategoryListView,
  AdminCategoryView,
  CategoryPatch,
  CategoryRow,
} from './categories.types.js';
import { translateCategoryDbError } from './category-db-errors.js';
import {
  assertLimit,
  assertParentAllowed,
  assertReorderExact,
  assertSlugFree,
  buildAdminViews,
  childrenIndex,
  compareSiblings,
  diffCategory,
  indexById,
  nextSortOrder,
  normalizeDescription,
  normalizeName,
  normalizeSlug,
  normalizeUpdate,
  ROOT_AUDIT_ENTITY_ID,
  slugify,
  uniqueSlug,
  type UpdateCategoryInput,
} from './category-policy.js';

const ENTITY = 'category';
const NOT_FOUND = 'Categoría no encontrada';

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  active?: boolean;
}

export interface ReorderCategoriesInput {
  parentId: string | null;
  orderedIds: string[];
}

/**
 * Comandos de escritura. Cada transacción: (1) toma el bloqueo de jerarquía, (2) lee TODO y valida con la policy,
 * (3) escribe y audita. Las categorías son globales: las escrituras exigen alcance GLOBAL del permiso (ADR-0016).
 */
@Injectable()
export class AdminCategoriesService {
  private readonly logger = new Logger(AdminCategoriesService.name);

  constructor(
    @Inject(CategoriesRepository) private readonly repo: CategoriesRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async create(staff: StaffContext, input: CreateCategoryInput): Promise<AdminCategoryView> {
    this.assertGlobal(staff, 'catalog.create');
    const name = normalizeName(input.name);
    const explicitSlug = input.slug === undefined ? undefined : normalizeSlug(input.slug);
    const description =
      input.description === undefined ? null : normalizeDescription(input.description);
    const parentId = input.parentId ?? null;
    const active = input.active ?? true;

    const created = await this.inTransaction(async (tx, rows) => {
      assertLimit(rows.length);
      if (parentId !== null) {
        assertParentAllowed(parentId, indexById(rows), childrenIndex(rows));
      }
      let slug: string;
      if (explicitSlug !== undefined) {
        assertSlugFree(explicitSlug, rows);
        slug = explicitSlug;
      } else {
        slug = uniqueSlug(slugify(name), new Set(rows.map((r) => r.slug)));
      }
      const row = await this.repo.insert(tx, {
        parentId,
        slug,
        name,
        description,
        sortOrder: nextSortOrder(rows, parentId),
        active,
      });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: row.id,
        action: 'category.created',
        newValues: {
          parentId: row.parentId,
          slug: row.slug,
          name: row.name,
          sortOrder: row.sortOrder,
          active: row.active,
        },
      });
      return { row, rows: [...rows, row] };
    });
    this.logger.log(`Categoría creada (id=${created.row.id}, staff=${staff.staffId})`);
    return this.viewOf(created.rows, created.row.id);
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdateCategoryInput,
  ): Promise<AdminCategoryView> {
    this.assertGlobal(staff, 'catalog.update');
    const patch = normalizeUpdate(input);

    const result = await this.inTransaction(async (tx, rows) => {
      const byId = indexById(rows);
      const current = byId.get(id);
      if (!current) throw new NotFoundException(NOT_FOUND);
      const diff = diffCategory(current, patch);
      if (!diff) return { rows, changed: false }; // sin cambios reales: ni escritura ni auditoría

      const changes: CategoryPatch = { ...diff.changes, updatedAt: new Date() };
      const oldValues = { ...diff.oldValues };
      const newValues = { ...diff.newValues };
      if (changes.slug !== undefined) assertSlugFree(changes.slug, rows, id);
      if (changes.parentId !== undefined) {
        if (changes.parentId !== null) {
          assertParentAllowed(changes.parentId, byId, childrenIndex(rows), id);
        }
        changes.sortOrder = nextSortOrder(rows, changes.parentId, id);
        oldValues['sortOrder'] = current.sortOrder;
        newValues['sortOrder'] = changes.sortOrder;
      }
      const updated = await this.repo.update(tx, id, changes);

      if (Object.keys(newValues).length > 0) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: id,
          action: 'category.updated',
          oldValues,
          newValues,
        });
      }
      if (changes.active !== undefined) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: id,
          action: changes.active ? 'category.activated' : 'category.deactivated',
          oldValues: { active: current.active },
          newValues: { active: changes.active },
        });
      }
      return { rows: rows.map((r) => (r.id === id ? updated : r)), changed: true };
    });
    if (result.changed) {
      this.logger.log(`Categoría actualizada (id=${id}, staff=${staff.staffId})`);
    }
    return this.viewOf(result.rows, id);
  }

  async reorder(
    staff: StaffContext,
    input: ReorderCategoriesInput,
  ): Promise<AdminCategoryListView> {
    this.assertGlobal(staff, 'catalog.update');
    const { parentId, orderedIds } = input;

    const result = await this.inTransaction(async (tx, rows) => {
      if (parentId !== null && !rows.some((r) => r.id === parentId)) {
        throw new NotFoundException(NOT_FOUND);
      }
      const siblings = [...rows].filter((r) => r.parentId === parentId).sort(compareSiblings);
      assertReorderExact(
        siblings.map((s) => s.id),
        orderedIds,
      );
      const before = siblings.map((s) => s.id);
      const inOrder =
        before.every((sid, i) => sid === orderedIds[i]) &&
        siblings.every((s, i) => s.sortOrder === i);
      if (inOrder) return { rows, changed: false }; // idempotente: ni escritura ni auditoría

      const now = new Date();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const updatedRows = new Map<string, CategoryRow>();
      for (const [index, sid] of orderedIds.entries()) {
        const row = byId.get(sid) as CategoryRow;
        if (row.sortOrder === index) continue;
        updatedRows.set(sid, await this.repo.update(tx, sid, { sortOrder: index, updatedAt: now }));
      }
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: parentId ?? ROOT_AUDIT_ENTITY_ID,
        action: 'category.reordered',
        oldValues: { parentId, orderedIds: before },
        newValues: { parentId, orderedIds: [...orderedIds] },
      });
      return { rows: rows.map((r) => updatedRows.get(r.id) ?? r), changed: true };
    });
    if (result.changed) {
      this.logger.log(
        `Categorías reordenadas (parentId=${parentId ?? 'raíz'}, staff=${staff.staffId})`,
      );
    }
    const items = buildAdminViews(result.rows)
      .filter((v) => v.parentId === parentId)
      .sort(compareSiblings);
    return { items, total: items.length };
  }

  /** Las categorías son globales: un alcance solo por sucursal no basta (403 antes que cualquier 404/422). */
  private assertGlobal(staff: StaffContext, permission: string): void {
    if (!this.authorization.scopeFor(staff, permission).allBranches) {
      throw new ForbiddenException('Acceso denegado');
    }
  }

  private viewOf(rows: readonly CategoryRow[], id: string): AdminCategoryView {
    const view = buildAdminViews(rows).find((v) => v.id === id);
    if (!view) throw new NotFoundException(NOT_FOUND);
    return view;
  }

  /** Transacción READ COMMITTED: bloqueo de jerarquía PRIMERO, después leer (todo) y validar. */
  private async inTransaction<T>(
    fn: (tx: CategoryTx, rows: CategoryRow[]) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.repo.transaction(async (tx) => {
        await this.repo.lockHierarchy(tx);
        return fn(tx, await this.repo.findAllRows(tx));
      });
    } catch (error) {
      throw translateCategoryDbError(error);
    }
  }
}
