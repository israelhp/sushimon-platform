import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as auth from '@/services/auth';
import * as staff from '@/services/staff';
import { createHarness } from '../testing';

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
  return 200;
}

async function error(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

type Harness = ReturnType<typeof createHarness>;
/** Sesión de un empleado cualquiera del store (los handlers leen el store, no la sesión). */
function actAs(h: Harness, userId: string) {
  const u = h.store.staff.find((x) => x.id === userId)!;
  h.session.staff = {
    userId,
    email: u.email,
    name: u.fullName,
    role: 'admin',
    grants: {},
    branches: [],
  };
}
function addAdmin(h: Harness, id: string, opts: { linked: boolean }) {
  h.store.staff.push({
    id,
    fullName: `Admin ${id}`,
    email: `${id}@sushimon.gt`,
    active: true,
    linked: opts.linked,
    linkedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    createdById: null,
    assignments: [{ roleId: 'role-admin', branchId: null }],
  });
}

const ROLE = {
  admin: 'role-admin',
  manager: 'role-manager',
  kitchen: 'role-kitchen',
  staff: 'role-staff',
};
const newStaff = (over: Record<string, unknown> = {}) => ({
  fullName: 'Nuevo Empleado',
  email: 'nuevo@sushimon.gt',
  assignments: [{ roleId: ROLE.kitchen, branchId: 'sucursal-1' }],
  ...over,
});

describe('F03 · contexto administrativo', () => {
  it('sin sesión 401; el encargado recibe grants acotados y solo sus sucursales', async () => {
    const h = createHarness();
    expect(await status(staff.getAdminContext(h.client))).toBe(401);
    h.asStaff('manager');
    const ctx = await staff.getAdminContext(h.client);
    expect(ctx.aal).toBe('aal2');
    expect(ctx.staff.grants['staff.create']).toEqual({
      allBranches: false,
      branchIds: ['sucursal-1'],
    });
    expect(ctx.staff.grants['roles.manage']).toBeUndefined();
    expect(ctx.staff.branches.map((b) => b.id)).toEqual(['sucursal-1']);
    expect(ctx.staff.permissions).toContain('staff.read');
  });

  it('el administrador tiene los 46 permisos con alcance global y todas las sucursales activas', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const ctx = await staff.getAdminContext(h.client);
    expect(Object.keys(ctx.staff.grants)).toHaveLength(46);
    expect(ctx.staff.grants['roles.manage']).toEqual({ allBranches: true, branchIds: [] });
    expect(ctx.staff.branches.map((b) => b.id)).toEqual(['sucursal-1', 'sucursal-2', 'sucursal-3']);
  });

  it('una sucursal inactiva no concede acceso operativo y el desactivado recibe 403', async () => {
    const h = createHarness();
    h.store.branches.find((b) => b.id === 'sucursal-1')!.active = false;
    h.asStaff('manager');
    const ctx = await staff.getAdminContext(h.client);
    expect(ctx.staff.grants['orders.read']).toBeUndefined();
    expect(ctx.staff.branches).toEqual([]);
    h.asStaff('manager', 'u8');
    expect(await status(staff.getAdminContext(h.client))).toBe(403);
  });

  it('GET /v1/auth/context incluye grants y branches del servidor', async () => {
    const h = createHarness();
    h.asStaff('kitchen');
    const ctx = await auth.getAuthContext(h.client);
    expect(ctx.access).toBe('GRANTED');
    expect(ctx.staff?.grants['orders.accept']).toEqual({
      allBranches: false,
      branchIds: ['sucursal-1'],
    });
    expect(ctx.staff?.branches).toHaveLength(1);
  });
});

describe('F03 · listado y detalle', () => {
  it('el administrador ve a todos; sin authUserId; manageable por fila', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const page = await staff.listAdminStaff(h.client, { pageSize: 100 });
    expect(page.total).toBe(11);
    expect(JSON.stringify(page)).not.toContain('authUserId');
    const valeria = page.items.find((u) => u.id === 'u10')!;
    expect(valeria.identityStatus).toBe('PENDING_LINK');
    expect(valeria.createdBy).toEqual({ id: 'u1', fullName: 'Ana Lucía Pérez' });
    expect(page.items.find((u) => u.id === 'u1')?.manageable).toBe(true);
    expect(page.items.find((u) => u.id === 'u1')?.assignments[0]).toMatchObject({
      branch: null,
      effective: true,
    });
  });

  it('el encargado de A solo ve personal de A; el de otra sucursal es 404', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const page = await staff.listAdminStaff(h.client);
    expect(page.items.map((u) => u.id).sort()).toEqual(['u2', 'u5', 'u8', 'u9']);
    expect(await status(staff.getAdminStaff(h.client, 'u3'))).toBe(404);
    expect(await status(staff.getAdminStaff(h.client, 'u1'))).toBe(404);
    expect(await status(staff.getAdminStaff(h.client, 'inexistente'))).toBe(404);
    // Sofía opera en s2 y s3: invisible para el encargado de s1.
    expect(await status(staff.getAdminStaff(h.client, 'u11'))).toBe(404);
  });

  it('403 sin staff.read', async () => {
    const h = createHarness();
    h.asStaff('kitchen');
    expect(await status(staff.listAdminStaff(h.client))).toBe(403);
    expect(await status(staff.getAdminStaff(h.client, 'u5'))).toBe(403);
  });

  it('filtros, búsqueda, orden y paginación validados', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect((await staff.listAdminStaff(h.client, { q: 'COCINA' })).total).toBe(3);
    expect(
      (await staff.listAdminStaff(h.client, { identityStatus: 'PENDING_LINK' })).items.map(
        (u) => u.id,
      ),
    ).toEqual(['u10']);
    expect(
      (await staff.listAdminStaff(h.client, { active: false })).items.map((u) => u.id),
    ).toEqual(['u8']);
    expect(
      (await staff.listAdminStaff(h.client, { branchId: 'sucursal-3' })).items
        .map((u) => u.id)
        .sort(),
    ).toEqual(['u11', 'u4', 'u7']);
    expect((await staff.listAdminStaff(h.client, { roleId: ROLE.staff })).total).toBe(1);
    const desc = await staff.listAdminStaff(h.client, {
      sort: 'email',
      order: 'desc',
      pageSize: 2,
      page: 2,
    });
    expect(desc.items).toHaveLength(2);
    expect(desc.pageSize).toBe(2);
    expect(await status(staff.listAdminStaff(h.client, { pageSize: 101 }))).toBe(400);
    expect(await status(staff.listAdminStaff(h.client, { page: 0 }))).toBe(400);
    expect(await status(staff.listAdminStaff(h.client, { q: 'x'.repeat(101) }))).toBe(400);
    expect(await status(h.client.get('/v1/admin/staff', { query: { sort: 'authUserId' } }))).toBe(
      400,
    );
  });
});

describe('F03 · crear (preautorizar)', () => {
  it('crea PENDING_LINK activo con correo normalizado y createdBy', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const created = await staff.createAdminStaff(
      h.client,
      newStaff({
        email: '  Nuevo@Sushimon.GT ',
        assignments: [
          { roleId: ROLE.admin, branchId: null },
          { roleId: ROLE.kitchen, branchId: 'sucursal-2' },
        ],
      }),
    );
    expect(created).toMatchObject({
      email: 'nuevo@sushimon.gt',
      active: true,
      identityStatus: 'PENDING_LINK',
      linkedAt: null,
      createdBy: { id: 'u1' },
    });
    expect(created.id).toBe('u12');
    expect(created.assignments).toHaveLength(2);
    expect(JSON.stringify(created)).not.toContain('authUserId');
  });

  it('rechaza authUserId y campos desconocidos (400), datos inválidos y reglas de rol/alcance', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(staff.createAdminStaff(h.client, newStaff({ authUserId: 'x' }) as never)),
    ).toBe(400);
    expect(await status(staff.createAdminStaff(h.client, newStaff({ fullName: 'A' })))).toBe(400);
    expect(await status(staff.createAdminStaff(h.client, newStaff({ email: 'mal' })))).toBe(400);
    expect(await status(staff.createAdminStaff(h.client, newStaff({ assignments: [] })))).toBe(400);
    // admin ⇒ global; el resto no puede ser global; sucursal inexistente/inactiva; duplicadas
    expect(
      await status(
        staff.createAdminStaff(
          h.client,
          newStaff({ assignments: [{ roleId: ROLE.admin, branchId: 'sucursal-1' }] }),
        ),
      ),
    ).toBe(400);
    expect(
      await status(
        staff.createAdminStaff(
          h.client,
          newStaff({ assignments: [{ roleId: ROLE.kitchen, branchId: null }] }),
        ),
      ),
    ).toBe(400);
    expect(
      await status(
        staff.createAdminStaff(
          h.client,
          newStaff({ assignments: [{ roleId: ROLE.kitchen, branchId: 'sucursal-4' }] }),
        ),
      ),
    ).toBe(400);
    expect(
      await status(
        staff.createAdminStaff(
          h.client,
          newStaff({ assignments: [{ roleId: 'nada', branchId: 'sucursal-1' }] }),
        ),
      ),
    ).toBe(400);
    const dup = { roleId: ROLE.kitchen, branchId: 'sucursal-1' };
    const e = await error(staff.createAdminStaff(h.client, newStaff({ assignments: [dup, dup] })));
    expect(e.status).toBe(400);
    expect(e.details?.join(' ')).toMatch(/duplicada/);
  });

  it('correo duplicado (sin importar mayúsculas) = 409', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(staff.createAdminStaff(h.client, newStaff({ email: 'ANA.PEREZ@sushimon.gt' }))),
    ).toBe(409);
  });

  it('el encargado de A crea en A; admin, global u otra sucursal = 403; sin staff.create = 403', async () => {
    const h = createHarness();
    h.asStaff('manager');
    expect((await staff.createAdminStaff(h.client, newStaff())).assignments[0]?.branch?.id).toBe(
      'sucursal-1',
    );
    const attempt = (assignments: unknown, email: string) =>
      status(staff.createAdminStaff(h.client, newStaff({ email, assignments })));
    expect(await attempt([{ roleId: ROLE.admin, branchId: null }], 'a1@sushimon.gt')).toBe(403);
    expect(
      await attempt([{ roleId: ROLE.kitchen, branchId: 'sucursal-2' }], 'a2@sushimon.gt'),
    ).toBe(403);
    // Regla del subconjunto: el encargado posee todos los permisos de `staff` y `kitchen`.
    expect(await attempt([{ roleId: ROLE.staff, branchId: 'sucursal-1' }], 'a3@sushimon.gt')).toBe(
      200,
    );
    h.asStaff('kitchen');
    expect(
      await status(staff.createAdminStaff(h.client, newStaff({ email: 'k@sushimon.gt' }))),
    ).toBe(403);
  });

  it('regla del subconjunto: sin un permiso del rol no se puede otorgar', async () => {
    const h = createHarness();
    h.store.roles.find((r) => r.code === 'manager')!.permissions = [
      'staff.read',
      'staff.create',
      'staff.assign_roles',
      'orders.read',
    ];
    h.asStaff('manager');
    // `kitchen` incluye orders.accept, que el encargado ya no posee.
    expect(await status(staff.createAdminStaff(h.client, newStaff()))).toBe(403);
  });
});

describe('F03 · editar (PATCH)', () => {
  it('cambia nombre; el correo solo en PENDING_LINK y se normaliza; vinculado = 409', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      (await staff.updateAdminStaff(h.client, 'u3', { fullName: '  Karla R.  ' })).fullName,
    ).toBe('Karla R.');
    expect(
      (await staff.updateAdminStaff(h.client, 'u10', { email: ' NUEVA@Sushimon.gt ' })).email,
    ).toBe('nueva@sushimon.gt');
    expect(
      await status(staff.updateAdminStaff(h.client, 'u3', { email: 'otro@sushimon.gt' })),
    ).toBe(409);
    expect(
      await status(staff.updateAdminStaff(h.client, 'u10', { email: 'ana.perez@sushimon.gt' })),
    ).toBe(409);
    expect(await status(staff.updateAdminStaff(h.client, 'u10', {}))).toBe(400);
    expect(await status(staff.updateAdminStaff(h.client, 'u10', { active: false } as never))).toBe(
      400,
    );
  });

  it('nadie edita su cuenta salvo fullName; 404 fuera de alcance; 403 si no es gestionable', async () => {
    const h = createHarness();
    h.asStaff('manager');
    expect(
      (await staff.updateAdminStaff(h.client, 'u2', { fullName: 'Marco A. Gómez' })).fullName,
    ).toBe('Marco A. Gómez');
    expect(await status(staff.updateAdminStaff(h.client, 'u2', { email: 'x@sushimon.gt' }))).toBe(
      403,
    );
    expect(await status(staff.updateAdminStaff(h.client, 'u3', { fullName: 'Otra' }))).toBe(404);
    // u5 es cocina de s1: gestionable.
    expect((await staff.updateAdminStaff(h.client, 'u5', { fullName: 'Cocina Z4' })).fullName).toBe(
      'Cocina Z4',
    );
    // Un empleado con una asignación fuera del alcance del encargado no es gestionable (visible por la de s1).
    h.store.staff
      .find((u) => u.id === 'u9')!
      .assignments.push({ roleId: ROLE.staff, branchId: 'sucursal-2' });
    expect(await status(staff.updateAdminStaff(h.client, 'u9', { fullName: 'Fuera' }))).toBe(403);
    expect((await staff.getAdminStaff(h.client, 'u9')).manageable).toBe(false);
  });
});

describe('F03 · estado', () => {
  it('desactivar exige reason (≤200) y es idempotente; activar no exige motivo', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(await status(staff.setAdminStaffStatus(h.client, 'u3', { active: false }))).toBe(400);
    expect(
      await status(
        staff.setAdminStaffStatus(h.client, 'u3', { active: false, reason: 'x'.repeat(201) }),
      ),
    ).toBe(400);
    expect(
      (await staff.setAdminStaffStatus(h.client, 'u3', { active: false, reason: 'Renuncia' }))
        .active,
    ).toBe(false);
    // idempotente
    expect(
      (await staff.setAdminStaffStatus(h.client, 'u3', { active: false, reason: 'Otra vez' }))
        .active,
    ).toBe(false);
    expect((await staff.setAdminStaffStatus(h.client, 'u3', { active: true })).active).toBe(true);
  });

  it('un desactivado pierde el acceso en la siguiente solicitud (403)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await staff.setAdminStaffStatus(h.client, 'u2', { active: false, reason: 'Baja' });
    h.asStaff('manager', 'u2');
    expect(await status(staff.listAdminStaff(h.client))).toBe(403);
  });

  it('nadie cambia su propio estado (403)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(staff.setAdminStaffStatus(h.client, 'u1', { active: false, reason: 'x' })),
    ).toBe(403);
    expect(await status(staff.setAdminStaffStatus(h.client, 'u1', { active: true }))).toBe(403);
  });

  it('último administrador: un administrador PENDING_LINK no cuenta como respaldo (409); con otro vinculado, sí', async () => {
    const h = createHarness();
    addAdmin(h, 'a3', { linked: false });
    actAs(h, 'a3');
    expect(
      await status(staff.setAdminStaffStatus(h.client, 'u1', { active: false, reason: 'Baja' })),
    ).toBe(409);
    expect(h.store.staff.find((u) => u.id === 'u1')?.active).toBe(true);
    // Con un segundo administrador vinculado, desactivar a Ana es válido; el último ya no.
    addAdmin(h, 'a2', { linked: true });
    actAs(h, 'a2');
    expect(
      (await staff.setAdminStaffStatus(h.client, 'u1', { active: false, reason: 'Baja' })).active,
    ).toBe(false);
    actAs(h, 'a3');
    expect(
      await status(staff.setAdminStaffStatus(h.client, 'a2', { active: false, reason: 'Baja' })),
    ).toBe(409);
  });
});

describe('F03 · asignaciones (PUT)', () => {
  it('reemplazo completo e idempotente', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const next = [
      { roleId: ROLE.manager, branchId: 'sucursal-2' },
      { roleId: ROLE.kitchen, branchId: 'sucursal-3' },
    ];
    const out = await staff.replaceAdminStaffAssignments(h.client, 'u3', { assignments: next });
    expect(out.assignments.map((a) => `${a.role.code}|${a.branch?.id}`).sort()).toEqual([
      'kitchen|sucursal-3',
      'manager|sucursal-2',
    ]);
    const again = await staff.replaceAdminStaffAssignments(h.client, 'u3', {
      assignments: [...next].reverse(),
    });
    expect(again.assignments).toHaveLength(2);
    expect(
      await status(staff.replaceAdminStaffAssignments(h.client, 'u3', { assignments: [] })),
    ).toBe(400);
  });

  it('nadie cambia sus propias asignaciones (403)', async () => {
    const h = createHarness();
    h.asStaff('manager');
    expect(
      await status(
        staff.replaceAdminStaffAssignments(h.client, 'u2', {
          assignments: [{ roleId: ROLE.kitchen, branchId: 'sucursal-1' }],
        }),
      ),
    ).toBe(403);
  });

  it('el encargado: añade en su sucursal, no otra sucursal ni admin (403) y no retira a un superior', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const ok = await staff.replaceAdminStaffAssignments(h.client, 'u5', {
      assignments: [
        { roleId: ROLE.kitchen, branchId: 'sucursal-1' },
        { roleId: ROLE.staff, branchId: 'sucursal-1' },
      ],
    });
    expect(ok.assignments).toHaveLength(2);
    expect(
      await status(
        staff.replaceAdminStaffAssignments(h.client, 'u5', {
          assignments: [{ roleId: ROLE.kitchen, branchId: 'sucursal-2' }],
        }),
      ),
    ).toBe(403);
    expect(
      await status(
        staff.replaceAdminStaffAssignments(h.client, 'u5', {
          assignments: [{ roleId: ROLE.admin, branchId: null }],
        }),
      ),
    ).toBe(403);
    // Retirar un rol que el actor no puede otorgar también es 403: se le da a u9 un rol con un permiso extra.
    h.store.roles.find((r) => r.code === 'staff')!.permissions.push('payments.refund');
    expect(
      await status(
        staff.replaceAdminStaffAssignments(h.client, 'u9', {
          assignments: [{ roleId: ROLE.kitchen, branchId: 'sucursal-1' }],
        }),
      ),
    ).toBe(403);
  });

  it('último administrador: quitar el rol admin al único vinculado = 409; con respaldo vinculado, 200', async () => {
    const h = createHarness();
    addAdmin(h, 'a3', { linked: false });
    actAs(h, 'a3');
    const demote = { assignments: [{ roleId: ROLE.manager, branchId: 'sucursal-1' }] };
    expect(await status(staff.replaceAdminStaffAssignments(h.client, 'u1', demote))).toBe(409);
    addAdmin(h, 'a2', { linked: true });
    expect(await status(staff.replaceAdminStaffAssignments(h.client, 'u1', demote))).toBe(200);
  });
});

describe('F03 · roles y permisos', () => {
  it('lista roles con permisos y empleados asignados; catálogo agrupado por módulo', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const roles = await staff.listAdminRoles(h.client);
    expect(roles.map((r) => r.code)).toEqual(['admin', 'manager', 'kitchen', 'staff']);
    expect(roles.find((r) => r.code === 'admin')).toMatchObject({
      isSystem: true,
      assignedStaffCount: 1,
    });
    expect(roles.find((r) => r.code === 'admin')?.permissions).toHaveLength(46);
    expect(roles.find((r) => r.code === 'kitchen')?.assignedStaffCount).toBe(4);
    expect((await staff.getAdminRole(h.client, ROLE.staff)).permissions.map((p) => p.code)).toEqual(
      ['orders.read', 'orders.accept', 'orders.prepare', 'deliveries.read'],
    );
    expect(await status(staff.getAdminRole(h.client, 'nada'))).toBe(404);
    const catalog = await staff.listAdminPermissions(h.client);
    expect(catalog.map((m) => m.module)).toContain('staff');
    expect(catalog.reduce((n, m) => n + m.permissions.length, 0)).toBe(46);
    h.asStaff('kitchen');
    expect(await status(staff.listAdminRoles(h.client))).toBe(403);
    expect(await status(staff.listAdminPermissions(h.client))).toBe(403);
  });

  it('PUT permisos: admin (sistema) = 409; encargado sin roles.manage = 403; cambio efectivo para los grants', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(
        staff.replaceAdminRolePermissions(h.client, ROLE.admin, { permissions: ['orders.read'] }),
      ),
    ).toBe(409);
    const out = await staff.replaceAdminRolePermissions(h.client, ROLE.kitchen, {
      permissions: ['orders.read', 'orders.accept', 'orders.cancel', 'orders.read'],
    });
    expect(out.permissions.map((p) => p.code)).toEqual([
      'orders.read',
      'orders.accept',
      'orders.cancel',
    ]);
    h.asStaff('kitchen');
    const ctx = await staff.getAdminContext(h.client);
    expect(ctx.staff.grants['orders.cancel']).toBeDefined();
    expect(ctx.staff.grants['orders.prepare']).toBeUndefined();
    h.asStaff('manager');
    expect(
      await status(
        staff.replaceAdminRolePermissions(h.client, ROLE.kitchen, { permissions: ['orders.read'] }),
      ),
    ).toBe(403);
  });

  it('PUT permisos: validaciones (400), 404, idempotencia y añadidos exigen alcance global', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(staff.replaceAdminRolePermissions(h.client, ROLE.kitchen, { permissions: [] })),
    ).toBe(400);
    expect(
      await status(
        staff.replaceAdminRolePermissions(h.client, ROLE.kitchen, {
          permissions: ['inventado.todo'],
        }),
      ),
    ).toBe(400);
    expect(
      await status(staff.replaceAdminRolePermissions(h.client, ROLE.kitchen, 'x' as never)),
    ).toBe(400);
    expect(
      await status(
        staff.replaceAdminRolePermissions(h.client, 'nada', { permissions: ['orders.read'] }),
      ),
    ).toBe(404);
    const same = await staff.replaceAdminRolePermissions(h.client, ROLE.staff, {
      permissions: ['orders.read', 'orders.accept', 'orders.prepare', 'deliveries.read'],
    });
    expect(same.permissions).toHaveLength(4);
    // Un actor con roles.manage pero sin alcance global sobre el permiso añadido: 403.
    const scoped = createHarness();
    scoped.store.roles.find((r) => r.code === 'manager')!.permissions.push('roles.manage');
    scoped.asStaff('manager');
    expect(
      await status(
        staff.replaceAdminRolePermissions(scoped.client, ROLE.kitchen, {
          permissions: ['orders.read', 'orders.cancel'],
        }),
      ),
    ).toBe(403);
  });
});

describe('F02 · POST /v1/admin/staff/:id/mfa-reset (simulado)', () => {
  const code = async (p: Promise<unknown>) => (await error(p)).businessCode;

  it('administrador global: 204 idempotente sobre un empleado vinculado y no cambia datos visibles', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const before = await staff.getAdminStaff(h.client, 'u5');
    expect(await staff.resetAdminStaffMfa(h.client, 'u5')).toBeUndefined();
    expect(await staff.resetAdminStaffMfa(h.client, 'u5')).toBeUndefined();
    expect(await staff.getAdminStaff(h.client, 'u5')).toEqual(before);
  });

  it('401 sin sesión; 403 genérico sin alcance global, sin staff.update o sobre uno mismo', async () => {
    const anon = createHarness();
    expect(await status(staff.resetAdminStaffMfa(anon.client, 'u5'))).toBe(401);
    // Encargado: tiene staff.update pero solo en su sucursal.
    const manager = createHarness();
    manager.asStaff('manager');
    const denied = await error(staff.resetAdminStaffMfa(manager.client, 'u5'));
    expect(denied.status).toBe(403);
    expect(denied.message).toBe('Acceso denegado');
    // Cocina: sin staff.update.
    const kitchen = createHarness();
    kitchen.asStaff('kitchen');
    expect(await status(staff.resetAdminStaffMfa(kitchen.client, 'u5'))).toBe(403);
    // Nunca sobre uno mismo.
    const admin = createHarness();
    admin.asStaff('admin');
    expect(await status(staff.resetAdminStaffMfa(admin.client, 'u1'))).toBe(403);
  });

  it('404 STAFF_NOT_FOUND si no existe; 409 STAFF_NOT_LINKED si está pendiente de vincular', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const missing = await error(staff.resetAdminStaffMfa(h.client, 'nada'));
    expect(missing.status).toBe(404);
    expect(missing.businessCode).toBe('STAFF_NOT_FOUND');
    expect(await code(staff.resetAdminStaffMfa(h.client, 'u10'))).toBe('STAFF_NOT_LINKED');
    expect(await status(staff.resetAdminStaffMfa(h.client, 'u10'))).toBe(409);
  });

  it('503 MFA_RESET_UNAVAILABLE cuando el servicio no está disponible (y se recupera)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    h.store.mfaResetUnavailable = true;
    const down = await error(staff.resetAdminStaffMfa(h.client, 'u5'));
    expect(down.status).toBe(503);
    expect(down.businessCode).toBe('MFA_RESET_UNAVAILABLE');
    h.store.mfaResetUnavailable = false;
    expect(await staff.resetAdminStaffMfa(h.client, 'u5')).toBeUndefined();
  });
});
