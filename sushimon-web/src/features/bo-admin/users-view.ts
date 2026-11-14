import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminRole,
  AdminStaff,
  CreateStaffRequest,
  StaffAssignmentInput,
  StaffRole,
  UpdateStaffRequest,
} from '@/lib/data-access/models';
import { can, canGlobally, type Grants } from '@/lib/permissions';
import type { PillTone } from '@/components/ui/Pill';
import type { AdminStaffFilters } from '@/services/staff';
import { errorMessage } from '../bo-orders/error-message';

/**
 * Usuarios (UI) — F03. Lógica pura de formularios, filtros y errores. La UI solo orienta (valida lo evidente y oculta lo
 * que no corresponde): el servidor decide permisos, alcance, regla del subconjunto, último administrador y unicidad.
 */

export const ROLE_PILL_TONE: Record<StaffRole, PillTone> = {
  admin: 'info',
  manager: 'alert',
  kitchen: 'confirmed',
  staff: 'muted',
};

export const ROLE_ORDER: readonly StaffRole[] = ['admin', 'manager', 'staff', 'kitchen'];

/** Misma regla que el servidor mock (`isValidEmail`). */
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

/** Misma normalización que la API: recorta y pasa a minúsculas. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const MAX_ASSIGNMENTS = 20;
export const GLOBAL_BRANCH = 'global';

// ── Formulario ────────────────────────────────────────────────────────────────────────────

export interface AssignmentDraft {
  roleId: string;
  /** '' = sin elegir; `GLOBAL_BRANCH` = todas las sucursales (solo rol admin). */
  branchId: string;
}

export interface StaffFormValues {
  fullName: string;
  email: string;
  assignments: AssignmentDraft[];
}

export type StaffFormField = 'fullName' | 'email' | 'assignments';

export interface StaffFormErrors {
  fullName?: string;
  email?: string;
  /** Error general de las asignaciones (cantidad). */
  assignments?: string;
  /** Error por fila (índice). */
  rows: Record<number, string>;
}

export const emptyStaffForm = (): StaffFormValues => ({
  fullName: '',
  email: '',
  assignments: [{ roleId: '', branchId: '' }],
});

export const staffToForm = (staff: AdminStaff): StaffFormValues => ({
  fullName: staff.fullName,
  email: staff.email,
  assignments: assignmentsToDrafts(staff),
});

export const assignmentsToDrafts = (staff: AdminStaff): AssignmentDraft[] =>
  staff.assignments.map((a) => ({ roleId: a.role.id, branchId: a.branch?.id ?? GLOBAL_BRANCH }));

const isAdminRole = (roles: readonly AdminRole[], roleId: string) =>
  roles.find((r) => r.id === roleId)?.code === 'admin';

/** Valida asignaciones como el contrato (1..20, rol y sucursal coherentes, sin duplicados). */
export function validateAssignments(
  drafts: readonly AssignmentDraft[],
  roles: readonly AdminRole[],
): Pick<StaffFormErrors, 'assignments' | 'rows'> {
  const rows: Record<number, string> = {};
  let general: string | undefined;
  if (drafts.length < 1) general = 'Agrega al menos una asignación (rol y sucursal).';
  else if (drafts.length > MAX_ASSIGNMENTS) general = `Máximo ${MAX_ASSIGNMENTS} asignaciones.`;
  const seen = new Set<string>();
  drafts.forEach((d, i) => {
    if (!d.roleId) rows[i] = 'Elige un rol.';
    else if (isAdminRole(roles, d.roleId) && d.branchId !== GLOBAL_BRANCH) {
      rows[i] = 'El administrador es global: elige «Todas las sucursales».';
    } else if (!isAdminRole(roles, d.roleId) && (!d.branchId || d.branchId === GLOBAL_BRANCH)) {
      rows[i] = 'Elige una sucursal (el alcance global es solo del administrador).';
    } else if (seen.has(`${d.roleId}|${d.branchId}`)) rows[i] = 'Asignación repetida.';
    seen.add(`${d.roleId}|${d.branchId}`);
  });
  return { assignments: general, rows };
}

export function validateStaffForm(
  values: StaffFormValues,
  roles: readonly AdminRole[],
  mode: 'create' | 'edit' = 'create',
  emailLocked = false,
): StaffFormErrors {
  const errors: StaffFormErrors = { rows: {} };
  const name = values.fullName.trim();
  if (!name) errors.fullName = 'Escribe el nombre completo.';
  else if (name.length < 2 || name.length > 100) {
    errors.fullName = 'El nombre debe tener entre 2 y 100 caracteres.';
  }
  if (!(mode === 'edit' && emailLocked)) {
    const email = values.email.trim();
    if (!email) errors.email = 'Escribe el correo.';
    else if (!isValidEmail(email) || email.length > 254) errors.email = 'Escribe un correo válido.';
  }
  if (mode === 'create') {
    const a = validateAssignments(values.assignments, roles);
    errors.assignments = a.assignments;
    errors.rows = a.rows;
  }
  return errors;
}

export const hasFormErrors = (e: StaffFormErrors) =>
  Boolean(e.fullName || e.email || e.assignments) || Object.keys(e.rows).length > 0;

/** Primer campo con error, en el orden del formulario (para enfocarlo). */
export const firstStaffError = (e: StaffFormErrors): StaffFormField | undefined =>
  e.fullName
    ? 'fullName'
    : e.email
      ? 'email'
      : e.assignments || Object.keys(e.rows).length
        ? 'assignments'
        : undefined;

export const toAssignmentInputs = (drafts: readonly AssignmentDraft[]): StaffAssignmentInput[] =>
  drafts.map((d) => ({
    roleId: d.roleId,
    branchId: d.branchId === GLOBAL_BRANCH ? null : d.branchId,
  }));

/** Cuerpo de `POST /v1/admin/staff` (valores ya validados). Nunca `authUserId`. */
export const toCreateStaffRequest = (values: StaffFormValues): CreateStaffRequest => ({
  fullName: values.fullName.trim(),
  email: normalizeEmail(values.email),
  assignments: toAssignmentInputs(values.assignments),
});

/** `PATCH` con SOLO lo que cambió (el correo solo si no está vinculado). `null` = sin cambios. */
export function toUpdateStaffRequest(
  values: StaffFormValues,
  original: AdminStaff,
): UpdateStaffRequest | null {
  const patch: UpdateStaffRequest = {};
  if (values.fullName.trim() !== original.fullName) patch.fullName = values.fullName.trim();
  const email = normalizeEmail(values.email);
  if (original.identityStatus === 'PENDING_LINK' && email !== original.email) patch.email = email;
  return Object.keys(patch).length ? patch : null;
}

/** ¿Cambiaron las asignaciones respecto de las del empleado? */
export function assignmentsChanged(
  drafts: readonly AssignmentDraft[],
  original: AdminStaff,
): boolean {
  const key = (d: AssignmentDraft) => `${d.roleId}|${d.branchId}`;
  const a = new Set(drafts.map(key));
  const b = new Set(assignmentsToDrafts(original).map(key));
  return a.size !== b.size || [...a].some((k) => !b.has(k));
}

/**
 * Roles que el actor puede ofrecer en el formulario: tiene `staff.assign_roles` y todos los permisos del rol (regla del
 * subconjunto, orientativa); `admin` solo con alcance global. El servidor decide.
 */
export function grantableRoles(roles: readonly AdminRole[], grants: Grants): AdminRole[] {
  if (!can(grants, 'staff.assign_roles')) return [];
  return roles.filter((role) => {
    if (role.code === 'admin') {
      return (
        canGlobally(grants, 'staff.assign_roles') &&
        role.permissions.every((p) => canGlobally(grants, p.code))
      );
    }
    return role.permissions.every((p) => can(grants, p.code));
  });
}

// ── Estado administrativo ─────────────────────────────────────────────────────────────────

export const STAFF_REASON_MAX = 200;

/** Motivo obligatorio al desactivar (máx. 200). Devuelve el mensaje de error o ''. */
export function validateStaffReason(reason: string, activating: boolean): string {
  const value = reason.trim();
  if (value.length > STAFF_REASON_MAX)
    return `El motivo admite hasta ${STAFF_REASON_MAX} caracteres.`;
  if (!activating && !value) return 'Escribe el motivo de la desactivación.';
  return '';
}

// ── Errores del servidor ──────────────────────────────────────────────────────────────────

export interface StaffServerError {
  /** Mensaje general (banner). */
  message: string;
  fields: Partial<Record<StaffFormField, string>>;
}

/** Traduce 400/403/404/409 de la capa de datos a un mensaje claro y, si procede, a un campo. */
export function staffServerError(error: unknown): StaffServerError {
  if (!isApiError(error)) return { message: errorMessage(error), fields: {} };
  switch (error.status) {
    case 400: {
      const fields: StaffServerError['fields'] = {};
      for (const detail of error.details ?? []) {
        const lower = detail.toLowerCase();
        const field: StaffFormField | undefined = lower.startsWith('fullname:')
          ? 'fullName'
          : lower.startsWith('email:')
            ? 'email'
            : lower.startsWith('assignments')
              ? 'assignments'
              : undefined;
        if (field && !fields[field]) fields[field] = detail.slice(detail.indexOf(':') + 1).trim();
      }
      const rest = error.details?.length ? error.details.join(' · ') : error.message;
      return { message: `Revisa los datos: ${rest}`, fields };
    }
    case 403:
      return {
        message: 'No tienes permiso para esta acción o excede lo que tu rol puede otorgar.',
        fields: {},
      };
    case 404:
      return { message: 'La persona ya no existe o no está dentro de tu alcance.', fields: {} };
    case 409: {
      const fields: StaffServerError['fields'] = /correo/i.test(error.message)
        ? { email: error.message }
        : {};
      return { message: error.message, fields };
    }
    default:
      return { message: errorMessage(error), fields: {} };
  }
}

// ── Filtros y listado ─────────────────────────────────────────────────────────────────────

export type StaffStatusFilter = 'all' | 'active' | 'inactive';
export type StaffIdentityFilter = 'all' | 'PENDING_LINK' | 'LINKED';
export type StaffSortKey = 'fullName' | 'email' | 'createdAt';

export interface StaffListState {
  q: string;
  /** '' = todos. */
  roleId: string;
  branchId: string;
  status: StaffStatusFilter;
  identity: StaffIdentityFilter;
  sort: StaffSortKey;
  order: 'asc' | 'desc';
  page: number;
}

export const STAFF_PAGE_SIZE = 10;

export const DEFAULT_STAFF_LIST: StaffListState = {
  q: '',
  roleId: '',
  branchId: '',
  status: 'all',
  identity: 'all',
  sort: 'fullName',
  order: 'asc',
  page: 1,
};

export const toStaffFilters = (state: StaffListState): AdminStaffFilters => ({
  q: state.q.trim() || undefined,
  roleId: state.roleId || undefined,
  branchId: state.branchId || undefined,
  active: state.status === 'all' ? undefined : state.status === 'active',
  identityStatus: state.identity === 'all' ? undefined : state.identity,
  sort: state.sort,
  order: state.order,
  page: state.page,
  pageSize: STAFF_PAGE_SIZE,
});

export const staffPageCount = (total: number, pageSize = STAFF_PAGE_SIZE) =>
  Math.max(1, Math.ceil(total / pageSize));

export const hasStaffFilters = (s: StaffListState) =>
  s.q.trim() !== '' ||
  s.roleId !== '' ||
  s.branchId !== '' ||
  s.status !== 'all' ||
  s.identity !== 'all';
