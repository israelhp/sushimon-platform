import { ApiError } from '@/lib/data-access/errors';
import type {
  AdminContextResponse,
  AdminPermissionCatalog,
  AdminRole,
  AdminRoleList,
  AdminStaff,
  AdminStaffPage,
  AuthStaffContext,
  StaffAssignmentInput,
} from '@/lib/data-access/models';
import { can, permissionModule } from '@/lib/permissions';
import { fail, isValidEmail } from '../domain';
import { PERMISSION_CATALOG } from '../fixtures/rbac';
import { contextBranches } from '../rbac';
import type { RoleRecord, StaffRecord } from '../store';
import {
  body,
  grantsOf,
  now,
  requireStaff,
  unionScope,
  type Handler,
  type Req,
  type StaffActor,
} from './shared';

/**
 * F03 — Empleados, roles y permisos (contrato `/v1/admin/staff`, `/v1/admin/roles`, `/v1/admin/permissions`,
 * `/v1/admin/me/context`). El mock reproduce las reglas del servidor (spec 006): permiso `staff.*`/`roles.*` en algún
 * alcance (403), 404 fuera del alcance de lectura, regla del subconjunto y dominio del objetivo (403), nadie se
 * modifica a sí mismo salvo `fullName`, último administrador (409), `admin` solo global, correo normalizado y único
 * (409), correo inmutable si está vinculado (409), motivo obligatorio al desactivar, rol del sistema de solo lectura
 * (409). `authUserId` nunca existe. La auditoría (`app.audit_events`) no se simula. Ids del mock: `uN`, no UUID.
 */
type Raw = Record<string, unknown>;

const FORBIDDEN = 'No tienes permiso para esta acción';

/** 400 con `details` (como `ErrorResponse.details`). */
function invalid(details: string[]): never {
  throw new ApiError(400, 'bad_request', 'Datos inválidos', undefined, [...new Set(details)]);
}

const asRaw = (req: Req): Raw => body<Raw>(req) as Raw;

function rejectUnknown(raw: Raw, allowed: readonly string[], problems: string[]) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) problems.push(`${key}: campo no permitido`);
  }
}

const normalizeEmail = (v: string) => v.trim().toLowerCase();

// ── Vistas ────────────────────────────────────────────────────────────────────────────────

const roleById = (req: Req, id: string) => req.store.roles.find((r) => r.id === id);

/** El actor posee el permiso en ese alcance (`null` = global exige alcance global). */
const holds = (actor: StaffActor, permission: string, branchId: string | null) =>
  branchId === null
    ? Boolean(actor.grants[permission]?.allBranches)
    : can(actor.grants, permission, branchId);

/** Regla del subconjunto: `staff.assign_roles` y TODOS los permisos del rol en ese alcance. */
const canGrant = (actor: StaffActor, role: RoleRecord, branchId: string | null) =>
  holds(actor, 'staff.assign_roles', branchId) &&
  role.permissions.every((p) => holds(actor, p, branchId));

/** Dominio: todas las asignaciones del objetivo están en el alcance del actor y son otorgables por él. */
function manageable(req: Req, actor: StaffActor, target: StaffRecord): boolean {
  if (target.assignments.length === 0) return false;
  return target.assignments.every((a) => {
    const role = roleById(req, a.roleId);
    return role ? canGrant(actor, role, a.branchId) : false;
  });
}

function visibleTo(actor: StaffActor, target: StaffRecord): boolean {
  const scope = actor.grants['staff.read'];
  if (!scope) return false;
  if (scope.allBranches) return true;
  return target.assignments.some(
    (a) => a.branchId !== null && scope.branchIds.includes(a.branchId),
  );
}

function staffView(req: Req, actor: StaffActor, record: StaffRecord): AdminStaff {
  const creator = record.createdById
    ? req.store.staff.find((u) => u.id === record.createdById)
    : undefined;
  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    active: record.active,
    identityStatus: record.linked ? 'LINKED' : 'PENDING_LINK',
    linkedAt: record.linkedAt,
    createdAt: record.createdAt,
    createdBy: creator ? { id: creator.id, fullName: creator.fullName } : null,
    assignments: record.assignments.flatMap((a) => {
      const role = roleById(req, a.roleId);
      if (!role) return [];
      const branch = a.branchId ? req.store.branches.find((b) => b.id === a.branchId) : undefined;
      return [
        {
          role: { id: role.id, code: role.code, name: role.name },
          branch: branch ? { id: branch.id, name: branch.name, code: branch.code } : null,
          effective: a.branchId === null || Boolean(branch?.active),
        },
      ];
    }),
    manageable: manageable(req, actor, record),
  };
}

function roleView(req: Req, role: RoleRecord): AdminRole {
  const count = req.store.staff.filter(
    (u) =>
      u.active &&
      u.assignments.some(
        (a) =>
          a.roleId === role.id &&
          (a.branchId === null || req.store.branches.find((b) => b.id === a.branchId)?.active),
      ),
  ).length;
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    isSystem: role.isSystem,
    permissions: PERMISSION_CATALOG.filter((p) => role.permissions.includes(p.code)).map((p) => ({
      code: p.code,
      description: p.description,
      module: permissionModule(p.code),
    })),
    assignedStaffCount: count,
  };
}

/** `AuthStaffContext` del servidor para un empleado (permisos vigentes del store). */
export function authStaffContext(req: Req, record: StaffRecord): AuthStaffContext {
  const grants = grantsOf(req.store, record);
  const scope = unionScope(grants);
  return {
    staffId: record.id,
    fullName: record.fullName,
    assignments: record.assignments.flatMap((a) => {
      const role = roleById(req, a.roleId);
      return role ? [{ role: role.code, branchId: a.branchId }] : [];
    }),
    permissions: Object.keys(grants),
    allBranches: scope.allBranches,
    branchIds: scope.branchIds,
    grants: Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, { ...v }])),
    branches: contextBranches(grants, req.store.branches),
  };
}

/** GET /v1/admin/me/context */
export const getAdminContext: Handler = (req): AdminContextResponse => {
  const actor = requireStaff(req);
  return {
    authUserId: '00000000-0000-4000-8000-00000000d3a0',
    email: actor.email,
    aal: 'aal2',
    staff: authStaffContext(req, actor.record),
  };
};

// ── Último administrador ──────────────────────────────────────────────────────────────────

/** Administradores globales activos y VINCULADOS (un PENDING_LINK no cuenta). */
function adminCount(req: Req, staff: readonly StaffRecord[]): number {
  const admin = req.store.roles.find((r) => r.code === 'admin');
  return staff.filter(
    (u) =>
      u.active &&
      u.linked &&
      u.assignments.some((a) => a.roleId === admin?.id && a.branchId === null),
  ).length;
}

// ── Lectura ───────────────────────────────────────────────────────────────────────────────

const STAFF_SORTS = ['fullName', 'email', 'createdAt'] as const;
const intParam = (raw: string | null, fallback: number) =>
  raw === null || raw === '' ? fallback : /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;

/** GET /v1/admin/staff */
export const listAdminStaff: Handler = (req): AdminStaffPage => {
  const actor = requireStaff(req, 'staff.read');
  const problems: string[] = [];
  const q = (req.query.get('q') ?? '').trim().toLowerCase();
  if (q.length > 100) problems.push('q: máximo 100 caracteres');
  const branchId = req.query.get('branchId') || undefined;
  const roleId = req.query.get('roleId') || undefined;
  const activeRaw = req.query.get('active');
  if (activeRaw !== null && activeRaw !== '' && activeRaw !== 'true' && activeRaw !== 'false') {
    problems.push('active: debe ser true o false');
  }
  const identity = req.query.get('identityStatus') || undefined;
  if (identity && identity !== 'PENDING_LINK' && identity !== 'LINKED') {
    problems.push('identityStatus: valor no permitido');
  }
  const sort = req.query.get('sort') ?? 'fullName';
  if (!(STAFF_SORTS as readonly string[]).includes(sort)) problems.push('sort: valor no permitido');
  const order = req.query.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') problems.push('order: valor no permitido');
  const page = intParam(req.query.get('page'), 1);
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
    problems.push('page: entero entre 1 y 1000000');
  }
  const pageSize = intParam(req.query.get('pageSize'), 20);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    problems.push('pageSize: entero entre 1 y 100');
  }
  if (problems.length) invalid(problems);

  const dir = order === 'desc' ? -1 : 1;
  const filtered = req.store.staff
    .filter((u) => visibleTo(actor, u))
    .filter((u) => !q || u.fullName.toLowerCase().includes(q) || u.email.includes(q))
    .filter((u) => !branchId || u.assignments.some((a) => a.branchId === branchId))
    .filter((u) => !roleId || u.assignments.some((a) => a.roleId === roleId))
    .filter((u) => !activeRaw || u.active === (activeRaw === 'true'))
    .filter((u) => !identity || u.linked === (identity === 'LINKED'))
    .sort((a, b) => {
      const primary =
        sort === 'email'
          ? a.email.localeCompare(b.email)
          : sort === 'createdAt'
            ? a.createdAt.localeCompare(b.createdAt)
            : a.fullName.localeCompare(b.fullName, 'es');
      return (
        dir * primary || a.fullName.localeCompare(b.fullName, 'es') || a.id.localeCompare(b.id)
      );
    });
  return {
    items: filtered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((u) => staffView(req, actor, u)),
    page,
    pageSize,
    total: filtered.length,
  };
};

/** Empleado dentro del alcance de lectura (404 si no existe o no es visible: no se distingue). */
function visibleStaff(req: Req, actor: StaffActor): StaffRecord {
  const found = req.store.staff.find((u) => u.id === req.params.id);
  if (!found || !visibleTo(actor, found)) fail(404, 'Empleado no encontrado');
  return found;
}

/** GET /v1/admin/staff/:id */
export const getAdminStaff: Handler = (req): AdminStaff => {
  const actor = requireStaff(req, 'staff.read');
  return staffView(req, actor, visibleStaff(req, actor));
};

// ── Validación de asignaciones ────────────────────────────────────────────────────────────

function parseAssignments(req: Req, value: unknown, problems: string[]): StaffAssignmentInput[] {
  if (!Array.isArray(value)) {
    problems.push('assignments: obligatorio (lista)');
    return [];
  }
  if (value.length < 1 || value.length > 20) {
    problems.push('assignments: de 1 a 20 asignaciones');
    return [];
  }
  const out: StaffAssignmentInput[] = [];
  const seen = new Set<string>();
  value.forEach((item, i) => {
    const at = `assignments[${i}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      problems.push(`${at}: objeto inválido`);
      return;
    }
    const raw = item as Raw;
    rejectUnknown(raw, ['roleId', 'branchId'], problems);
    const role = typeof raw.roleId === 'string' ? roleById(req, raw.roleId) : undefined;
    if (!role) {
      problems.push(`${at}.roleId: rol inexistente`);
      return;
    }
    const branchId = raw.branchId === undefined ? undefined : raw.branchId;
    if (branchId !== null && typeof branchId !== 'string') {
      problems.push(`${at}.branchId: obligatorio (id o null)`);
      return;
    }
    if (role.code === 'admin' && branchId !== null) {
      problems.push(`${at}: el rol admin solo se asigna con alcance global`);
      return;
    }
    if (role.code !== 'admin' && branchId === null) {
      problems.push(`${at}: el alcance global es exclusivo del rol admin`);
      return;
    }
    if (branchId !== null && !req.store.branches.some((b) => b.id === branchId && b.active)) {
      problems.push(`${at}.branchId: la sucursal no existe o está inactiva`);
      return;
    }
    const key = `${role.id}|${branchId}`;
    if (seen.has(key)) {
      problems.push(`${at}: asignación duplicada`);
      return;
    }
    seen.add(key);
    out.push({ roleId: role.id, branchId });
  });
  return out;
}

/** 403 si alguna asignación no es otorgable por el actor (regla del subconjunto). */
function assertGrantable(req: Req, actor: StaffActor, list: readonly StaffAssignmentInput[]) {
  for (const a of list) {
    const role = roleById(req, a.roleId);
    if (!role || !canGrant(actor, role, a.branchId)) fail(403, FORBIDDEN);
  }
}

const assignmentKey = (a: StaffAssignmentInput) => `${a.roleId}|${a.branchId ?? 'global'}`;

// ── Escritura ─────────────────────────────────────────────────────────────────────────────

function parseName(raw: Raw, problems: string[], required: boolean): string | undefined {
  const v = raw.fullName;
  if (v === undefined) {
    if (required) problems.push('fullName: obligatorio');
    return undefined;
  }
  if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 100) {
    problems.push('fullName: de 2 a 100 caracteres');
    return undefined;
  }
  return v.trim();
}

function parseEmail(raw: Raw, problems: string[], required: boolean): string | undefined {
  const v = raw.email;
  if (v === undefined) {
    if (required) problems.push('email: obligatorio');
    return undefined;
  }
  if (typeof v !== 'string' || !isValidEmail(v) || v.trim().length > 254) {
    problems.push('email: correo inválido');
    return undefined;
  }
  return normalizeEmail(v);
}

const emailTaken = (req: Req, email: string, exceptId?: string) =>
  req.store.staff.some((u) => u.email === email && u.id !== exceptId);

/** POST /v1/admin/staff — preautoriza (PENDING_LINK); no crea cuenta de Auth ni envía correo. */
export const createAdminStaff: Handler = (req): AdminStaff => {
  const actor = requireStaff(req, 'staff.create');
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['fullName', 'email', 'assignments'], problems);
  const fullName = parseName(raw, problems, true);
  const email = parseEmail(raw, problems, true);
  const assignments = parseAssignments(req, raw.assignments, problems);
  if (problems.length) invalid(problems);
  assertGrantable(req, actor, assignments);
  if (emailTaken(req, email as string)) fail(409, 'Ya existe un empleado con ese correo');

  let n = req.store.sequences.user;
  while (req.store.staff.some((u) => u.id === `u${n}`)) n += 1;
  req.store.sequences.user = n + 1;
  const record: StaffRecord = {
    id: `u${n}`,
    fullName: fullName as string,
    email: email as string,
    active: true,
    linked: false,
    linkedAt: null,
    createdAt: now(req).toISOString(),
    createdById: actor.id,
    assignments,
  };
  req.store.staff.push(record);
  return staffView(req, actor, record);
};

/** PATCH /v1/admin/staff/:id — nombre y correo (correo solo en PENDING_LINK; nadie se edita salvo `fullName`). */
export const updateAdminStaff: Handler = (req): AdminStaff => {
  const actor = requireStaff(req, 'staff.update');
  const target = visibleStaff(req, actor);
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['fullName', 'email'], problems);
  if (Object.keys(raw).length === 0) problems.push('al menos un campo');
  const fullName = parseName(raw, problems, false);
  const email = parseEmail(raw, problems, false);
  if (problems.length) invalid(problems);

  const self = target.id === actor.id;
  if (self && email !== undefined) fail(403, FORBIDDEN);
  if (!self && !manageable(req, actor, target)) fail(403, FORBIDDEN);
  if (email !== undefined && email !== target.email) {
    if (target.linked) fail(409, 'El correo de una identidad vinculada no se puede cambiar');
    if (emailTaken(req, email, target.id)) fail(409, 'Ya existe un empleado con ese correo');
    target.email = email;
  }
  if (fullName !== undefined) target.fullName = fullName;
  return staffView(req, actor, target);
};

/** PATCH /v1/admin/staff/:id/status — activa/desactiva; desactivar exige `reason`; idempotente. */
export const updateAdminStaffStatus: Handler = (req): AdminStaff => {
  const actor = requireStaff(req, 'staff.disable');
  const target = visibleStaff(req, actor);
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['active', 'reason'], problems);
  if (typeof raw.active !== 'boolean') problems.push('active: obligatorio (booleano)');
  if (raw.reason !== undefined && typeof raw.reason !== 'string')
    problems.push('reason: debe ser texto');
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (reason.length > 200) problems.push('reason: máximo 200 caracteres');
  if (raw.active === false && !reason) problems.push('reason: obligatorio al desactivar');
  if (problems.length) invalid(problems);

  if (target.id === actor.id) fail(403, FORBIDDEN);
  if (!manageable(req, actor, target)) fail(403, FORBIDDEN);
  const active = raw.active === true;
  if (target.active === active) return staffView(req, actor, target);
  if (!active) {
    const after = req.store.staff.map((u) => (u.id === target.id ? { ...u, active: false } : u));
    if (adminCount(req, req.store.staff) > 0 && adminCount(req, after) === 0) {
      fail(409, 'No se puede desactivar al último administrador activo');
    }
  }
  target.active = active;
  return staffView(req, actor, target);
};

/** PUT /v1/admin/staff/:id/assignments — reemplazo completo, regla del subconjunto y último administrador. */
export const replaceAdminStaffAssignments: Handler = (req): AdminStaff => {
  const actor = requireStaff(req, 'staff.assign_roles');
  const target = visibleStaff(req, actor);
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['assignments'], problems);
  const next = parseAssignments(req, raw.assignments, problems);
  if (problems.length) invalid(problems);

  if (target.id === actor.id) fail(403, FORBIDDEN);
  if (!manageable(req, actor, target)) fail(403, FORBIDDEN);
  const before = new Set(target.assignments.map(assignmentKey));
  const after = new Set(next.map(assignmentKey));
  const added = next.filter((a) => !before.has(assignmentKey(a)));
  const removed = target.assignments.filter((a) => !after.has(assignmentKey(a)));
  if (added.length === 0 && removed.length === 0) return staffView(req, actor, target);
  assertGrantable(req, actor, [...added, ...removed]);

  const simulated = req.store.staff.map((u) =>
    u.id === target.id ? { ...u, assignments: next } : u,
  );
  if (adminCount(req, req.store.staff) > 0 && adminCount(req, simulated) === 0) {
    fail(409, 'No se puede dejar al sistema sin un administrador activo');
  }
  target.assignments = next;
  return staffView(req, actor, target);
};

// ── Roles y permisos ──────────────────────────────────────────────────────────────────────

/** GET /v1/admin/roles */
export const listAdminRoles: Handler = (req): AdminRoleList => {
  requireStaff(req, 'roles.read');
  return { items: req.store.roles.map((r) => roleView(req, r)) };
};

function findRole(req: Req): RoleRecord {
  const role = roleById(req, req.params.id ?? '');
  if (!role) fail(404, 'Rol no encontrado');
  return role;
}

/** GET /v1/admin/roles/:id */
export const getAdminRole: Handler = (req): AdminRole => {
  requireStaff(req, 'roles.read');
  return roleView(req, findRole(req));
};

/** GET /v1/admin/permissions — catálogo agrupado por módulo. */
export const listAdminPermissions: Handler = (req): AdminPermissionCatalog => {
  requireStaff(req, 'roles.read');
  const modules: AdminPermissionCatalog['items'] = [];
  for (const p of PERMISSION_CATALOG) {
    const moduleKey = permissionModule(p.code);
    let group = modules.find((m) => m.module === moduleKey);
    if (!group) {
      group = { module: moduleKey, permissions: [] };
      modules.push(group);
    }
    group.permissions.push({ code: p.code, description: p.description });
  }
  return { items: modules };
};

/** PUT /v1/admin/roles/:id/permissions — reemplazo completo; rol del sistema = 409; añadidos = alcance global. */
export const replaceAdminRolePermissions: Handler = (req): AdminRole => {
  const actor = requireStaff(req, 'roles.manage');
  const role = findRole(req);
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['permissions'], problems);
  const known = new Set(PERMISSION_CATALOG.map((p) => p.code));
  let next: string[] = [];
  if (!Array.isArray(raw.permissions) || raw.permissions.some((p) => typeof p !== 'string')) {
    problems.push('permissions: obligatorio (lista de códigos)');
  } else {
    next = [...new Set(raw.permissions as string[])];
    if (next.length === 0) problems.push('permissions: al menos un permiso');
    for (const code of next)
      if (!known.has(code)) problems.push(`permissions: código desconocido (${code})`);
  }
  if (problems.length) invalid(problems);

  if (role.isSystem) fail(409, 'Los roles del sistema no se pueden editar');
  const added = next.filter((c) => !role.permissions.includes(c));
  if (added.some((c) => !actor.grants[c]?.allBranches)) fail(403, FORBIDDEN);
  // Se conserva el orden del catálogo.
  role.permissions = PERMISSION_CATALOG.map((p) => p.code).filter((c) => next.includes(c));
  return roleView(req, role);
};
