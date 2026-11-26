import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminCategory,
  AdminCategoryList,
  CreateCategoryRequest,
  PublicCategoryTree,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F10 — Categorías y jerarquía del menú. Operaciones del contrato: listStoreCategories, listAdminCategories,
 * createAdminCategory, updateAdminCategory, reorderAdminCategories y deleteAdminCategory (ADR-0034: borrado físico solo si no está
 * en uso; la alternativa reversible es `active=false`).
 * Los errores de negocio llegan en `ApiError.businessCode` (`CATEGORY_*`); la UI ramifica por él, nunca por `message`.
 * La API decide permisos y alcance (401/403): las escrituras exigen alcance global.
 */
export interface CategoryFilters {
  /** undefined = todas. */
  active?: boolean;
  /** Solo hijos directos de esa categoría. */
  parentId?: string;
  /** Nombre o slug (contiene; sin distinguir mayúsculas ni acentos); máx. 80. */
  q?: string;
}

/** Público: árbol anidado (máx. 3 niveles) SOLO con categorías visibles (ella y todos sus ancestros activos). */
export const listStoreCategories = (client: DataClient) =>
  client.get<PublicCategoryTree>(paths.storeCategories(), { public: true });

/** Lista PLANA (activas e inactivas) en orden depth-first con `depth` y `effectivelyVisible`. Tope 500. */
export const listAdminCategories = (client: DataClient, filters: CategoryFilters = {}) =>
  client.get<AdminCategoryList>(paths.adminCategories(), {
    query: {
      active: filters.active,
      parentId: filters.parentId,
      q: filters.q?.trim() || undefined,
    },
  });

/** 409 `CATEGORY_SLUG_TAKEN`; 422 `CATEGORY_PARENT_INVALID` | `CATEGORY_DEPTH_EXCEEDED` | `CATEGORY_LIMIT_REACHED`. */
/** `active` es opcional (por defecto `true`): el tipo generado lo marca obligatorio por su `default`. */
export type CreateCategoryInput = Omit<CreateCategoryRequest, 'active'> & { active?: boolean };

export const createAdminCategory = (client: DataClient, input: CreateCategoryInput) =>
  client.post<AdminCategory>(paths.adminCategories(), input);

/** Editar, mover (`parentId`) y activar/desactivar (`active`). 409 `CATEGORY_SLUG_TAKEN`; 422 `CATEGORY_CYCLE` | `CATEGORY_DEPTH_EXCEEDED` | `CATEGORY_PARENT_INVALID`. */
export const updateAdminCategory = (client: DataClient, id: string, input: UpdateCategoryRequest) =>
  client.patch<AdminCategory>(paths.adminCategory(id), input);

/** `orderedIds` = EXACTAMENTE los hermanos actuales de `parentId`. 422 `CATEGORY_REORDER_MISMATCH`; 404 si el padre no existe. */
export const reorderAdminCategories = (client: DataClient, input: ReorderCategoriesRequest) =>
  client.put<AdminCategoryList>(paths.adminCategoriesReorder(), input);

/**
 * Borrado físico (204, ADR-0034). 409 `CATEGORY_IN_USE` (el cuerpo trae `usage` con conteos de subcategorías, productos y banners);
 * 404 si no existe (repetirlo también); 403 sin `catalog.update` global; 503 `CATEGORIES_BUSY` (reintentable).
 */
export const deleteAdminCategory = (client: DataClient, id: string) =>
  client.delete<void>(paths.adminCategory(id));
