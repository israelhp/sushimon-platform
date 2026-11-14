import { Logger } from '@nestjs/common';
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
  ROLE_IDS,
  roleRecord,
  staffRecord,
} from '../../test/support/staff-fixtures.js';
import { staffHarness } from '../../test/support/staff-service-harness.js';

const ACTOR = '99999999-9999-4999-8999-999999999999';
const adminActor = () => globalStaff(ALL_PERMISSIONS, { staffId: ACTOR });
const kitchen = ROLE_IDS['kitchen'] as string;

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('RolesService · consultas', () => {
  it('lista roles con isSystem, permisos con módulo y empleados activos asignados', async () => {
    const { roles, repo } = staffHarness();
    repo.seed(
      staffRecord('cccccccc-0000-4000-8000-000000000001', [assignmentRecord('kitchen', BRANCH_A)]),
      staffRecord('cccccccc-0000-4000-8000-000000000002', [assignmentRecord('kitchen', BRANCH_A)], {
        active: false,
      }),
    );
    const { items } = await roles.list();
    const k = items.find((r) => r.code === 'kitchen');
    expect(k).toMatchObject({ isSystem: false, assignedStaffCount: 1 });
    expect(k?.permissions[0]).toEqual({
      code: 'orders.accept',
      description: 'Descripción de orders.accept',
      module: 'orders',
    });
    expect(items.find((r) => r.code === 'admin')).toMatchObject({ isSystem: true });
    expect(items.find((r) => r.code === 'admin')?.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('detalle inexistente → 404', async () => {
    const { roles } = staffHarness();
    await expect(roles.get('aaaaaaaa-9999-4999-8999-999999999999')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('catálogo agrupado por módulo, ordenado', async () => {
    const { roles } = staffHarness();
    const { items } = await roles.permissions();
    expect(items.map((m) => m.module)).toEqual(
      [...new Set(ALL_PERMISSIONS.map((p) => p.split('.')[0]))].sort(),
    );
    expect(items.flatMap((m) => m.permissions)).toHaveLength(ALL_PERMISSIONS.length);
    expect(items.find((m) => m.module === 'staff')?.permissions.map((p) => p.code)).toEqual([
      'staff.assign_roles',
      'staff.create',
      'staff.disable',
      'staff.read',
      'staff.update',
    ]);
  });
});

describe('RolesService.replacePermissions', () => {
  it('reemplaza, y audita añadidos/retirados y empleados afectados en la misma transacción', async () => {
    const { roles, repo } = staffHarness();
    const T1 = 'cccccccc-0000-4000-8000-000000000001';
    repo.seed(staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]));
    const view = await roles.replacePermissions(adminActor(), kitchen, [
      'orders.read',
      'orders.cancel',
    ]);
    expect(view.permissions.map((p) => p.code)).toEqual(['orders.cancel', 'orders.read']);
    expect(repo.audit).toEqual([
      expect.objectContaining({
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: kitchen,
        newValues: {
          role: 'kitchen',
          added: ['orders.cancel'],
          removed: ['orders.accept', 'orders.complete', 'orders.prepare', 'orders.reject'],
          affectedStaffIds: [T1],
        },
      }),
    ]);
    // Rige en la siguiente solicitud: los registros reflejan los permisos nuevos.
    expect(repo.staff.get(T1)?.assignments[0]?.role.permissions).toEqual([
      'orders.cancel',
      'orders.read',
    ]);
  });

  it('idempotente: mismo conjunto no escribe ni audita', async () => {
    const { roles, repo } = staffHarness();
    await roles.replacePermissions(
      adminActor(),
      kitchen,
      [...roleRecord('kitchen').permissions].reverse(),
    );
    expect(repo.audit).toEqual([]);
  });

  it('el rol admin (is_system) no se edita: 409', async () => {
    const { roles, repo } = staffHarness();
    await expect(
      roles.replacePermissions(adminActor(), ROLE_IDS['admin'] as string, ['orders.read']),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.roles.get(ROLE_IDS['admin'] as string)?.permissions.size).toBe(
      ALL_PERMISSIONS.length,
    );
  });

  it('añadir un permiso que el actor no posee con alcance GLOBAL → 403 + denied_escalation; nada cambia', async () => {
    const { roles, repo } = staffHarness();
    const actor = staffContext(
      mergeGrants(
        grantsOf(['roles.manage', 'orders.read'], 'global'),
        grantsOf(['payments.refund'], [BRANCH_A]), // alcance parcial: no basta
      ),
      { staffId: ACTOR },
    );
    for (const permission of ['payments.refund', 'audit.read']) {
      await expect(
        roles.replacePermissions(actor, kitchen, [
          ...roleRecord('kitchen').permissions,
          permission,
        ]),
      ).rejects.toMatchObject({ status: 403, message: 'Acceso denegado' });
    }
    expect(repo.roles.get(kitchen)?.permissions.has('payments.refund')).toBe(false);
    expect(repo.audit.map((e) => e.action)).toEqual([
      'staff.denied_escalation',
      'staff.denied_escalation',
    ]);
    expect(repo.audit[0]).toMatchObject({
      entityType: 'role',
      entityId: kitchen,
      reason: 'permission_not_held_globally',
    });
  });

  it('retirar permisos no exige poseerlos; añadir uno que sí posee globalmente funciona', async () => {
    const { roles } = staffHarness();
    const actor = globalStaff(['roles.manage', 'orders.cancel'], { staffId: ACTOR });
    await expect(roles.replacePermissions(actor, kitchen, ['orders.read'])).resolves.toBeDefined();
    await expect(
      roles.replacePermissions(actor, kitchen, ['orders.read', 'orders.cancel']),
    ).resolves.toBeDefined();
  });

  it('roles.manage acotado a una sucursal no basta (el rol aplica a todas): 403', async () => {
    const { roles } = staffHarness();
    const actor = scopedStaff(['roles.manage', 'orders.read'], [BRANCH_A], { staffId: ACTOR });
    await expect(roles.replacePermissions(actor, kitchen, ['orders.read'])).rejects.toMatchObject({
      status: 403,
    });
  });

  it('permiso desconocido → 400; rol inexistente → 404', async () => {
    const { roles } = staffHarness();
    await expect(
      roles.replacePermissions(adminActor(), kitchen, ['orders.read', 'x.y']),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      roles.replacePermissions(adminActor(), 'aaaaaaaa-9999-4999-8999-999999999999', [
        'orders.read',
      ]),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('si la auditoría falla, los permisos NO cambian (misma transacción)', async () => {
    const { roles, repo } = staffHarness();
    repo.failNext.set('audit', new Error('audit down'));
    await expect(roles.replacePermissions(adminActor(), kitchen, ['orders.read'])).rejects.toThrow(
      'audit down',
    );
    expect(repo.roles.get(kitchen)?.permissions.size).toBe(5);
  });

  it('actor desactivado entre el guard y el comando → 403 sin mutar', async () => {
    const { roles, repo, revoked } = staffHarness();
    revoked.add(ACTOR);
    await expect(
      roles.replacePermissions(adminActor(), kitchen, ['orders.read']),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.roles.get(kitchen)?.permissions.size).toBe(5);
    expect(repo.audit.map((e) => e.reason)).toEqual(['actor_no_longer_authorized']);
  });
});
