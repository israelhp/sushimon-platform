import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminBranch,
  CreateBranchRequest,
  DraftOrder,
  UpdateBranchRequest,
} from '@/lib/data-access/models';
import type { AdminBranchFilters } from '@/services/branches';
import { errorMessage } from '../bo-orders/error-message';
import { isActive } from '../bo-orders/order-view';

/**
 * Sucursales (UI) — F07. Lógica pura de formularios, filtros y errores. Los campos de operación (horario, cobertura,
 * radio, estadísticas) son SIMULADOS (F08/F09/F33) y se usan solo para mostrarlos con la insignia «Simulación».
 * No existe tope de sucursales (spec F07 D9): el «5» del prototipo es una decisión comercial pendiente.
 */

// ── Formulario ────────────────────────────────────────────────────────────────────────────

export interface BranchFormValues {
  code: string;
  name: string;
  address: string;
  phone: string;
  latitude: string;
  longitude: string;
}

export type BranchFormField = keyof BranchFormValues;
export type BranchFormErrors = Partial<Record<BranchFormField, string>>;

/** Orden de los campos en pantalla (para enfocar el primero con error). */
export const BRANCH_FORM_FIELDS: readonly BranchFormField[] = [
  'code',
  'name',
  'address',
  'phone',
  'latitude',
  'longitude',
];

export const emptyBranchForm = (): BranchFormValues => ({
  code: '',
  name: '',
  address: '',
  phone: '',
  latitude: '',
  longitude: '',
});

export const branchToForm = (branch: AdminBranch): BranchFormValues => ({
  code: branch.code,
  name: branch.name,
  address: branch.address,
  phone: branch.phone ?? '',
  latitude: branch.latitude === null ? '' : String(branch.latitude),
  longitude: branch.longitude === null ? '' : String(branch.longitude),
});

/** Misma normalización que la API: recorta y pasa a minúsculas. */
export const normalizeBranchCode = (code: string) => code.trim().toLowerCase();

const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PHONE_CHARS_RE = /^[0-9+\s()-]+$/;

function parseCoordinate(raw: string): number | null | 'invalid' {
  const value = raw.trim();
  if (value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : 'invalid';
}

/** Valida como el contrato (CreateBranchRequest). En edición `code` no se valida: es inmutable. */
export function validateBranchForm(
  values: BranchFormValues,
  mode: 'create' | 'edit' = 'create',
): BranchFormErrors {
  const errors: BranchFormErrors = {};
  if (mode === 'create') {
    const code = normalizeBranchCode(values.code);
    if (!code) errors.code = 'Escribe el código de la sucursal.';
    else if (code.length < 2 || code.length > 40)
      errors.code = 'El código debe tener entre 2 y 40 caracteres.';
    else if (!CODE_RE.test(code))
      errors.code =
        'Usa minúsculas, números y guiones (sin guion al inicio, al final ni repetido).';
  }
  const name = values.name.trim();
  if (!name) errors.name = 'Escribe el nombre de la sucursal.';
  else if (name.length > 100) errors.name = 'El nombre admite hasta 100 caracteres.';
  const address = values.address.trim();
  if (!address) errors.address = 'Escribe la dirección de la sucursal.';
  else if (address.length > 300) errors.address = 'La dirección admite hasta 300 caracteres.';

  const phone = values.phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, '').length;
    if (phone.length > 25 || !PHONE_CHARS_RE.test(phone) || digits < 7 || digits > 15) {
      errors.phone = 'Indica de 7 a 15 dígitos (se admiten +, espacios, guiones y paréntesis).';
    }
  }

  const lat = parseCoordinate(values.latitude);
  const lon = parseCoordinate(values.longitude);
  if (lat === 'invalid' || (typeof lat === 'number' && Math.abs(lat) > 90))
    errors.latitude = 'La latitud debe ser un número entre -90 y 90.';
  if (lon === 'invalid' || (typeof lon === 'number' && Math.abs(lon) > 180))
    errors.longitude = 'La longitud debe ser un número entre -180 y 180.';
  if (!errors.latitude && !errors.longitude && (lat === null) !== (lon === null)) {
    const missing = lat === null ? 'latitude' : 'longitude';
    errors[missing] = 'Indica latitud y longitud juntas, o deja ambas vacías.';
  }
  return errors;
}

export const firstBranchError = (errors: BranchFormErrors): BranchFormField | undefined =>
  BRANCH_FORM_FIELDS.find((f) => errors[f]);

/** Cuerpo de `POST /v1/admin/branches` (valores ya validados). Sin coordenadas ficticias. */
export function toCreateRequest(values: BranchFormValues): CreateBranchRequest {
  const lat = parseCoordinate(values.latitude);
  const lon = parseCoordinate(values.longitude);
  return {
    code: normalizeBranchCode(values.code),
    name: values.name.trim(),
    address: values.address.trim(),
    phone: values.phone.trim() || null,
    latitude: typeof lat === 'number' ? lat : null,
    longitude: typeof lon === 'number' ? lon : null,
    active: true,
  };
}

/**
 * Cuerpo de `PATCH /v1/admin/branches/{id}` con SOLO los campos que cambiaron (nunca `code`/`active`).
 * `null` = no hay cambios (el contrato exige al menos un campo).
 */
export function toUpdateRequest(
  values: BranchFormValues,
  original: AdminBranch,
): UpdateBranchRequest | null {
  const next = toCreateRequest({ ...values, code: original.code });
  const patch: UpdateBranchRequest = {};
  if (next.name !== original.name) patch.name = next.name;
  if (next.address !== original.address) patch.address = next.address;
  if ((next.phone ?? null) !== original.phone) patch.phone = next.phone ?? null;
  if ((next.latitude ?? null) !== original.latitude) patch.latitude = next.latitude ?? null;
  if ((next.longitude ?? null) !== original.longitude) patch.longitude = next.longitude ?? null;
  return Object.keys(patch).length ? patch : null;
}

// ── Estado administrativo ─────────────────────────────────────────────────────────────────

export const REASON_MAX = 200;

/** Motivo obligatorio al desactivar (máx. 200). Devuelve el mensaje de error o ''. */
export function validateStatusReason(reason: string, activating: boolean): string {
  const value = reason.trim();
  if (value.length > REASON_MAX) return `El motivo admite hasta ${REASON_MAX} caracteres.`;
  if (!activating && !value) return 'Escribe el motivo de la desactivación.';
  return '';
}

// ── Errores del servidor ──────────────────────────────────────────────────────────────────

export interface BranchServerError {
  /** Mensaje general (banner). */
  message: string;
  /** Errores asignables a un campo (409 → code; 400 con `details` que nombran el campo). */
  fields: BranchFormErrors;
}

/** Traduce un error de la capa de datos a mensajes por campo y general (409, 400, 403, 404…). */
export function branchServerError(error: unknown): BranchServerError {
  if (!isApiError(error)) return { message: errorMessage(error), fields: {} };
  if (error.status === 409) {
    return {
      message: 'Ya existe una sucursal con ese código.',
      fields: { code: 'Ya existe una sucursal con ese código. Elige otro.' },
    };
  }
  if (error.status === 403) {
    return { message: 'No tienes permiso para esta acción sobre sucursales.', fields: {} };
  }
  if (error.status === 404) {
    return { message: 'La sucursal ya no existe o no está en tu alcance.', fields: {} };
  }
  if (error.status === 400) {
    const fields: BranchFormErrors = {};
    for (const detail of error.details ?? []) {
      const field = BRANCH_FORM_FIELDS.find((f) => detail.toLowerCase().startsWith(`${f}:`));
      if (field && !fields[field]) fields[field] = detail.slice(field.length + 1).trim();
    }
    const rest = (error.details ?? []).length ? (error.details ?? []).join(' · ') : error.message;
    return { message: `Revisa los datos: ${rest}`, fields };
  }
  return { message: errorMessage(error), fields: {} };
}

// ── Filtros y listado ─────────────────────────────────────────────────────────────────────

export type BranchStatusFilter = 'all' | 'active' | 'inactive';
export type BranchSortKey = 'name' | 'code' | 'createdAt';

export interface BranchListState {
  q: string;
  status: BranchStatusFilter;
  sort: BranchSortKey;
  order: 'asc' | 'desc';
  page: number;
}

export const BRANCH_PAGE_SIZE = 12;

export const DEFAULT_BRANCH_LIST: BranchListState = {
  q: '',
  status: 'all',
  sort: 'name',
  order: 'asc',
  page: 1,
};

export const toAdminFilters = (state: BranchListState): AdminBranchFilters => ({
  q: state.q.trim() || undefined,
  active: state.status === 'all' ? undefined : state.status === 'active',
  sort: state.sort,
  order: state.order,
  page: state.page,
  pageSize: BRANCH_PAGE_SIZE,
});

export const pageCount = (total: number, pageSize = BRANCH_PAGE_SIZE) =>
  Math.max(1, Math.ceil(total / pageSize));

export const hasActiveFilters = (state: BranchListState) =>
  state.q.trim() !== '' || state.status !== 'all';

export function coordinatesLabel(branch: Pick<AdminBranch, 'latitude' | 'longitude'>): string {
  return branch.latitude === null || branch.longitude === null
    ? 'Sin coordenadas'
    : `${branch.latitude}, ${branch.longitude}`;
}

// ── Estadísticas simuladas (F33) ──────────────────────────────────────────────────────

export interface BranchStats {
  orders: number;
  active: number;
  sales: number;
}

/** Estadísticas de hoy de una sucursal (SIMULADAS): pedidos y ventas del panel + los que siguen en curso. */
export function branchStats(
  branchId: string,
  byBranch: readonly { branchId: string; orders: number; sales: number }[] | undefined,
  todayOrders: readonly DraftOrder[] | undefined,
): BranchStats {
  const row = byBranch?.find((b) => b.branchId === branchId);
  return {
    orders: row?.orders ?? 0,
    sales: row?.sales ?? 0,
    active: (todayOrders ?? []).filter((o) => o.branchId === branchId && isActive(o)).length,
  };
}
