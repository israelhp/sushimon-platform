import { Logger } from '@nestjs/common';
import { coverageResult, MUNI_GUATEMALA, ownZone } from '../../test/support/checkout-harness.js';
import {
  KEY_A,
  KEY_B,
  ordersHarness,
  principal,
  type OrdersHarness,
} from '../../test/support/orders-harness.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import { ordersBusy } from './orders-errors.js';

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const body = (e: unknown) =>
  ((e as { getResponse?: () => unknown }).getResponse?.() ?? {}) as Record<string, unknown>;
const statusOf = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();

describe('OrdersService.getTracking (F21)', () => {
  let h: OrdersHarness;
  beforeAll(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  beforeEach(() => {
    h = ordersHarness();
    h.identity.defaultPhone = '55559999';
  });

  const guestOrder = async (over: Record<string, unknown> = {}, key = KEY_A) => {
    const res = await h.orders.create(undefined, key, await h.orderBody(over));
    return {
      id: res.body.order.id,
      token: res.body.access?.guestToken as string,
    };
  };
  const ownerOrder = async () => {
    const p = principal();
    const res = await h.orders.create(p, KEY_B, await h.orderBody({}, p));
    return { p, id: res.body.order.id };
  };
  const at = (m: number) => new Date(h.clock.current.getTime() + m * 60_000);
  const reads = () => h.ordersRepo.calls.filter((c) => c.startsWith('findTracking'));

  it('invitado con token: 200 con forma real; 1 consulta de tracking; sin escrituras', async () => {
    const { id, token } = await guestOrder();
    const writes = ['createOrder', 'issueGuestToken', 'purgeExpired'];
    h.ordersRepo.calls.length = 0;
    const before = { tokens: h.ordersRepo.tokens.length, audits: h.ordersRepo.audits.length };
    const t = await h.orders.getTracking(undefined, id, token);
    expect(t).toMatchObject({
      orderId: id,
      status: 'pending',
      publicStatus: 'received',
      terminal: false,
      fulfillmentType: 'DELIVERY',
      delivery: { provider: 'OWN', status: null },
      pollAfterSeconds: 15,
      eventsTruncated: false,
    });
    expect(t.events).toHaveLength(1);
    expect(reads()).toEqual(['findTrackingForGuestToken']);
    expect(h.ordersRepo.calls.some((c) => writes.includes(c))).toBe(false);
    expect(h.ordersRepo.tokens).toHaveLength(before.tokens);
    expect(h.ordersRepo.audits).toHaveLength(before.audits);
  });

  it('dueño por JWT: 200; ajeno => 404; el cliente con JWT no ve el pedido de invitado', async () => {
    const mine = await ownerOrder();
    const guest = await guestOrder({}, 'c1b2c3d4-e5f6-4789-8abc-def012345678');
    expect((await h.orders.getTracking(mine.p, mine.id, undefined)).orderId).toBe(mine.id);
    const stranger = principal('otro-usuario');
    await h.identity.ensureCustomer(stranger);
    expect(statusOf(await err(h.orders.getTracking(stranger, mine.id, undefined)))).toBe(404);
    expect(statusOf(await err(h.orders.getTracking(mine.p, guest.id, undefined)))).toBe(404);
  });

  it('404 uniforme: sin credenciales, token inválido/de otro pedido/vencido/revocado e inexistente => mismo cuerpo que `get`', async () => {
    const a = await guestOrder();
    const b = await guestOrder({}, 'd1b2c3d4-e5f6-4789-8abc-def012345678');
    const reference = body(await err(h.orders.get(undefined, a.id, `smo_${'B'.repeat(43)}`)));
    const cases = [
      h.orders.getTracking(undefined, a.id, undefined),
      h.orders.getTracking(undefined, a.id, `smo_${'B'.repeat(43)}`),
      h.orders.getTracking(undefined, a.id, b.token),
      h.orders.getTracking(undefined, '00000000-0000-4000-8000-000000000999', a.token),
    ];
    for (const c of cases) {
      const e = await err(c);
      expect(statusOf(e)).toBe(404);
      expect(body(e)).toEqual(reference);
    }
    h.clock.current = new Date(h.clock.current.getTime() + 15 * 86_400_000);
    expect(statusOf(await err(h.orders.getTracking(undefined, a.id, a.token)))).toBe(404);
    h.clock.current = new Date(h.clock.current.getTime() - 15 * 86_400_000);
    h.ordersRepo.tokens.forEach((t) => (t.revokedAt = new Date()));
    expect(statusOf(await err(h.orders.getTracking(undefined, a.id, a.token)))).toBe(404);
  });

  it('formato de token inválido => 400 sin tocar el repositorio ni el gate', async () => {
    const { id } = await guestOrder();
    h.ordersRepo.calls.length = 0;
    const e = await err(h.orders.getTracking(undefined, id, 'smo_corto'));
    expect(statusOf(e)).toBe(400);
    expect(h.ordersRepo.calls).toEqual([]);
    expect(h.gate.inFlight).toBe(0);
  });

  it('UNA sola adquisición del gate por consulta (invitado y dueño), sin anidar', async () => {
    const gate = new DbGate(1, 0, 10, ordersBusy);
    const spy = vi.spyOn(gate, 'run');
    h = ordersHarness({ gate });
    h.identity.defaultPhone = '55559999';
    const { id, token } = await guestOrder();
    spy.mockClear();
    await h.orders.getTracking(undefined, id, token);
    expect(spy).toHaveBeenCalledTimes(1);
    const mine = await ownerOrder();
    spy.mockClear();
    await h.orders.getTracking(mine.p, mine.id, undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    // Con token inválido y sesión, también una (token => dueño dentro del mismo cupo).
    spy.mockClear();
    await h.orders.getTracking(mine.p, mine.id, `smo_${'C'.repeat(43)}`);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('presupuesto: invitado 1 lectura de tracking; dueño 1 (join; sin findCustomer); token fallido + JWT => 2 en el repo', async () => {
    const { id, token } = await guestOrder();
    h.ordersRepo.calls.length = 0;
    await h.orders.getTracking(undefined, id, token);
    expect(h.ordersRepo.calls).toHaveLength(1);
    const mine = await ownerOrder();
    h.ordersRepo.calls.length = 0;
    await h.orders.getTracking(mine.p, mine.id, undefined);
    expect(h.ordersRepo.calls).toEqual(['findTrackingForOwnerAuthUser']);
  });

  it('dueño: autoriza por join (no llama a identity.findCustomer); token fallido + JWT => 2 lecturas; el pedido de invitado con JWT => 404', async () => {
    const mine = await ownerOrder();
    const guest = await guestOrder({}, 'e1b2c3d4-e5f6-4789-8abc-def012345678');
    const find = vi.spyOn(h.identity, 'findCustomer');
    h.ordersRepo.calls.length = 0;
    await h.orders.getTracking(mine.p, mine.id, `smo_${'F'.repeat(43)}`);
    expect(h.ordersRepo.calls).toEqual([
      'findTrackingForGuestToken',
      'findTrackingForOwnerAuthUser',
    ]);
    expect(find).not.toHaveBeenCalled();
    expect(statusOf(await err(h.orders.getTracking(mine.p, guest.id, undefined)))).toBe(404);
  });

  it('admisión de lecturas: cupo ocupado y 2 esperas => el tracking se rechaza AL INSTANTE (503) mientras una escritura sigue entrando en cola', async () => {
    const gate = new DbGate(1, 8, 1_000, ordersBusy);
    h = ordersHarness({ gate });
    h.identity.defaultPhone = '55559999';
    const { id, token } = await guestOrder();
    let release: () => void = () => undefined;
    const held = gate.run(() => new Promise<void>((r) => (release = r)));
    const queued = [gate.run(() => Promise.resolve(1)), gate.run(() => Promise.resolve(2))];
    expect(gate.waiting).toBe(2);
    const e = await err(h.orders.getTracking(undefined, id, token));
    expect(body(e)['code']).toBe('ORDERS_BUSY');
    expect(statusOf(e)).toBe(503);
    expect(gate.waiting).toBe(2); // el rechazo no ocupó plaza
    const write = gate.run(() => Promise.resolve('escritura')); // como createOrder: sin umbral de admisión
    expect(gate.waiting).toBe(3);
    release();
    await Promise.all([held, ...queued, write]);
  });

  it('admisión de lecturas: con una sola espera en cola el tracking SÍ se encola y responde', async () => {
    const gate = new DbGate(1, 8, 1_000, ordersBusy);
    h = ordersHarness({ gate });
    h.identity.defaultPhone = '55559999';
    const { id, token } = await guestOrder();
    let release: () => void = () => undefined;
    const held = gate.run(() => new Promise<void>((r) => (release = r)));
    const pending = h.orders.getTracking(undefined, id, token);
    expect(gate.waiting).toBe(1);
    release();
    expect((await pending).orderId).toBe(id);
    await held;
  });

  it('gate saturado => 503 ORDERS_BUSY y libera el cupo', async () => {
    const gate = new DbGate(1, 0, 10, ordersBusy);
    h = ordersHarness({ gate });
    h.identity.defaultPhone = '55559999';
    const { id, token } = await guestOrder();
    let release: () => void = () => undefined;
    const held = gate.run(() => new Promise<void>((r) => (release = r)));
    const e = await err(h.orders.getTracking(undefined, id, token));
    expect(statusOf(e)).toBe(503);
    expect(body(e)['code']).toBe('ORDERS_BUSY');
    release();
    await held;
    await new Promise((r) => setTimeout(r, 0));
    expect((await h.orders.getTracking(undefined, id, token)).orderId).toBe(id);
  });

  it('error retryable de la BD => 503 ORDERS_BUSY; el error de BD no se disfraza de 404', async () => {
    const { id, token } = await guestOrder();
    h.ordersRepo.trackingFailWith = { code: 'P2024' };
    const e = await err(h.orders.getTracking(undefined, id, token));
    expect(body(e)['code']).toBe('ORDERS_BUSY');
  });

  it('delivery OWN y PICKUP con el proveedor real del pedido; nunca consulta `deliveries`', async () => {
    h.cover.result = coverageResult({ own: ownZone('15.00') });
    const res = await h.orders.create(
      undefined,
      KEY_A,
      await h.orderBody({
        fulfillment: {
          type: 'DELIVERY',
          municipalityId: MUNI_GUATEMALA,
          zone: 'Zona 10',
          deliveryProvider: 'OWN',
        },
        deliveryAddress: { addressLine: '6a avenida 12-34' },
      }),
    );
    const t = await h.orders.getTracking(undefined, res.body.order.id, res.body.access?.guestToken);
    expect(t.delivery).toEqual({ provider: 'OWN', status: null });
    expect(t.steps.map((s) => s.phase)).toContain('on_the_way');
    expect(JSON.stringify(t)).not.toMatch(/6a avenida|5555|Ana|170|15\.00/);
  });

  it('PICKUP histórico (ADR-0036): el seguimiento sigue respondiendo con el recorrido de recogida, sin entrega', async () => {
    const { id, token } = await guestOrder();
    const stored = h.ordersRepo.orders.get(id);
    if (!stored) throw new Error('sin pedido');
    stored.record.fulfillmentType = 'PICKUP';
    stored.record.deliveryProvider = null;
    const t = await h.orders.getTracking(undefined, id, token);
    expect(t).toMatchObject({ fulfillmentType: 'PICKUP', delivery: null });
    expect(t.steps.map((s) => s.phase)).not.toContain('on_the_way');
  });

  it('PEDIDOSYA en el registro => {provider:PEDIDOSYA,status:null} sin simulación', async () => {
    const { id, token } = await guestOrder();
    const stored = h.ordersRepo.orders.get(id);
    if (!stored) throw new Error('sin pedido');
    stored.record.fulfillmentType = 'DELIVERY';
    stored.record.deliveryProvider = 'PEDIDOSYA';
    const t = await h.orders.getTracking(undefined, id, token);
    expect(t.delivery).toEqual({ provider: 'PEDIDOSYA', status: null });
  });

  it('historial controlado: salto, estado manda sobre el último evento, y rejected corta el recorrido', async () => {
    const { id, token } = await guestOrder();
    h.ordersRepo.setTracking(id, 'preparing', [
      { newStatus: 'pending', changedAt: at(0) },
      { newStatus: 'preparing', changedAt: at(6) },
    ]);
    let t = await h.orders.getTracking(undefined, id, token);
    expect(t.steps.find((s) => s.phase === 'accepted')?.reachedAt).toBeNull();
    expect(t.pollAfterSeconds).toBe(30);
    h.ordersRepo.setTracking(id, 'rejected', [
      { newStatus: 'pending', changedAt: at(0) },
      { newStatus: 'rejected', changedAt: at(2) },
    ]);
    t = await h.orders.getTracking(undefined, id, token);
    expect(t.steps.map((s) => s.phase)).toEqual(['received', 'rejected']);
    expect(t.terminal).toBe(true);
    expect(t.pollAfterSeconds).toBeNull();
  });

  it('solo lectura: no cambia el estado del pedido ni llama a servicios externos', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { id, token } = await guestOrder();
    const before = JSON.stringify(h.ordersRepo.orders.get(id)?.record, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    await h.orders.getTracking(undefined, id, token);
    expect(
      JSON.stringify(h.ordersRepo.orders.get(id)?.record, (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
