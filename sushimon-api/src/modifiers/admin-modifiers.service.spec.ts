import { Logger } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { uniqueViolation } from '../../test/support/fake-products-repo.js';
import {
  FakeModifiersRepo,
  G,
  groupRow,
  mid,
  optionRow,
  OPT,
  P,
} from '../../test/support/fake-modifiers-repo.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { AdminModifiersService } from './admin-modifiers.service.js';
import { ModifiersQueryService } from './modifiers-query.service.js';
import type { ModifiersRepository } from './modifiers.repository.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

const PERMS = ['catalog.read', 'catalog.create', 'catalog.update'];
const staff = (scoped = false): StaffContext => ({
  ...(scoped ? scopedStaff(PERMS, ['branch-1']) : globalStaff(PERMS)),
  staffId: 'staff-1',
});

interface AuditEvent {
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

function setup() {
  const repo = new FakeModifiersRepo();
  repo.seedGroup(groupRow(G.salsas, { name: 'Salsas', minSelect: 1, maxSelect: 2 }), [
    optionRow(OPT(1), G.salsas, { name: 'Soya', extraPrice: '1.50', sortOrder: 0 }),
    optionRow(OPT(2), G.salsas, { name: 'Picante', sortOrder: 1 }),
    optionRow(OPT(3), G.salsas, { name: 'Dulce', sortOrder: 2, active: false }),
  ]);
  repo.seedGroup(groupRow(G.extras, { name: 'Extras' }), []);
  repo.seedGroup(groupRow(G.vacio, { name: 'Inactivo', active: false }), []);
  repo.seedProduct(P.roll, [G.salsas]);
  repo.seedProduct(P.sin, []);
  const events: AuditEvent[] = [];
  const audit = {
    record: vi.fn((_tx: unknown, e: AuditEvent) => {
      events.push(e);
      return Promise.resolve();
    }),
  };
  const r = repo as unknown as ModifiersRepository;
  const service = new AdminModifiersService(
    r,
    new ModifiersQueryService(r),
    audit,
    new AuthorizationService({} as IdentityService),
  );
  return { service, repo, events, audit };
}

const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { status?: number }).status;

describe('AdminModifiersService.createGroup', () => {
  it('crea grupo con opciones, audita group + modifier.created en la misma transacción', async () => {
    const { service, repo, events } = setup();
    const view = await service.createGroup(staff(), {
      name: ' Bebidas ',
      minSelect: 1,
      options: [{ name: 'Té', extraPrice: '2.50' }, { name: 'Agua' }],
    });
    expect(view).toMatchObject({
      name: 'Bebidas',
      required: true,
      optionCount: 2,
      productCount: 0,
    });
    expect(view.options.map((o) => [o.name, o.extraPrice, o.sortOrder])).toEqual([
      ['Té', '2.50', 0],
      ['Agua', '0.00', 1],
    ]);
    expect(events.map((e) => e.action)).toEqual([
      'modifier_group.created',
      'modifier.created',
      'modifier.created',
    ]);
    expect(repo.count('transaction')).toBe(1);
  });

  it('403 con alcance por sucursal, antes de tocar la BD', async () => {
    const { service, repo } = setup();
    expect(status(await failure(service.createGroup(staff(true), { name: 'X' })))).toBe(403);
    expect(repo.calls).toEqual([]);
  });

  it('min > opciones => 422 LIMITS_INVALID sin transacción; grupo inactivo exento', async () => {
    const { service, repo } = setup();
    const e = await failure(
      service.createGroup(staff(), { name: 'X', minSelect: 1, maxSelect: 2 }),
    );
    expect(code(e)).toBe('MODIFIER_LIMITS_INVALID');
    expect(repo.calls).toEqual([]);
    expect(
      (await service.createGroup(staff(), { name: 'X', minSelect: 1, active: false })).active,
    ).toBe(false);
  });

  it('nombre repetido sin distinguir mayúsculas => 409 y rollback del audit', async () => {
    const { service, events } = setup();
    const e = await failure(service.createGroup(staff(), { name: 'SALSAS' }));
    expect(status(e)).toBe(409);
    expect(code(e)).toBe('MODIFIER_GROUP_NAME_TAKEN');
    expect(events).toEqual([]);
  });

  it('503 MODIFIERS_BUSY ante P2028', async () => {
    const { service, repo } = setup();
    repo.failTransactionWith = { code: 'P2028' };
    const e = await failure(service.createGroup(staff(), { name: 'X' }));
    expect(status(e)).toBe(503);
    expect(code(e)).toBe('MODIFIERS_BUSY');
  });
});

describe('AdminModifiersService.updateGroup', () => {
  it('bloquea el grupo antes de leer; sin cambios => sin escribir ni auditar', async () => {
    const { service, repo, events } = setup();
    await service.updateGroup(staff(), G.salsas, { name: 'Salsas', minSelect: 1 });
    expect(repo.calls.slice(0, 3)).toEqual(['transaction', 'lockGroup', 'findGroupById']);
    expect(repo.count('updateGroup')).toBe(0);
    expect(events).toEqual([]);
  });

  it('inexistente => 404; 403 antes de 404', async () => {
    const { service } = setup();
    expect(code(await failure(service.updateGroup(staff(), mid(999), { name: 'x' })))).toBe(
      'MODIFIER_GROUP_NOT_FOUND',
    );
    expect(status(await failure(service.updateGroup(staff(true), mid(999), { name: 'x' })))).toBe(
      403,
    );
  });

  it('relación y rango se validan con el estado resultante', async () => {
    const { service } = setup();
    expect(code(await failure(service.updateGroup(staff(), G.salsas, { maxSelect: 0 })))).toBe(
      'MODIFIER_LIMITS_INVALID',
    );
    // min 3 > max 2 actual
    expect(code(await failure(service.updateGroup(staff(), G.salsas, { minSelect: 3 })))).toBe(
      'MODIFIER_LIMITS_INVALID',
    );
    // min 2 > 2 activas? salsas tiene 2 activas: ok; con max 2
    expect((await service.updateGroup(staff(), G.salsas, { minSelect: 2 })).minSelect).toBe(2);
  });

  it('subir min por encima de las opciones activas => LIMITS_INVALID; reactivar insatisfecho también', async () => {
    const { service, repo } = setup();
    repo.patchGroup(G.extras, { active: true });
    expect(code(await failure(service.updateGroup(staff(), G.extras, { minSelect: 1 })))).toBe(
      'MODIFIER_LIMITS_INVALID',
    );
    repo.patchGroup(G.vacio, { minSelect: 1 });
    expect(code(await failure(service.updateGroup(staff(), G.vacio, { active: true })))).toBe(
      'MODIFIER_LIMITS_INVALID',
    );
  });

  it('desactivar siempre posible; audita updated y deactivated por separado', async () => {
    const { service, events } = setup();
    const view = await service.updateGroup(staff(), G.salsas, { name: 'Otras', active: false });
    expect(view).toMatchObject({ name: 'Otras', active: false });
    expect(events.map((e) => e.action)).toEqual([
      'modifier_group.updated',
      'modifier_group.deactivated',
    ]);
    expect(events[0]).toMatchObject({
      oldValues: { name: 'Salsas' },
      newValues: { name: 'Otras' },
    });
  });

  it('carrera de nombre (23505 por constraint) => 409', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = uniqueViolation('modifier_groups_name_lower_key');
    expect(code(await failure(service.updateGroup(staff(), G.salsas, { name: 'Z' })))).toBe(
      'MODIFIER_GROUP_NAME_TAKEN',
    );
  });
});

describe('23505 sin target/constraint/message: traducción por operación (M1)', () => {
  const bare = { code: 'P2002' };
  it('createGroup/updateGroup => 409 MODIFIER_GROUP_NAME_TAKEN', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = bare;
    const a = await failure(service.createGroup(staff(), { name: 'Nuevo' }));
    expect([status(a), code(a)]).toEqual([409, 'MODIFIER_GROUP_NAME_TAKEN']);
    repo.failNextWriteWith = { code: '23505' };
    const b = await failure(service.updateGroup(staff(), G.salsas, { name: 'Otro' }));
    expect([status(b), code(b)]).toEqual([409, 'MODIFIER_GROUP_NAME_TAKEN']);
  });
  it('createOption/updateOption => 409 MODIFIER_NAME_TAKEN', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = bare;
    const a = await failure(service.createOption(staff(), G.salsas, { name: 'Nueva' }));
    expect([status(a), code(a)]).toEqual([409, 'MODIFIER_NAME_TAKEN']);
    repo.failNextWriteWith = { code: '23505' };
    const b = await failure(service.updateOption(staff(), OPT(1), { name: 'Otra' }));
    expect([status(b), code(b)]).toEqual([409, 'MODIFIER_NAME_TAKEN']);
  });
  it('violación de sort_key (reorder concurrente / diferida) => 503 MODIFIERS_BUSY', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = { code: '23505', meta: { target: ['modifiers_group_sort_key'] } };
    const e = await failure(service.reorderOptions(staff(), G.salsas, [OPT(3), OPT(1), OPT(2)]));
    expect([status(e), code(e)]).toEqual([503, 'MODIFIERS_BUSY']);
  });
  it('deadlock (40P01) => 503 MODIFIERS_BUSY', async () => {
    const { service, repo } = setup();
    repo.failTransactionWith = { code: '40P01' };
    expect(code(await failure(service.createGroup(staff(), { name: 'D' })))).toBe('MODIFIERS_BUSY');
  });
});

describe('AdminModifiersService.createOption', () => {
  it('agrega al final (max + 1), precio por defecto, audita', async () => {
    const { service, events, repo } = setup();
    const o = await service.createOption(staff(), G.salsas, { name: 'Ajo' });
    expect(o).toMatchObject({ name: 'Ajo', extraPrice: '0.00', sortOrder: 3, active: true });
    expect(events.map((e) => e.action)).toEqual(['modifier.created']);
    expect(repo.calls.slice(0, 3)).toEqual(['transaction', 'lockGroup', 'findOptionsByGroupIds']);
  });

  it('grupo inexistente 404; nombre repetido 409; 31ª opción 422', async () => {
    const { service, repo } = setup();
    expect(code(await failure(service.createOption(staff(), mid(999), { name: 'A' })))).toBe(
      'MODIFIER_GROUP_NOT_FOUND',
    );
    expect(code(await failure(service.createOption(staff(), G.salsas, { name: ' soya ' })))).toBe(
      'MODIFIER_NAME_TAKEN',
    );
    for (let i = 0; i < 27; i += 1)
      await service.createOption(staff(), G.salsas, { name: `n${i}` });
    expect(repo.optionsOf(G.salsas)).toHaveLength(30);
    expect(code(await failure(service.createOption(staff(), G.salsas, { name: 'x' })))).toBe(
      'MODIFIER_LIMIT_REACHED',
    );
  });

  it('precio inválido => 400 y no abre transacción', async () => {
    const { service, repo } = setup();
    expect(
      status(
        await failure(
          service.createOption(staff(), G.salsas, { name: 'A', extraPrice: '10000.00' }),
        ),
      ),
    ).toBe(400);
    expect(repo.calls).toEqual([]);
  });

  it('trigger de tope (23514) => 422 como respaldo', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = Object.assign(new Error('modifier_group_max_options'), {
      code: '23514',
    });
    expect(code(await failure(service.createOption(staff(), G.salsas, { name: 'Q' })))).toBe(
      'MODIFIER_LIMIT_REACHED',
    );
  });
});

describe('AdminModifiersService.updateOption', () => {
  it('edita precio y nombre, audita modifier.updated', async () => {
    const { service, events } = setup();
    const o = await service.updateOption(staff(), OPT(1), {
      name: 'Soya light',
      extraPrice: '2.00',
    });
    expect(o).toMatchObject({ name: 'Soya light', extraPrice: '2.00' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'modifier.updated',
      oldValues: { name: 'Soya', extraPrice: '1.50' },
    });
  });

  it('sin cambios => no escribe ni audita; 404 MODIFIER_NOT_FOUND', async () => {
    const { service, repo, events } = setup();
    await service.updateOption(staff(), OPT(1), { name: 'Soya', extraPrice: '1.50' });
    expect(repo.count('updateOption')).toBe(0);
    expect(events).toEqual([]);
    expect(code(await failure(service.updateOption(staff(), mid(999), { active: false })))).toBe(
      'MODIFIER_NOT_FOUND',
    );
  });

  it('nombre repetido en el grupo => 409', async () => {
    const { service } = setup();
    expect(code(await failure(service.updateOption(staff(), OPT(1), { name: 'PICANTE' })))).toBe(
      'MODIFIER_NAME_TAKEN',
    );
  });

  it('desactivar una opción que dejaría el grupo activo insatisfecho => 422 UNSATISFIABLE', async () => {
    const { service, events } = setup();
    await service.updateGroup(staff(), G.salsas, { minSelect: 2 });
    events.length = 0;
    const e = await failure(service.updateOption(staff(), OPT(1), { active: false }));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('MODIFIER_GROUP_UNSATISFIABLE');
    expect(events).toEqual([]);
  });

  it('con min 1 se puede desactivar una de dos; grupo inactivo sin restricción; reactivar audita', async () => {
    const { service, events } = setup();
    expect((await service.updateOption(staff(), OPT(1), { active: false })).active).toBe(false);
    await service.updateOption(staff(), OPT(3), { active: true });
    expect(events.map((e) => e.action)).toEqual(['modifier.deactivated', 'modifier.activated']);
    // grupo inactivo (vacio) con una opción: se puede desactivar
    const { service: s2, repo } = setup();
    repo.patchGroup(G.salsas, { active: false, minSelect: 2 });
    expect((await s2.updateOption(staff(), OPT(1), { active: false })).active).toBe(false);
  });
});

describe('AdminModifiersService.reorderOptions', () => {
  const ids = (n: number[]) => n.map(OPT);

  it('asigna 0..n-1 y audita modifier.reordered', async () => {
    const { service, events } = setup();
    const r = await service.reorderOptions(staff(), G.salsas, ids([3, 1, 2]));
    expect(r.items.map((i) => [i.id, i.sortOrder])).toEqual([
      [OPT(3), 0],
      [OPT(1), 1],
      [OPT(2), 2],
    ]);
    expect(events.map((e) => e.action)).toEqual(['modifier.reordered']);
  });

  it('mismo orden => 200 sin escribir ni auditar (idempotente)', async () => {
    const { service, repo, events } = setup();
    await service.reorderOptions(staff(), G.salsas, ids([1, 2, 3]));
    expect(repo.count('setOptionOrder')).toBe(0);
    expect(events).toEqual([]);
  });

  it.each([
    ['falta una', [1, 2]],
    ['repetida', [1, 1, 2]],
    ['ajena', [1, 2, 99]],
    ['de más', [1, 2, 3, 4]],
  ])('%s => 422 MODIFIER_REORDER_MISMATCH', async (_n, list) => {
    const { service, repo } = setup();
    repo.seedGroup(groupRow(G.vacio), [optionRow(OPT(99), G.vacio), optionRow(OPT(4), G.vacio)]);
    expect(code(await failure(service.reorderOptions(staff(), G.salsas, ids(list))))).toBe(
      'MODIFIER_REORDER_MISMATCH',
    );
    expect(repo.count('setOptionOrder')).toBe(0);
  });

  it('grupo inexistente => 404', async () => {
    const { service } = setup();
    expect(code(await failure(service.reorderOptions(staff(), mid(999), [])))).toBe(
      'MODIFIER_GROUP_NOT_FOUND',
    );
  });
});

describe('AdminModifiersService.replaceProductGroups', () => {
  it('reemplaza y ordena, audita ids antes/después', async () => {
    const { service, events, repo } = setup();
    repo.patchGroup(G.extras, {});
    const r = await service.replaceProductGroups(staff(), P.roll, [G.extras, G.salsas]);
    expect(r.groups.map((g) => g.id)).toEqual([G.extras, G.salsas]);
    expect(events).toEqual([
      expect.objectContaining({
        action: 'product.modifier_groups_replaced',
        oldValues: { groupIds: [G.salsas] },
        newValues: { groupIds: [G.extras, G.salsas] },
      }),
    ]);
    expect(repo.calls.slice(0, 3)).toEqual(['transaction', 'lockProduct', 'findProductLinks']);
  });

  it('vaciar la lista; sin cambios => 200 sin escribir ni auditar', async () => {
    const { service, repo, events } = setup();
    const same = await service.replaceProductGroups(staff(), P.roll, [G.salsas]);
    expect(same.groups).toHaveLength(1);
    expect(repo.count('replaceProductLinks')).toBe(0);
    expect(events).toEqual([]);
    expect((await service.replaceProductGroups(staff(), P.roll, [])).groups).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it('nuevos inactivos/inexistentes/duplicados => 422 MODIFIER_GROUP_INVALID con paths', async () => {
    const { service, repo } = setup();
    const e = (await failure(
      service.replaceProductGroups(staff(), P.roll, [G.salsas, G.vacio, mid(999)]),
    )) as { response: { violations: { path: string }[] } };
    expect(code(e)).toBe('MODIFIER_GROUP_INVALID');
    expect(e.response.violations.map((v) => v.path)).toEqual(['groupIds[1]', 'groupIds[2]']);
    expect(repo.count('replaceProductLinks')).toBe(0);
    expect(
      code(await failure(service.replaceProductGroups(staff(), P.roll, [G.extras, G.extras]))),
    ).toBe('MODIFIER_GROUP_INVALID');
  });

  it('un grupo YA asociado que se desactivó puede permanecer', async () => {
    const { service, repo } = setup();
    repo.patchGroup(G.salsas, { active: false });
    const r = await service.replaceProductGroups(staff(), P.roll, [G.extras, G.salsas]);
    expect(r.groups.map((g) => g.id)).toEqual([G.extras, G.salsas]);
  });

  it('11 grupos => 422 LIMIT_REACHED; producto inexistente 404; 403 por alcance', async () => {
    const { service } = setup();
    const many = Array.from({ length: 11 }, (_, i) => mid(300 + i));
    expect(code(await failure(service.replaceProductGroups(staff(), P.roll, many)))).toBe(
      'MODIFIER_LIMIT_REACHED',
    );
    expect(code(await failure(service.replaceProductGroups(staff(), mid(999), [])))).toBe(
      'PRODUCT_NOT_FOUND',
    );
    expect(status(await failure(service.replaceProductGroups(staff(true), P.roll, [])))).toBe(403);
  });

  it('503 si falla por bloqueo (55P03)', async () => {
    const { service, repo } = setup();
    repo.failNextWriteWith = { code: '55P03' };
    expect(code(await failure(service.replaceProductGroups(staff(), P.roll, [G.extras])))).toBe(
      'MODIFIERS_BUSY',
    );
  });
});
