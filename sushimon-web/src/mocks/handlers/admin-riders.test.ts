import { afterEach, describe, expect, it } from 'vitest';
import type { AdminRider, AdminRiderPage } from '@/lib/data-access/models';
import { validateContract } from '@/test/contract-schema';
import { createHarness, type TestHarness } from '../testing';

/**
 * F27 (spec 028 §13): el mock responde `/v1/admin/riders*` con la forma y las reglas del servidor: permiso por operación y alcance
 * por sucursal, 404 uniforme (anti-IDOR), `expectedVersion`, idempotencia, traslado → no disponible, `BUSY` imposible de fijar y, desde
 * F28, ocupación DERIVADA de las entregas (`busyKnown=true`).
 */

const as = (role: Parameters<TestHarness['asStaff']>[0], grantManagerWrites = false) => {
  const h = createHarness();
  if (grantManagerWrites) {
    h.store.roles
      .find((r) => r.code === 'manager')
      ?.permissions.push('riders.create', 'riders.update');
  }
  h.asStaff(role);
  return h;
};
const list = (h: TestHarness, query: Record<string, string | number | boolean | undefined> = {}) =>
  h.client.get<AdminRiderPage>('/v1/admin/riders', { query });
const get = (h: TestHarness, id: string) => h.client.get<AdminRider>(`/v1/admin/riders/${id}`);
const create = (h: TestHarness, body: unknown) =>
  h.client.post<AdminRider>('/v1/admin/riders', body);
const patch = (h: TestHarness, id: string, body: unknown) =>
  h.client.patch<AdminRider>(`/v1/admin/riders/${id}`, body);
const status = (h: TestHarness, id: string, body: unknown) =>
  h.client.patch<AdminRider>(`/v1/admin/riders/${id}/status`, body);
const availability = (h: TestHarness, id: string, body: unknown) =>
  h.client.patch<AdminRider>(`/v1/admin/riders/${id}/availability`, body);
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as { status: number; businessCode?: string; body?: Record<string, unknown> };
  }
  throw new Error('se esperaba un error');
};
const NEW = { branchId: 'sucursal-1', fullName: 'Nuevo Motorista', phone: '+50255509999' };

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GET /v1/admin/riders', () => {
  it('admin ve todos con la forma del contrato, teléfono enmascarado y sin placa; desde F28 busyKnown=true y la ocupación sale de las entregas', async () => {
    const page = await list(as('admin'));
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 7 });
    for (const item of page.items) {
      expect(validateContract('AdminRiderSummary', item)).toEqual([]);
      expect(item.busyKnown).toBe(true);
      // Solo `rider-4` tiene una entrega abierta sembrada (`assigned`): único ocupado.
      expect(item.busy).toBe(item.id === 'rider-4');
      expect(item).not.toHaveProperty('phone');
      expect(item).not.toHaveProperty('licensePlate');
      expect(item.phoneMasked).toMatch(/^\+502\*{4}\d{4}$/);
    }
    expect(validateContract('AdminRiderPage', page)).toEqual([]);
  });

  it('ordena por nombre sin acentos (Ángel antes que Diego) y desempata por id', async () => {
    const names = (await list(as('admin'))).items.map((r) => r.fullName);
    expect(names.indexOf('Ángel Morales')).toBeLessThan(names.indexOf('Diego Batz'));
    const desc = (await list(as('admin'), { order: 'desc' })).items.map((r) => r.fullName);
    expect(desc).toEqual([...names].reverse());
  });

  it('el encargado solo ve su sucursal; branchId ajeno => página vacía (no se distingue)', async () => {
    const h = as('manager');
    const page = await list(h);
    expect(page.total).toBe(3);
    expect(page.items.every((r) => r.branchId === 'sucursal-1')).toBe(true);
    expect(await list(h, { branchId: 'sucursal-2' })).toMatchObject({ items: [], total: 0 });
  });

  it('filtros: nombre sin acentos, active, availability (BUSY = disponible y ocupado por una entrega) y sucursal', async () => {
    const h = as('admin');
    expect((await list(h, { q: 'angel' })).items.map((r) => r.id)).toEqual(['rider-3']);
    expect((await list(h, { q: '  PÉREZ ' })).items.map((r) => r.id)).toEqual(['rider-1']);
    expect((await list(h, { active: false })).items.map((r) => r.id)).toEqual(['rider-7']);
    expect((await list(h, { active: true })).total).toBe(6);
    expect((await list(h, { availability: 'AVAILABLE' })).items.map((r) => r.id).sort()).toEqual([
      'rider-1',
      'rider-3',
    ]);
    expect((await list(h, { availability: 'UNAVAILABLE' })).total).toBe(4); // incluye al inactivo
    expect((await list(h, { availability: 'BUSY' })).items.map((r) => r.id)).toEqual(['rider-4']);
    expect((await list(h, { branchId: 'sucursal-3' })).total).toBe(2);
    // El teléfono NO es buscable.
    expect((await list(h, { q: '5550100' })).total).toBe(0);
  });

  it('paginación: pageSize y total; página fuera de rango => vacía con total', async () => {
    const h = as('admin');
    const first = await list(h, { pageSize: 3, page: 1 });
    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(7);
    expect((await list(h, { pageSize: 3, page: 3 })).items).toHaveLength(1);
    expect(await list(h, { pageSize: 3, page: 9 })).toMatchObject({ items: [], total: 7 });
  });

  it('parámetros inválidos => 400', async () => {
    const h = as('admin');
    for (const query of [
      { active: 'quizá' },
      { availability: 'ocupado' },
      { sort: 'phone' },
      { order: 'sideways' },
      { page: 0 },
      { pageSize: 101 },
      { q: 'x'.repeat(81) },
    ]) {
      expect((await fails(list(h, query))).status, JSON.stringify(query)).toBe(400);
    }
  });

  it('sin sesión 401; sin riders.read (cocina) 403', async () => {
    expect((await fails(list(as(null)))).status).toBe(401);
    expect((await fails(list(as('kitchen')))).status).toBe(403);
  });

  it('escenario empty: lista vacía', async () => {
    const h = createHarness('empty');
    h.asStaff('admin');
    expect(await list(h)).toMatchObject({ items: [], total: 0 });
  });
});

describe('GET /v1/admin/riders/:id', () => {
  it('detalle con teléfono completo y placa (contrato AdminRider)', async () => {
    const r = await get(as('admin'), 'rider-1');
    expect(r).toMatchObject({
      phone: '+50255501001',
      licensePlate: 'M482HJK',
      branchName: 'Sucursal 1',
    });
    expect(validateContract('AdminRider', r)).toEqual([]);
  });

  it('fuera del alcance o inexistente: el MISMO 404 RIDER_NOT_FOUND', async () => {
    const h = as('manager');
    const outside = await fails(get(h, 'rider-4'));
    const missing = await fails(get(h, 'rider-999'));
    expect(outside).toMatchObject({ status: 404, businessCode: 'RIDER_NOT_FOUND' });
    expect(outside.status).toBe(missing.status);
    expect(outside.businessCode).toBe(missing.businessCode);
    expect(outside.body).toEqual(missing.body);
  });
});

describe('POST /v1/admin/riders', () => {
  it('alta: activo, NO disponible, versión 1; luego aparece en el listado', async () => {
    const h = as('admin');
    const created = await create(h, { ...NEW, vehicleType: 'CAR', licensePlate: 'p-551 bcd' });
    expect(created).toMatchObject({
      active: true,
      availability: 'UNAVAILABLE',
      version: 1,
      operationalState: 'UNAVAILABLE',
      licensePlate: 'P551BCD',
      busyKnown: true,
      busy: false,
    });
    expect(validateContract('AdminRider', created)).toEqual([]);
    expect((await list(h)).total).toBe(8);
  });

  it('teléfono duplicado (aunque sea de un inactivo u otra sucursal) => 409 RIDER_PHONE_TAKEN', async () => {
    const h = as('admin');
    expect(await fails(create(h, { ...NEW, phone: '+50255501007' }))).toMatchObject({
      status: 409,
      businessCode: 'RIDER_PHONE_TAKEN',
    });
  });

  it('valida forma: teléfono, nombre, vehículo, placa, campos desconocidos y sucursal obligatoria => 400', async () => {
    const h = as('admin');
    for (const body of [
      { ...NEW, phone: '55509999' },
      { ...NEW, phone: '+502 5550 9999' },
      { ...NEW, fullName: 'A' },
      { ...NEW, vehicleType: 'SPACESHIP' },
      { ...NEW, licensePlate: 'AB' },
      { ...NEW, active: true },
      { fullName: 'Sin sucursal', phone: '+50255509998' },
    ]) {
      expect((await fails(create(h, body))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('sucursal inexistente o inactiva => 422 BRANCH_NOT_AVAILABLE; sin riders.create 403', async () => {
    expect(await fails(create(as('admin'), { ...NEW, branchId: 'sucursal-4' }))).toMatchObject({
      status: 422,
      businessCode: 'BRANCH_NOT_AVAILABLE',
    });
    expect(await fails(create(as('admin'), { ...NEW, branchId: 'no-existe' }))).toMatchObject({
      status: 422,
    });
    // El encargado (solo riders.read/assign, P93) no puede crear.
    expect((await fails(create(as('manager'), NEW))).status).toBe(403);
  });

  it('con riders.create acotado: otra sucursal => 403 RIDER_ACTION_FORBIDDEN', async () => {
    const h = as('manager', true);
    expect(await fails(create(h, { ...NEW, branchId: 'sucursal-2' }))).toMatchObject({
      status: 403,
      businessCode: 'RIDER_ACTION_FORBIDDEN',
    });
    expect((await create(h, NEW)).branchId).toBe('sucursal-1');
  });
});

describe('PATCH /v1/admin/riders/:id', () => {
  it('edita con expectedVersion, sube la versión y recalcula el enmascarado', async () => {
    const h = as('admin');
    const r = await patch(h, 'rider-1', {
      expectedVersion: 1,
      phone: '+50255507777',
      licensePlate: null,
    });
    expect(r).toMatchObject({
      version: 2,
      phone: '+50255507777',
      phoneMasked: '+502****7777',
      licensePlate: null,
    });
  });

  it('expectedVersion obligatorio, al menos un campo, sin active/availability => 400', async () => {
    const h = as('admin');
    for (const body of [
      { fullName: 'Sin versión' },
      { expectedVersion: 1 },
      { expectedVersion: 1, active: false },
      { expectedVersion: 1, availability: 'AVAILABLE' },
      { expectedVersion: 0, fullName: 'Cero' },
    ]) {
      expect((await fails(patch(h, 'rider-1', body))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('versión vieja => 409 RIDER_VERSION_CONFLICT con current y sin guardar', async () => {
    const h = as('admin');
    await patch(h, 'rider-1', { expectedVersion: 1, fullName: 'Primero' });
    const e = await fails(patch(h, 'rider-1', { expectedVersion: 1, fullName: 'Segundo' }));
    expect(e).toMatchObject({
      status: 409,
      businessCode: 'RIDER_VERSION_CONFLICT',
      body: { current: 2 },
    });
    expect((await get(h, 'rider-1')).fullName).toBe('Primero');
  });

  it('valores idénticos: 200 sin subir la versión', async () => {
    const h = as('admin');
    expect(
      (await patch(h, 'rider-1', { expectedVersion: 1, fullName: 'Juan Carlos Pérez' })).version,
    ).toBe(1);
  });

  it('teléfono de otra persona => 409 RIDER_PHONE_TAKEN', async () => {
    const h = as('admin');
    expect(
      await fails(patch(h, 'rider-1', { expectedVersion: 1, phone: '+50255501002' })),
    ).toMatchObject({ status: 409, businessCode: 'RIDER_PHONE_TAKEN' });
  });

  it('traslado: mismo id a otra sucursal activa y queda NO disponible', async () => {
    const h = as('admin');
    const r = await patch(h, 'rider-1', { expectedVersion: 1, branchId: 'sucursal-2' });
    expect(r).toMatchObject({
      id: 'rider-1',
      branchId: 'sucursal-2',
      branchName: 'Sucursal 2',
      availability: 'UNAVAILABLE',
      version: 2,
    });
    expect((await list(h)).total).toBe(7); // no se duplica
    expect(
      await fails(patch(h, 'rider-1', { expectedVersion: 2, branchId: 'sucursal-4' })),
    ).toMatchObject({ status: 422, businessCode: 'BRANCH_NOT_AVAILABLE' });
  });

  it('traslado exige riders.update en origen Y destino; el que no ve el motorista recibe 404', async () => {
    const h = as('manager', true);
    expect(
      await fails(patch(h, 'rider-1', { expectedVersion: 1, branchId: 'sucursal-2' })),
    ).toMatchObject({ status: 403, businessCode: 'RIDER_ACTION_FORBIDDEN' });
    expect(
      await fails(patch(h, 'rider-4', { expectedVersion: 1, fullName: 'Intruso' })),
    ).toMatchObject({ status: 404, businessCode: 'RIDER_NOT_FOUND' });
  });

  it('el encargado sin riders.update: 403 genérico', async () => {
    expect(
      (await fails(patch(as('manager'), 'rider-1', { expectedVersion: 1, fullName: 'X Y' })))
        .status,
    ).toBe(403);
  });
});

describe('PATCH status y availability', () => {
  it('desactivar fuerza NO disponible; reactivar NO lo marca disponible; ambos idempotentes', async () => {
    const h = as('admin');
    const off = await status(h, 'rider-1', { active: false, reason: 'Renuncia' });
    expect(off).toMatchObject({
      active: false,
      availability: 'UNAVAILABLE',
      operationalState: 'INACTIVE',
      version: 2,
    });
    expect((await status(h, 'rider-1', { active: false })).version).toBe(2); // sin cambio
    const on = await status(h, 'rider-1', { active: true });
    expect(on).toMatchObject({
      active: true,
      availability: 'UNAVAILABLE',
      operationalState: 'UNAVAILABLE',
      version: 3,
    });
  });

  it('valida el cuerpo: active obligatorio, reason ≤ 200, campos desconocidos', async () => {
    const h = as('admin');
    for (const body of [
      {},
      { active: 'sí' },
      { active: false, reason: 'x'.repeat(201) },
      { active: false, extra: 1 },
    ]) {
      expect((await fails(status(h, 'rider-1', body))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('disponibilidad: AVAILABLE/UNAVAILABLE explícitos e idempotentes; BUSY => 400; inactivo AVAILABLE => 409 RIDER_INACTIVE', async () => {
    const h = as('admin');
    expect(await availability(h, 'rider-2', { availability: 'AVAILABLE' })).toMatchObject({
      availability: 'AVAILABLE',
      operationalState: 'AVAILABLE',
      version: 2,
      busyKnown: true,
    });
    expect((await availability(h, 'rider-2', { availability: 'AVAILABLE' })).version).toBe(2);
    expect((await fails(availability(h, 'rider-2', { availability: 'BUSY' }))).status).toBe(400);
    expect((await fails(availability(h, 'rider-2', { availability: 'libre' }))).status).toBe(400);
    expect(await fails(availability(h, 'rider-7', { availability: 'AVAILABLE' }))).toMatchObject({
      status: 409,
      businessCode: 'RIDER_INACTIVE',
    });
  });

  it('sin permiso de escritura: 403; fuera de alcance: 404', async () => {
    expect((await fails(status(as('manager'), 'rider-1', { active: false }))).status).toBe(403);
    expect(
      await fails(availability(as('manager', true), 'rider-4', { availability: 'AVAILABLE' })),
    ).toMatchObject({ status: 404 });
  });
});

describe('fallos de prueba (window.__sushimonMockFaults)', () => {
  const withFault = (route: string, fault: string) => {
    (globalThis as { window?: unknown }).window = { __sushimonMockFaults: { [route]: [fault] } };
  };

  it('busy => 503 RIDERS_BUSY con Retry-After; rate-limited => 429', async () => {
    withFault('GET /v1/admin/riders', 'busy');
    const busy = await fails(list(as('admin')));
    expect(busy).toMatchObject({ status: 503, businessCode: 'RIDERS_BUSY' });
    withFault('GET /v1/admin/riders', 'rate-limited');
    expect(await fails(list(as('admin')))).toMatchObject({
      status: 429,
      businessCode: 'RATE_LIMITED',
    });
  });

  it('has-active-delivery => 409 en desactivar, UNAVAILABLE y traslado (y no cambia nada)', async () => {
    const h = as('admin');
    withFault('PATCH /v1/admin/riders/rider-1/status', 'has-active-delivery');
    expect(await fails(status(h, 'rider-1', { active: false }))).toMatchObject({
      status: 409,
      businessCode: 'RIDER_HAS_ACTIVE_DELIVERY',
    });
    withFault('PATCH /v1/admin/riders/rider-1/availability', 'has-active-delivery');
    expect(await fails(availability(h, 'rider-1', { availability: 'UNAVAILABLE' }))).toMatchObject({
      businessCode: 'RIDER_HAS_ACTIVE_DELIVERY',
    });
    withFault('PATCH /v1/admin/riders/rider-1', 'has-active-delivery');
    expect(
      await fails(patch(h, 'rider-1', { expectedVersion: 1, branchId: 'sucursal-2' })),
    ).toMatchObject({ businessCode: 'RIDER_HAS_ACTIVE_DELIVERY' });
    expect(await get(h, 'rider-1')).toMatchObject({
      active: true,
      availability: 'AVAILABLE',
      branchId: 'sucursal-1',
      version: 1,
    });
  });

  it('version-conflict: otra persona editó justo antes => 409 con la versión nueva', async () => {
    const h = as('admin');
    withFault('PATCH /v1/admin/riders/rider-1', 'version-conflict');
    expect(
      await fails(patch(h, 'rider-1', { expectedVersion: 1, fullName: 'Mi cambio' })),
    ).toMatchObject({ status: 409, businessCode: 'RIDER_VERSION_CONFLICT', body: { current: 2 } });
  });
});
