import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminCategory,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@/lib/data-access/models';
import {
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  CATEGORY_SLUG_MAX,
  CATEGORY_SLUG_PATTERN,
  MAX_CATEGORY_DEPTH,
  hasControlChars,
  normalizeCategoryName,
} from '@/lib/category-tree';
import { errorMessage } from '../bo-orders/error-message';

/**
 * Categorías del backoffice (F10) — lógica pura: formulario (validación equivalente a la del servidor solo para dar
 * mensajes inmediatos; la API decide), solicitudes mínimas y traducción de errores por `code` (nunca por `message`).
 * El backoffice es solo español.
 */

export interface CategoryFormValues {
  name: string;
  /** Vacío al crear = el servidor lo genera desde el nombre. */
  slug: string;
  description: string;
  /** '' = raíz. */
  parentId: string;
  active: boolean;
}

export const CATEGORY_FIELDS = ['name', 'slug', 'description', 'parentId'] as const;
export type CategoryField = (typeof CATEGORY_FIELDS)[number];
export type CategoryFormErrors = Partial<Record<CategoryField, string>>;

export const emptyCategoryForm = (parentId = ''): CategoryFormValues => ({
  name: '',
  slug: '',
  description: '',
  parentId,
  active: true,
});

export const categoryToForm = (c: AdminCategory): CategoryFormValues => ({
  name: c.name,
  slug: c.slug,
  description: c.description ?? '',
  parentId: c.parentId ?? '',
  active: c.active,
});

export const NAME_MESSAGE = `Escribe un nombre de 1 a ${CATEGORY_NAME_MAX} caracteres.`;
export const SLUG_MESSAGE = `Usa minúsculas, números y guiones (p. ej. rolls-frios), hasta ${CATEGORY_SLUG_MAX} caracteres.`;
export const DESCRIPTION_MESSAGE = `La descripción admite hasta ${CATEGORY_DESCRIPTION_MAX} caracteres, sin caracteres de control.`;

/** Validación equivalente a la del servidor (mensajes inmediatos). Vacío = válido. */
export function validateCategoryForm(
  values: CategoryFormValues,
  mode: 'create' | 'edit',
): CategoryFormErrors {
  const errors: CategoryFormErrors = {};
  const name = normalizeCategoryName(values.name);
  if (name.length < 1 || name.length > CATEGORY_NAME_MAX) errors.name = NAME_MESSAGE;
  const slug = values.slug.trim();
  if (
    slug === ''
      ? mode === 'edit'
      : !CATEGORY_SLUG_PATTERN.test(slug) || slug.length > CATEGORY_SLUG_MAX
  ) {
    errors.slug = SLUG_MESSAGE;
  }
  if (values.description.length > CATEGORY_DESCRIPTION_MAX || hasControlChars(values.description)) {
    errors.description = DESCRIPTION_MESSAGE;
  }
  return errors;
}

export const firstCategoryError = (errors: CategoryFormErrors): CategoryField | null =>
  CATEGORY_FIELDS.find((f) => errors[f]) ?? null;

export function toCreateRequest(values: CategoryFormValues): CreateCategoryRequest {
  const request: CreateCategoryRequest = {
    name: normalizeCategoryName(values.name),
    parentId: values.parentId || null,
    active: values.active,
  };
  if (values.slug.trim()) request.slug = values.slug.trim();
  if (values.description.trim()) request.description = values.description.trim();
  return request;
}

/** Solo lo que cambió respecto de la categoría vigente; null si no hay cambios. */
export function toUpdateRequest(
  values: CategoryFormValues,
  current: AdminCategory,
): UpdateCategoryRequest | null {
  const patch: UpdateCategoryRequest = {};
  const name = normalizeCategoryName(values.name);
  if (name !== current.name) patch.name = name;
  if (values.slug.trim() !== current.slug) patch.slug = values.slug.trim();
  const description = values.description.trim() || null;
  if (description !== current.description) patch.description = description;
  const parentId = values.parentId || null;
  if (parentId !== current.parentId) patch.parentId = parentId;
  if (values.active !== current.active) patch.active = values.active;
  return Object.keys(patch).length > 0 ? patch : null;
}

export type CategoryErrorKind =
  | 'slugTaken'
  | 'cycle'
  | 'depth'
  | 'parentInvalid'
  | 'reorderMismatch'
  | 'limit'
  | 'busy'
  | 'invalid'
  | 'forbidden'
  | 'unauthorized'
  | 'notFound'
  | 'other';

export interface CategoryServerError {
  kind: CategoryErrorKind;
  message: string;
  fields: CategoryFormErrors;
  /** Hay que volver a pedir la jerarquía (cambió en otra sesión). */
  reload: boolean;
}

const result = (
  kind: CategoryErrorKind,
  message: string,
  fields: CategoryFormErrors = {},
  reload = false,
): CategoryServerError => ({ kind, message, fields, reload });

/**
 * 409 `CATEGORY_SLUG_TAKEN`; 422 `CATEGORY_CYCLE` | `CATEGORY_DEPTH_EXCEEDED` | `CATEGORY_PARENT_INVALID` |
 * `CATEGORY_REORDER_MISMATCH` | `CATEGORY_LIMIT_REACHED`; 400, 401, 403, 404.
 */
export function categoryServerError(error: unknown): CategoryServerError {
  if (!isApiError(error)) return result('other', errorMessage(error));
  switch (error.businessCode) {
    case 'CATEGORY_SLUG_TAKEN':
      return result(
        'slugTaken',
        'Ya existe una categoría con ese slug. Elige otro o déjalo en blanco para generarlo.',
        {
          slug: 'Este slug ya está en uso.',
        },
      );
    case 'CATEGORY_CYCLE':
      return result(
        'cycle',
        'No puedes mover una categoría dentro de sí misma ni de una de sus subcategorías.',
        { parentId: 'Elige otra categoría padre: esta crearía un ciclo.' },
      );
    case 'CATEGORY_DEPTH_EXCEEDED':
      return result(
        'depth',
        `El menú admite como máximo ${MAX_CATEGORY_DEPTH} niveles de categorías.`,
        { parentId: `Superaría los ${MAX_CATEGORY_DEPTH} niveles permitidos.` },
      );
    case 'CATEGORY_PARENT_INVALID':
      return result(
        'parentInvalid',
        'La categoría padre ya no existe o está desactivada. Se recargó la lista.',
        { parentId: 'Elige una categoría padre activa.' },
        true,
      );
    case 'CATEGORY_REORDER_MISMATCH':
      return result(
        'reorderMismatch',
        'Otra persona cambió las categorías de este nivel. Se recargó la lista: vuelve a ordenar.',
        {},
        true,
      );
    case 'CATEGORIES_BUSY':
      return result('busy', 'Hay otra edición en curso. Espera un momento y reintenta.');
    case 'CATEGORY_LIMIT_REACHED':
      return result(
        'limit',
        'Se alcanzó el máximo de 500 categorías. Desactiva o reutiliza una existente.',
      );
  }
  if (error.status === 400) {
    const fields: CategoryFormErrors = {};
    for (const detail of error.details ?? []) {
      const field = CATEGORY_FIELDS.find((f) => detail.startsWith(`${f}:`));
      if (field) fields[field] ??= detail.slice(field.length + 1).trim();
    }
    return result(
      'invalid',
      `Revisa los datos: ${(error.details ?? []).join(' · ') || error.message}`,
      fields,
    );
  }
  if (error.status === 401) {
    return result('unauthorized', 'Tu sesión expiró. Vuelve a iniciar sesión en el backoffice.');
  }
  if (error.status === 403) {
    return result(
      'forbidden',
      'No tienes permiso para modificar categorías: se requiere acceso a todas las sucursales.',
    );
  }
  if (error.status === 404) {
    return result('notFound', 'La categoría ya no existe. Se recargó la lista.', {}, true);
  }
  return result('other', errorMessage(error));
}
