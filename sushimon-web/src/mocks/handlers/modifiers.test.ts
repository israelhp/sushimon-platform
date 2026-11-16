import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as modifiers from '@/services/modifiers';
import * as products from '@/services/products';
import { createHarness } from '../testing';

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.businessCode };
    throw e;
  }
  throw new Error('se esperaba un error');
}

const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};

describe('F12 mock · semillas y ficha pública', () => {
  it('siembra Extras (queso crema Q5.00, aguacate Q4.00, salsa Q3.00) y Salsa obligatoria', async () => {
    const h = admin();
    const page = await modifiers.listAdminModifierGroups(h.client);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(page.items.map((g) => g.name)).toEqual(['Bebida del combo', 'Extras', 'Salsa']);
    const extras = await modifiers.getAdminModifierGroup(h.client, 'mgroup-extras');
    expect(extras.options.slice(0, 3).map((o) => [o.name, o.extraPrice])).toEqual([
      ['Queso crema', '5.00'],
      ['Aguacate', '4.00'],
      ['Salsa extra', '3.00'],
    ]);
    expect(extras).toMatchObject({
      required: false,
      minSelect: 0,
      maxSelect: 3,
      optionCount: 4,
      activeOptionCount: 3,
    });
    expect(page.items.find((g) => g.name === 'Salsa')).toMatchObject({
      required: true,
      productCount: 2,
    });
  });

  it('la ficha pública trae solo grupos ofrecibles con opciones activas, en orden de asociación', async () => {
    const h = createHarness();
    const detail = await products.getStoreProduct(h.client, 'california-roll');
    expect(detail.modifierGroups).toHaveLength(1);
    const extras = detail.modifierGroups[0]!;
    expect(extras).toMatchObject({ id: 'mgroup-extras', name: 'Extras', required: false });
    expect(extras.options.map((o) => o.name)).toEqual(['Queso crema', 'Aguacate', 'Salsa extra']);
    const pizza = await products.getStoreProduct(h.client, 'sushi-pizza');
    expect(pizza.modifierGroups.map((g) => g.name)).toEqual(['Salsa', 'Extras']);
    expect(pizza.modifierGroups[0]).toMatchObject({ required: true, minSelect: 1, maxSelect: 1 });
    expect((await products.getStoreProduct(h.client, 'dumplings')).modifierGroups).toEqual([]);
    // La lista pública NO incluye modifierGroups.
    const list = await products.listStoreProducts(h.client);
    expect(JSON.stringify(list)).not.toContain('modifierGroups');
  });

  it('un grupo desactivado o insatisfacible desaparece de la ficha sin ocultar el producto', async () => {
    const h = admin();
    await modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', { active: false });
    const detail = await products.getStoreProduct(h.client, 'california-roll');
    expect(detail.modifierGroups).toEqual([]);
    expect(detail.slug).toBe('california-roll');
    // Dato manual insatisfacible: grupo activo sin opciones activas se omite.
    h.store.modifiers
      .filter((m) => m.groupId === 'mgroup-salsa')
      .forEach((m) => (m.active = false));
    expect((await products.getStoreProduct(h.client, 'poporopos-cangrejo')).modifierGroups).toEqual(
      [],
    );
  });

  it('un grupo con opción desactivada deja de ofrecerla', async () => {
    const h = admin();
    await modifiers.updateAdminModifier(h.client, 'mopt-aguacate', { active: false });
    const detail = await products.getStoreProduct(h.client, 'california-roll');
    expect(detail.modifierGroups[0]!.options.map((o) => o.name)).toEqual([
      'Queso crema',
      'Salsa extra',
    ]);
  });
});

describe('F12 mock · autorización', () => {
  it('401 sin sesión, 403 sin permiso, lectura con cualquier alcance y escritura solo global', async () => {
    const h = createHarness();
    expect(await failure(modifiers.listAdminModifierGroups(h.client))).toMatchObject({
      status: 401,
    });
    h.asStaff('kitchen');
    expect(await failure(modifiers.listAdminModifierGroups(h.client))).toMatchObject({
      status: 403,
    });
    h.asStaff('manager'); // catalog.read por sucursal: lee, no escribe
    expect((await modifiers.listAdminModifierGroups(h.client)).total).toBe(3);
    expect(
      (await modifiers.getAdminProductModifiers(h.client, 'california-roll')).groups,
    ).toHaveLength(1);
    expect(
      await failure(modifiers.createAdminModifierGroup(h.client, { name: 'Nuevo' })),
    ).toMatchObject({ status: 403 });
    expect(
      await failure(modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', { name: 'X' })),
    ).toMatchObject({ status: 403 });
    expect(
      await failure(modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', [])),
    ).toMatchObject({ status: 403 });
  });

  it('escritura sin alcance global => 403 aunque tenga el permiso', async () => {
    const h = createHarness();
    const role = h.store.roles.find((r) => r.code === 'manager')!;
    role.permissions.push('catalog.create', 'catalog.update');
    h.asStaff('manager');
    expect(
      await failure(modifiers.createAdminModifierGroup(h.client, { name: 'Nuevo' })),
    ).toMatchObject({ status: 403 });
    expect(
      await failure(modifiers.updateAdminModifier(h.client, 'mopt-aguacate', { name: 'Palta' })),
    ).toMatchObject({ status: 403 });
  });
});

describe('F12 mock · lista de grupos', () => {
  it('filtros q (sin acentos/mayúsculas) y active, orden name,id y paginación; 400 en parámetros inválidos', async () => {
    const h = admin();
    expect(
      (await modifiers.listAdminModifierGroups(h.client, { q: 'EXTRA' })).items.map((g) => g.name),
    ).toEqual(['Extras']);
    expect(
      (await modifiers.listAdminModifierGroups(h.client, { active: false })).items.map(
        (g) => g.name,
      ),
    ).toEqual(['Bebida del combo']);
    const second = await modifiers.listAdminModifierGroups(h.client, { page: 2, pageSize: 2 });
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(second.items.map((g) => g.name)).toEqual(['Salsa']);
    expect(
      await failure(modifiers.listAdminModifierGroups(h.client, { pageSize: 101 })),
    ).toMatchObject({ status: 400 });
    expect(await failure(modifiers.listAdminModifierGroups(h.client, { page: 0 }))).toMatchObject({
      status: 400,
    });
    expect(
      await failure(modifiers.listAdminModifierGroups(h.client, { q: 'x'.repeat(81) })),
    ).toMatchObject({ status: 400 });
  });
});

describe('F12 mock · crear y editar grupos', () => {
  it('crea un grupo obligatorio con opciones iniciales (orden = sortOrder) y valores por defecto', async () => {
    const h = admin();
    const g = await modifiers.createAdminModifierGroup(h.client, {
      name: '  Término  de   cocción ',
      minSelect: 1,
      maxSelect: 1,
      options: [{ name: 'Medio', extraPrice: '0.00' }, { name: 'Bien cocido' }],
    });
    expect(g).toMatchObject({
      name: 'Término de cocción',
      required: true,
      active: true,
      optionCount: 2,
      activeOptionCount: 2,
      productCount: 0,
    });
    expect(g.options.map((o) => [o.name, o.extraPrice, o.sortOrder])).toEqual([
      ['Medio', '0.00', 0],
      ['Bien cocido', '0.00', 1],
    ]);
    const bare = await modifiers.createAdminModifierGroup(h.client, { name: 'Vacío' });
    expect(bare).toMatchObject({ minSelect: 0, maxSelect: 1, active: true, options: [] });
  });

  it('409 por nombre repetido sin distinguir mayúsculas (grupo y opciones del alta)', async () => {
    const h = admin();
    expect(await failure(modifiers.createAdminModifierGroup(h.client, { name: 'EXTRAS' }))).toEqual(
      { status: 409, code: 'MODIFIER_GROUP_NAME_TAKEN' },
    );
    expect(
      await failure(
        modifiers.createAdminModifierGroup(h.client, {
          name: 'Con repetidas',
          options: [{ name: 'Uno' }, { name: 'uno' }],
        }),
      ),
    ).toEqual({ status: 409, code: 'MODIFIER_NAME_TAKEN' });
    expect(
      await failure(
        modifiers.updateAdminModifierGroup(h.client, 'mgroup-salsa', { name: 'extras' }),
      ),
    ).toEqual({ status: 409, code: 'MODIFIER_GROUP_NAME_TAKEN' });
    // Renombrar a su propio nombre con otra capitalización es válido.
    expect(
      (await modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', { name: 'EXTRAS' }))
        .name,
    ).toBe('EXTRAS');
  });

  it('422 MODIFIER_LIMITS_INVALID: min>max, max<1, max>20, min<0 y grupo activo inalcanzable', async () => {
    const h = admin();
    for (const limits of [
      { minSelect: 3, maxSelect: 2 },
      { maxSelect: 0 },
      { maxSelect: 21 },
      { minSelect: -1 },
    ]) {
      expect(
        await failure(modifiers.createAdminModifierGroup(h.client, { name: 'L', ...limits })),
      ).toEqual({ status: 422, code: 'MODIFIER_LIMITS_INVALID' });
    }
    // Activo con min 2 y 1 opción => inalcanzable; inactivo se permite.
    expect(
      await failure(
        modifiers.createAdminModifierGroup(h.client, {
          name: 'L',
          minSelect: 2,
          maxSelect: 2,
          options: [{ name: 'A' }],
        }),
      ),
    ).toEqual({ status: 422, code: 'MODIFIER_LIMITS_INVALID' });
    const draft = await modifiers.createAdminModifierGroup(h.client, {
      name: 'L',
      minSelect: 2,
      maxSelect: 2,
      active: false,
    });
    expect(draft.active).toBe(false);
    // Reactivar sin opciones suficientes => LIMITS_INVALID; subir min por encima de las activas también.
    expect(
      await failure(modifiers.updateAdminModifierGroup(h.client, draft.id, { active: true })),
    ).toEqual({ status: 422, code: 'MODIFIER_LIMITS_INVALID' });
    expect(
      await failure(
        modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', {
          minSelect: 4,
          maxSelect: 4,
        }),
      ),
    ).toEqual({ status: 422, code: 'MODIFIER_LIMITS_INVALID' });
    expect(
      (await modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', { minSelect: 3 }))
        .required,
    ).toBe(true);
  });

  it('422 MODIFIER_LIMIT_REACHED con más de 30 opciones; 400 con más de 100 o forma inválida', async () => {
    const h = admin();
    const options = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Op ${i}` }));
    expect(
      await failure(
        modifiers.createAdminModifierGroup(h.client, { name: 'Muchas', options: options(31) }),
      ),
    ).toEqual({ status: 422, code: 'MODIFIER_LIMIT_REACHED' });
    expect(
      (
        await modifiers.createAdminModifierGroup(h.client, {
          name: 'Treinta',
          options: options(30),
        })
      ).optionCount,
    ).toBe(30);
    expect(
      await failure(
        modifiers.createAdminModifierGroup(h.client, { name: 'Muchas', options: options(101) }),
      ),
    ).toMatchObject({ status: 400 });
    const bad = [
      { name: '' },
      { name: 'a'.repeat(81) },
      { name: 'ok', minSelect: 1.5 },
      { name: 'ok', maxSelect: '2' as unknown as number },
      { name: 'ok', extra: 1 } as never,
      { name: 'ok', options: [{ name: 'a', extraPrice: '5' }] },
      { name: 'ok', options: [{ name: 'a', extraPrice: '10000.00' }] },
    ];
    for (const body of bad) {
      expect(await failure(modifiers.createAdminModifierGroup(h.client, body))).toMatchObject({
        status: 400,
      });
    }
    expect(await failure(modifiers.createAdminModifierGroup(h.client, {} as never))).toMatchObject({
      status: 400,
    });
  });

  it('PATCH: cuerpo vacío o campo desconocido => 400; 404; sin cambios => 200 sin escribir; desactivar siempre posible', async () => {
    const h = admin();
    expect(
      await failure(modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', {})),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(
        modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', { foo: 1 } as never),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(modifiers.updateAdminModifierGroup(h.client, 'nope', { name: 'X' })),
    ).toEqual({ status: 404, code: 'MODIFIER_GROUP_NOT_FOUND' });
    const before = h.store.modifierGroups.find((g) => g.id === 'mgroup-extras')!.updatedAt;
    await modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', {
      name: 'Extras',
      maxSelect: 3,
    });
    expect(h.store.modifierGroups.find((g) => g.id === 'mgroup-extras')!.updatedAt).toBe(before);
    // Desactivar un grupo obligatorio con opciones insuficientes es posible.
    h.store.modifiers
      .filter((m) => m.groupId === 'mgroup-salsa')
      .forEach((m) => (m.active = false));
    expect(
      (await modifiers.updateAdminModifierGroup(h.client, 'mgroup-salsa', { active: false }))
        .active,
    ).toBe(false);
    expect(await failure(modifiers.getAdminModifierGroup(h.client, 'nope'))).toEqual({
      status: 404,
      code: 'MODIFIER_GROUP_NOT_FOUND',
    });
  });
});

describe('F12 mock · opciones', () => {
  it('crea al final con precio decimal en cadena; 409 por nombre (case-insensitive) y 422 al pasar de 30', async () => {
    const h = admin();
    const o = await modifiers.createAdminModifier(h.client, 'mgroup-salsa', {
      name: 'Teriyaki',
      extraPrice: '1.50',
    });
    expect(o).toMatchObject({
      extraPrice: '1.50',
      sortOrder: 3,
      active: true,
      groupId: 'mgroup-salsa',
    });
    expect(
      await failure(modifiers.createAdminModifier(h.client, 'mgroup-salsa', { name: 'PONZU' })),
    ).toEqual({ status: 409, code: 'MODIFIER_NAME_TAKEN' });
    expect(await failure(modifiers.createAdminModifier(h.client, 'nope', { name: 'A' }))).toEqual({
      status: 404,
      code: 'MODIFIER_GROUP_NOT_FOUND',
    });
    for (const bad of ['5', '5.0', '10000.00', '-1.00', 'x']) {
      expect(
        await failure(
          modifiers.createAdminModifier(h.client, 'mgroup-salsa', {
            name: `P${bad}`,
            extraPrice: bad,
          }),
        ),
      ).toMatchObject({ status: 400 });
    }
    for (
      let i = 0;
      h.store.modifiers.filter((m) => m.groupId === 'mgroup-salsa').length < 30;
      i++
    ) {
      await modifiers.createAdminModifier(h.client, 'mgroup-salsa', { name: `Relleno ${i}` });
    }
    expect(
      await failure(modifiers.createAdminModifier(h.client, 'mgroup-salsa', { name: 'Una más' })),
    ).toEqual({ status: 422, code: 'MODIFIER_LIMIT_REACHED' });
  });

  it('PATCH de opción: nombre, precio, activar; 404, 409 y MODIFIER_GROUP_UNSATISFIABLE', async () => {
    const h = admin();
    const updated = await modifiers.updateAdminModifier(h.client, 'mopt-queso-crema', {
      name: 'Queso',
      extraPrice: '6.00',
    });
    expect(updated).toMatchObject({ name: 'Queso', extraPrice: '6.00' });
    expect(await failure(modifiers.updateAdminModifier(h.client, 'nope', { name: 'X' }))).toEqual({
      status: 404,
      code: 'MODIFIER_NOT_FOUND',
    });
    expect(
      await failure(
        modifiers.updateAdminModifier(h.client, 'mopt-queso-crema', { name: 'aguacate' }),
      ),
    ).toEqual({ status: 409, code: 'MODIFIER_NAME_TAKEN' });
    expect(
      await failure(modifiers.updateAdminModifier(h.client, 'mopt-queso-crema', {})),
    ).toMatchObject({ status: 400 });
    // Salsa (min 1, 3 opciones activas): desactivar dos está bien, la tercera rompe el mínimo.
    await modifiers.updateAdminModifier(h.client, 'mopt-anguila', { active: false });
    await modifiers.updateAdminModifier(h.client, 'mopt-mayo-spicy', { active: false });
    expect(
      await failure(modifiers.updateAdminModifier(h.client, 'mopt-ponzu', { active: false })),
    ).toEqual({ status: 422, code: 'MODIFIER_GROUP_UNSATISFIABLE' });
    expect(
      (await modifiers.getAdminModifierGroup(h.client, 'mgroup-salsa')).activeOptionCount,
    ).toBe(1);
    // Un grupo inactivo no tiene esa restricción.
    expect(
      (await modifiers.updateAdminModifier(h.client, 'mopt-te-frio', { active: false })).active,
    ).toBe(false);
  });

  it('reordenar: exacto, idempotente, 422 con faltantes/duplicados/ajenos y 400 con más de 30', async () => {
    const h = admin();
    const ids = (await modifiers.getAdminModifierGroup(h.client, 'mgroup-extras')).options.map(
      (o) => o.id,
    );
    const reversed = [...ids].reverse();
    const out = await modifiers.reorderAdminModifiers(h.client, 'mgroup-extras', {
      orderedIds: reversed,
    });
    expect(out.items.map((o) => o.id)).toEqual(reversed);
    expect(out.items.map((o) => o.sortOrder)).toEqual([0, 1, 2, 3]);
    const stamp = h.store.modifiers.find((m) => m.id === reversed[0])!.updatedAt;
    await modifiers.reorderAdminModifiers(h.client, 'mgroup-extras', { orderedIds: reversed });
    expect(h.store.modifiers.find((m) => m.id === reversed[0])!.updatedAt).toBe(stamp);
    for (const orderedIds of [ids.slice(1), [...ids, ids[0]!], [...ids.slice(1), 'mopt-ponzu']]) {
      expect(
        await failure(modifiers.reorderAdminModifiers(h.client, 'mgroup-extras', { orderedIds })),
      ).toEqual({ status: 422, code: 'MODIFIER_REORDER_MISMATCH' });
    }
    expect(
      await failure(
        modifiers.reorderAdminModifiers(h.client, 'mgroup-extras', {
          orderedIds: Array.from({ length: 31 }, (_, i) => `x${i}`),
        }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(modifiers.reorderAdminModifiers(h.client, 'nope', { orderedIds: [] })),
    ).toEqual({ status: 404, code: 'MODIFIER_GROUP_NOT_FOUND' });
  });
});

describe('F12 mock · asociación producto–grupo', () => {
  it('GET devuelve los grupos asociados (activos e inactivos) con opciones; 404 si el producto no existe', async () => {
    const h = admin();
    const r = await modifiers.getAdminProductModifiers(h.client, 'sushi-pizza');
    expect(r.productId).toBe('sushi-pizza');
    expect(r.groups.map((g) => g.name)).toEqual(['Salsa', 'Extras']);
    expect(r.groups[1]!.options).toHaveLength(4);
    expect(await failure(modifiers.getAdminProductModifiers(h.client, 'nope'))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('PUT reemplaza (orden, vaciar, sin cambios) e invalida la ficha pública', async () => {
    const h = admin();
    const r = await modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', [
      'mgroup-extras',
      'mgroup-salsa',
    ]);
    expect(r.groups.map((g) => g.id)).toEqual(['mgroup-extras', 'mgroup-salsa']);
    expect(
      (await products.getStoreProduct(h.client, 'dumplings')).modifierGroups.map((g) => g.name),
    ).toEqual(['Extras', 'Salsa']);
    const reordered = await modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', [
      'mgroup-salsa',
      'mgroup-extras',
    ]);
    expect(reordered.groups.map((g) => g.id)).toEqual(['mgroup-salsa', 'mgroup-extras']);
    expect(
      (await modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', [])).groups,
    ).toEqual([]);
    expect(h.store.productModifierGroups.dumplings).toBeUndefined();
    const same = await modifiers.replaceAdminProductModifierGroups(h.client, 'california-roll', [
      'mgroup-extras',
    ]);
    expect(same.groups).toHaveLength(1);
  });

  it('422 MODIFIER_GROUP_INVALID: duplicados, inexistentes e inactivos NUEVOS; un asociado desactivado puede permanecer', async () => {
    const h = admin();
    for (const ids of [['mgroup-extras', 'mgroup-extras'], ['nope'], ['mgroup-bebida']]) {
      expect(
        await failure(modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', ids)),
      ).toEqual({ status: 422, code: 'MODIFIER_GROUP_INVALID' });
    }
    await modifiers.updateAdminModifierGroup(h.client, 'mgroup-extras', { active: false });
    const r = await modifiers.replaceAdminProductModifierGroups(h.client, 'california-roll', [
      'mgroup-extras',
      'mgroup-salsa',
    ]);
    expect(r.groups.map((g) => [g.id, g.active])).toEqual([
      ['mgroup-extras', false],
      ['mgroup-salsa', true],
    ]);
  });

  it('422 MODIFIER_LIMIT_REACHED con más de 10; 400 con más de 50, forma inválida o producto inexistente', async () => {
    const h = admin();
    for (let i = 0; i < 11; i++) {
      await modifiers.createAdminModifierGroup(h.client, { name: `G${i}` });
    }
    const ids = h.store.modifierGroups.filter((g) => g.name.startsWith('G')).map((g) => g.id);
    expect(ids).toHaveLength(11);
    expect(
      await failure(modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', ids)),
    ).toEqual({ status: 422, code: 'MODIFIER_LIMIT_REACHED' });
    expect(
      (await modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', ids.slice(0, 10)))
        .groups,
    ).toHaveLength(10);
    expect(
      await failure(
        modifiers.replaceAdminProductModifierGroups(
          h.client,
          'dumplings',
          Array.from({ length: 51 }, (_, i) => `x${i}`),
        ),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(
        modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', 'x' as never),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(modifiers.replaceAdminProductModifierGroups(h.client, 'nope', [])),
    ).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
  });
});

describe('F12 mock · MODIFIERS_BUSY', () => {
  it('503 determinista: no escribe y la siguiente funciona; sin cambios no cuenta', async () => {
    const h = admin();
    h.store.modifiersBusy = 2;
    const before = h.store.modifierGroups.length;
    expect(await failure(modifiers.createAdminModifierGroup(h.client, { name: 'Busy' }))).toEqual({
      status: 503,
      code: 'MODIFIERS_BUSY',
    });
    expect(h.store.modifierGroups).toHaveLength(before);
    // Sin cambios: no consume el contador.
    await modifiers.updateAdminModifier(h.client, 'mopt-aguacate', { name: 'Aguacate' });
    expect(h.store.modifiersBusy).toBe(1);
    expect(
      await failure(
        modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', ['mgroup-extras']),
      ),
    ).toEqual({ status: 503, code: 'MODIFIERS_BUSY' });
    expect(h.store.productModifierGroups.dumplings).toBeUndefined();
    expect(
      (await modifiers.replaceAdminProductModifierGroups(h.client, 'dumplings', ['mgroup-extras']))
        .groups,
    ).toHaveLength(1);
  });
});

describe('F12 mock · escenarios', () => {
  it('empty: sin grupos ni asociaciones; forbidden: 403 en administración', async () => {
    const empty = createHarness('empty');
    empty.asStaff('admin');
    expect((await modifiers.listAdminModifierGroups(empty.client)).total).toBe(0);
    const forbidden = createHarness('forbidden');
    forbidden.asStaff('admin');
    expect(await failure(modifiers.listAdminModifierGroups(forbidden.client))).toMatchObject({
      status: 403,
    });
  });
});
