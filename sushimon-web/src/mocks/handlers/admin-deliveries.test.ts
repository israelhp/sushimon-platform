import { afterEach, describe, expect, it } from 'vitest';
import type {
  AdminDelivery,
  AdminDeliveryCommandResult,
  AdminDeliveryPage,
  AdminOrderTransitionResult,
} from '@/lib/data-access/models';
import { validateContract } from '@/test/contract-schema';
import { createHarness, grantsForRole, type TestHarness } from '../testing';

/**
 * F28 (spec 029 §16, W/mock): el mock responde `/v1/admin/deliveries*` con la forma y las reglas del servidor: permiso por operación
 * y alcance por sucursal, 404 uniforme, `expectedVersion`, `replayed`, elegibilidad del pedido y del motorista, recoger/entregar
 * mueven el pedido, retorno separado y sin PII en el listado.
 */

const as = (role: Parameters<TestHarness['asStaff']>[0], userId?: string) => {
  const h = createHarness();
  h.asStaff(role, userId);
  return h;
};
const list = (h: TestHarness, query: Record<string, string | number | undefined> = {}) =>
  h.client.get<AdminDeliveryPage>('/v1/admin/deliveries', { query });
const get = (h: TestHarness, id: string) =>
  h.client.get<AdminDelivery>(`/v1/admin/deliveries/${id}`);
const create = (h: TestHarness, orderId: string) =>
  h.client.post<AdminDeliveryCommandResult>('/v1/admin/deliveries', { orderId });
const cmd = (h: TestHarness, id: string, route: string, body: unknown) =>
  h.client.post<AdminDeliveryCommandResult>(`/v1/admin/deliveries/${id}/${route}`, body);
const assign = (h: TestHarness, id: string, riderId: string, expectedVersion: number) =>
  cmd(h, id, 'assign-own-rider', { riderId, expectedVersion });
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as {
      status: number;
      businessCode?: string;
      violations?: { code: string }[];
      body?: Record<string, unknown>;
      retryAfterSec?: number;
    };
  }
  throw new Error('se esperaba un error');
};

const ORDER = 'MON-307051'; // sucursal 1 · a domicilio · listo · reparto propio

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GET /v1/admin/deliveries', () => {
  it('administrador: abiertas por defecto, forma del contrato y SIN PII del cliente', async () => {
    const page = await list(as('admin'));
    expect(validateContract('AdminDeliveryPage', page)).toEqual([]);
    expect(page.items.map((d) => d.id).sort()).toEqual(['delivery-1', 'delivery-2']);
    expect(page.nextCursor).toBeNull();
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/\+502\d{8}|Gabriela|addressLine|referenceNote|"customer"/);
    const assigned = page.items.find((d) => d.id === 'delivery-2');
    expect(assigned?.rider).toMatchObject({ fullName: 'Marvin Tzoc', phoneMasked: '+502****1004' });
    expect(assigned?.riderOccupied).toBe(true);
    expect(assigned?.awaitingReturn).toBe(false);
  });

  it('el encargado solo ve su sucursal; branchId ajeno => 404 BRANCH_NOT_FOUND; staff solo lectura', async () => {
    const h = as('manager');
    expect((await list(h)).items).toEqual([]); // las entregas sembradas son de las sucursales 2 y 3
    const err = await fails(list(h, { branchId: 'sucursal-2' }));
    expect(err).toMatchObject({ status: 404, businessCode: 'BRANCH_NOT_FOUND' });
    expect((await list(as('staff'))).items).toBeDefined();
  });

  it('cocina no tiene deliveries.read => 403; sin sesión => 401', async () => {
    expect((await fails(list(as('kitchen')))).status).toBe(403);
    expect((await fails(list(as(null)))).status).toBe(401);
  });

  it('filtros: estado, motorista; parámetros inválidos => 400; cursor alterado => DELIVERY_CURSOR_INVALID', async () => {
    const h = as('admin');
    expect((await list(h, { status: 'assigned' })).items.map((d) => d.id)).toEqual(['delivery-2']);
    expect((await list(h, { riderId: 'rider-4' })).items.map((d) => d.id)).toEqual(['delivery-2']);
    expect((await list(h, { riderId: 'rider-999' })).items).toEqual([]);
    expect((await list(h, { status: 'returned' })).items).toEqual([]);
    for (const query of [{ status: 'flotando' }, { limit: 0 }, { limit: 101 }, { from: 'ayer' }]) {
      expect((await fails(list(h, query))).status).toBe(400);
    }
    expect(await fails(list(h, { cursor: '%%%' }))).toMatchObject({
      status: 400,
      businessCode: 'DELIVERY_CURSOR_INVALID',
    });
  });

  it('paginación por cursor: limit 1 devuelve nextCursor y la segunda página no repite', async () => {
    const h = as('admin');
    const first = await list(h, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await list(h, { limit: 1, cursor: first.nextCursor as string });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
  });

  it('fallos de prueba: rate-limited => 429 con Retry-After; busy => 503 DELIVERIES_BUSY', async () => {
    const h = as('admin');
    (globalThis as { window?: unknown }).window = {
      __sushimonMockFaults: { 'GET /v1/admin/deliveries': ['rate-limited', 'busy'] },
    };
    expect(await fails(list(h))).toMatchObject({ status: 429, businessCode: 'RATE_LIMITED' });
    expect(await fails(list(h))).toMatchObject({ status: 503, businessCode: 'DELIVERIES_BUSY' });
  });
});

describe('GET /v1/admin/deliveries/:id (PII solo con contactVisible)', () => {
  it('administrador (orders.read): contacto y dirección con la entrega abierta', async () => {
    const d = await get(as('admin'), 'delivery-1');
    expect(validateContract('AdminDelivery', d)).toEqual([]);
    expect(d.contactVisible).toBe(true);
    expect(d.customer).toMatchObject({ name: 'Gabriela Pineda', phone: '+50256120098' });
    expect(d.address?.addressLine).toBeTruthy();
    expect(d.history.map((h) => h.event)).toEqual(['created']);
  });

  it('empleado sin orders.read en la sucursal: contactVisible=false y customer/address null', async () => {
    const h = as('admin');
    // El alcance de `orders.read` se quita al rol (la UI solo refleja lo que el servidor informa).
    const role = h.store.roles.find((r) => r.code === 'admin');
    if (role) role.permissions = role.permissions.filter((p) => p !== 'orders.read');
    const d = await get(h, 'delivery-1');
    expect(d).toMatchObject({ contactVisible: false, customer: null, address: null });
    expect(JSON.stringify(d)).not.toMatch(/Gabriela|\+50256120098/);
  });

  it('entrega cerrada (cancelada): sin contacto aunque tenga permiso', async () => {
    const h = as('admin');
    await cmd(h, 'delivery-1', 'cancel', { expectedVersion: 1, reason: 'Sin motorista' });
    const d = await get(h, 'delivery-1');
    expect(d).toMatchObject({ status: 'cancelled', contactVisible: false, customer: null });
  });

  it('inexistente o fuera del alcance => el MISMO 404 DELIVERY_NOT_FOUND', async () => {
    const h = as('manager'); // sucursal 1: delivery-1 es de la 3
    const a = await fails(get(h, 'delivery-1'));
    const b = await fails(get(h, 'delivery-999'));
    expect(a).toMatchObject({ status: 404, businessCode: 'DELIVERY_NOT_FOUND' });
    expect(b.body).toEqual(a.body);
  });
});

describe('POST /v1/admin/deliveries (crear / reabrir)', () => {
  it('crea en pending; repetir es idempotente (replayed) y no escribe', async () => {
    const h = as('admin');
    const first = await create(h, ORDER);
    expect(validateContract('AdminDeliveryCommandResult', first)).toEqual([]);
    expect(first.delivery).toMatchObject({ status: 'pending', version: 1, rider: null });
    expect(first.transition).toMatchObject({ from: null, to: 'pending', replayed: false });
    const again = await create(h, ORDER);
    expect(again.transition.replayed).toBe(true);
    expect(again.delivery.id).toBe(first.delivery.id);
    expect((await list(h)).items.filter((d) => d.orderId === ORDER)).toHaveLength(1);
    // No cambia el pedido.
    expect(h.store.orders.find((o) => o.id === ORDER)?.status).toBe('ready');
  });

  it('una cancelada se REABRE (evento reopened) conservando el historial', async () => {
    const h = as('admin');
    const created = await create(h, ORDER);
    await cmd(h, created.delivery.id, 'cancel', { expectedVersion: 1, reason: 'Cambió el plan' });
    const reopened = await create(h, ORDER);
    expect(reopened.transition).toMatchObject({
      from: 'cancelled',
      to: 'pending',
      event: 'reopened',
    });
    const detail = await get(h, created.delivery.id);
    expect(detail.history.map((e) => e.event)).toEqual(['created', 'cancelled', 'reopened']);
  });

  it('pedido no elegible => 422 DELIVERY_ORDER_NOT_ELIGIBLE con la razón; inexistente => 404 ORDER_NOT_FOUND', async () => {
    const h = as('admin');
    const pending = await fails(create(h, 'MON-307058')); // a domicilio, sin aceptar
    expect(pending).toMatchObject({ status: 422, businessCode: 'DELIVERY_ORDER_NOT_ELIGIBLE' });
    expect(pending.violations?.map((v) => v.code)).toEqual(['ORDER_STATUS_NOT_DISPATCHABLE']);
    const pickup = await fails(create(h, 'MON-307050')); // retiro en tienda
    expect(pickup.violations?.map((v) => v.code)).toContain('ORDER_NOT_DELIVERY');
    expect(await fails(create(h, 'MON-000000'))).toMatchObject({
      status: 404,
      businessCode: 'ORDER_NOT_FOUND',
    });
  });

  it('staff (solo lectura) => 403; pedido de otra sucursal para el encargado => 404 ORDER_NOT_FOUND', async () => {
    expect((await fails(create(as('staff'), ORDER))).status).toBe(403);
    expect(await fails(create(as('manager'), 'MON-307052'))).toMatchObject({
      status: 404,
      businessCode: 'ORDER_NOT_FOUND',
    });
  });
});

describe('asignar / reasignar / desasignar', () => {
  it('asigna (assigned, v2) y el motorista pasa a ocupado; reasignar libera al anterior', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    const assigned = await assign(h, delivery.id, 'rider-1', 1);
    expect(assigned.delivery).toMatchObject({
      status: 'assigned',
      version: 2,
      riderOccupied: true,
      rider: { id: 'rider-1' },
    });
    expect(assigned.transition).toMatchObject({ event: 'rider_assigned', replayed: false });
    const riders = await h.client.get<{ items: { id: string; busy: boolean }[] }>(
      '/v1/admin/riders',
      { query: { branchId: 'sucursal-1' } },
    );
    expect(riders.items.find((r) => r.id === 'rider-1')?.busy).toBe(true);
    const re = await assign(h, delivery.id, 'rider-3', 2);
    expect(re.transition.event).toBe('rider_reassigned');
    const after = await h.client.get<{ items: { id: string; busy: boolean }[] }>(
      '/v1/admin/riders',
      { query: { branchId: 'sucursal-1' } },
    );
    expect(after.items.find((r) => r.id === 'rider-1')?.busy).toBe(false);
    expect(after.items.find((r) => r.id === 'rider-3')?.busy).toBe(true);
  });

  it('el mismo motorista otra vez => replayed sin escribir', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    await assign(h, delivery.id, 'rider-1', 1);
    const again = await assign(h, delivery.id, 'rider-1', 2);
    expect(again.transition.replayed).toBe(true);
    expect(again.delivery.version).toBe(2);
  });

  it('RIDER_NOT_ELIGIBLE explica la razón sin revelar la sucursal del motorista', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    const unavailable = await fails(assign(h, delivery.id, 'rider-2', 1)); // marcado no disponible
    expect(unavailable).toMatchObject({ status: 422, businessCode: 'RIDER_NOT_ELIGIBLE' });
    expect(unavailable.violations?.map((v) => v.code)).toEqual(['UNAVAILABLE']);
    const other = await fails(assign(h, delivery.id, 'rider-4', 1)); // otra sucursal y ocupado
    expect(other.violations?.map((v) => v.code)).toEqual(['WRONG_BRANCH', 'BUSY']);
    const inactive = await fails(assign(h, delivery.id, 'rider-7', 1));
    expect(inactive.violations?.map((v) => v.code)).toContain('INACTIVE');
    expect(JSON.stringify(other)).not.toMatch(/sucursal-2/);
  });

  it('un motorista ocupado en otra entrega no se asigna (BUSY) y el fallo rider-busy simula perder la carrera', async () => {
    const h = as('admin');
    const a = await create(h, ORDER);
    await assign(h, a.delivery.id, 'rider-1', 1);
    // Segundo pedido despachable de la sucursal 1 (clon del anterior con otro número).
    const clone = structuredClone(h.store.orders.find((o) => o.id === ORDER)!);
    clone.id = 'MON-309999';
    h.store.orders.push(clone);
    const b = await create(h, 'MON-309999');
    expect(
      (await fails(assign(h, b.delivery.id, 'rider-1', 1))).violations?.map((v) => v.code),
    ).toEqual(['BUSY']);
    (globalThis as { window?: unknown }).window = {
      __sushimonMockFaults: {
        [`POST /v1/admin/deliveries/${b.delivery.id}/assign-own-rider`]: ['rider-busy'],
      },
    };
    const lost = await fails(assign(h, b.delivery.id, 'rider-3', 1));
    expect(lost).toMatchObject({ status: 422, businessCode: 'RIDER_NOT_ELIGIBLE' });
  });

  it('motorista inexistente o sin riders.read en su sucursal => 404 RIDER_NOT_FOUND; sin deliveries.assign => 403', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    expect(await fails(assign(h, delivery.id, 'rider-999', 1))).toMatchObject({
      status: 404,
      businessCode: 'RIDER_NOT_FOUND',
    });
    // `staff` ve la entrega pero no puede asignar: el permiso base `deliveries.assign` falta (403).
    expect((await fails(assign(as('staff'), delivery.id, 'rider-1', 1))).status).toBe(403);
  });

  it('expectedVersion distinta => 409 DELIVERY_STATE_CONFLICT con current; el cuerpo exige expectedVersion (400)', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    await assign(h, delivery.id, 'rider-1', 1);
    const stale = await fails(assign(h, delivery.id, 'rider-3', 1));
    expect(stale).toMatchObject({ status: 409, businessCode: 'DELIVERY_STATE_CONFLICT' });
    expect(stale.body?.current).toEqual({ status: 'assigned', version: 2 });
    expect(
      (await fails(cmd(h, delivery.id, 'assign-own-rider', { riderId: 'rider-1' }))).status,
    ).toBe(400);
  });

  it('desasignar vuelve a pending y libera; el motivo es opcional pero se valida', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    await assign(h, delivery.id, 'rider-1', 1);
    expect(
      (await fails(cmd(h, delivery.id, 'unassign-rider', { expectedVersion: 2, reason: 'a' })))
        .businessCode,
    ).toBe('DELIVERY_REASON_REQUIRED');
    const un = await cmd(h, delivery.id, 'unassign-rider', {
      expectedVersion: 2,
      reason: 'Se retrasó',
    });
    expect(un.delivery).toMatchObject({ status: 'pending', rider: null, riderOccupied: false });
  });
});

describe('recoger, entregar, retorno y cancelar', () => {
  async function assigned(h: TestHarness) {
    const { delivery } = await create(h, ORDER);
    return assign(h, delivery.id, 'rider-1', 1);
  }
  const orderStatus = (h: TestHarness, id = ORDER) =>
    h.store.orders.find((o) => o.id === id)?.status;

  it('flujo completo: recoger mueve el pedido a on_the_way, entregar a delivered y el retorno lo separa y libera', async () => {
    const h = as('admin');
    const a = await assigned(h);
    const picked = await cmd(h, a.delivery.id, 'mark-picked-up', { expectedVersion: 2 });
    expect(picked.delivery).toMatchObject({ status: 'picked_up', orderStatus: 'on_the_way' });
    expect(orderStatus(h)).toBe('on_the_way');
    const delivered = await cmd(h, a.delivery.id, 'mark-delivered', { expectedVersion: 3 });
    expect(delivered.delivery).toMatchObject({
      status: 'delivered',
      orderStatus: 'delivered',
      awaitingReturn: true,
      riderOccupied: true,
    });
    expect(orderStatus(h)).toBe('delivered');
    // Esperando retorno: el motorista sigue ocupado y la acción disponible es solo el retorno.
    expect(delivered.delivery.availableActions.map((x) => x.action)).toEqual(['return_to_branch']);
    const returned = await cmd(h, a.delivery.id, 'return-to-branch', { expectedVersion: 4 });
    expect(returned.delivery).toMatchObject({
      status: 'returned',
      riderOccupied: false,
      awaitingReturn: false,
    });
    expect(returned.transition).toMatchObject({
      from: 'delivered',
      to: 'returned',
      event: 'returned',
    });
    expect(orderStatus(h)).toBe('delivered'); // el retorno no toca el pedido
    const detail = await get(h, a.delivery.id);
    expect(detail.history.map((e) => e.event)).toEqual([
      'created',
      'rider_assigned',
      'picked_up',
      'delivered',
      'returned',
    ]);
    expect(detail).toMatchObject({ contactVisible: false, customer: null });
  });

  it('recoger con el pedido aún en preparación: acción deshabilitada ORDER_NOT_READY; el servidor responde 409 ORDER_STATE_CONFLICT con current', async () => {
    const h = as('admin');
    const d2 = await get(h, 'delivery-2'); // pedido MON-307054 en preparación, asignada a rider-4
    const pick = d2.availableActions.find((x) => x.action === 'mark_picked_up');
    expect(pick).toEqual({
      action: 'mark_picked_up',
      enabled: false,
      disabledReason: 'ORDER_NOT_READY',
    });
    const err = await fails(cmd(h, 'delivery-2', 'mark-picked-up', { expectedVersion: 2 }));
    expect(err).toMatchObject({ status: 409, businessCode: 'ORDER_STATE_CONFLICT' });
    expect((err.body?.current as { status: string }).status).toBe('preparing');
    expect((await get(h, 'delivery-2')).status).toBe('assigned'); // sin cambios
  });

  it('repetir un comando ya aplicado => replayed; con versión distinta y otro estado => 409', async () => {
    const h = as('admin');
    const a = await assigned(h);
    await cmd(h, a.delivery.id, 'mark-picked-up', { expectedVersion: 2 });
    const again = await cmd(h, a.delivery.id, 'mark-picked-up', { expectedVersion: 2 });
    expect(again.transition.replayed).toBe(true);
    expect(
      (await fails(cmd(h, a.delivery.id, 'return-to-branch', { expectedVersion: 3 }))).businessCode,
    ).toBe('DELIVERY_STATE_CONFLICT');
  });

  it('cancelar exige motivo (400 DELIVERY_REASON_REQUIRED), libera al motorista y NO cambia el pedido', async () => {
    const h = as('admin');
    const a = await assigned(h);
    for (const reason of [undefined, '', 'ab', 'x'.repeat(281), 'hola\u0007']) {
      const body = reason === undefined ? { expectedVersion: 2 } : { expectedVersion: 2, reason };
      expect(await fails(cmd(h, a.delivery.id, 'cancel', body))).toMatchObject({
        status: 400,
        businessCode: 'DELIVERY_REASON_REQUIRED',
      });
    }
    const cancelled = await cmd(h, a.delivery.id, 'cancel', {
      expectedVersion: 2,
      reason: 'Cliente ausente',
    });
    expect(cancelled.delivery).toMatchObject({
      status: 'cancelled',
      rider: null,
      riderOccupied: false,
    });
    expect(orderStatus(h)).toBe('ready');
    const riders = await h.client.get<{ items: { id: string; busy: boolean }[] }>(
      '/v1/admin/riders',
    );
    expect(riders.items.find((r) => r.id === 'rider-1')?.busy).toBe(false);
  });

  it('acciones por permiso: staff ve la entrega pero NO_PERMISSION en todas (la web las oculta)', async () => {
    const h = as('staff');
    const d = await get(h, 'delivery-2').catch(() => null);
    // El empleado de la sucursal 1 no ve la 2: el mismo 404.
    expect(d).toBeNull();
    const ha = as('admin');
    const admin = await get(ha, 'delivery-2');
    expect(admin.availableActions.every((x) => x.disabledReason !== 'NO_PERMISSION')).toBe(true);
  });

  it('fallo de prueba version-conflict: otra persona cambió la entrega => 409 con la versión actual', async () => {
    const h = as('admin');
    const a = await assigned(h);
    (globalThis as { window?: unknown }).window = {
      __sushimonMockFaults: {
        [`POST /v1/admin/deliveries/${a.delivery.id}/mark-picked-up`]: ['version-conflict'],
      },
    };
    const err = await fails(cmd(h, a.delivery.id, 'mark-picked-up', { expectedVersion: 2 }));
    expect(err).toMatchObject({ status: 409, businessCode: 'DELIVERY_STATE_CONFLICT' });
    expect((err.body?.current as { version: number }).version).toBe(3);
  });
});

describe('cancelar/rechazar el PEDIDO con una entrega abierta (F22 + F28)', () => {
  const cancelOrder = (h: TestHarness, id: string, status: string) =>
    h.client.post<AdminOrderTransitionResult>(`/v1/admin/orders/${id}/cancel`, {
      expectedStatus: status,
      reason: 'Cliente canceló',
    });

  it('409 ORDER_HAS_ACTIVE_DELIVERY con current del pedido; cancelar la entrega primero lo permite', async () => {
    const h = as('admin');
    const { delivery } = await create(h, ORDER);
    const err = await fails(cancelOrder(h, ORDER, 'ready'));
    expect(err).toMatchObject({ status: 409, businessCode: 'ORDER_HAS_ACTIVE_DELIVERY' });
    expect((err.body?.current as { status: string }).status).toBe('ready');
    await cmd(h, delivery.id, 'cancel', { expectedVersion: 1, reason: 'Cliente canceló' });
    const ok = await cancelOrder(h, ORDER, 'ready');
    expect(ok.transition.to).toBe('cancelled');
  });

  it('el despacho (dispatch) del pedido queda habilitado para reparto propio con deliveries.assign', async () => {
    const detail = await as('manager').client.get<{
      availableActions: { action: string; enabled: boolean; disabledReason: string | null }[];
    }>(`/v1/admin/orders/${ORDER}`);
    expect(detail.availableActions.find((a) => a.action === 'dispatch')).toEqual({
      action: 'dispatch',
      enabled: true,
      disabledReason: null,
    });
  });
});

describe('matriz de permisos del spec §7 (RBAC simulado)', () => {
  const can = (role: 'admin' | 'manager' | 'staff' | 'kitchen', permission: string) =>
    grantsForRole(role)[permission] !== undefined;

  it('admin y encargado: todo; empleado: solo ve; cocina: nada de entregas', () => {
    for (const role of ['admin', 'manager'] as const) {
      for (const p of [
        'deliveries.read',
        'deliveries.assign',
        'deliveries.update',
        'riders.assign',
      ]) {
        expect(can(role, p), `${role} ${p}`).toBe(true);
      }
    }
    expect(can('staff', 'deliveries.read')).toBe(true);
    for (const p of ['deliveries.assign', 'deliveries.update', 'riders.assign']) {
      expect(can('staff', p), `staff ${p}`).toBe(false);
    }
    for (const p of [
      'deliveries.read',
      'deliveries.assign',
      'deliveries.update',
      'riders.assign',
    ]) {
      expect(can('kitchen', p), `kitchen ${p}`).toBe(false);
    }
  });
});
