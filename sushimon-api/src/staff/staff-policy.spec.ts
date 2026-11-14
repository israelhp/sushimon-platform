import { BadRequestException } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  globalStaff,
  grantsOf,
  mergeGrants,
  scopedStaff,
  staffContext,
} from '../../test/support/staff-context.js';
import {
  assignmentRecord,
  BRANCH_A,
  BRANCH_B,
  ROLE_IDS,
  roleRecord,
  staffRecord,
} from '../../test/support/staff-fixtures.js';
import {
  assertAdminGlobalRule,
  assertNoDuplicateAssignments,
  canGrantRole,
  diffAssignments,
  holdsRoleAt,
  isGlobalAdmin,
  isManageable,
  isVisible,
  normalizeEmail,
  normalizeFullName,
  normalizeStatusReason,
} from './staff-policy.js';

const ACTOR = '99999999-9999-4999-8999-999999999999';
const T1 = 'cccccccc-0000-4000-8000-000000000001';

/** Encargado de una sucursal con los permisos de su rol sembrado. */
const manager = (branches: string[]) => scopedStaff(roleRecord('manager').permissions, branches);
const admin = () => globalStaff(ALL_PERMISSIONS);
const failsWith400 = (fn: () => unknown) => expect(fn).toThrow(BadRequestException);

describe('normalización', () => {
  it('correo: recorta y pasa a minúsculas', () => {
    expect(normalizeEmail('  Ana.Perez@Sushimon.COM ')).toBe('ana.perez@sushimon.com');
  });
  it.each(['', '   ', 'sin-arroba', 'a@b', 'a b@c.com', `${'a'.repeat(250)}@x.com`])(
    'correo inválido %j → 400',
    (raw) => failsWith400(() => normalizeEmail(raw)),
  );
  it('nombre: colapsa espacios y rechaza vacío o demasiado largo', () => {
    expect(normalizeFullName('  Ana   Pérez ')).toBe('Ana Pérez');
    failsWith400(() => normalizeFullName('   '));
    failsWith400(() => normalizeFullName('x'.repeat(121)));
    expect(normalizeFullName('José Ñandú')).toBe('José Ñandú');
  });
  it.each([
    ['salto de línea', 'Ana\nPérez'],
    ['tabulador', 'Ana\tPérez'],
    ['NUL', 'Ana\u0000'],
    ['ancho cero (Cf)', 'Ana\u200bPérez'],
    ['RTL override (Cf)', '\u202eAna'],
    ['BOM (Cf)', '\ufeffAna'],
  ])('nombre con %s → 400', (_n, raw) => {
    failsWith400(() => normalizeFullName(raw));
  });
  it('motivo: obligatorio al desactivar, opcional al activar, máx. 200', () => {
    failsWith400(() => normalizeStatusReason(false, undefined));
    failsWith400(() => normalizeStatusReason(false, '  '));
    expect(normalizeStatusReason(true, undefined)).toBeNull();
    expect(normalizeStatusReason(false, ' Renunció ')).toBe('Renunció');
    failsWith400(() => normalizeStatusReason(true, 'x'.repeat(201)));
  });
});

describe('forma de las asignaciones', () => {
  it('duplicados (rol, sucursal) → 400; mismo rol en otra sucursal es válido', () => {
    failsWith400(() =>
      assertNoDuplicateAssignments([
        { roleId: ROLE_IDS['manager'] as string, branchId: BRANCH_A },
        { roleId: ROLE_IDS['manager'] as string, branchId: BRANCH_A },
      ]),
    );
    failsWith400(() =>
      assertNoDuplicateAssignments([
        { roleId: ROLE_IDS['admin'] as string, branchId: null },
        { roleId: ROLE_IDS['admin'] as string, branchId: null },
      ]),
    );
    expect(() =>
      assertNoDuplicateAssignments([
        { roleId: ROLE_IDS['manager'] as string, branchId: BRANCH_A },
        { roleId: ROLE_IDS['manager'] as string, branchId: BRANCH_B },
      ]),
    ).not.toThrow();
  });

  it('admin ⇒ global y global ⇒ admin (400 en ambos sentidos)', () => {
    expect(() => assertAdminGlobalRule('admin', null)).not.toThrow();
    expect(() => assertAdminGlobalRule('manager', BRANCH_A)).not.toThrow();
    failsWith400(() => assertAdminGlobalRule('admin', BRANCH_A));
    failsWith400(() => assertAdminGlobalRule('manager', null));
    failsWith400(() => assertAdminGlobalRule('kitchen', null));
  });
});

describe('regla del subconjunto (canGrantRole / holdsRoleAt)', () => {
  it('el administrador global otorga cualquier rol, también admin global', () => {
    const { grants } = admin();
    expect(canGrantRole(grants, roleRecord('admin').permissions, null)).toBe(true);
    expect(canGrantRole(grants, roleRecord('manager').permissions, BRANCH_A)).toBe(true);
  });

  it('el encargado otorga roles inferiores (subconjunto) en SU sucursal', () => {
    const { grants } = manager([BRANCH_A]);
    expect(canGrantRole(grants, roleRecord('kitchen').permissions, BRANCH_A)).toBe(true);
    expect(canGrantRole(grants, roleRecord('staff').permissions, BRANCH_A)).toBe(true);
    // Par: manager a manager (permisos iguales) está permitido (riesgo documentado en la spec).
    expect(canGrantRole(grants, roleRecord('manager').permissions, BRANCH_A)).toBe(true);
  });

  it('el encargado NUNCA otorga admin ni alcance global', () => {
    const { grants } = manager([BRANCH_A]);
    expect(canGrantRole(grants, roleRecord('admin').permissions, null)).toBe(false);
    expect(canGrantRole(grants, roleRecord('manager').permissions, null)).toBe(false);
    expect(canGrantRole(grants, roleRecord('admin').permissions, BRANCH_A)).toBe(false);
  });

  it('no otorga en una sucursal fuera de su alcance', () => {
    const { grants } = manager([BRANCH_A]);
    expect(canGrantRole(grants, roleRecord('kitchen').permissions, BRANCH_B)).toBe(false);
  });

  it('exige staff.assign_roles en ese alcance aunque posea los permisos del rol', () => {
    const { grants } = scopedStaff(roleRecord('kitchen').permissions, [BRANCH_A]);
    expect(holdsRoleAt(grants, roleRecord('kitchen').permissions, BRANCH_A)).toBe(true);
    expect(canGrantRole(grants, roleRecord('kitchen').permissions, BRANCH_A)).toBe(false);
  });

  it('los permisos se evalúan por separado: poseer uno en A y otro en B no basta', () => {
    const grants = mergeGrants(
      grantsOf(['staff.assign_roles', 'orders.read'], [BRANCH_A]),
      grantsOf(['orders.accept'], [BRANCH_B]),
    );
    expect(holdsRoleAt(grants, ['orders.read', 'orders.accept'], BRANCH_A)).toBe(false);
  });

  it('un rol vacío sería otorgable por cualquiera con assign_roles (no existe: la migración exige ≥1 permiso)', () => {
    const { grants } = manager([BRANCH_A]);
    expect(canGrantRole(grants, [], BRANCH_A)).toBe(true);
  });
});

describe('visibilidad (staff.read)', () => {
  it('global ve todo, incluso a quien no tiene asignaciones', () => {
    const { grants } = admin();
    expect(isVisible(grants, staffRecord(T1, []))).toBe(true);
  });

  it('acotado ve solo a quien tiene alguna asignación en su alcance; las globales NO son visibles', () => {
    const { grants } = manager([BRANCH_A]);
    expect(isVisible(grants, staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]))).toBe(true);
    expect(
      isVisible(
        grants,
        staffRecord(T1, [
          assignmentRecord('kitchen', BRANCH_B),
          assignmentRecord('staff', BRANCH_A),
        ]),
      ),
    ).toBe(true);
    expect(isVisible(grants, staffRecord(T1, [assignmentRecord('kitchen', BRANCH_B)]))).toBe(false);
    expect(isVisible(grants, staffRecord(T1, [assignmentRecord('admin', null)]))).toBe(false);
    expect(isVisible(grants, staffRecord(T1, []))).toBe(false);
  });

  it('sin staff.read no ve a nadie', () => {
    const { grants } = scopedStaff(['staff.update'], [BRANCH_A]);
    expect(isVisible(grants, staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]))).toBe(false);
  });
});

describe('dominio del objetivo (isManageable)', () => {
  it('encargado gestiona a un cocinero de su sucursal', () => {
    const { grants } = manager([BRANCH_A]);
    const target = staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]);
    expect(isManageable(grants, ACTOR, target, 'staff.update')).toBe(true);
  });

  it('NO gestiona a quien también opera fuera de su alcance (todas las asignaciones deben estar dentro)', () => {
    const { grants } = manager([BRANCH_A]);
    const target = staffRecord(T1, [
      assignmentRecord('kitchen', BRANCH_A),
      assignmentRecord('kitchen', BRANCH_B),
    ]);
    expect(isManageable(grants, ACTOR, target, 'staff.update')).toBe(false);
  });

  it('NO gestiona a un administrador ni a quien tenga un rol que no puede otorgar', () => {
    const { grants } = manager([BRANCH_A]);
    expect(
      isManageable(
        grants,
        ACTOR,
        staffRecord(T1, [assignmentRecord('admin', null)]),
        'staff.update',
      ),
    ).toBe(false);
    const superior = staffRecord(T1, [assignmentRecord('admin', BRANCH_A)]);
    expect(isManageable(grants, ACTOR, superior, 'staff.update')).toBe(false);
  });

  it('nadie se gestiona a sí mismo (autoedición solo de fullName, tratada aparte)', () => {
    const { grants } = admin();
    expect(
      isManageable(
        grants,
        T1,
        staffRecord(T1, [assignmentRecord('manager', BRANCH_A)]),
        'staff.update',
      ),
    ).toBe(false);
  });

  it('el alcance se toma del permiso de la operación (staff.disable acotado, staff.update global)', () => {
    const grants = mergeGrants(
      grantsOf(roleRecord('manager').permissions, [BRANCH_A]),
      grantsOf(['staff.update'], 'global'),
    );
    const target = staffRecord(T1, [assignmentRecord('kitchen', BRANCH_B)]);
    // staff.update global cubre B, pero no posee los permisos del rol en B (subconjunto) → no gestionable.
    expect(isManageable(grants, ACTOR, target, 'staff.update')).toBe(false);
    expect(
      isManageable(
        grants,
        ACTOR,
        staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]),
        'staff.disable',
      ),
    ).toBe(true);
  });

  it('un administrador global gestiona a todos, incluso con asignaciones en sucursales inactivas', () => {
    const { grants } = admin();
    const target = staffRecord(T1, [
      assignmentRecord('manager', BRANCH_A, { branchActive: false }),
      assignmentRecord('admin', null),
    ]);
    expect(isManageable(grants, ACTOR, target, 'staff.disable')).toBe(true);
  });

  it('un encargado no gestiona a quien opera en una sucursal inactiva (su alcance excluye las inactivas)', () => {
    // Los grants del actor ya no incluyen sucursales inactivas: se simula con alcance vacío.
    const grants = grantsOf(roleRecord('manager').permissions, []);
    const target = staffRecord(T1, [
      assignmentRecord('kitchen', BRANCH_A, { branchActive: false }),
    ]);
    expect(isManageable(grants, ACTOR, target, 'staff.update')).toBe(false);
  });
});

describe('diffAssignments', () => {
  const kitchenA = assignmentRecord('kitchen', BRANCH_A);
  const managerB = assignmentRecord('manager', BRANCH_B);

  it('añade lo nuevo, retira lo que ya no está y conserva lo activo que coincide', () => {
    const diff = diffAssignments(
      [kitchenA, managerB],
      [
        { roleId: ROLE_IDS['kitchen'] as string, branchId: BRANCH_A },
        { roleId: ROLE_IDS['staff'] as string, branchId: BRANCH_A },
      ],
    );
    expect(diff.remove).toEqual([managerB]);
    expect(diff.add).toEqual([{ roleId: ROLE_IDS['staff'], branchId: BRANCH_A }]);
  });

  it('sin cambios → diff vacío (idempotente)', () => {
    const diff = diffAssignments(
      [kitchenA],
      [{ roleId: ROLE_IDS['kitchen'] as string, branchId: BRANCH_A }],
    );
    expect(diff).toEqual({ remove: [], add: [] });
  });

  it('una fila inactiva que coincide se elimina y se recrea activa', () => {
    const inactive = assignmentRecord('kitchen', BRANCH_A, { active: false });
    const diff = diffAssignments(
      [inactive],
      [{ roleId: ROLE_IDS['kitchen'] as string, branchId: BRANCH_A }],
    );
    expect(diff.remove).toEqual([inactive]);
    expect(diff.add).toHaveLength(1);
  });
});

describe('isGlobalAdmin', () => {
  it('solo admin global activo', () => {
    expect(isGlobalAdmin(assignmentRecord('admin', null))).toBe(true);
    expect(isGlobalAdmin(assignmentRecord('admin', null, { active: false }))).toBe(false);
    expect(isGlobalAdmin(assignmentRecord('manager', BRANCH_A))).toBe(false);
  });
});

it('staffContext sin permisos no posee nada', () => {
  const { grants } = staffContext({});
  expect(canGrantRole(grants, ['orders.read'], BRANCH_A)).toBe(false);
});
