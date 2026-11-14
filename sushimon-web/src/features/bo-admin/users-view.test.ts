import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminRole, AdminStaff } from '@/lib/data-access/models';
import type { Grants } from '@/lib/permissions';
import {
  GLOBAL_BRANCH,
  assignmentsChanged,
  emptyStaffForm,
  firstStaffError,
  grantableRoles,
  hasFormErrors,
  hasStaffFilters,
  isValidEmail,
  staffPageCount,
  staffServerError,
  toAssignmentInputs,
  toCreateStaffRequest,
  toStaffFilters,
  toUpdateStaffRequest,
  validateAssignments,
  validateStaffForm,
  validateStaffReason,
  DEFAULT_STAFF_LIST,
} from './users-view';

const perm = (code: string) => ({ code, description: code, module: code.split('.')[0]! });
const role = (id: string, code: string, permissions: string[]): AdminRole => ({
  id,
  code,
  name: code,
  isSystem: code === 'admin',
  permissions: permissions.map(perm),
  assignedStaffCount: 0,
});
const ADMIN = role('r-admin', 'admin', ['staff.read', 'staff.assign_roles', 'orders.read']);
const MANAGER = role('r-manager', 'manager', ['staff.read', 'staff.assign_roles', 'orders.read']);
const KITCHEN = role('r-kitchen', 'kitchen', ['orders.read']);
const ROLES = [ADMIN, MANAGER, KITCHEN];

const staff = (over: Partial<AdminStaff> = {}): AdminStaff => ({
  id: 'u1',
  fullName: 'Ana Pérez',
  email: 'ana@sushimon.gt',
  active: true,
  identityStatus: 'PENDING_LINK',
  linkedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  createdBy: null,
  assignments: [
    {
      role: { id: 'r-kitchen', code: 'kitchen', name: 'Cocina' },
      branch: { id: 'b1', name: 'Zona 4', code: 'z4' },
      effective: true,
    },
  ],
  manageable: true,
  ...over,
});

describe('formulario de usuario', () => {
  it('valida el correo como el servidor', () => {
    expect(isValidEmail('ana@sushimon.gt')).toBe(true);
    expect(isValidEmail('ana@sushimon')).toBe(false);
  });

  it('exige nombre, correo y al menos una asignación completa', () => {
    const errors = validateStaffForm(emptyStaffForm(), ROLES);
    expect(errors.fullName).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.rows[0]).toBeTruthy();
    expect(firstStaffError(errors)).toBe('fullName');
    expect(hasFormErrors(errors)).toBe(true);
    const ok = validateStaffForm(
      {
        fullName: 'Ana',
        email: ' Ana@Sushimon.gt ',
        assignments: [{ roleId: 'r-kitchen', branchId: 'b1' }],
      },
      ROLES,
    );
    expect(hasFormErrors(ok)).toBe(false);
  });

  it('admin ⇒ global y el resto ⇒ sucursal concreta; sin duplicados', () => {
    const rows = (drafts: { roleId: string; branchId: string }[]) =>
      validateAssignments(drafts, ROLES).rows;
    expect(rows([{ roleId: 'r-admin', branchId: 'b1' }])[0]).toMatch(/global/i);
    expect(rows([{ roleId: 'r-admin', branchId: GLOBAL_BRANCH }])).toEqual({});
    expect(rows([{ roleId: 'r-kitchen', branchId: GLOBAL_BRANCH }])[0]).toMatch(/sucursal/i);
    expect(rows([{ roleId: 'r-kitchen', branchId: '' }])[0]).toBeTruthy();
    expect(
      rows([
        { roleId: 'r-kitchen', branchId: 'b1' },
        { roleId: 'r-kitchen', branchId: 'b1' },
      ])[1],
    ).toMatch(/repetida/i);
    expect(validateAssignments([], ROLES).assignments).toBeTruthy();
    expect(
      validateAssignments(
        Array.from({ length: 21 }, (_, i) => ({ roleId: 'r-kitchen', branchId: `b${i}` })),
        ROLES,
      ).assignments,
    ).toMatch(/20/);
  });

  it('en edición vinculada el correo no se valida ni se envía', () => {
    const linked = staff({ identityStatus: 'LINKED' });
    const values = { fullName: 'Ana M.', email: 'otro@x.gt', assignments: [] };
    expect(hasFormErrors(validateStaffForm(values, ROLES, 'edit', true))).toBe(false);
    expect(toUpdateStaffRequest(values, linked)).toEqual({ fullName: 'Ana M.' });
    expect(toUpdateStaffRequest({ ...values, fullName: 'Ana Pérez' }, linked)).toBeNull();
  });

  it('en edición PENDING_LINK envía solo lo que cambió, con el correo normalizado', () => {
    const pending = staff();
    expect(
      toUpdateStaffRequest(
        { fullName: 'Ana Pérez', email: ' NUEVO@Sushimon.gt ', assignments: [] },
        pending,
      ),
    ).toEqual({ email: 'nuevo@sushimon.gt' });
  });

  it('arma el POST sin authUserId y con branchId null para global', () => {
    const body = toCreateStaffRequest({
      fullName: ' Ana ',
      email: ' ANA@Sushimon.gt ',
      assignments: [
        { roleId: 'r-admin', branchId: GLOBAL_BRANCH },
        { roleId: 'r-kitchen', branchId: 'b1' },
      ],
    });
    expect(body).toEqual({
      fullName: 'Ana',
      email: 'ana@sushimon.gt',
      assignments: [
        { roleId: 'r-admin', branchId: null },
        { roleId: 'r-kitchen', branchId: 'b1' },
      ],
    });
    expect(Object.keys(body)).not.toContain('authUserId');
    expect(toAssignmentInputs([{ roleId: 'x', branchId: 'b' }])).toEqual([
      { roleId: 'x', branchId: 'b' },
    ]);
  });

  it('detecta cambios de asignaciones respecto del empleado', () => {
    const s = staff();
    expect(assignmentsChanged([{ roleId: 'r-kitchen', branchId: 'b1' }], s)).toBe(false);
    expect(assignmentsChanged([{ roleId: 'r-kitchen', branchId: 'b2' }], s)).toBe(true);
    expect(
      assignmentsChanged(
        [
          { roleId: 'r-kitchen', branchId: 'b1' },
          { roleId: 'r-kitchen', branchId: 'b2' },
        ],
        s,
      ),
    ).toBe(true);
  });
});

describe('roles otorgables (orientativo; decide el servidor)', () => {
  const grants = (global: boolean): Grants => ({
    'staff.read': { allBranches: global, branchIds: global ? [] : ['b1'] },
    'staff.assign_roles': { allBranches: global, branchIds: global ? [] : ['b1'] },
    'orders.read': { allBranches: global, branchIds: global ? [] : ['b1'] },
  });

  it('el encargado ofrece manager y cocina, nunca admin', () => {
    expect(grantableRoles(ROLES, grants(false)).map((r) => r.code)).toEqual(['manager', 'kitchen']);
  });

  it('el administrador global ofrece todos; sin staff.assign_roles, ninguno', () => {
    expect(grantableRoles(ROLES, grants(true)).map((r) => r.code)).toEqual([
      'admin',
      'manager',
      'kitchen',
    ]);
    expect(grantableRoles(ROLES, {})).toEqual([]);
  });

  it('no ofrece un rol con un permiso que el actor no tiene', () => {
    const partial: Grants = {
      'staff.assign_roles': { allBranches: false, branchIds: ['b1'] },
    };
    expect(grantableRoles(ROLES, partial)).toEqual([]);
  });
});

describe('motivo de desactivación', () => {
  it('es obligatorio al desactivar, opcional al activar y máx. 200', () => {
    expect(validateStaffReason('', false)).toMatch(/motivo/i);
    expect(validateStaffReason('  ', false)).toMatch(/motivo/i);
    expect(validateStaffReason('Renuncia', false)).toBe('');
    expect(validateStaffReason('', true)).toBe('');
    expect(validateStaffReason('x'.repeat(201), true)).toMatch(/200/);
  });
});

describe('errores del servidor', () => {
  const err = (status: number, message: string, details?: string[]) =>
    new ApiError(status, 'x', message, undefined, details);

  it('400 asigna detalles a campos', () => {
    const out = staffServerError(
      err(400, 'Datos inválidos', [
        'email: correo inválido',
        'assignments[0].roleId: rol inexistente',
      ]),
    );
    expect(out.fields.email).toBe('correo inválido');
    expect(out.fields.assignments).toBeTruthy();
    expect(out.message).toMatch(/Revisa/);
  });

  it('403, 404 y 409 tienen mensaje claro; el 409 de correo marca el campo', () => {
    expect(staffServerError(err(403, 'x')).message).toMatch(/permiso/);
    expect(staffServerError(err(404, 'x')).message).toMatch(/alcance/);
    const dup = staffServerError(err(409, 'Ya existe un empleado con ese correo'));
    expect(dup.fields.email).toBeTruthy();
    const last = staffServerError(
      err(409, 'No se puede desactivar al último administrador activo'),
    );
    expect(last.message).toMatch(/último administrador/);
    expect(last.fields).toEqual({});
  });
});

describe('filtros y paginación', () => {
  it('traduce el estado de la lista a filtros del contrato', () => {
    expect(toStaffFilters(DEFAULT_STAFF_LIST)).toEqual({
      q: undefined,
      roleId: undefined,
      branchId: undefined,
      active: undefined,
      identityStatus: undefined,
      sort: 'fullName',
      order: 'asc',
      page: 1,
      pageSize: 10,
    });
    expect(
      toStaffFilters({
        ...DEFAULT_STAFF_LIST,
        q: ' ana ',
        roleId: 'r1',
        branchId: 'b1',
        status: 'inactive',
        identity: 'PENDING_LINK',
        page: 2,
      }),
    ).toMatchObject({
      q: 'ana',
      roleId: 'r1',
      branchId: 'b1',
      active: false,
      identityStatus: 'PENDING_LINK',
      page: 2,
    });
  });

  it('cuenta páginas y detecta filtros activos', () => {
    expect(staffPageCount(0)).toBe(1);
    expect(staffPageCount(11, 10)).toBe(2);
    expect(hasStaffFilters(DEFAULT_STAFF_LIST)).toBe(false);
    expect(hasStaffFilters({ ...DEFAULT_STAFF_LIST, status: 'active' })).toBe(true);
  });
});
