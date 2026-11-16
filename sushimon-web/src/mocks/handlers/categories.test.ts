import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminCategory } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import * as categories from '@/services/categories';
import { createHarness } from '../testing';

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
  }
  throw new Error('se esperaba un ApiError');
};
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};
const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};
const adminList = async (h: ReturnType<typeof admin>) =>
  (await categories.listAdminCategories(h.client)).items;
const bySlug = (items: AdminCategory[], slug: string) => items.find((c) => c.slug === slug)!;

describe('F10 público: GET /v1/store/categories', () => {
  it('sin sesión devuelve el árbol anidado ordenado, ligero y solo con visibles', async () => {
    const h = createHarness();
    const { items } = await categories.listStoreCategories(h.client);
    expect(items.map((c) => c.slug)).toEqual([
      'entradas',
      'monchis',
      'rolls',
      'espirituosas',
      'relax',
      'postres',
    ]);
    const rolls = items.find((c) => c.slug === 'rolls')!;
    expect(rolls.children.map((c) => c.slug)).toEqual(['rolls-frios', 'rolls-tempura']);
    expect(Object.keys(rolls).sort()).toEqual(['children', 'description', 'id', 'name', 'slug']);
    // La raíz inactiva "temporada" y su hijo activo no se publican.
    expect(JSON.stringify(items)).not.toContain('temporada');
    expect(JSON.stringify(items)).not.toContain('edicion-limitada');
  });

  it('desactivar un padre oculta su subárbol aunque los hijos sigan activos; reactivarlo lo devuelve', async () => {
    const h = admin();
    const rolls = bySlug(await adminList(h), 'rolls');
    await categories.updateAdminCategory(h.client, rolls.id, { active: false });
    const hidden = await categories.listStoreCategories(h.client);
    expect(hidden.items.map((c) => c.slug)).not.toContain('rolls');
    expect(JSON.stringify(hidden)).not.toContain('rolls-frios');
    // El hijo conserva active=true pero effectivelyVisible=false.
    const child = bySlug(await adminList(h), 'rolls-frios');
    expect(child).toMatchObject({ active: true, effectivelyVisible: false });
    await categories.updateAdminCategory(h.client, rolls.id, { active: true });
    const back = await categories.listStoreCategories(h.client);
    expect(back.items.find((c) => c.slug === 'rolls')?.children).toHaveLength(2);
  });

  it('escenario empty: lista vacía (no es un error)', async () => {
    const h = createHarness('empty');
    expect(await categories.listStoreCategories(h.client)).toEqual({ items: [] });
  });
});

describe('F10 admin: lectura y permisos', () => {
  it('lista plana depth-first con depth y effectivelyVisible, incluidas inactivas', async () => {
    const h = admin();
    const list = await categories.listAdminCategories(h.client);
    expect(list.total).toBe(list.items.length);
    expect(list.items.map((c) => c.slug)).toEqual([
      'entradas',
      'monchis',
      'rolls',
      'rolls-frios',
      'rolls-tempura',
      'espirituosas',
      'relax',
      'postres',
      'temporada',
      'edicion-limitada',
    ]);
    expect(bySlug(list.items, 'rolls-frios')).toMatchObject({ depth: 2, effectivelyVisible: true });
    expect(bySlug(list.items, 'temporada')).toMatchObject({
      depth: 1,
      active: false,
      effectivelyVisible: false,
    });
    expect(bySlug(list.items, 'edicion-limitada')).toMatchObject({
      depth: 2,
      active: true,
      effectivelyVisible: false,
    });
  });

  it('filtros active, parentId y q (sin acentos ni mayúsculas) no reordenan', async () => {
    const h = admin();
    expect(
      (await categories.listAdminCategories(h.client, { active: false })).items.map((c) => c.slug),
    ).toEqual(['temporada']);
    const rolls = bySlug(await adminList(h), 'rolls');
    expect(
      (await categories.listAdminCategories(h.client, { parentId: rolls.id })).items.map(
        (c) => c.slug,
      ),
    ).toEqual(['rolls-frios', 'rolls-tempura']);
    expect(
      (await categories.listAdminCategories(h.client, { parentId: 'no-existe' })).items,
    ).toEqual([]);
    expect(
      (await categories.listAdminCategories(h.client, { q: 'BEBIDAS' })).items.map((c) => c.slug),
    ).toEqual(['espirituosas', 'relax']);
    expect(
      (await failure(h.client.get(paths.adminCategories(), { query: { active: 'x' } }))).status,
    ).toBe(400);
  });

  it('401 sin sesión; 403 sin catalog.read (cocina); el encargado puede leer pero no escribir', async () => {
    const h = createHarness();
    expect(await status(categories.listAdminCategories(h.client))).toBe(401);
    h.asStaff('kitchen');
    expect(await status(categories.listAdminCategories(h.client))).toBe(403);
    h.asStaff('manager');
    expect((await categories.listAdminCategories(h.client)).items.length).toBeGreaterThan(0);
    expect(await status(categories.createAdminCategory(h.client, { name: 'Bowls' }))).toBe(403);
    const first = (await adminList(h))[0]!;
    expect(await status(categories.updateAdminCategory(h.client, first.id, { name: 'X' }))).toBe(
      403,
    );
    expect(
      await status(categories.reorderAdminCategories(h.client, { parentId: null, orderedIds: [] })),
    ).toBe(403);
  });

  it('403 en escrituras con permiso pero SIN alcance global (solo sucursales)', async () => {
    const h = createHarness();
    // Un rol de sucursal al que se le concede catalog.update/create: sigue sin poder (las categorías son globales).
    const manager = h.store.roles.find((r) => r.code === 'manager')!;
    manager.permissions.push('catalog.create', 'catalog.update');
    h.asStaff('manager');
    expect((await categories.listAdminCategories(h.client)).items.length).toBeGreaterThan(0);
    const e = await failure(categories.createAdminCategory(h.client, { name: 'Bowls' }));
    expect(e.status).toBe(403);
    const first = (await adminList(h))[0]!;
    expect(
      await status(categories.updateAdminCategory(h.client, first.id, { active: false })),
    ).toBe(403);
    // No escribió nada.
    expect((await adminList(h)).find((c) => c.slug === 'bowls')).toBeUndefined();
  });

  it('no existe DELETE', async () => {
    const h = admin();
    const first = (await adminList(h))[0]!;
    expect(await status(h.client.delete(paths.adminCategory(first.id)))).toBe(404);
  });
});

describe('F10 crear', () => {
  it('genera el slug desde el nombre (sin acentos, kebab), lo desambigua y coloca al final', async () => {
    const h = admin();
    const a = await categories.createAdminCategory(h.client, {
      name: '  Ñoquis   Crujientes ¡Hoy!  ',
    });
    expect(a).toMatchObject({
      slug: 'noquis-crujientes-hoy',
      name: 'Ñoquis Crujientes ¡Hoy!',
      parentId: null,
      depth: 1,
      active: true,
      effectivelyVisible: true,
      description: null,
    });
    const b = await categories.createAdminCategory(h.client, { name: 'Ñoquis Crujientes Hoy' });
    expect(b.slug).toBe('noquis-crujientes-hoy-2');
    const c = await categories.createAdminCategory(h.client, { name: 'noquis crujientes hoy' });
    expect(c.slug).toBe('noquis-crujientes-hoy-3');
    // Al final de sus hermanos raíz: max+1.
    const roots = (await adminList(h)).filter((x) => x.parentId === null);
    expect(c.sortOrder).toBe(
      Math.max(...roots.filter((r) => r.id !== c.id).map((r) => r.sortOrder)) + 1,
    );
    expect(b.sortOrder).toBeLessThan(c.sortOrder);
  });

  it('409 CATEGORY_SLUG_TAKEN con slug explícito repetido', async () => {
    const h = admin();
    const e = await failure(
      categories.createAdminCategory(h.client, { name: 'Otra', slug: 'rolls' }),
    );
    expect(e).toMatchObject({ status: 409, businessCode: 'CATEGORY_SLUG_TAKEN' });
  });

  it('padre inexistente o inactivo => 422 CATEGORY_PARENT_INVALID', async () => {
    const h = admin();
    const list = await adminList(h);
    // `edicion-limitada` está activa pero oculta por su padre inactivo: tampoco recibe hijos (spec 011 D3).
    for (const parentId of [
      'no-existe',
      bySlug(list, 'temporada').id,
      bySlug(list, 'edicion-limitada').id,
    ]) {
      const e = await failure(categories.createAdminCategory(h.client, { name: 'Hija', parentId }));
      expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_PARENT_INVALID' });
    }
  });

  it('profundidad máxima 3: una subcategoría de nivel 3 acepta, la de nivel 4 => CATEGORY_DEPTH_EXCEEDED', async () => {
    const h = admin();
    const tempura = bySlug(await adminList(h), 'rolls-tempura');
    const level3 = await categories.createAdminCategory(h.client, {
      name: 'Especiales',
      parentId: tempura.id,
    });
    expect(level3.depth).toBe(3);
    const e = await failure(
      categories.createAdminCategory(h.client, { name: 'Nivel cuatro', parentId: level3.id }),
    );
    expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_DEPTH_EXCEEDED' });
  });

  it('400: nombre vacío/largo, slug no kebab, propiedades desconocidas, descripción larga', async () => {
    const h = admin();
    const bad = [
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 'Ok', slug: 'Mal Slug' },
      { name: 'Ok', extra: 1 },
      { name: 'Ok', description: 'd'.repeat(501) },
      { name: 'Ok', active: 'si' },
      {},
    ];
    for (const body of bad) {
      expect(await status(h.client.post(paths.adminCategories(), body))).toBe(400);
    }
  });

  it('422 CATEGORY_LIMIT_REACHED al llegar a 500', async () => {
    const h = admin();
    const template = h.store.menuCategories[0]!;
    while (h.store.menuCategories.length < 500) {
      const n = h.store.menuCategories.length;
      h.store.menuCategories.push({ ...template, id: `x-${n}`, slug: `x-${n}`, parentId: null });
    }
    const e = await failure(categories.createAdminCategory(h.client, { name: 'La 501' }));
    expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_LIMIT_REACHED' });
  });
});

describe('F10 editar y mover', () => {
  it('edita nombre, slug y descripción; null borra la descripción; sin cambios no toca updatedAt', async () => {
    const h = admin();
    const monchis = bySlug(await adminList(h), 'monchis');
    const edited = await categories.updateAdminCategory(h.client, monchis.id, {
      name: '  Monchis   y más ',
      slug: 'monchis-y-mas',
      description: 'Para picar',
    });
    expect(edited).toMatchObject({
      name: 'Monchis y más',
      slug: 'monchis-y-mas',
      description: 'Para picar',
    });
    expect(edited.updatedAt >= monchis.updatedAt).toBe(true);
    const cleared = await categories.updateAdminCategory(h.client, monchis.id, {
      description: null,
    });
    expect(cleared.description).toBeNull();
    const same = await categories.updateAdminCategory(h.client, monchis.id, {
      name: 'Monchis y más',
    });
    expect(same.updatedAt).toBe(cleared.updatedAt);
  });

  it('409 CATEGORY_SLUG_TAKEN al usar el slug de otra; el propio slug no choca', async () => {
    const h = admin();
    const list = await adminList(h);
    const e = await failure(
      categories.updateAdminCategory(h.client, bySlug(list, 'monchis').id, { slug: 'rolls' }),
    );
    expect(e).toMatchObject({ status: 409, businessCode: 'CATEGORY_SLUG_TAKEN' });
    expect(
      (await categories.updateAdminCategory(h.client, bySlug(list, 'rolls').id, { slug: 'rolls' }))
        .slug,
    ).toBe('rolls');
  });

  it('400 con cuerpo vacío o campos no permitidos; 404 si no existe', async () => {
    const h = admin();
    const id = (await adminList(h))[0]!.id;
    expect(await status(h.client.patch(paths.adminCategory(id), {}))).toBe(400);
    expect(await status(h.client.patch(paths.adminCategory(id), { sortOrder: 3 }))).toBe(400);
    expect(await status(categories.updateAdminCategory(h.client, 'no-existe', { name: 'X' }))).toBe(
      404,
    );
  });

  it('CICLOS IMPOSIBLES: moverla a sí misma o a un descendiente => 422 CATEGORY_CYCLE y no cambia nada', async () => {
    const h = admin();
    const before = await adminList(h);
    const rolls = bySlug(before, 'rolls');
    const tempura = bySlug(before, 'rolls-tempura');
    const nested = await categories.createAdminCategory(h.client, {
      name: 'Especiales',
      parentId: tempura.id,
    });
    for (const parentId of [rolls.id, tempura.id, nested.id]) {
      const e = await failure(categories.updateAdminCategory(h.client, rolls.id, { parentId }));
      expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_CYCLE' });
    }
    // Mover el nodo intermedio a su propio hijo también es ciclo.
    const e2 = await failure(
      categories.updateAdminCategory(h.client, tempura.id, { parentId: nested.id }),
    );
    expect(e2.businessCode).toBe('CATEGORY_CYCLE');
    const after = await adminList(h);
    expect(bySlug(after, 'rolls').parentId).toBeNull();
    expect(bySlug(after, 'rolls-tempura').parentId).toBe(rolls.id);
  });

  it('mover un subárbol que superaría 3 niveles => CATEGORY_DEPTH_EXCEEDED; permitido si cabe', async () => {
    const h = admin();
    const list = await adminList(h);
    const rolls = bySlug(list, 'rolls'); // altura 2
    const relax = bySlug(list, 'relax');
    // rolls (altura 2) bajo relax (nivel 1) => 3 niveles: cabe.
    const moved = await categories.updateAdminCategory(h.client, rolls.id, { parentId: relax.id });
    expect(moved).toMatchObject({ parentId: relax.id, depth: 2 });
    // Ahora relax > rolls > rolls-frios (3 niveles): mover relax bajo una raíz => 4 niveles.
    const entradas = bySlug(await adminList(h), 'entradas');
    const e = await failure(
      categories.updateAdminCategory(h.client, relax.id, { parentId: entradas.id }),
    );
    expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_DEPTH_EXCEEDED' });
  });

  it('mover a un padre inactivo o inexistente => CATEGORY_PARENT_INVALID; a la raíz con null; pasa al final', async () => {
    const h = admin();
    const list = await adminList(h);
    const monchis = bySlug(list, 'monchis');
    for (const parentId of [bySlug(list, 'temporada').id, 'no-existe']) {
      const e = await failure(categories.updateAdminCategory(h.client, monchis.id, { parentId }));
      expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_PARENT_INVALID' });
    }
    const frios = bySlug(list, 'rolls-frios');
    const root = await categories.updateAdminCategory(h.client, frios.id, { parentId: null });
    expect(root).toMatchObject({ parentId: null, depth: 1 });
    const roots = (await adminList(h)).filter((c) => c.parentId === null);
    expect(roots.at(-1)?.slug).toBe('rolls-frios');
    expect(root.sortOrder).toBe(Math.max(...roots.map((r) => r.sortOrder)));
  });

  it('desactivar un padre no toca a los hijos; sus hijos no admiten hijos nuevos bajo padre inactivo', async () => {
    const h = admin();
    const list = await adminList(h);
    const rolls = bySlug(list, 'rolls');
    await categories.updateAdminCategory(h.client, rolls.id, { active: false });
    const after = await adminList(h);
    expect(bySlug(after, 'rolls')).toMatchObject({ active: false, effectivelyVisible: false });
    expect(bySlug(after, 'rolls-frios')).toMatchObject({ active: true, effectivelyVisible: false });
    const e = await failure(
      categories.createAdminCategory(h.client, { name: 'Nueva', parentId: rolls.id }),
    );
    expect(e.businessCode).toBe('CATEGORY_PARENT_INVALID');
  });
});

describe('F10 reordenar entre hermanos', () => {
  const siblingsOf = async (h: ReturnType<typeof admin>, parentId: string | null) =>
    (await adminList(h)).filter((c) => c.parentId === parentId);

  it('asigna 0..n-1, devuelve los hermanos ordenados y el orden es estable en lecturas posteriores', async () => {
    const h = admin();
    const roots = await siblingsOf(h, null);
    const reversed = roots.map((c) => c.id).reverse();
    const result = await categories.reorderAdminCategories(h.client, {
      parentId: null,
      orderedIds: reversed,
    });
    expect(result.items.map((c) => c.id)).toEqual(reversed);
    expect(result.items.map((c) => c.sortOrder)).toEqual(reversed.map((_, i) => i));
    expect((await siblingsOf(h, null)).map((c) => c.id)).toEqual(reversed);
    const publicRoots = (await categories.listStoreCategories(h.client)).items.map((c) => c.id);
    expect(publicRoots).toEqual(reversed.filter((id) => publicRoots.includes(id)));
  });

  it('es idempotente: repetir el mismo orden no cambia updatedAt', async () => {
    const h = admin();
    const rolls = bySlug(await adminList(h), 'rolls');
    const kids = (await siblingsOf(h, rolls.id)).map((c) => c.id);
    const first = await categories.reorderAdminCategories(h.client, {
      parentId: rolls.id,
      orderedIds: [...kids].reverse(),
    });
    const again = await categories.reorderAdminCategories(h.client, {
      parentId: rolls.id,
      orderedIds: [...kids].reverse(),
    });
    expect(again.items.map((c) => c.updatedAt)).toEqual(first.items.map((c) => c.updatedAt));
  });

  it('422 CATEGORY_REORDER_MISMATCH: faltan, sobran, ajenos o duplicados; no escribe', async () => {
    const h = admin();
    const roots = (await siblingsOf(h, null)).map((c) => c.id);
    const rolls = bySlug(await adminList(h), 'rolls');
    const kid = (await siblingsOf(h, rolls.id))[0]!.id;
    const bad = [
      roots.slice(1), // falta uno
      [...roots, 'otra'], // sobra uno
      [...roots.slice(1), kid], // ajeno (de otro padre)
      [roots[0]!, ...roots], // duplicado
      [],
    ];
    for (const orderedIds of bad) {
      const e = await failure(
        categories.reorderAdminCategories(h.client, { parentId: null, orderedIds }),
      );
      expect(e).toMatchObject({ status: 422, businessCode: 'CATEGORY_REORDER_MISMATCH' });
    }
    expect((await siblingsOf(h, null)).map((c) => c.id)).toEqual(roots);
  });

  it('404 con padre inexistente; 400 con forma inválida', async () => {
    const h = admin();
    expect(
      await status(
        categories.reorderAdminCategories(h.client, { parentId: 'nada', orderedIds: [] }),
      ),
    ).toBe(404);
    expect(await status(h.client.put(paths.adminCategoriesReorder(), { orderedIds: [] }))).toBe(
      400,
    );
    expect(
      await status(
        h.client.put(paths.adminCategoriesReorder(), { parentId: null, orderedIds: [1] }),
      ),
    ).toBe(400);
    expect(
      await status(
        h.client.put(paths.adminCategoriesReorder(), { parentId: null, orderedIds: [], x: 1 }),
      ),
    ).toBe(400);
  });

  it('orden estable con empates: sortOrder, luego nombre, luego id', async () => {
    const h = admin();
    for (const c of h.store.menuCategories) if (c.parentId === null) c.sortOrder = 0;
    const roots = (await siblingsOf(h, null)).map((c) => c.name);
    expect(roots).toEqual([...roots].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});
