import type { HttpException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { DbGate } from '../common/concurrency/db-gate.js';
import { deliveriesHarness } from '../../test/support/deliveries-harness.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from '../../test/support/staff-context.js';
import { deliveriesBusy } from './delivery-errors.js';

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const info = (e: unknown) => {
  const x = e as HttpException;
  const body = x.getResponse() as {
    code?: string;
    extra?: { current?: { status: string; version?: number } };
    violations?: { path: string; code: string }[];
  };
  return {
    status: x.getStatus(),
    code: body.code,
    current: body.extra?.current,
    violations: body.violations?.map((v) => v.code),
    raw: JSON.stringify(body),
  };
};

const ALL = ROLE_PERMISSIONS['admin'] as string[];
const admin = () => globalStaff(ALL);
const manager = (b: string) =>
  scopedStaff(ROLE_PERMISSIONS['manager'] as string[], [b], {
    staffId: '66666666-6666-4666-8666-666666666666',
  });
const reader = (b: string) =>
  scopedStaff(ROLE_PERMISSIONS['staff'] as string[], [b], {
    staffId: '77777777-7777-4777-8777-777777777777',
  });

describe('DeliveriesCommandsService (S)', () => {
  let h: ReturnType<typeof deliveriesHarness>;
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    h = deliveriesHarness();
  });
  afterEach(() => vi.restoreAllMocks());

  const rider = (over: Record<string, unknown> = {}) =>
    h.riders.seed({ branchId: h.branchA, availability: 'AVAILABLE', ...over });
  const order = (over: Record<string, unknown> = {}) =>
    h.repo.seedOrder({ branchId: h.branchA, ...over });
  /** Crea una entrega por el servicio real y devuelve su id y versión. */
  const created = async (over: Record<string, unknown> = {}) => {
    const o = order(over);
    const res = await h.commands.create(admin(), o.id);
    return { order: o, id: res.delivery.id, version: res.delivery.version };
  };
  const assigned = async (r = rider(), over: Record<string, unknown> = {}) => {
    const c = await created(over);
    const res = await h.commands.assign(admin(), c.id, {
      riderId: r.id,
      expectedVersion: c.version,
    });
    return { ...c, rider: r, version: res.delivery.version };
  };

  describe('R03 R04 R05 crear y reabrir', () => {
    it('crea pending v1 con historial `created` y auditoría delivery.created SIN PII; no toca el pedido', async () => {
      const staff = admin();
      const o = order({ status: 'accepted' });
      const res = await h.commands.create(staff, o.id);
      expect(res.delivery).toMatchObject({
        orderId: o.id,
        status: 'pending',
        version: 1,
        rider: null,
        riderOccupied: false,
        awaitingReturn: false,
        orderStatus: 'accepted',
      });
      expect(res.transition).toMatchObject({
        from: null,
        to: 'pending',
        event: 'created',
        replayed: false,
        appliedByMe: true,
      });
      expect(h.repo.eventsOf(res.delivery.id).map((e) => e.event)).toEqual(['created']);
      expect(h.repo.orders.get(o.id)?.status).toBe('accepted');
      expect(h.repo.orderHistory).toHaveLength(0);
      expect(h.repo.audits).toHaveLength(1);
      expect(h.repo.audits[0]).toMatchObject({
        action: 'delivery.created',
        entityType: 'delivery',
        entityId: res.delivery.id,
        branchId: h.branchA,
        actorId: staff.staffId,
        newValues: { status: 'pending', riderId: null, orderId: o.id },
      });
      const dump = JSON.stringify(h.repo.audits);
      for (const pii of [
        'CLIENTE-SECRETO',
        '+5025555',
        'DIRECCION-SECRETA',
        'REFERENCIA-SECRETA',
      ]) {
        expect(dump).not.toContain(pii);
      }
    });

    it.each(['accepted', 'preparing', 'ready'])('pedido en %s es elegible', async (status) => {
      const o = order({ status });
      expect((await h.commands.create(admin(), o.id)).delivery.status).toBe('pending');
    });

    it('crear dos veces: repetición idempotente sin segunda fila, historial ni auditoría', async () => {
      const o = order();
      const first = await h.commands.create(admin(), o.id);
      const again = await h.commands.create(admin(), o.id);
      expect(again.transition).toMatchObject({ replayed: true, appliedByMe: true });
      expect(again.delivery.id).toBe(first.delivery.id);
      expect(h.repo.deliveries.size).toBe(1);
      expect(h.repo.history).toHaveLength(1);
      expect(h.repo.audits).toHaveLength(1);
    });

    it('repetición por OTRA persona: replayed=true y appliedByMe=false', async () => {
      const o = order();
      await h.commands.create(admin(), o.id);
      const other = globalStaff(ALL, { staffId: '88888888-8888-4888-8888-888888888888' });
      const again = await h.commands.create(other, o.id);
      expect(again.transition).toMatchObject({ replayed: true, appliedByMe: false });
    });

    it('sobre `cancelled` REABRE a pending (historial `reopened`, conserva el ciclo anterior); sobre `returned` => 409', async () => {
      const c = await created();
      await h.commands.execute(admin(), 'cancel', c.id, {
        expectedVersion: c.version,
        reason: 'cliente cambió',
      });
      const reopened = await h.commands.create(admin(), c.order.id);
      expect(reopened.transition).toMatchObject({
        from: 'cancelled',
        to: 'pending',
        event: 'reopened',
        replayed: false,
      });
      expect(reopened.delivery).toMatchObject({ status: 'pending', version: 3, cancelledAt: null });
      expect(h.repo.eventsOf(c.id).map((e) => e.event)).toEqual([
        'created',
        'cancelled',
        'reopened',
      ]);
      expect(h.repo.audits.at(-1)?.action).toBe('delivery.reopened');

      const done = order({ status: 'delivered' });
      h.repo.seedDelivery({ orderId: done.id, status: 'returned', riderId: rider().id });
      const e = info(await err(h.commands.create(admin(), done.id)));
      expect([e.status, e.code, e.current?.status]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        'returned',
      ]);
    });

    it('reabrir exige el pedido todavía despachable (422)', async () => {
      const c = await created();
      await h.commands.execute(admin(), 'cancel', c.id, {
        expectedVersion: c.version,
        reason: 'motivo uno',
      });
      h.repo.orders.get(c.order.id)!.status = 'cancelled';
      const e = info(await err(h.commands.create(admin(), c.order.id)));
      expect([e.status, e.code, e.violations]).toEqual([
        422,
        'DELIVERY_ORDER_NOT_ELIGIBLE',
        ['ORDER_STATUS_NOT_DISPATCHABLE'],
      ]);
    });

    it.each([
      ['PICKUP', { fulfillmentType: 'PICKUP' }, ['ORDER_NOT_DELIVERY']],
      ['PEDIDOSYA', { deliveryProvider: 'PEDIDOSYA' }, ['ORDER_PROVIDER_NOT_OWN']],
      ['pending', { status: 'pending' }, ['ORDER_STATUS_NOT_DISPATCHABLE']],
      ['on_the_way', { status: 'on_the_way' }, ['ORDER_STATUS_NOT_DISPATCHABLE']],
      ['cancelled', { status: 'cancelled' }, ['ORDER_STATUS_NOT_DISPATCHABLE']],
      [
        'PICKUP terminal',
        { fulfillmentType: 'PICKUP', status: 'picked_up' },
        ['ORDER_STATUS_NOT_DISPATCHABLE', 'ORDER_NOT_DELIVERY'],
      ],
    ])('pedido %s => 422 DELIVERY_ORDER_NOT_ELIGIBLE sin crear fila', async (_n, over, codes) => {
      const o = order(over);
      const e = info(await err(h.commands.create(admin(), o.id)));
      expect([e.status, e.code, e.violations]).toEqual([422, 'DELIVERY_ORDER_NOT_ELIGIBLE', codes]);
      expect(h.repo.deliveries.size).toBe(0);
      expect(h.repo.history).toHaveLength(0);
      expect(h.repo.audits).toHaveLength(0);
    });

    it('pedido inexistente o de otra sucursal => el MISMO 404 ORDER_NOT_FOUND; sin deliveries.assign => 403', async () => {
      const mine = order();
      const theirs = order({ branchId: h.branchB });
      const a = info(await err(h.commands.create(manager(h.branchA), theirs.id)));
      const b = info(
        await err(h.commands.create(manager(h.branchA), 'c0000000-0000-4000-8000-0000000000aa')),
      );
      expect([a.status, a.code]).toEqual([404, 'ORDER_NOT_FOUND']);
      expect(a.raw).toBe(b.raw);
      const f = info(await err(h.commands.create(reader(h.branchA), mine.id)));
      expect([f.status, f.code]).toEqual([403, 'DELIVERY_ACTION_FORBIDDEN']);
      expect(h.repo.deliveries.size).toBe(0);
    });

    it('carrera: la entrega la creó otra transacción entre la lectura y el INSERT => 200 replayed', async () => {
      const o = order();
      // al leer el pedido todavía no hay entrega; al INSERT ya existe (UNIQUE(order_id) => 0 filas) => idempotente
      h.repo.afterRead = () => {
        h.repo.afterRead = null;
        h.repo.seedDelivery({ orderId: o.id });
      };
      const res = await h.commands.create(admin(), o.id);
      expect(res.transition.replayed).toBe(true);
      expect(h.repo.deliveries.size).toBe(1);
    });
  });

  describe('R06 R07 R10 R11 asignar y reasignar', () => {
    it('asigna: pending → assigned, rider, historial rider_assigned, auditoría; ocupación visible por el puerto de F27', async () => {
      const staff = admin();
      const r = rider();
      const c = await created();
      const res = await h.commands.assign(staff, c.id, {
        riderId: r.id,
        expectedVersion: c.version,
      });
      expect(res.delivery).toMatchObject({
        status: 'assigned',
        version: 2,
        riderOccupied: true,
        rider: { id: r.id, fullName: r.fullName, vehicleType: 'MOTORCYCLE' },
      });
      expect(res.delivery.rider?.phoneMasked).toMatch(/^\+502\*{4}\d{4}$/);
      expect(res.transition).toMatchObject({
        from: 'pending',
        to: 'assigned',
        event: 'rider_assigned',
      });
      expect(h.repo.eventsOf(c.id).at(-1)).toMatchObject({
        event: 'rider_assigned',
        riderId: r.id,
        changedBy: staff.staffId,
      });
      expect(h.repo.audits.at(-1)).toMatchObject({
        action: 'delivery.rider_assigned',
        newValues: { status: 'assigned', riderId: r.id, orderId: c.order.id },
      });
      const busy = await h.port.findBusy({ riderIds: [r.id] });
      expect([busy.known, busy.busyIds.has(r.id)]).toEqual([true, true]);
      expect(h.repo.orders.get(c.order.id)?.status).toBe('ready'); // el pedido no cambia
      // el motorista nunca se serializa con su sucursal, placa ni teléfono completo
      const dump = JSON.stringify(res);
      expect(dump).not.toContain(r.phone);
      expect(dump).not.toContain(h.branchA.length ? `"riderBranchId"` : '');
    });

    it.each([
      ['INACTIVE', { active: false }, ['INACTIVE']],
      ['UNAVAILABLE', { availability: 'UNAVAILABLE' }, ['UNAVAILABLE']],
    ])('R07 motorista %s => 422 RIDER_NOT_ELIGIBLE', async (_n, over, codes) => {
      const r = rider(over);
      const c = await created();
      const e = info(
        await err(h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version })),
      );
      expect([e.status, e.code, e.violations]).toEqual([422, 'RIDER_NOT_ELIGIBLE', codes]);
      expect(h.repo.deliveryOf(c.order.id)?.status).toBe('pending');
    });

    it('R07 sucursal distinta => WRONG_BRANCH (admin global) sin revelar la sucursal del motorista', async () => {
      const r = rider({ branchId: h.branchB });
      const c = await created();
      const e = info(
        await err(h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version })),
      );
      expect([e.status, e.code, e.violations]).toEqual([
        422,
        'RIDER_NOT_ELIGIBLE',
        ['WRONG_BRANCH'],
      ]);
      expect(e.raw).not.toContain(h.branchB);
      expect(e.raw).not.toContain(h.branchA);
    });

    it('R07 reparto propio deshabilitado en la sucursal => OWN_DELIVERY_DISABLED', async () => {
      h.riders.ownDelivery.set(h.branchA, false);
      const r = rider();
      const c = await created();
      const e = info(
        await err(h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version })),
      );
      expect(e.violations).toEqual(['OWN_DELIVERY_DISABLED']);
    });

    it('R07/R08 motorista ocupado => BUSY; dos entregas y un motorista EN PARALELO: una gana y otra 422 BUSY', async () => {
      const r = rider();
      const c1 = await created();
      const c2 = await created();
      const [x, y] = await Promise.all([
        err(h.commands.assign(admin(), c1.id, { riderId: r.id, expectedVersion: c1.version })),
        err(h.commands.assign(admin(), c2.id, { riderId: r.id, expectedVersion: c2.version })),
      ]);
      const failures = [x, y].filter((e) => e !== null).map(info);
      expect(failures).toHaveLength(1);
      expect([failures[0]?.status, failures[0]?.code, failures[0]?.violations]).toEqual([
        422,
        'RIDER_NOT_ELIGIBLE',
        ['BUSY'],
      ]);
      expect([...h.repo.deliveries.values()].filter((d) => d.riderId === r.id)).toHaveLength(1);
    });

    it('R08 el índice único parcial respalda la carrera: 23505 al escribir => 422 RIDER_NOT_ELIGIBLE/BUSY', async () => {
      const r = rider();
      const c = await created();
      h.repo.changeFailWith = {
        code: '23505',
        message: 'duplicate key deliveries_one_active_per_rider_idx',
      };
      const e = info(
        await err(h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version })),
      );
      expect([e.status, e.code, e.violations]).toEqual([422, 'RIDER_NOT_ELIGIBLE', ['BUSY']]);
      expect(e.raw).not.toContain('duplicate key');
      expect(h.repo.deliveryOf(c.order.id)?.status).toBe('pending');
    });

    it('falla CERRADO: con el puerto «sin entregas» (known=false) NO asigna y responde 503 DELIVERIES_BUSY', async () => {
      h.port.known = false;
      const r = rider();
      const c = await created();
      const e = info(
        await err(h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version })),
      );
      expect([e.status, e.code]).toEqual([503, 'DELIVERIES_BUSY']);
      expect(h.repo.deliveryOf(c.order.id)?.status).toBe('pending');
    });

    it('motorista inexistente o NO visible para el actor => el MISMO 404 RIDER_NOT_FOUND', async () => {
      const far = rider({ branchId: h.branchB });
      const c = await created();
      const m = scopedStaff(
        ['deliveries.read', 'deliveries.assign', 'riders.assign', 'riders.read'],
        [h.branchA],
      );
      const a = info(
        await err(h.commands.assign(m, c.id, { riderId: far.id, expectedVersion: c.version })),
      );
      const b = info(
        await err(
          h.commands.assign(m, c.id, {
            riderId: 'c0000000-0000-4000-8000-0000000000bb',
            expectedVersion: c.version,
          }),
        ),
      );
      expect([a.status, a.code]).toEqual([404, 'RIDER_NOT_FOUND']);
      expect(a.raw).toBe(b.raw);
    });

    it('R10 reasignar antes de la recogida: nuevo motorista ocupado, anterior libre, historial rider_reassigned', async () => {
      const a = await assigned();
      const second = rider({ fullName: 'Segundo' });
      const res = await h.commands.assign(admin(), a.id, {
        riderId: second.id,
        expectedVersion: a.version,
      });
      expect(res.transition).toMatchObject({
        from: 'assigned',
        to: 'assigned',
        event: 'rider_reassigned',
      });
      expect(res.delivery.rider?.id).toBe(second.id);
      const busy = (await h.port.findBusy({ riderIds: [a.rider.id, second.id] })).busyIds;
      expect([busy.has(a.rider.id), busy.has(second.id)]).toEqual([false, true]);
      expect(h.repo.eventsOf(a.id).at(-1)).toMatchObject({
        event: 'rider_reassigned',
        riderId: second.id,
      });
      expect(h.repo.audits.at(-1)).toMatchObject({
        action: 'delivery.rider_reassigned',
        oldValues: { riderId: a.rider.id },
        newValues: { riderId: second.id },
      });
    });

    it('R10 reasignar con picked_up => 409 DELIVERY_STATE_CONFLICT con current', async () => {
      const a = await assigned();
      const p = await h.commands.execute(admin(), 'mark_picked_up', a.id, {
        expectedVersion: a.version,
      });
      const other = rider({ fullName: 'Otro' });
      const e = info(
        await err(
          h.commands.assign(admin(), a.id, {
            riderId: other.id,
            expectedVersion: p.delivery.version,
          }),
        ),
      );
      expect([e.status, e.code, e.current]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        { status: 'picked_up', version: p.delivery.version },
      ]);
    });

    it('R11 asignar al MISMO motorista => 200 replayed sin escribir; repetir tras éxito con la misma versión => replayed', async () => {
      const a = await assigned();
      const eventsBefore = h.repo.history.length;
      const auditsBefore = h.repo.audits.length;
      const same = await h.commands.assign(admin(), a.id, {
        riderId: a.rider.id,
        expectedVersion: a.version,
      });
      expect(same.transition).toMatchObject({ replayed: true, event: 'rider_assigned' });
      const stale = await h.commands.assign(admin(), a.id, {
        riderId: a.rider.id,
        expectedVersion: a.version - 1,
      });
      expect(stale.transition.replayed).toBe(true);
      expect(h.repo.history).toHaveLength(eventsBefore);
      expect(h.repo.audits).toHaveLength(auditsBefore);
    });

    it('versión vieja con OTRO motorista => 409 con current; estado terminal => 409', async () => {
      const a = await assigned();
      const other = rider({ fullName: 'Otro' });
      const e = info(
        await err(h.commands.assign(admin(), a.id, { riderId: other.id, expectedVersion: 1 })),
      );
      expect([e.status, e.code, e.current?.version]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        a.version,
      ]);
      const c = await created();
      await h.commands.execute(admin(), 'cancel', c.id, {
        expectedVersion: c.version,
        reason: 'motivo uno',
      });
      const t = info(
        await err(
          h.commands.assign(admin(), c.id, { riderId: other.id, expectedVersion: c.version + 1 }),
        ),
      );
      expect([t.status, t.code, t.current?.status]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        'cancelled',
      ]);
    });

    it('el pedido salió de `accepted|preparing|ready` => 422 DELIVERY_ORDER_NOT_ELIGIBLE', async () => {
      const r = rider();
      const c = await created();
      h.repo.orders.get(c.order.id)!.status = 'cancelled';
      const e = info(
        await err(h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version })),
      );
      expect([e.status, e.code, e.violations]).toEqual([
        422,
        'DELIVERY_ORDER_NOT_ELIGIBLE',
        ['ORDER_STATUS_NOT_DISPATCHABLE'],
      ]);
    });

    it('asignar exige riders.assign Y deliveries.assign en la sucursal; entrega ajena => 404 uniforme', async () => {
      const r = rider();
      const c = await created();
      const noRiderAssign = scopedStaff(
        ['deliveries.read', 'deliveries.assign', 'riders.read'],
        [h.branchA],
      );
      const f = info(
        await err(
          h.commands.assign(noRiderAssign, c.id, { riderId: r.id, expectedVersion: c.version }),
        ),
      );
      expect([f.status, f.code]).toEqual([403, 'DELIVERY_ACTION_FORBIDDEN']);
      const elsewhere = manager(h.branchB);
      const n = info(
        await err(
          h.commands.assign(elsewhere, c.id, { riderId: r.id, expectedVersion: c.version }),
        ),
      );
      const m = info(
        await err(
          h.commands.assign(elsewhere, 'c0000000-0000-4000-8000-0000000000cc', {
            riderId: r.id,
            expectedVersion: 1,
          }),
        ),
      );
      expect([n.status, n.code]).toEqual([404, 'DELIVERY_NOT_FOUND']);
      expect(n.raw).toBe(m.raw);
    });
  });

  describe('R12 desasignar', () => {
    it('assigned → pending, motorista libre, historial rider_unassigned con el motivo (opcional)', async () => {
      const a = await assigned();
      const res = await h.commands.execute(admin(), 'unassign', a.id, {
        expectedVersion: a.version,
        reason: '  se enfermó  ',
      });
      expect(res.delivery).toMatchObject({ status: 'pending', rider: null, riderOccupied: false });
      expect(h.repo.eventsOf(a.id).at(-1)).toMatchObject({
        event: 'rider_unassigned',
        riderId: a.rider.id,
        reason: 'se enfermó',
      });
      expect(h.repo.audits.at(-1)).toMatchObject({
        action: 'delivery.rider_unassigned',
        reason: 'se enfermó',
        oldValues: { riderId: a.rider.id },
      });
      expect((await h.port.findBusy({ riderIds: [a.rider.id] })).busyIds.size).toBe(0);
      const without = await assigned();
      expect(
        (
          await h.commands.execute(admin(), 'unassign', without.id, {
            expectedVersion: without.version,
          })
        ).delivery.status,
      ).toBe('pending');
    });

    it.each([['ab'], ['  '], ['x'.repeat(281)], ['hola\u0000mundo'], ['hola‮mundo'], ['']])(
      'motivo inválido %j => 400 DELIVERY_REASON_REQUIRED sin escribir',
      async (reason) => {
        const a = await assigned();
        const e = info(
          await err(
            h.commands.execute(admin(), 'unassign', a.id, { expectedVersion: a.version, reason }),
          ),
        );
        expect([e.status, e.code]).toEqual([400, 'DELIVERY_REASON_REQUIRED']);
        expect(h.repo.deliveryOf(a.order.id)?.status).toBe('assigned');
      },
    );
  });

  describe('R13 R14 R15 recoger, entregar y retorno', () => {
    it('R13 recoger: delivery picked_up y pedido ready → on_the_way en UNA transacción (historial y auditoría de ambos)', async () => {
      const staff = admin();
      const a = await assigned();
      const res = await h.commands.execute(staff, 'mark_picked_up', a.id, {
        expectedVersion: a.version,
      });
      expect(res.delivery).toMatchObject({ status: 'picked_up', orderStatus: 'on_the_way' });
      expect(h.repo.orders.get(a.order.id)?.status).toBe('on_the_way');
      expect(h.repo.orderHistory.at(-1)).toMatchObject({
        oldStatus: 'ready',
        newStatus: 'on_the_way',
        changedBy: staff.staffId,
      });
      expect(h.repo.eventsOf(a.id).at(-1)?.event).toBe('picked_up');
      expect(h.repo.audits.map((x) => x.action).slice(-2)).toEqual([
        'order.dispatched',
        'delivery.picked_up',
      ]);
      expect(h.repo.calls.filter((c) => c === 'order:cas')).toHaveLength(1);
    });

    it('R13 pedido en preparing => 409 ORDER_STATE_CONFLICT con current y SIN cambios', async () => {
      const a = await assigned(rider(), { status: 'preparing' });
      const auditsBefore = h.repo.audits.length;
      const e = info(
        await err(
          h.commands.execute(admin(), 'mark_picked_up', a.id, { expectedVersion: a.version }),
        ),
      );
      expect([e.status, e.code, e.current?.status]).toEqual([
        409,
        'ORDER_STATE_CONFLICT',
        'preparing',
      ]);
      expect(h.repo.deliveryOf(a.order.id)?.status).toBe('assigned');
      expect(h.repo.orders.get(a.order.id)?.status).toBe('preparing');
      expect(h.repo.audits).toHaveLength(auditsBefore);
    });

    it('R13 desde pending o con versión vieja => 409 DELIVERY_STATE_CONFLICT; PEDIDOSYA jamás llega a recoger', async () => {
      const c = await created();
      const e = info(
        await err(
          h.commands.execute(admin(), 'mark_picked_up', c.id, { expectedVersion: c.version }),
        ),
      );
      expect([e.status, e.code, e.current?.status]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        'pending',
      ]);
      const a = await assigned();
      const stale = info(
        await err(h.commands.execute(admin(), 'mark_picked_up', a.id, { expectedVersion: 1 })),
      );
      expect([stale.status, stale.code, stale.current?.version]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        a.version,
      ]);
      // si una fila inconsistente cayera sobre PEDIDOSYA, la matriz del pedido lo rechaza (422) y no cambia nada
      const py = order({ deliveryProvider: 'PEDIDOSYA' });
      const d = h.repo.seedDelivery({ orderId: py.id, status: 'assigned', riderId: rider().id });
      const r = info(
        await err(
          h.commands.execute(admin(), 'mark_picked_up', d.id, { expectedVersion: d.version }),
        ),
      );
      expect([r.status, r.code]).toEqual([422, 'ORDER_TRANSITION_INVALID']);
      expect(h.repo.orders.get(py.id)?.status).toBe('ready');
      expect(h.repo.deliveries.get(d.id)?.status).toBe('assigned');
    });

    it('R14 entregar: picked_up → delivered y pedido on_the_way → delivered; el motorista SIGUE ocupado', async () => {
      const a = await assigned();
      const p = await h.commands.execute(admin(), 'mark_picked_up', a.id, {
        expectedVersion: a.version,
      });
      const res = await h.commands.execute(admin(), 'mark_delivered', a.id, {
        expectedVersion: p.delivery.version,
      });
      expect(res.delivery).toMatchObject({
        status: 'delivered',
        orderStatus: 'delivered',
        awaitingReturn: true,
        riderOccupied: true,
      });
      expect(h.repo.audits.map((x) => x.action).slice(-2)).toEqual([
        'order.delivered',
        'delivery.delivered',
      ]);
      expect((await h.port.findBusy({ riderIds: [a.rider.id] })).busyIds.has(a.rider.id)).toBe(
        true,
      );
    });

    it('R15 retorno: delivered → returned con historial SEPARADO, libera al motorista y NO toca el pedido', async () => {
      const a = await assigned();
      const p = await h.commands.execute(admin(), 'mark_picked_up', a.id, {
        expectedVersion: a.version,
      });
      const d = await h.commands.execute(admin(), 'mark_delivered', a.id, {
        expectedVersion: p.delivery.version,
      });
      const orderEvents = h.repo.orderHistory.length;
      const res = await h.commands.execute(admin(), 'return_to_branch', a.id, {
        expectedVersion: d.delivery.version,
      });
      expect(res.delivery).toMatchObject({
        status: 'returned',
        riderOccupied: false,
        awaitingReturn: false,
      });
      expect(res.delivery.returnedAt).not.toBeNull();
      expect(h.repo.eventsOf(a.id).map((e) => e.event)).toEqual([
        'created',
        'rider_assigned',
        'picked_up',
        'delivered',
        'returned',
      ]);
      expect(h.repo.orderHistory).toHaveLength(orderEvents);
      expect((await h.port.findBusy({ riderIds: [a.rider.id] })).busyIds.size).toBe(0);
      expect(h.repo.audits.at(-1)?.action).toBe('delivery.returned');
    });

    it('R16 sin retorno la entrega queda `delivered` y el motorista ocupado; un retorno tardío lo libera', async () => {
      const a = await assigned();
      const p = await h.commands.execute(admin(), 'mark_picked_up', a.id, {
        expectedVersion: a.version,
      });
      const d = await h.commands.execute(admin(), 'mark_delivered', a.id, {
        expectedVersion: p.delivery.version,
      });
      const list = await h.queries.list(admin(), { status: ['delivered'] });
      expect(list.items.map((i) => i.id)).toEqual([a.id]);
      expect(list.items[0]?.awaitingReturn).toBe(true);
      const other = rider({ fullName: 'Otro' });
      const c = await created();
      const busy = info(
        await err(
          h.commands.assign(admin(), c.id, { riderId: a.rider.id, expectedVersion: c.version }),
        ),
      );
      expect(busy.violations).toEqual(['BUSY']);
      void other;
      await h.commands.execute(admin(), 'return_to_branch', a.id, {
        expectedVersion: d.delivery.version,
      });
      const ok = await h.commands.assign(admin(), c.id, {
        riderId: a.rider.id,
        expectedVersion: c.version,
      });
      expect(ok.delivery.status).toBe('assigned');
    });

    it('retorno desde estados distintos de delivered => 409', async () => {
      const a = await assigned();
      const e = info(
        await err(
          h.commands.execute(admin(), 'return_to_branch', a.id, { expectedVersion: a.version }),
        ),
      );
      expect([e.status, e.code]).toEqual([409, 'DELIVERY_STATE_CONFLICT']);
    });
  });

  describe('R17 idempotencia de cada comando', () => {
    it.each([
      'unassign',
      'mark_picked_up',
      'mark_delivered',
      'return_to_branch',
      'cancel',
    ] as const)(
      '%s repetido => 200 replayed SIN historial ni auditoría nueva; appliedByMe correcto',
      async (command) => {
        const staff = admin();
        const a = await assigned();
        let version = a.version;
        const reason = command === 'cancel' ? 'motivo uno' : undefined;
        const run = (v: number, who = staff) =>
          h.commands.execute(who, command, a.id, {
            expectedVersion: v,
            ...(reason ? { reason } : {}),
          });
        if (command === 'mark_delivered' || command === 'return_to_branch') {
          const p = await h.commands.execute(staff, 'mark_picked_up', a.id, {
            expectedVersion: version,
          });
          version = p.delivery.version;
        }
        if (command === 'return_to_branch') {
          const d = await h.commands.execute(staff, 'mark_delivered', a.id, {
            expectedVersion: version,
          });
          version = d.delivery.version;
        }
        const first = await run(version);
        expect(first.transition.replayed).toBe(false);
        const events = h.repo.history.length;
        const audits = h.repo.audits.length;
        const orderEvents = h.repo.orderHistory.length;
        const second = await run(version);
        expect(second.transition).toMatchObject({
          replayed: true,
          appliedByMe: true,
          event: first.transition.event,
        });
        expect(second.transition.at).toBe(first.transition.at);
        expect(second.delivery.version).toBe(first.delivery.version);
        const other = globalStaff(ALL, { staffId: '88888888-8888-4888-8888-888888888888' });
        expect((await run(version, other)).transition).toMatchObject({
          replayed: true,
          appliedByMe: false,
        });
        expect(h.repo.history).toHaveLength(events);
        expect(h.repo.audits).toHaveLength(audits);
        expect(h.repo.orderHistory).toHaveLength(orderEvents);
      },
    );

    it('una repetición exige la autorización completa', async () => {
      const a = await assigned();
      await h.commands.execute(admin(), 'unassign', a.id, { expectedVersion: a.version });
      const e = info(
        await err(
          h.commands.execute(reader(h.branchA), 'unassign', a.id, { expectedVersion: a.version }),
        ),
      );
      expect([e.status, e.code]).toEqual([403, 'DELIVERY_ACTION_FORBIDDEN']);
    });
  });

  describe('R20 cancelar entrega', () => {
    it('pending|assigned → cancelled con motivo, libera al motorista y NO toca el pedido', async () => {
      const a = await assigned();
      const res = await h.commands.execute(admin(), 'cancel', a.id, {
        expectedVersion: a.version,
        reason: '  cliente canceló  ',
      });
      expect(res.delivery).toMatchObject({
        status: 'cancelled',
        rider: null,
        riderOccupied: false,
      });
      expect(res.delivery.cancelledAt).not.toBeNull();
      expect(h.repo.eventsOf(a.id).at(-1)).toMatchObject({
        event: 'cancelled',
        reason: 'cliente canceló',
        riderId: a.rider.id,
      });
      expect(h.repo.orders.get(a.order.id)?.status).toBe('ready');
      expect((await h.port.findBusy({ riderIds: [a.rider.id] })).busyIds.size).toBe(0);
      const p = await created();
      expect(
        (
          await h.commands.execute(admin(), 'cancel', p.id, {
            expectedVersion: p.version,
            reason: 'duplicada',
          })
        ).delivery.status,
      ).toBe('cancelled');
    });

    it.each([[undefined], [''], ['  '], ['ab'], ['x'.repeat(281)], ['a\u0007b'], [null]])(
      'sin motivo válido (%j) => 400 DELIVERY_REASON_REQUIRED sin tocar la BD',
      async (reason) => {
        const a = await assigned();
        const callsBefore = h.repo.calls.length;
        const e = info(
          await err(
            h.commands.execute(admin(), 'cancel', a.id, {
              expectedVersion: a.version,
              reason: reason,
            }),
          ),
        );
        expect([e.status, e.code]).toEqual([400, 'DELIVERY_REASON_REQUIRED']);
        expect(h.repo.calls).toHaveLength(callsBefore);
      },
    );

    it('desde picked_up => 409 y el pedido sigue on_the_way', async () => {
      const a = await assigned();
      const p = await h.commands.execute(admin(), 'mark_picked_up', a.id, {
        expectedVersion: a.version,
      });
      const e = info(
        await err(
          h.commands.execute(admin(), 'cancel', a.id, {
            expectedVersion: p.delivery.version,
            reason: 'motivo uno',
          }),
        ),
      );
      expect([e.status, e.code, e.current?.status]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        'picked_up',
      ]);
    });
  });

  describe('R19 todo o nada', () => {
    it('si falla la auditoría no cambia ni la entrega ni el pedido (rollback conjunto)', async () => {
      const a = await assigned();
      h.repo.failAudit = true;
      const before = {
        events: h.repo.history.length,
        orderEvents: h.repo.orderHistory.length,
        audits: h.repo.audits.length,
      };
      expect(
        await err(
          h.commands.execute(admin(), 'mark_picked_up', a.id, { expectedVersion: a.version }),
        ),
      ).not.toBeNull();
      expect(h.repo.deliveryOf(a.order.id)).toMatchObject({
        status: 'assigned',
        version: a.version,
      });
      expect(h.repo.orders.get(a.order.id)?.status).toBe('ready');
      expect(h.repo.history).toHaveLength(before.events);
      expect(h.repo.orderHistory).toHaveLength(before.orderEvents);
      expect(h.repo.audits).toHaveLength(before.audits);
    });
  });

  describe('permisos y alcance (R23 R24)', () => {
    it('personal con solo deliveries.read ve pero no actúa => 403 DELIVERY_ACTION_FORBIDDEN en TODOS los comandos', async () => {
      const a = await assigned();
      const staff = reader(h.branchA);
      for (const command of [
        'unassign',
        'mark_picked_up',
        'mark_delivered',
        'return_to_branch',
        'cancel',
      ] as const) {
        const e = info(
          await err(
            h.commands.execute(staff, command, a.id, {
              expectedVersion: a.version,
              reason: 'motivo uno',
            }),
          ),
        );
        expect([command, e.status, e.code]).toEqual([command, 403, 'DELIVERY_ACTION_FORBIDDEN']);
      }
      expect(h.repo.deliveryOf(a.order.id)?.status).toBe('assigned');
    });

    it('entrega de otra sucursal => el MISMO 404 DELIVERY_NOT_FOUND (cuerpo idéntico) en TODOS los comandos', async () => {
      const a = await assigned();
      const staff = manager(h.branchB);
      const missing = info(
        await err(
          h.commands.execute(staff, 'cancel', 'c0000000-0000-4000-8000-0000000000dd', {
            expectedVersion: 1,
            reason: 'motivo uno',
          }),
        ),
      );
      for (const command of [
        'unassign',
        'mark_picked_up',
        'mark_delivered',
        'return_to_branch',
        'cancel',
      ] as const) {
        const e = info(
          await err(
            h.commands.execute(staff, command, a.id, {
              expectedVersion: a.version,
              reason: 'motivo uno',
            }),
          ),
        );
        expect([command, e.status, e.code]).toEqual([command, 404, 'DELIVERY_NOT_FOUND']);
        expect(e.raw).toBe(missing.raw);
      }
    });
  });

  describe('S2 autorizar antes de bloquear · S5 orders.read al crear', () => {
    it('S2: sin permiso o fuera de alcance NO se bloquea ninguna fila (ni entrega ni motorista)', async () => {
      const r = rider();
      const a = await assigned(rider());
      h.repo.lockedRiders.length = 0;
      h.repo.lockedDeliveries.length = 0;
      h.repo.calls.length = 0;
      // 403: solo `deliveries.read`; 404: otra sucursal. Ningún comando llega a bloquear.
      for (const staff of [reader(h.branchA), manager(h.branchB)]) {
        for (const command of ['unassign', 'mark_picked_up', 'mark_delivered', 'cancel'] as const) {
          await err(
            h.commands.execute(staff, command, a.id, {
              expectedVersion: a.version,
              reason: 'motivo uno',
            }),
          );
        }
        await err(h.commands.assign(staff, a.id, { riderId: r.id, expectedVersion: a.version }));
      }
      expect(h.repo.lockedDeliveries).toEqual([]);
      expect(h.repo.lockedRiders).toEqual([]);
      expect(h.repo.calls).not.toContain('lockRider');
    });

    it('S2: motorista de otra sucursal o actor sin `riders.read` => 404 uniforme SIN bloquear la fila del motorista', async () => {
      const far = rider({ branchId: h.branchB });
      const c = await created();
      const noRead = scopedStaff(
        ['deliveries.read', 'deliveries.assign', 'riders.assign'],
        [h.branchA],
      );
      const sameBranchOnly = scopedStaff(
        ['deliveries.read', 'deliveries.assign', 'riders.assign', 'riders.read'],
        [h.branchA],
      );
      for (const staff of [noRead, sameBranchOnly]) {
        const e = info(
          await err(
            h.commands.assign(staff, c.id, { riderId: far.id, expectedVersion: c.version }),
          ),
        );
        expect([e.status, e.code]).toEqual([404, 'RIDER_NOT_FOUND']);
      }
      expect(h.repo.lockedRiders).toEqual([]);
      expect(h.repo.deliveryOf(c.order.id)?.status).toBe('pending');
    });

    it('S2: un actor autorizado SÍ bloquea (motorista y entrega) en ese orden', async () => {
      const r = rider();
      const c = await created();
      h.repo.lockedRiders.length = 0;
      await h.commands.assign(admin(), c.id, { riderId: r.id, expectedVersion: c.version });
      expect(h.repo.lockedRiders).toEqual([r.id]);
      const at = (name: string) => h.repo.calls.lastIndexOf(name);
      expect(at('lockRider')).toBeLessThan(at('readLocked'));
    });

    it('S5: crear exige `orders.read` en la sucursal del pedido: sin él, 404 ORDER_NOT_FOUND idéntico al de un pedido inexistente y sin escribir', async () => {
      const o = order();
      const noOrdersRead = scopedStaff(['deliveries.read', 'deliveries.assign'], [h.branchA]);
      const denied = info(await err(h.commands.create(noOrdersRead, o.id)));
      const missing = info(
        await err(h.commands.create(noOrdersRead, 'c0000000-0000-4000-8000-0000000000ab')),
      );
      expect([denied.status, denied.code]).toEqual([404, 'ORDER_NOT_FOUND']);
      expect(denied.raw).toBe(missing.raw);
      expect(h.repo.deliveries.size).toBe(0);
      expect(h.repo.audits).toHaveLength(0);
      const withOrdersRead = scopedStaff(
        ['deliveries.read', 'deliveries.assign', 'orders.read'],
        [h.branchA],
      );
      expect((await h.commands.create(withOrdersRead, o.id)).delivery.status).toBe('pending');
    });
  });

  describe('errores de BD (R37)', () => {
    it('lock_timeout (55P03) => 503 DELIVERIES_BUSY con Retry-After', async () => {
      const a = await assigned();
      h.repo.failWith = { code: '55P03' };
      const e = err(
        h.commands.execute(admin(), 'cancel', a.id, {
          expectedVersion: a.version,
          reason: 'motivo uno',
        }),
      );
      const x = e.then((v) => (v as HttpException).getResponse());
      expect(await x).toMatchObject({ code: 'DELIVERIES_BUSY', retryAfter: 2 });
      expect(info(await e).status).toBe(503);
    });

    it('23514/42501 de las guardas (coherencia diferida, carrera con el pedido) => 409 DELIVERY_STATE_CONFLICT con current, sin mensajes internos', async () => {
      const a = await assigned();
      for (const code of ['23514', '42501']) {
        h.repo.changeFailWith = {
          code,
          message: 'deliveries_guard: transicion pending -> picked_up no permitida',
        };
        const e = info(
          await err(h.commands.execute(admin(), 'unassign', a.id, { expectedVersion: a.version })),
        );
        expect([e.status, e.code, e.current]).toEqual([
          409,
          'DELIVERY_STATE_CONFLICT',
          { status: 'assigned', version: a.version },
        ]);
        expect(e.raw).not.toContain('transicion');
      }
    });

    it('S4: 23514/42501 SIN nombre de restricción conocido NO se trata como carrera: el error interno sale tal cual (500 genérico)', async () => {
      const a = await assigned();
      for (const code of ['23514', '42501', '23505', '23001']) {
        const raw = Object.assign(new Error('app.otra_tabla: violacion ajena'), { code });
        h.repo.changeFailWith = raw;
        const failed = await err(
          h.commands.execute(admin(), 'unassign', a.id, { expectedVersion: a.version }),
        );
        expect([code, failed]).toEqual([code, raw]);
      }
    });

    it('23514 al CREAR (el pedido se canceló en paralelo) => 409 ORDER_STATE_CONFLICT con el estado vigente del pedido', async () => {
      const o = order();
      // la cancelación la confirmó OTRA transacción: sobrevive al rollback de esta (relectura fuera de la transacción fallida)
      vi.spyOn(h.repo, 'orderCurrentOf').mockResolvedValue({
        status: 'cancelled',
        updatedAt: new Date(),
      });
      h.repo.afterRead = () => {
        h.repo.afterRead = null;
        h.repo.insertFailWith = {
          code: '23514',
          message: 'deliveries_order_coherence: estado incoherente',
        };
      };
      const e = info(await err(h.commands.create(admin(), o.id)));
      expect([e.status, e.code, e.current?.status]).toEqual([
        409,
        'ORDER_STATE_CONFLICT',
        'cancelled',
      ]);
      expect(e.raw).not.toContain('incoherente');
      expect(h.repo.deliveries.size).toBe(0);
    });

    it('un error inesperado de BD no se traduce (el filtro global lo trata como 500 genérico)', async () => {
      const a = await assigned();
      const boom = new Error('relation "app.deliveries" does not exist');
      h.repo.failWith = boom;
      expect(
        await err(
          h.commands.execute(admin(), 'cancel', a.id, {
            expectedVersion: a.version,
            reason: 'motivo uno',
          }),
        ),
      ).toBe(boom);
    });

    it('gate saturado => 503 DELIVERIES_BUSY (R31)', async () => {
      const tight = deliveriesHarness({ gate: new DbGate(1, 0, 50, deliveriesBusy) });
      const o = tight.repo.seedOrder({ branchId: tight.branchA });
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      const slow = tight.gate.run(() => hold);
      const e = info(await err(tight.commands.create(admin(), o.id)));
      expect([e.status, e.code]).toEqual([503, 'DELIVERIES_BUSY']);
      release();
      await slow;
    });
  });
});
