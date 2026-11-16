import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminModifier,
  AdminModifierGroup,
  AdminModifierGroupPage,
  AdminModifierList,
  AdminProductModifiers,
  CreateModifierGroupRequest,
  CreateModifierRequest,
  ReorderModifiersRequest,
  UpdateModifierGroupRequest,
  UpdateModifierRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F12 — Modificadores (extras) de producto. Operaciones del contrato: listAdminModifierGroups, createAdminModifierGroup,
 * getAdminModifierGroup, updateAdminModifierGroup, createAdminModifier, reorderAdminModifiers, updateAdminModifier,
 * getAdminProductModifiers y replaceAdminProductModifierGroups. La ficha pública trae `modifierGroups` en
 * `getStoreProduct` (`services/products.ts`). Sin borrado físico: se desactiva con `active=false`. Los importes extra son
 * CADENAS decimales (`"5.00"`). Los errores de negocio llegan en `ApiError.businessCode` (`MODIFIER_*`, `MODIFIERS_BUSY`); la UI
 * ramifica por él, nunca por `message`. La API decide permisos y alcance (401/403): lectura `catalog.read`; escrituras con
 * alcance global. El cliente nunca aporta precios al cotizar: el servidor recalcula (F19).
 */

export interface ModifierGroupFilters {
  /** Nombre del grupo (contiene; sin distinguir mayúsculas ni acentos); máx. 80. */
  q?: string;
  /** undefined = todos. */
  active?: boolean;
  page?: number;
  pageSize?: number;
}

/** Resumen paginado (sin opciones) con `optionCount`, `activeOptionCount` y `productCount`. Orden `name, id`. */
export const listAdminModifierGroups = (client: DataClient, filters: ModifierGroupFilters = {}) =>
  client.get<AdminModifierGroupPage>(paths.adminModifierGroups(), {
    query: {
      q: filters.q?.trim() || undefined,
      active: filters.active,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

/** Detalle con TODAS las opciones (activas e inactivas) ordenadas. 404 `MODIFIER_GROUP_NOT_FOUND`. */
export const getAdminModifierGroup = (client: DataClient, id: string) =>
  client.get<AdminModifierGroup>(paths.adminModifierGroup(id));

/**
 * 409 `MODIFIER_GROUP_NAME_TAKEN` | `MODIFIER_NAME_TAKEN`; 422 `MODIFIER_LIMITS_INVALID` | `MODIFIER_LIMIT_REACHED`;
 * 503 `MODIFIERS_BUSY`; 400, 401, 403. `options` permite crear un grupo obligatorio ya satisfecho.
 */
export const createAdminModifierGroup = (client: DataClient, input: CreateModifierGroupRequest) =>
  client.post<AdminModifierGroup>(paths.adminModifierGroups(), input);

/** PATCH parcial (nombre, límites, activar/desactivar). 404 `MODIFIER_GROUP_NOT_FOUND`; 409 `MODIFIER_GROUP_NAME_TAKEN`; 422 `MODIFIER_LIMITS_INVALID`. */
export const updateAdminModifierGroup = (
  client: DataClient,
  id: string,
  input: UpdateModifierGroupRequest,
) => client.patch<AdminModifierGroup>(paths.adminModifierGroup(id), input);

/** Agrega una opción al final. 404 `MODIFIER_GROUP_NOT_FOUND`; 409 `MODIFIER_NAME_TAKEN`; 422 `MODIFIER_LIMIT_REACHED` (máx. 30). */
export const createAdminModifier = (
  client: DataClient,
  groupId: string,
  input: CreateModifierRequest,
) => client.post<AdminModifier>(paths.adminModifierGroupOptions(groupId), input);

/** `orderedIds` = EXACTAMENTE las opciones actuales del grupo. 422 `MODIFIER_REORDER_MISMATCH`. Responde la lista ya ordenada. */
export const reorderAdminModifiers = (
  client: DataClient,
  groupId: string,
  input: ReorderModifiersRequest,
) => client.put<AdminModifierList>(paths.adminModifierGroupReorder(groupId), input);

/** PATCH parcial de una opción. 404 `MODIFIER_NOT_FOUND`; 409 `MODIFIER_NAME_TAKEN`; 422 `MODIFIER_GROUP_UNSATISFIABLE`. */
export const updateAdminModifier = (client: DataClient, id: string, input: UpdateModifierRequest) =>
  client.patch<AdminModifier>(paths.adminModifier(id), input);

/** Grupos asociados al producto (activos e inactivos) en orden, con todas sus opciones. 404 `PRODUCT_NOT_FOUND`. */
export const getAdminProductModifiers = (client: DataClient, productId: string) =>
  client.get<AdminProductModifiers>(paths.adminProductModifiers(productId));

/**
 * REEMPLAZA la lista de grupos del producto (`[]` la vacía; máx. 10). 404 `PRODUCT_NOT_FOUND`; 422 `MODIFIER_GROUP_INVALID`
 * (duplicados, inexistentes o inactivos recién añadidos) | `MODIFIER_LIMIT_REACHED`; 503 `MODIFIERS_BUSY`.
 */
export const replaceAdminProductModifierGroups = (
  client: DataClient,
  productId: string,
  groupIds: string[],
) => client.put<AdminProductModifiers>(paths.adminProductModifierGroups(productId), { groupIds });
