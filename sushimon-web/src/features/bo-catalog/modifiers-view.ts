import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminModifierGroupSummary,
  CreateModifierGroupRequest,
  UpdateModifierGroupRequest,
} from '@/lib/data-access/models';
import {
  MODIFIER_MAX_SELECT_LIMIT,
  MODIFIER_NAME_MAX,
  MODIFIER_OPTIONS_MAX,
  PRODUCT_MODIFIER_GROUPS_MAX,
  areLimitsValid,
  hasModifierNameControlChars,
  modifierNameKey,
  normalizeModifierName,
  parseExtraPriceInput,
  selectionRule,
} from '@/lib/modifier-rules';
import { errorMessage } from '@/features/bo-orders/error-message';
import { BUSY_MESSAGE } from './products-view';

/**
 * F12 — Lógica pura de los formularios y de los errores de modificadores del backoffice. Sin React ni red. El servidor decide
 * siempre: esta validación solo avisa antes de enviar. Los errores de negocio se ramifican por `code` (nunca por `message`).
 */

export { BUSY_MESSAGE };

// ── Formulario del grupo ───────────────────────────────────────────────────────────────────

export interface OptionFormRow {
  /** Clave estable de la fila (no viaja al servidor). */
  key: string;
  name: string;
  /** Texto del precio (`5`, `4,50`); vacío = `0.00`. */
  price: string;
}

export interface GroupFormValues {
  name: string;
  /** Enteros como texto del campo. */
  minSelect: string;
  maxSelect: string;
  active: boolean;
  /** Solo al CREAR (opciones iniciales); al editar las opciones se gestionan aparte. */
  options: OptionFormRow[];
}

export const GROUP_FIELDS = ['name', 'minSelect', 'maxSelect', 'options'] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];
export type GroupFormErrors = Partial<Record<GroupField, string>>;

let rowSeq = 0;
export const newOptionRow = (name = '', price = ''): OptionFormRow => ({
  key: `o${++rowSeq}`,
  name,
  price,
});

export const emptyGroupForm = (): GroupFormValues => ({
  name: '',
  minSelect: '0',
  maxSelect: '1',
  active: true,
  options: [],
});

export const groupToForm = (g: AdminModifierGroupSummary): GroupFormValues => ({
  name: g.name,
  minSelect: String(g.minSelect),
  maxSelect: String(g.maxSelect),
  active: g.active,
  options: [],
});

export const NAME_MESSAGE = `Escribe un nombre de 1 a ${MODIFIER_NAME_MAX} caracteres, sin caracteres de control.`;
export const LIMITS_MESSAGE = `Mínimo y máximo no válidos: 0 ≤ mínimo ≤ máximo, y el máximo entre 1 y ${MODIFIER_MAX_SELECT_LIMIT}.`;
export const PRICE_MESSAGE = 'Escribe un precio extra de Q0.00 a Q9,999.99 (máximo 2 decimales).';
export const UNREACHABLE_MESSAGE =
  'El mínimo supera las opciones del grupo: agrega opciones, baja el mínimo o deja el grupo inactivo.';

/** Entero estricto (solo dígitos) o `null`. */
export const parseWholeNumber = (text: string): number | null =>
  /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;

export function validateOptionName(name: string): string | null {
  const normalized = normalizeModifierName(name);
  return normalized.length < 1 ||
    normalized.length > MODIFIER_NAME_MAX ||
    hasModifierNameControlChars(normalized)
    ? NAME_MESSAGE
    : null;
}

/** Mismas reglas que el servidor para avisar antes de enviar. `mode` solo importa para las opciones iniciales (alta). */
export function validateGroupForm(
  values: GroupFormValues,
  mode: 'create' | 'edit',
): GroupFormErrors {
  const errors: GroupFormErrors = {};
  if (validateOptionName(values.name)) errors.name = NAME_MESSAGE;
  const min = parseWholeNumber(values.minSelect);
  const max = parseWholeNumber(values.maxSelect);
  if (min === null) errors.minSelect = LIMITS_MESSAGE;
  if (max === null) errors.maxSelect = LIMITS_MESSAGE;
  if (min !== null && max !== null && !areLimitsValid(min, max)) {
    errors.minSelect = LIMITS_MESSAGE;
    errors.maxSelect = LIMITS_MESSAGE;
  }
  if (mode === 'create') {
    const rows = values.options;
    if (rows.length > MODIFIER_OPTIONS_MAX) {
      errors.options = `Máximo ${MODIFIER_OPTIONS_MAX} opciones por grupo.`;
    } else {
      const seen = new Set<string>();
      for (const [i, row] of rows.entries()) {
        if (validateOptionName(row.name)) {
          errors.options = `Opción ${i + 1}: ${NAME_MESSAGE}`;
          break;
        }
        if (parseExtraPriceInput(row.price) === null) {
          errors.options = `Opción ${i + 1}: ${PRICE_MESSAGE}`;
          break;
        }
        const key = modifierNameKey(row.name);
        if (seen.has(key)) {
          errors.options = `Opción ${i + 1}: el nombre está repetido en el grupo.`;
          break;
        }
        seen.add(key);
      }
      if (!errors.options && values.active && min !== null && min > rows.length) {
        errors.minSelect = UNREACHABLE_MESSAGE;
      }
    }
  }
  return errors;
}

export const firstGroupError = (errors: GroupFormErrors): GroupField | null =>
  GROUP_FIELDS.find((f) => errors[f]) ?? null;

/** Alta: el formulario ya está validado. `options` solo se envía si hay filas. */
export function toCreateGroupRequest(values: GroupFormValues): CreateModifierGroupRequest {
  return {
    name: normalizeModifierName(values.name),
    minSelect: parseWholeNumber(values.minSelect) as number,
    maxSelect: parseWholeNumber(values.maxSelect) as number,
    active: values.active,
    ...(values.options.length > 0
      ? {
          options: values.options.map((o) => ({
            name: normalizeModifierName(o.name),
            extraPrice: parseExtraPriceInput(o.price) as string,
          })),
        }
      : {}),
  };
}

/** Solo lo que cambió (o `null` si nada): el PATCH exige al menos un campo. */
export function toUpdateGroupRequest(
  values: GroupFormValues,
  current: AdminModifierGroupSummary,
): UpdateModifierGroupRequest | null {
  const patch: UpdateModifierGroupRequest = {};
  const name = normalizeModifierName(values.name);
  if (name !== current.name) patch.name = name;
  const min = parseWholeNumber(values.minSelect) as number;
  if (min !== current.minSelect) patch.minSelect = min;
  const max = parseWholeNumber(values.maxSelect) as number;
  if (max !== current.maxSelect) patch.maxSelect = max;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ── Presentación ───────────────────────────────────────────────────────────────────────────

/** Regla de elección legible: «Elige 1», «Elige hasta 3» o «Elige de 2 a 4». */
export function ruleText(minSelect: number, maxSelect: number): string {
  const rule = selectionRule(minSelect, maxSelect);
  if (rule.kind === 'exactly') return `Elige ${rule.count}`;
  if (rule.kind === 'upTo') return `Elige hasta ${rule.max}`;
  return `Elige de ${rule.min} a ${rule.max}`;
}

export type ModifierStatusFilter = 'all' | 'active' | 'inactive';
export const modifierStatusToActive = (s: ModifierStatusFilter): boolean | undefined =>
  s === 'all' ? undefined : s === 'active';

/** Grupos que se pueden AÑADIR a un producto: activos y aún no asociados. */
export function addableGroups<T extends { id: string; active: boolean }>(
  all: readonly T[],
  selectedIds: readonly string[],
): T[] {
  return all.filter((g) => g.active && !selectedIds.includes(g.id));
}

export const canAddMoreGroups = (selectedIds: readonly string[]): boolean =>
  selectedIds.length < PRODUCT_MODIFIER_GROUPS_MAX;

export const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

// ── Errores del servidor ───────────────────────────────────────────────────────────────────

export type ModifierErrorKind =
  | 'groupNameTaken'
  | 'optionNameTaken'
  | 'limitsInvalid'
  | 'unsatisfiable'
  | 'limitReached'
  | 'reorderMismatch'
  | 'groupInvalid'
  | 'notFound'
  | 'busy'
  | 'invalid'
  | 'forbidden'
  | 'unauthorized'
  | 'other';

export interface ModifierServerError {
  kind: ModifierErrorKind;
  message: string;
  fields: GroupFormErrors & { optionName?: string; optionPrice?: string };
  /** Hay que volver a pedir datos (otra sesión cambió grupos, opciones o el producto). */
  reload: boolean;
}

const result = (
  kind: ModifierErrorKind,
  message: string,
  fields: ModifierServerError['fields'] = {},
  reload = false,
): ModifierServerError => ({ kind, message, fields, reload });

/**
 * 409 `MODIFIER_GROUP_NAME_TAKEN` | `MODIFIER_NAME_TAKEN`; 422 `MODIFIER_LIMITS_INVALID` | `MODIFIER_GROUP_UNSATISFIABLE` |
 * `MODIFIER_LIMIT_REACHED` | `MODIFIER_REORDER_MISMATCH` | `MODIFIER_GROUP_INVALID`; 404 `MODIFIER_GROUP_NOT_FOUND` |
 * `MODIFIER_NOT_FOUND` | `PRODUCT_NOT_FOUND`; 503 `MODIFIERS_BUSY`; 400, 401, 403.
 */
export function modifierServerError(error: unknown): ModifierServerError {
  if (!isApiError(error)) return result('other', errorMessage(error));
  switch (error.businessCode) {
    case 'MODIFIER_GROUP_NAME_TAKEN':
      return result('groupNameTaken', 'Ya existe un grupo con ese nombre. Elige otro.', {
        name: 'Este nombre ya está en uso.',
      });
    case 'MODIFIER_NAME_TAKEN':
      return result('optionNameTaken', 'Ya existe una opción con ese nombre en el grupo.', {
        options: 'Hay un nombre de opción repetido.',
        optionName: 'Este nombre ya está en uso en el grupo.',
      });
    case 'MODIFIER_LIMITS_INVALID':
      return result(
        'limitsInvalid',
        'Los límites no son válidos: 0 ≤ mínimo ≤ máximo (máximo 1–20), y un grupo activo necesita al menos tantas opciones activas como su mínimo.',
        { minSelect: LIMITS_MESSAGE, maxSelect: LIMITS_MESSAGE },
      );
    case 'MODIFIER_GROUP_UNSATISFIABLE':
      return result(
        'unsatisfiable',
        'No se puede desactivar esa opción: el grupo quedaría con menos opciones activas que su mínimo. Baja el mínimo o desactiva el grupo primero.',
      );
    case 'MODIFIER_LIMIT_REACHED':
      return result(
        'limitReached',
        `Se alcanzó el límite: máximo ${MODIFIER_OPTIONS_MAX} opciones por grupo y ${PRODUCT_MODIFIER_GROUPS_MAX} grupos por producto.`,
        { options: `Máximo ${MODIFIER_OPTIONS_MAX} opciones por grupo.` },
      );
    case 'MODIFIER_REORDER_MISMATCH':
      return result(
        'reorderMismatch',
        'El orden no coincide con las opciones actuales (otra sesión las cambió). Se recargó la lista.',
        {},
        true,
      );
    case 'MODIFIER_GROUP_INVALID':
      return result(
        'groupInvalid',
        'Algún grupo ya no existe o está inactivo. Se recargó la lista de grupos.',
        {},
        true,
      );
    case 'MODIFIER_GROUP_NOT_FOUND':
      return result('notFound', 'El grupo ya no existe. Se recargó la lista.', {}, true);
    case 'MODIFIER_NOT_FOUND':
      return result('notFound', 'La opción ya no existe. Se recargó la lista.', {}, true);
    case 'PRODUCT_NOT_FOUND':
      return result('notFound', 'El producto ya no existe. Se recargó la lista.', {}, true);
    case 'MODIFIERS_BUSY':
      return result('busy', BUSY_MESSAGE);
  }
  if (error.status === 400) {
    return result(
      'invalid',
      `Revisa los datos: ${(error.details ?? []).join(' · ') || error.message}`,
    );
  }
  if (error.status === 401) {
    return result('unauthorized', 'Tu sesión expiró. Vuelve a iniciar sesión en el backoffice.');
  }
  if (error.status === 403) {
    return result(
      'forbidden',
      'No tienes permiso para modificar extras: se requiere acceso a todas las sucursales.',
    );
  }
  if (error.status === 404)
    return result('notFound', 'No se encontró el recurso. Se recargó.', {}, true);
  return result('other', errorMessage(error));
}
