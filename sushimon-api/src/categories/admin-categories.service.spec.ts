import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import type { CategoriesRepository } from './categories.repository.js';
import type { CategoryPatch, CategoryRow, NewCategoryData } from './categories.types.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = ID(1); // raíz
const B = ID(2); // hija de A
const C = ID(3); // hija de B (nivel 3)
const D = ID(4); // hija de A
const E = ID(5); // raíz

const row = (
  id: string,
  parentId: string | null,
  over: Partial<CategoryRow> = {},
): CategoryRow => ({
  id,
  parentId,
  slug: `slug-${id.slice(-1)}`,
  name: `Cat ${id.slice(-1)}`,
  description: null,
  sortOrder: 0,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const seed = (): CategoryRow[] => [
  row(A, null, { sortOrder: 0 }),
  row(B, A, { sortOrder: 0 }),
  row(C, B, { sortOrder: 0 }),
  row(D, A, { sortOrder: 1 }),
  row(E, null, { sortOrder: 1 }),
];

const staff = (over: { scoped?: boolean } = {}): StaffContext => {
  const perms = ['catalog.read', 'catalog.create', 'catalog.update'];
  const ctx = over.scoped ? scopedStaff(perms, ['branch-1']) : globalStaff(perms);
  return { ...ctx, staffId: 'staff-1' };
};

function setup(initial: CategoryRow[] = seed()) {
  const store = new Map(initial.map((r) => [r.id, { ...r }]));
  const calls: string[] = [];
  const audit: { action: string; entityId: string; oldValues?: unknown; newValues?: unknown }[] =
    [];
  let counter = 100;
  const tx = {};
  const repo = {
    // Simula COMMIT/ROLLBACK: si la función falla, se restaura el estado y la auditoría.
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      calls.push('begin');
      const snapshot = new Map([...store].map(([k, v]) => [k, { ...v }]));
      const auditLength = audit.length;
      try {
        return await fn(tx);
      } catch (error) {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        audit.length = auditLength;
        throw error;
      }
    }),
    lockHierarchy: vi.fn(() => {
      calls.push('lock');
      return Promise.resolve();
    }),
    findAllRows: vi.fn(() => {
      calls.push('read');
      return Promise.resolve([...store.values()].map((r) => ({ ...r })));
    }),
    insert: vi.fn((_tx: unknown, data: NewCategoryData) => {
      calls.push('insert');
      counter += 1;
      const created = row(ID(counter), data.parentId, { ...data });
      store.set(created.id, created);
      return Promise.resolve({ ...created });
    }),
    update: vi.fn((_tx: unknown, id: string, data: CategoryPatch) => {
      calls.push('update');
      const next = { ...(store.get(id) as CategoryRow), ...data };
      store.set(id, next);
      return Promise.resolve({ ...next });
    }),
  };
  const auditService = {
    record: vi.fn((_tx: unknown, event: (typeof audit)[number]) => {
      calls.push('audit');
      audit.push(event);
      return Promise.resolve();
    }),
  };
  const service = new AdminCategoriesService(
    repo as unknown as CategoriesRepository,
    auditService,
    new AuthorizationService({} as IdentityService),
  );
  return { service, repo, store, calls, audit, auditService };
}

describe('AdminCategoriesService.create', () => {
  it('bloquea la jerarquía PRIMERO, lee, escribe y audita (en ese orden), una sola vez', async () => {
    const { service, calls, audit } = setup();
    const created = await service.create(staff(), { name: '  Rolls  Fríos ', parentId: A });
    expect(calls).toEqual(['begin', 'lock', 'read', 'insert', 'audit']);
    expect(created).toMatchObject({
      slug: 'rolls-frios',
      name: 'Rolls Fríos',
      parentId: A,
      sortOrder: 2,
      depth: 2,
      active: true,
      effectivelyVisible: true,
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'category.created', entityId: created.id });
    expect(JSON.stringify(audit[0])).not.toMatch(/description/);
  });

  it('raíz nueva al final de las raíces; slug duplicado se desambigua -2, -3', async () => {
    const { service } = setup([
      row(A, null, { slug: 'rolls', sortOrder: 4 }),
      row(B, null, { slug: 'rolls-2' }),
    ]);
    const created = await service.create(staff(), { name: 'Rolls' });
    expect(created).toMatchObject({ slug: 'rolls-3', parentId: null, sortOrder: 5, depth: 1 });
  });

  it('slug explícito duplicado => 409 sin escribir', async () => {
    const { service, repo, audit } = setup();
    await expect(service.create(staff(), { name: 'X', slug: 'slug-1' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'CATEGORY_SLUG_TAKEN' },
    });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });

  it.each([
    ['padre inexistente', { parentId: ID(99) }, 'CATEGORY_PARENT_INVALID'],
    ['padre inactivo', { parentId: 'inactive' }, 'CATEGORY_PARENT_INVALID'],
    ['profundidad > 3', { parentId: C }, 'CATEGORY_DEPTH_EXCEEDED'],
  ])('%s => 422 %s', async (_label, input, code) => {
    const data = seed().map((r) => (r.id === D ? { ...r, active: false } : r));
    const { service, repo } = setup(data);
    const parentId = input.parentId === 'inactive' ? D : input.parentId;
    await expect(service.create(staff(), { name: 'X', parentId })).rejects.toMatchObject({
      status: 422,
      response: { code },
    });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('tope de 500 => 422 CATEGORY_LIMIT_REACHED', async () => {
    const many = Array.from({ length: 500 }, (_, i) => row(ID(1000 + i), null, { slug: `s${i}` }));
    const { service } = setup(many);
    await expect(service.create(staff(), { name: 'X' })).rejects.toMatchObject({
      status: 422,
      response: { code: 'CATEGORY_LIMIT_REACHED' },
    });
  });

  it('alcance solo por sucursal => 403 antes de tocar la base', async () => {
    const { service, repo } = setup();
    await expect(service.create(staff({ scoped: true }), { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('nombre vacío tras recortar => 400', async () => {
    const { service } = setup();
    await expect(service.create(staff(), { name: '   ' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('AdminCategoriesService.update', () => {
  it('sin cambios reales: sin escritura ni auditoría; devuelve la vista', async () => {
    const { service, repo, audit } = setup();
    const view = await service.update(staff(), B, { name: 'Cat 2', parentId: A, active: true });
    expect(view.id).toBe(B);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });

  it('categoría inexistente => 404 (después del 403)', async () => {
    const { service } = setup();
    await expect(service.update(staff(), ID(99), { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update(staff({ scoped: true }), ID(99), { name: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('editar nombre y descripción: category.updated con old/new solo de lo cambiado', async () => {
    const { service, audit, calls } = setup();
    const view = await service.update(staff(), B, { name: 'Nuevo', description: 'Algo' });
    expect(calls.slice(0, 3)).toEqual(['begin', 'lock', 'read']);
    expect(view).toMatchObject({ name: 'Nuevo', description: 'Algo' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'category.updated',
      oldValues: { name: 'Cat 2', description: null },
      newValues: { name: 'Nuevo', description: 'Algo' },
    });
  });

  it('desactivar => category.deactivated; el hijo activo queda effectivelyVisible=false', async () => {
    const { service, audit, store } = setup();
    const view = await service.update(staff(), B, { active: false });
    expect(view).toMatchObject({ active: false, effectivelyVisible: false });
    expect(audit.map((a) => a.action)).toEqual(['category.deactivated']);
    expect(store.get(C)?.active).toBe(true); // el hijo no se toca
    const reactivated = await service.update(staff(), B, { active: true });
    expect(reactivated.effectivelyVisible).toBe(true);
    expect(audit.map((a) => a.action)).toEqual(['category.deactivated', 'category.activated']);
  });

  it('editar y desactivar a la vez => updated + deactivated', async () => {
    const { service, audit } = setup();
    await service.update(staff(), D, { name: 'Otro', active: false });
    expect(audit.map((a) => a.action)).toEqual(['category.updated', 'category.deactivated']);
    expect(audit[0]?.newValues).toEqual({ name: 'Otro' });
  });

  it('slug de otra categoría => 409; el propio slug no es conflicto', async () => {
    const { service } = setup();
    await expect(service.update(staff(), B, { slug: 'slug-4' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'CATEGORY_SLUG_TAKEN' },
    });
    await expect(service.update(staff(), B, { slug: 'slug-2' })).resolves.toMatchObject({ id: B });
  });

  it('mover: queda al final de los nuevos hermanos y audita parentId/sortOrder', async () => {
    const { service, audit } = setup();
    const view = await service.update(staff(), D, { parentId: E });
    expect(view).toMatchObject({ parentId: E, sortOrder: 0, depth: 2 });
    expect(audit[0]).toMatchObject({
      action: 'category.updated',
      oldValues: { parentId: A, sortOrder: 1 },
      newValues: { parentId: E, sortOrder: 0 },
    });
  });

  it('mover a la raíz (parentId null)', async () => {
    const { service } = setup();
    const view = await service.update(staff(), B, { parentId: null });
    expect(view).toMatchObject({ parentId: null, depth: 1, sortOrder: 2 });
  });

  it('ciclo: a sí misma, a un hijo y a un nieto => 422 CATEGORY_CYCLE sin escribir', async () => {
    const { service, repo } = setup();
    for (const target of [A, B, C]) {
      await expect(service.update(staff(), A, { parentId: target })).rejects.toMatchObject({
        status: 422,
        response: { code: 'CATEGORY_CYCLE' },
      });
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('profundidad: mover un subárbol que pasaría de 3 niveles => 422 CATEGORY_DEPTH_EXCEEDED', async () => {
    const { service } = setup();
    await expect(service.update(staff(), A, { parentId: E })).rejects.toMatchObject({
      status: 422,
      response: { code: 'CATEGORY_DEPTH_EXCEEDED' },
    });
  });

  it('destino inexistente o inactivo => 422 CATEGORY_PARENT_INVALID', async () => {
    const data = seed().map((r) => (r.id === E ? { ...r, active: false } : r));
    const { service } = setup(data);
    for (const target of [ID(99), E]) {
      await expect(service.update(staff(), D, { parentId: target })).rejects.toMatchObject({
        status: 422,
        response: { code: 'CATEGORY_PARENT_INVALID' },
      });
    }
  });

  it('PATCH vacío => 400 sin abrir transacción', async () => {
    const { service, repo } = setup();
    await expect(service.update(staff(), B, {})).rejects.toMatchObject({ status: 400 });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('alcance de sucursal => 403', async () => {
    const { service } = setup();
    await expect(service.update(staff({ scoped: true }), B, { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('un error de trigger de BD se traduce (red de seguridad ante carreras)', async () => {
    const { service, repo } = setup();
    repo.update.mockRejectedValueOnce({ code: '23514', message: 'categories_parent_cycle' });
    await expect(service.update(staff(), D, { name: 'X' })).rejects.toMatchObject({
      status: 422,
      response: { code: 'CATEGORY_CYCLE' },
    });
  });
});

describe('AdminCategoriesService.reorder', () => {
  it('reordena hijos: sort_order 0..n-1, audita una vez y devuelve los hermanos ordenados', async () => {
    const { service, audit, calls, store } = setup();
    const res = await service.reorder(staff(), { parentId: A, orderedIds: [D, B] });
    expect(calls.slice(0, 3)).toEqual(['begin', 'lock', 'read']);
    expect(res.items.map((i) => [i.id, i.sortOrder])).toEqual([
      [D, 0],
      [B, 1],
    ]);
    expect(res.total).toBe(2);
    expect(store.get(D)?.sortOrder).toBe(0);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'category.reordered',
      entityId: A,
      oldValues: { parentId: A, orderedIds: [B, D] },
      newValues: { parentId: A, orderedIds: [D, B] },
    });
  });

  it('raíces (parentId null): audita con el UUID nulo como entidad', async () => {
    const { service, audit } = setup();
    const res = await service.reorder(staff(), { parentId: null, orderedIds: [E, A] });
    expect(res.items.map((i) => i.id)).toEqual([E, A]);
    expect(audit[0]?.entityId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('idempotente: mismo orden => 200 sin escritura ni auditoría', async () => {
    const { service, repo, audit } = setup();
    const res = await service.reorder(staff(), { parentId: A, orderedIds: [B, D] });
    expect(res.items.map((i) => i.id)).toEqual([B, D]);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });

  it('mismo orden pero sort_order con huecos => renumera (cambio real)', async () => {
    const data = seed().map((r) => (r.id === D ? { ...r, sortOrder: 7 } : r));
    const { service, audit, store } = setup(data);
    await service.reorder(staff(), { parentId: A, orderedIds: [B, D] });
    expect(store.get(D)?.sortOrder).toBe(1);
    expect(audit).toHaveLength(1);
  });

  it.each([
    ['faltante', [B]],
    ['ajeno', [B, D, C]],
    ['duplicado', [B, B]],
    ['sobrante repetido', [B, D, D]],
  ])('%s => 422 CATEGORY_REORDER_MISMATCH sin escribir', async (_label, orderedIds) => {
    const { service, repo, audit } = setup();
    await expect(service.reorder(staff(), { parentId: A, orderedIds })).rejects.toMatchObject({
      status: 422,
      response: { code: 'CATEGORY_REORDER_MISMATCH' },
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });

  it('parentId inexistente => 404; alcance de sucursal => 403', async () => {
    const { service } = setup();
    await expect(
      service.reorder(staff(), { parentId: ID(99), orderedIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.reorder(staff({ scoped: true }), { parentId: A, orderedIds: [B, D] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AdminCategoriesService: atomicidad y escala', () => {
  it('si la auditoría falla, el alta se revierte (nada persiste) y el error se propaga', async () => {
    const { service, auditService, store } = setup();
    auditService.record.mockRejectedValueOnce(new Error('audit down'));
    const before = store.size;
    await expect(service.create(staff(), { name: 'Nueva' })).rejects.toThrow('audit down');
    expect(store.size).toBe(before);
  });

  it('si la auditoría falla, el PATCH se revierte', async () => {
    const { service, auditService, store } = setup();
    auditService.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.update(staff(), B, { name: 'Otro' })).rejects.toThrow('audit down');
    expect(store.get(B)?.name).toBe('Cat 2');
  });

  it('si la auditoría falla, el reorder se revierte', async () => {
    const { service, auditService, store } = setup();
    auditService.record.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.reorder(staff(), { parentId: A, orderedIds: [D, B] })).rejects.toThrow(
      'audit down',
    );
    expect(store.get(D)?.sortOrder).toBe(1);
    expect(store.get(B)?.sortOrder).toBe(0);
  });

  it('un error de lock_timeout/timeout del repositorio => 503 CATEGORIES_BUSY', async () => {
    const { service, repo } = setup();
    repo.lockHierarchy.mockRejectedValueOnce({ cause: { code: '55P03' } });
    await expect(service.create(staff(), { name: 'X' })).rejects.toMatchObject({
      status: 503,
      response: { code: 'CATEGORIES_BUSY' },
    });
  });

  it('reorder con 500 hermanos invertidos: una escritura por fila cambiada y una auditoría', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => ID(5000 + i));
    const { service, repo, audit } = setup(
      ids.map((rid, i) =>
        row(rid, null, { sortOrder: i, name: `N${String(i).padStart(3, '0')}`, slug: `s${i}` }),
      ),
    );
    const res = await service.reorder(staff(), { parentId: null, orderedIds: [...ids].reverse() });
    expect(res.total).toBe(500);
    expect(res.items[0]?.id).toBe(ids[499]);
    expect(repo.update).toHaveBeenCalledTimes(500);
    expect(audit).toHaveLength(1);
  });
});
