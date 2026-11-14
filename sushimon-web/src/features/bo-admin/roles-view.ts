import { isApiError } from '@/lib/data-access/errors';
import { errorMessage } from '../bo-orders/error-message';

/** Roles y permisos (UI) — F03. Lógica pura; el servidor valida (403 alcance, 409 rol del sistema, 400 códigos). */

export interface PermissionDiff {
  added: string[];
  removed: string[];
}

/** Diferencia entre los permisos actuales de un rol y el borrador. */
export function diffPermissions(
  current: readonly string[],
  draft: readonly string[],
): PermissionDiff {
  const before = new Set(current);
  const after = new Set(draft);
  return {
    added: [...after].filter((c) => !before.has(c)).sort(),
    removed: [...before].filter((c) => !after.has(c)).sort(),
  };
}

export const hasPermissionChanges = (d: PermissionDiff) => d.added.length + d.removed.length > 0;

/** Marca/desmarca un permiso. */
export const togglePermission = (draft: readonly string[], code: string): string[] =>
  draft.includes(code) ? draft.filter((c) => c !== code) : [...draft, code];

/** Marca o desmarca todos los permisos de un módulo. */
export function setModule(
  draft: readonly string[],
  moduleCodes: readonly string[],
  on: boolean,
): string[] {
  const rest = draft.filter((c) => !moduleCodes.includes(c));
  return on ? [...rest, ...moduleCodes] : rest;
}

export function rolePermissionsError(error: unknown): string {
  if (!isApiError(error)) return errorMessage(error);
  if (error.status === 403) {
    return 'No puedes otorgar permisos que tú no tienes con alcance global.';
  }
  if (error.status === 409) return 'Los roles del sistema no se pueden editar.';
  if (error.status === 404) return 'El rol ya no existe.';
  if (error.status === 400) {
    return `Revisa los permisos: ${error.details?.length ? error.details.join(' · ') : error.message}`;
  }
  return errorMessage(error);
}
