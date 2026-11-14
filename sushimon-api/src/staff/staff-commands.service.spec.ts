import { Logger } from '@nestjs/common';
import { ALL_PERMISSIONS, globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import {
  assignmentRecord,
  BRANCH_A,
  BRANCH_B,
  BRANCH_C,
  ROLE_IDS,
  roleRecord,
  staffRecord,
} from '../../test/support/staff-fixtures.js';
import { actions, staffHarness } from '../../test/support/staff-service-harness.js';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const T1 = 'cccccccc-0000-4000-8000-000000000001';
const T2 = 'cccccccc-0000-4000-8000-000000000002';
const T3 = 'cccccccc-0000-4000-8000-000000000003';

const adminActor = () => globalStaff(ALL_PERMISSIONS, { staffId: ADMIN_ID });
const managerActor = (branches = [BRANCH_A]) =>
  scopedStaff(roleRecord('manager').permissions, branches, { staffId: ADMIN_ID });
const role = (code: string) => ROLE_IDS[code] as string;

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('StaffCommandsService.create', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    fullName: ' Luis  Pérez ',
    email: ' Luis@Sushimon.TEST ',
    assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
    ...over,
  });

  it('el encargado preautoriza en su sucursal: correo normalizado, PENDING_LINK, createdBy y auditoría', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(
      staffRecord(ADMIN_ID, [assignmentRecord('manager', BRANCH_A)], { fullName: 'Marta' }),
    );
    const view = await commands.create(managerActor(), input());
    expect(view).toMatchObject({
      fullName: 'Luis Pérez',
      email: 'luis@sushimon.test',
      identityStatus: 'PENDING_LINK',
      linkedAt: null,
      active: true,
      createdBy: { id: ADMIN_ID, fullName: 'Marta' },
    });
    expect(view.assignments).toEqual([
      expect.objectContaining({
        branch: expect.objectContaining({ id: BRANCH_A }) as unknown,
        effective: true,
      }),
    ]);
    expect(JSON.stringify(view)).not.toContain('authUserId');
    expect(repo.audit).toEqual([
      expect.objectContaining({
        actorId: ADMIN_ID,
        entityType: 'staff_user',
        action: 'staff.created',
        newValues: expect.objectContaining({
          email: 'luis@sushimon.test',
          identityStatus: 'PENDING_LINK',
          assignments: [`kitchen@${BRANCH_A}`],
        }) as unknown,
      }),
    ]);
  });

  it('el encargado NO otorga admin: 403 genérico + staff.denied_escalation en transacción aparte; nada se crea', async () => {
    const { commands, repo } = staffHarness();
    await expect(
      commands.create(
        managerActor(),
        input({ assignments: [{ roleId: role('admin'), branchId: null }] }),
      ),
    ).rejects.toMatchObject({ status: 403, message: 'Acceso denegado' });
    expect(repo.staff.size).toBe(0);
    expect(repo.audit).toEqual([
      expect.objectContaining({
        action: 'staff.denied_escalation',
        actorId: ADMIN_ID,
        reason: 'scope_not_covered',
      }),
    ]);
    // La transacción del comando se revierte y la del evento de seguridad se confirma aparte.
    expect(repo.calls.filter((c) => c.startsWith('tx:'))).toEqual([
      'tx:begin',
      'tx:rollback',
      'tx:begin',
      'tx:commit',
    ]);
  });

  it.each([
    ['alcance global', [{ roleId: role('manager'), branchId: null }]],
    ['sucursal fuera de su alcance', [{ roleId: role('kitchen'), branchId: BRANCH_B }]],
    ['rol admin en su sucursal', [{ roleId: role('admin'), branchId: BRANCH_A }]],
    [
      'una asignación válida y otra en otra sucursal',
      [
        { roleId: role('kitchen'), branchId: BRANCH_A },
        { roleId: role('kitchen'), branchId: BRANCH_B },
      ],
    ],
  ])('encargado: %s → 403 sin crear', async (_n, assignments) => {
    const { commands, repo } = staffHarness();
    await expect(commands.create(managerActor(), input({ assignments }))).rejects.toMatchObject({
      status: 403,
    });
    expect(repo.staff.size).toBe(0);
    expect(actions(repo)).toEqual(['staff.denied_escalation']);
  });

  it('exige staff.create en el alcance de CADA asignación, además de assign_roles', async () => {
    const { commands, repo } = staffHarness();
    const actor = scopedStaff(['staff.assign_roles', 'orders.read'], [BRANCH_A], {
      staffId: ADMIN_ID,
    });
    // staff.create ausente: el guard HTTP ya lo bloquea; aquí el servicio también lo exige (defensa en profundidad).
    await expect(commands.create(actor, input())).rejects.toMatchObject({ status: 403 });
    expect(repo.staff.size).toBe(0);
  });

  it('el administrador global crea otro administrador (global) y un encargado en una sucursal', async () => {
    const { commands } = staffHarness();
    const a = await commands.create(adminActor(), {
      fullName: 'Nuevo Admin',
      email: 'nuevo.admin@sushimon.test',
      assignments: [{ roleId: role('admin'), branchId: null }],
    });
    expect(a.assignments[0]).toMatchObject({ branch: null, role: { code: 'admin' } });
    const m = await commands.create(
      adminActor(),
      input({ assignments: [{ roleId: role('manager'), branchId: BRANCH_B }] }),
    );
    expect(m.assignments[0]?.role.code).toBe('manager');
  });

  it('reglas de forma: rol inexistente, sucursal inactiva/inexistente, admin⇔global, duplicados → 400', async () => {
    const { commands, repo } = staffHarness();
    const bad = async (assignments: unknown) =>
      commands
        .create(adminActor(), input({ assignments }))
        .catch((e: { status: number }) => e.status);
    expect(
      await bad([{ roleId: 'aaaaaaaa-9999-4999-8999-999999999999', branchId: BRANCH_A }]),
    ).toBe(400);
    expect(await bad([{ roleId: role('kitchen'), branchId: BRANCH_C }])).toBe(400); // inactiva
    expect(
      await bad([{ roleId: role('kitchen'), branchId: 'dddddddd-9999-4999-8999-999999999999' }]),
    ).toBe(400);
    expect(await bad([{ roleId: role('manager'), branchId: null }])).toBe(400); // global ⇒ admin
    expect(await bad([{ roleId: role('admin'), branchId: BRANCH_A }])).toBe(400); // admin ⇒ global
    expect(
      await bad([
        { roleId: role('kitchen'), branchId: BRANCH_A },
        { roleId: role('kitchen'), branchId: BRANCH_A },
      ]),
    ).toBe(400);
    expect(repo.staff.size).toBe(0);
    expect(repo.audit).toEqual([]);
  });

  it('correo duplicado (UNIQUE) → 409, también con distinta capitalización; sin auditoría', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(
      staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)], { email: 'luis@sushimon.test' }),
    );
    await expect(commands.create(adminActor(), input())).rejects.toMatchObject({
      status: 409,
      message: 'Ya existe un empleado con ese correo',
    });
    expect(repo.audit).toEqual([]);
  });

  it('un CHECK/trigger de BD (23514/P2004) se traduce a 400 y revierte', async () => {
    const { commands, repo } = staffHarness();
    repo.failNext.set('insertStaff', Object.assign(new Error('check'), { code: 'P2004' }));
    await expect(commands.create(adminActor(), input())).rejects.toMatchObject({ status: 400 });
    expect(repo.staff.size).toBe(0);
  });

  it('si la auditoría falla, el alta se revierte (misma transacción)', async () => {
    const { commands, repo } = staffHarness();
    repo.failNext.set('audit', new Error('audit down'));
    await expect(commands.create(adminActor(), input())).rejects.toThrow('audit down');
    expect(repo.staff.size).toBe(0);
    expect(repo.audit).toEqual([]);
  });

  it('el correo y el nombre inválidos se rechazan antes de tocar la BD', async () => {
    const { commands, repo } = staffHarness();
    await expect(commands.create(adminActor(), input({ email: 'nope' }))).rejects.toMatchObject({
      status: 400,
    });
    await expect(commands.create(adminActor(), input({ fullName: '   ' }))).rejects.toMatchObject({
      status: 400,
    });
    expect(repo.calls).toEqual([]);
  });
});

describe('StaffCommandsService.update', () => {
  const kitchenA = () =>
    staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)], {
      linked: false,
      linkedAt: null,
      fullName: 'Luis',
      email: 'luis@sushimon.test',
    });

  it('cambia nombre y correo (PENDING_LINK) y audita solo el diff real', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    const view = await commands.update(managerActor(), T1, {
      fullName: 'Luis Alberto',
      email: 'LUIS.A@sushimon.test',
    });
    expect(view).toMatchObject({ fullName: 'Luis Alberto', email: 'luis.a@sushimon.test' });
    expect(repo.audit).toEqual([
      expect.objectContaining({
        action: 'staff.updated',
        oldValues: { fullName: 'Luis', email: 'luis@sushimon.test' },
        newValues: { fullName: 'Luis Alberto', email: 'luis.a@sushimon.test' },
      }),
    ]);
  });

  it('sin cambios reales: no escribe ni audita', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    await commands.update(managerActor(), T1, { fullName: ' Luis ', email: 'LUIS@sushimon.test' });
    expect(repo.audit).toEqual([]);
  });

  it('el correo de una identidad VINCULADA no se cambia (409); el nombre sí', async () => {
    const { commands, repo } = staffHarness();
    repo.seed({ ...kitchenA(), linked: true });
    await expect(
      commands.update(managerActor(), T1, { email: 'otro@sushimon.test' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(commands.update(managerActor(), T1, { fullName: 'Luisa' })).resolves.toMatchObject(
      { fullName: 'Luisa' },
    );
  });

  it('correo ya usado por otro empleado → 409', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(
      kitchenA(),
      staffRecord(T2, [assignmentRecord('kitchen', BRANCH_A)], { email: 'otro@sushimon.test' }),
    );
    await expect(
      commands.update(managerActor(), T1, { email: 'otro@sushimon.test' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('autoedición: solo fullName; cambiar su propio correo → 403 + denied_escalation', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(
      staffRecord(ADMIN_ID, [assignmentRecord('manager', BRANCH_A)], {
        fullName: 'Marta',
        email: 'marta@sushimon.test',
        linked: false,
      }),
    );
    await expect(
      commands.update(managerActor(), ADMIN_ID, { fullName: 'Marta Díaz' }),
    ).resolves.toMatchObject({ fullName: 'Marta Díaz' });
    await expect(
      commands.update(managerActor(), ADMIN_ID, { email: 'nuevo@sushimon.test' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(actions(repo)).toEqual(['staff.updated', 'staff.denied_escalation']);
    expect(repo.audit[1]?.reason).toBe('self_modification');
  });

  it('empleado de otra sucursal (o inexistente) → 404 indistinguible; no entra a la transacción de escritura', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(staffRecord(T1, [assignmentRecord('kitchen', BRANCH_B)]));
    const other = await commands
      .update(managerActor(), T1, { fullName: 'X' })
      .catch((e: { status: number; message: string }) => e);
    const missing = await commands
      .update(managerActor(), T3, { fullName: 'X' })
      .catch((e: { status: number; message: string }) => e);
    expect(other).toMatchObject({ status: 404 });
    expect((other as { message: string }).message).toBe((missing as { message: string }).message);
    expect(repo.audit).toEqual([]);
  });

  it('visible pero no gestionable (opera también fuera de su alcance) → 403 + denied_escalation', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(
      staffRecord(T1, [
        assignmentRecord('kitchen', BRANCH_A),
        assignmentRecord('kitchen', BRANCH_B),
      ]),
    );
    await expect(commands.update(managerActor(), T1, { fullName: 'X' })).rejects.toMatchObject({
      status: 403,
    });
    expect(repo.audit[0]).toMatchObject({
      action: 'staff.denied_escalation',
      entityId: T1,
      reason: 'target_not_manageable',
    });
  });

  it('PATCH vacío → 400', async () => {
    const { commands } = staffHarness();
    await expect(commands.update(managerActor(), T1, {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('StaffCommandsService.changeStatus', () => {
  const target = () => staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]);

  it('desactiva con motivo y audita staff.deactivated con reason', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(target());
    const view = await commands.changeStatus(managerActor(), T1, {
      active: false,
      reason: ' Renunció ',
    });
    expect(view.active).toBe(false);
    expect(repo.audit).toEqual([
      expect.objectContaining({
        action: 'staff.deactivated',
        reason: 'Renunció',
        oldValues: { active: true },
        newValues: { active: false },
      }),
    ]);
  });

  it('desactivar sin motivo → 400; activar (motivo opcional) audita staff.activated', async () => {
    const { commands, repo } = staffHarness();
    repo.seed({ ...target(), active: false });
    await expect(
      commands.changeStatus(managerActor(), T1, { active: false }),
    ).rejects.toMatchObject({ status: 400 });
    await commands.changeStatus(managerActor(), T1, { active: true });
    expect(actions(repo)).toEqual(['staff.activated']);
  });

  it('idempotente: mismo estado no escribe ni audita', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(target());
    await expect(
      commands.changeStatus(managerActor(), T1, { active: true }),
    ).resolves.toMatchObject({ active: true });
    expect(repo.audit).toEqual([]);
  });

  it('nadie cambia su propio estado ni se reactiva: 403 + denied_escalation', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(staffRecord(ADMIN_ID, [assignmentRecord('admin', null)]));
    await expect(
      commands.changeStatus(adminActor(), ADMIN_ID, { active: false, reason: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      commands.changeStatus(adminActor(), ADMIN_ID, { active: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(actions(repo)).toEqual(['staff.denied_escalation', 'staff.denied_escalation']);
    expect(repo.staff.get(ADMIN_ID)?.active).toBe(true);
  });

  it('empleado de otra sucursal → 404; no gestionable → 403', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(staffRecord(T1, [assignmentRecord('kitchen', BRANCH_B)]));
    await expect(
      commands.changeStatus(managerActor(), T1, { active: false, reason: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
    repo.seed(
      staffRecord(T2, [assignmentRecord('admin', null), assignmentRecord('manager', BRANCH_A)]),
    );
    // visible (tiene A) pero incluye un admin global: no gestionable.
    await expect(
      commands.changeStatus(managerActor(), T2, { active: false, reason: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  describe('último administrador (candado pg_advisory_xact_lock + recuento en la misma transacción)', () => {
    const admin = (id: string, over = {}) =>
      staffRecord(id, [assignmentRecord('admin', null)], over);

    it('toma el candado ANTES de leer/bloquear la fila y recuenta antes de confirmar', async () => {
      const { commands, repo } = staffHarness();
      repo.seed(admin(T1), admin(T2));
      await commands.changeStatus(adminActor(), T1, { active: false, reason: 'baja' });
      expect(repo.calls.slice(0, 3)).toEqual(['tx:begin', 'lock:admin', 'lock:staff']);
    });

    it('desactivar al último administrador activo y vinculado → 409 y revierte', async () => {
      const { commands, repo } = staffHarness();
      // El actor es otro administrador que NO está en la tabla (p. ej. ya desactivado en paralelo).
      repo.seed(admin(T1));
      await expect(
        commands.changeStatus(adminActor(), T1, { active: false, reason: 'baja' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(repo.staff.get(T1)?.active).toBe(true);
      expect(repo.audit).toEqual([]);
    });

    it('dos desactivaciones de los dos últimos administradores (transacciones serializadas): exactamente una tiene éxito', async () => {
      const { commands, repo } = staffHarness();
      repo.seed(admin(T1), admin(T2));
      const actorA = globalStaff(ALL_PERMISSIONS, { staffId: T1 });
      const actorB = globalStaff(ALL_PERMISSIONS, { staffId: T2 });
      // Cada uno intenta desactivar al otro; el candado serializa y el segundo recuenta en 0.
      const results = await Promise.allSettled([
        commands.changeStatus(actorA, T2, { active: false, reason: 'a' }),
        commands.changeStatus(actorB, T1, { active: false, reason: 'b' }),
      ]);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as { status: number }).status).toBe(409);
      expect([...repo.staff.values()].filter((s) => s.active)).toHaveLength(1);
    });

    it('un administrador PENDING_LINK no cuenta: desactivar al único vinculado → 409', async () => {
      const { commands, repo } = staffHarness();
      repo.seed(admin(T1), admin(T2, { linked: false, linkedAt: null }));
      await expect(
        commands.changeStatus(adminActor(), T1, { active: false, reason: 'x' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('desactivar a un NO administrador no depende del recuento', async () => {
      const { commands, repo } = staffHarness();
      repo.seed(staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)])); // sin ningún administrador en la tabla
      await expect(
        commands.changeStatus(adminActor(), T1, { active: false, reason: 'x' }),
      ).resolves.toMatchObject({ active: false });
    });
  });
});

describe('StaffCommandsService.replaceAssignments', () => {
  const kitchenA = () => staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]);

  it('reemplazo transaccional con diff: añade, retira y audita added/removed', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    const view = await commands.replaceAssignments(managerActor(), T1, {
      assignments: [{ roleId: role('staff'), branchId: BRANCH_A }],
    });
    expect(view.assignments.map((a) => a.role.code)).toEqual(['staff']);
    expect(repo.audit).toEqual([
      expect.objectContaining({
        action: 'staff.assignments_changed',
        newValues: { added: [`staff@${BRANCH_A}`], removed: [`kitchen@${BRANCH_A}`] },
      }),
    ]);
    expect(repo.calls.slice(0, 3)).toEqual(['tx:begin', 'lock:admin', 'lock:staff']);
  });

  it('idempotente: mismo conjunto no escribe ni audita', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    await commands.replaceAssignments(managerActor(), T1, {
      assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
    });
    expect(repo.audit).toEqual([]);
  });

  it('el encargado no otorga admin/global ni otra sucursal (regla del subconjunto, 403) y no cambia nada', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    for (const assignments of [
      [{ roleId: role('admin'), branchId: null }],
      [{ roleId: role('kitchen'), branchId: BRANCH_B }],
      [
        { roleId: role('kitchen'), branchId: BRANCH_A },
        { roleId: role('manager'), branchId: null },
      ],
    ]) {
      await expect(
        commands.replaceAssignments(managerActor(), T1, { assignments }),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(repo.staff.get(T1)?.assignments).toHaveLength(1);
    expect(new Set(actions(repo))).toEqual(new Set(['staff.denied_escalation']));
  });

  it('nadie modifica sus propias asignaciones → 403', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(staffRecord(ADMIN_ID, [assignmentRecord('manager', BRANCH_A)]));
    await expect(
      commands.replaceAssignments(managerActor(), ADMIN_ID, {
        assignments: [
          { roleId: role('manager'), branchId: BRANCH_A },
          { roleId: role('manager'), branchId: BRANCH_B },
        ],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.audit[0]?.reason).toBe('self_modification');
  });

  it('un encargado no retira un rol superior a nadie: el objetivo con admin no es gestionable', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(
      staffRecord(T1, [assignmentRecord('manager', BRANCH_A), assignmentRecord('admin', null)]),
    );
    await expect(
      commands.replaceAssignments(managerActor(), T1, {
        assignments: [{ roleId: role('manager'), branchId: BRANCH_A }],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.staff.get(T1)?.assignments).toHaveLength(2);
  });

  it('sucursal inexistente/inactiva en una asignación AÑADIDA → 400; conservar la ya existente en una inactiva no se rechaza', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(staffRecord(T1, [assignmentRecord('kitchen', BRANCH_C, { branchActive: false })]));
    await expect(
      commands.replaceAssignments(adminActor(), T1, {
        assignments: [
          { roleId: role('kitchen'), branchId: BRANCH_C },
          { roleId: role('kitchen'), branchId: 'dddddddd-9999-4999-8999-999999999999' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      commands.replaceAssignments(adminActor(), T1, {
        assignments: [{ roleId: role('kitchen'), branchId: BRANCH_C }],
      }),
    ).resolves.toBeDefined();
  });

  it('rol inexistente → 400; duplicados → 400', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    await expect(
      commands.replaceAssignments(adminActor(), T1, {
        assignments: [{ roleId: 'aaaaaaaa-9999-4999-8999-999999999999', branchId: BRANCH_A }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      commands.replaceAssignments(adminActor(), T1, {
        assignments: [
          { roleId: role('kitchen'), branchId: BRANCH_A },
          { roleId: role('kitchen'), branchId: BRANCH_A },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('un fallo a mitad (trigger de BD) revierte TODO el reemplazo, sin auditoría', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(kitchenA());
    repo.failNext.set('createAssignments', Object.assign(new Error('check'), { code: '23514' }));
    await expect(
      commands.replaceAssignments(adminActor(), T1, {
        assignments: [{ roleId: role('staff'), branchId: BRANCH_A }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.staff.get(T1)?.assignments.map((a) => a.role.code)).toEqual(['kitchen']);
    expect(repo.audit).toEqual([]);
  });

  it('quitar el rol admin al último administrador → 409; si queda otro administrador vinculado, se permite', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(staffRecord(T1, [assignmentRecord('admin', null)]));
    const replacement = { assignments: [{ roleId: role('manager'), branchId: BRANCH_A }] };
    await expect(commands.replaceAssignments(adminActor(), T1, replacement)).rejects.toMatchObject({
      status: 409,
    });
    expect(repo.staff.get(T1)?.assignments[0]?.role.code).toBe('admin');
    repo.seed(staffRecord(T2, [assignmentRecord('admin', null)]));
    await expect(commands.replaceAssignments(adminActor(), T1, replacement)).resolves.toBeDefined();
  });

  it('inexistente → 404', async () => {
    const { commands } = staffHarness();
    await expect(
      commands.replaceAssignments(adminActor(), T3, {
        assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('permisos del actor releídos DENTRO de la transacción (tras el candado)', () => {
  const K = staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]);

  it('actor desactivado entre el guard y el comando → 403 sin mutar, en los cuatro comandos', async () => {
    const { commands, repo, revoked } = staffHarness();
    repo.seed(K);
    revoked.add(ADMIN_ID); // el guard lo vio activo; la relectura con el candado ya no
    const calls = [
      () =>
        commands.create(adminActor(), {
          fullName: 'Luis',
          email: 'luis@sushimon.test',
          assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
        }),
      () => commands.update(adminActor(), T1, { fullName: 'Otro' }),
      () => commands.changeStatus(adminActor(), T1, { active: false, reason: 'x' }),
      () =>
        commands.replaceAssignments(adminActor(), T1, {
          assignments: [{ roleId: role('staff'), branchId: BRANCH_A }],
        }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(repo.staff.size).toBe(1);
    expect(repo.staff.get(T1)).toMatchObject({ fullName: K.fullName, active: true });
    expect(repo.staff.get(T1)?.assignments).toHaveLength(1);
    expect(new Set(repo.audit.map((e) => e.reason))).toEqual(
      new Set(['actor_no_longer_authorized']),
    );
    expect(new Set(actions(repo))).toEqual(new Set(['staff.denied_escalation']));
  });

  it('el candado de administradores se toma ANTES de releer los permisos del actor', async () => {
    const { commands, repo } = staffHarness();
    repo.seed(K);
    await commands.changeStatus(adminActor(), T1, { active: false, reason: 'x' });
    expect(repo.calls.slice(0, 3)).toEqual(['tx:begin', 'lock:admin', 'lock:staff']);
  });

  it('roles y sucursales se validan y bloquean dentro de la transacción (FOR SHARE)', async () => {
    const { commands, repo, branches } = staffHarness();
    repo.seed(K);
    await commands.replaceAssignments(adminActor(), T1, {
      assignments: [{ roleId: role('staff'), branchId: BRANCH_B }],
    });
    expect(repo.calls).toContain('lock:roles-share');
    expect(branches.allActiveForShare).toHaveBeenCalledWith(expect.anything(), [BRANCH_B]);
  });
});
