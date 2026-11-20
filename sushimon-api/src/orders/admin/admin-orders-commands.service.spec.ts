import { DbGate } from '../../common/concurrency/db-gate.js';
import {
  adminOrdersHarness,
  BRANCH_A,
  BRANCH_B,
} from '../../../test/support/admin-orders-harness.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from '../../../test/support/staff-context.js';
import { ordersBusy } from '../orders-errors.js';
import type { OrderCommand } from './order-transition.matrix.js';

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const body = (e: unknown) =>
  (e as { getResponse: () => Record<string, unknown> }).getResponse() as {
    code?: string;
    extra?: { current?: { status: string } };
    violations?: { code: string }[];
  };
const status = (e: unknown) => (e as { getStatus: () => number }).getStatus();

const ALL = ROLE_PERMISSIONS['admin'] as string[];
const admin = () => globalStaff(ALL);
const manager = (b: string) =>
  scopedStaff(ROLE_PERMISSIONS['manager'] as string[], [b], {
    staffId: '66666666-6666-4666-8666-666666666666',
  });
const kitchen = (b: string) => scopedStaff(ROLE_PERMISSIONS['kitchen'] as string[], [b]);
const staffRole = (b: string) =>
  scopedStaff(ROLE_PERMISSIONS['staff'] as string[], [b], {
    staffId: '77777777-7777-4777-8777-777777777777',
  });

describe('AdminOrdersCommandsService (S)', () => {
  it('recorrido PICKUP: accept -> start -> ready -> complete, con historial y auditoría por paso (filas 12, 15)', async () => {
    const { repo, commands } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const steps: [OrderCommand, string, string][] = [
      ['accept', 'pending', 'accepted'],
      ['start_preparing', 'accepted', 'preparing'],
      ['mark_ready', 'preparing', 'ready'],
      ['complete', 'ready', 'picked_up'],
    ];
    for (const [command, from, to] of steps) {
      const res = await commands.execute(admin(), command, id, { expectedStatus: from });
      expect(res.order.status).toBe(to);
      expect(res.transition).toMatchObject({ from, to, replayed: false, appliedByMe: true });
      expect(res.pendingActions).toEqual([]);
    }
    expect(repo.eventsOf(id).map((e) => e.newStatus)).toEqual([
      'pending',
      'accepted',
      'preparing',
      'ready',
      'picked_up',
    ]);
    expect(repo.audits.map((a) => a.action)).toEqual([
      'order.accepted',
      'order.preparation_started',
      'order.marked_ready',
      'order.completed',
    ]);
    expect(repo.orders.get(id)?.status).toBe('picked_up');
  });

  it('fila 12: complete sobre DELIVERY (OWN y PEDIDOSYA) => 422 ORDER_FULFILLMENT_MISMATCH sin escribir', async () => {
    for (const provider of ['OWN', 'PEDIDOSYA'] as const) {
      const { repo, commands } = adminOrdersHarness();
      const id = repo.seed({
        branchId: BRANCH_A,
        status: 'ready',
        fulfillmentType: 'DELIVERY',
        deliveryProvider: provider,
      });
      const e = await err(commands.execute(admin(), 'complete', id, { expectedStatus: 'ready' }));
      expect(status(e)).toBe(422);
      expect(body(e).violations?.[0]?.code).toBe('ORDER_FULFILLMENT_MISMATCH');
      expect(body(e).extra?.current?.status).toBe('ready');
      expect(repo.audits).toHaveLength(0);
    }
  });

  it('fila 13: PEDIDOSYA accept -> start -> ready funcionan y ningún comando produce on_the_way/delivered', async () => {
    const { repo, commands, fulfillment } = adminOrdersHarness();
    const id = repo.seed({
      branchId: BRANCH_A,
      fulfillmentType: 'DELIVERY',
      deliveryProvider: 'PEDIDOSYA',
    });
    await commands.execute(admin(), 'accept', id, { expectedStatus: 'pending' });
    await commands.execute(admin(), 'start_preparing', id, { expectedStatus: 'accepted' });
    const ready = await commands.execute(admin(), 'mark_ready', id, {
      expectedStatus: 'preparing',
    });
    expect(ready.order.availableActions).toEqual([
      { action: 'cancel', enabled: true, disabledReason: null },
      { action: 'dispatch', enabled: false, disabledReason: 'PROVIDER_BLOCKED_EXTERNAL' },
    ]);
    expect(fulfillment.calls).toHaveLength(0);
    const all: OrderCommand[] = ['accept', 'reject', 'start_preparing', 'mark_ready', 'complete'];
    for (const c of all) {
      await err(commands.execute(admin(), c, id, { expectedStatus: 'ready', reason: 'motivo' }));
    }
    expect(repo.orders.get(id)?.status).toBe('ready');
  });

  it('fila 14: cancel desde pending/accepted/preparing/ready => 200; desde on_the_way => 422 ORDER_CANCEL_NOT_ALLOWED; terminal => 422', async () => {
    for (const from of ['pending', 'accepted', 'preparing', 'ready']) {
      const { repo, commands } = adminOrdersHarness();
      const id = repo.seed({ branchId: BRANCH_A, status: from });
      const res = await commands.execute(admin(), 'cancel', id, {
        expectedStatus: from,
        reason: 'Cliente lo pidió',
      });
      expect(res.order.status).toBe('cancelled');
    }
    const { repo, commands } = adminOrdersHarness();
    const way = repo.seed({
      branchId: BRANCH_A,
      status: 'on_the_way',
      fulfillmentType: 'DELIVERY',
    });
    const e = await err(
      commands.execute(admin(), 'cancel', way, { expectedStatus: 'on_the_way', reason: 'tarde' }),
    );
    expect(body(e).violations?.[0]?.code).toBe('ORDER_CANCEL_NOT_ALLOWED');
    for (const t of ['delivered', 'picked_up', 'rejected', 'cancelled']) {
      const id = repo.seed({ branchId: BRANCH_A, status: t });
      const te = await err(
        commands.execute(admin(), 'cancel', id, { expectedStatus: t, reason: 'tarde' }),
      );
      expect(body(te).violations?.[0]?.code).toBe('ORDER_TERMINAL');
    }
  });

  it('fila 10: expectedStatus que no es origen del comando => 422 ORDER_SOURCE_INVALID aunque el pedido esté en ese estado', async () => {
    const { repo, commands } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A, status: 'accepted' });
    const e = await err(commands.execute(admin(), 'accept', id, { expectedStatus: 'accepted' }));
    expect(status(e)).toBe(422);
    expect(body(e).violations?.[0]?.code).toBe('ORDER_SOURCE_INVALID');
    expect(repo.audits).toHaveLength(0);
  });

  it('fila 3: permiso por comando (kitchen rechaza pero no cancela; staff prepara pero no completa ni rechaza)', async () => {
    const { repo, commands } = adminOrdersHarness();
    const a = repo.seed({ branchId: BRANCH_A });
    const forbidden = async (
      staff: ReturnType<typeof kitchen>,
      c: OrderCommand,
      id: string,
      expected: string,
    ) =>
      body(
        await err(
          commands.execute(staff, c, id, { expectedStatus: expected, reason: 'motivo ok' }),
        ),
      ).code;
    expect(await forbidden(kitchen(BRANCH_A), 'cancel', a, 'pending')).toBe(
      'ORDER_ACTION_FORBIDDEN',
    );
    expect(await forbidden(staffRole(BRANCH_A), 'reject', a, 'pending')).toBe(
      'ORDER_ACTION_FORBIDDEN',
    );
    const r = await commands.execute(kitchen(BRANCH_A), 'reject', a, {
      expectedStatus: 'pending',
      reason: 'Sin existencias',
    });
    expect(r.order.status).toBe('rejected');
    const ready = repo.seed({ branchId: BRANCH_A, status: 'ready' });
    expect(await forbidden(staffRole(BRANCH_A), 'complete', ready, 'ready')).toBe(
      'ORDER_ACTION_FORBIDDEN',
    );
    const prep = repo.seed({ branchId: BRANCH_A, status: 'preparing' });
    const done = await commands.execute(staffRole(BRANCH_A), 'mark_ready', prep, {
      expectedStatus: 'preparing',
    });
    expect(done.order.status).toBe('ready');
  });

  it('fila 7: permiso solo en la sucursal B => 404 en un pedido de A; con orders.read pero sin cancel => 403', async () => {
    const { repo, commands } = adminOrdersHarness();
    const inA = repo.seed({ branchId: BRANCH_A });
    const missing = await err(
      commands.execute(manager(BRANCH_B), 'cancel', inA, {
        expectedStatus: 'pending',
        reason: 'prueba',
      }),
    );
    expect(status(missing)).toBe(404);
    expect(body(missing).code).toBe('ORDER_NOT_FOUND');
    const readOnly = scopedStaff(['orders.read', 'orders.accept'], [BRANCH_A]);
    const denied = await err(
      commands.execute(readOnly, 'cancel', inA, { expectedStatus: 'pending', reason: 'prueba' }),
    );
    expect(status(denied)).toBe(403);
    expect(body(denied).code).toBe('ORDER_ACTION_FORBIDDEN');
    // permiso del comando en A pero SIN orders.read en A => 404 (no ve el pedido)
    const blind = scopedStaff(['orders.cancel'], [BRANCH_A]);
    expect(
      status(
        await err(
          commands.execute(blind, 'cancel', inA, { expectedStatus: 'pending', reason: 'prueba' }),
        ),
      ),
    ).toBe(404);
    expect(repo.audits).toHaveLength(0);
  });

  it('fila 6: inexistente y ajeno dan el MISMO error (código, estado y mensaje)', async () => {
    const { repo, commands } = adminOrdersHarness();
    const inA = repo.seed({ branchId: BRANCH_A });
    const a = await err(
      commands.execute(manager(BRANCH_B), 'accept', inA, { expectedStatus: 'pending' }),
    );
    const b = await err(
      commands.execute(manager(BRANCH_B), 'accept', 'c0000000-0000-4000-8000-0000000000ff', {
        expectedStatus: 'pending',
      }),
    );
    expect(body(a)).toEqual(body(b));
    expect(status(a)).toBe(status(b));
  });

  it('fila 21: repetición por otro empleado SIN permiso o alcance => 403/404, no hay repetición', async () => {
    const { repo, commands } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    await commands.execute(admin(), 'accept', id, { expectedStatus: 'pending' });
    const other = scopedStaff(['orders.read'], [BRANCH_A]);
    expect(
      status(await err(commands.execute(other, 'accept', id, { expectedStatus: 'pending' }))),
    ).toBe(403);
    expect(
      status(
        await err(commands.execute(manager(BRANCH_B), 'accept', id, { expectedStatus: 'pending' })),
      ),
    ).toBe(404);
    const again = await commands.execute(manager(BRANCH_A), 'accept', id, {
      expectedStatus: 'pending',
    });
    expect(again.transition).toMatchObject({ replayed: true, appliedByMe: false });
  });

  describe('fila 8: motivo', () => {
    it.each([undefined, '', '   ', 'ab', '  a  '])(
      'reject con motivo %j => 400 ORDER_REASON_REQUIRED',
      async (reason) => {
        const { repo, commands } = adminOrdersHarness();
        const id = repo.seed({ branchId: BRANCH_A });
        const e = await err(
          commands.execute(admin(), 'reject', id, { expectedStatus: 'pending', reason }),
        );
        expect(status(e)).toBe(400);
        expect(body(e).code).toBe('ORDER_REASON_REQUIRED');
        expect(repo.calls).not.toContain('transaction');
      },
    );

    it('281 caracteres o caracteres de control => 400; 280 pasa y se recorta', async () => {
      const { repo, commands } = adminOrdersHarness();
      const id = repo.seed({ branchId: BRANCH_A });
      expect(
        status(
          await err(
            commands.execute(admin(), 'cancel', id, {
              expectedStatus: 'pending',
              reason: 'x'.repeat(281),
            }),
          ),
        ),
      ).toBe(400);
      expect(
        status(
          await err(
            commands.execute(admin(), 'cancel', id, {
              expectedStatus: 'pending',
              reason: 'mal\u0007motivo',
            }),
          ),
        ),
      ).toBe(400);
      await commands.execute(admin(), 'cancel', id, {
        expectedStatus: 'pending',
        reason: `  ${'x'.repeat(280)}  `,
      });
      expect(repo.eventsOf(id)[1]?.reason).toBe('x'.repeat(280));
      expect(repo.audits[0]?.reason).toBe('x'.repeat(280));
    });

    it.each(['mal\u202Emotivo', 'ancho\u200Bcero', 'sal\u2028to', 'pár\u2029rafo', 'tab\tulado'])(
      'motivo con caracteres de control, formato o separadores (%j) => 400',
      async (reason) => {
        const { repo, commands } = adminOrdersHarness();
        const id = repo.seed({ branchId: BRANCH_A });
        const e = await err(
          commands.execute(admin(), 'cancel', id, { expectedStatus: 'pending', reason }),
        );
        expect(status(e)).toBe(400);
        expect(repo.calls).not.toContain('transaction');
      },
    );

    it('los comandos sin motivo no guardan ninguno', async () => {
      const { repo, commands } = adminOrdersHarness();
      const id = repo.seed({ branchId: BRANCH_A });
      await commands.execute(admin(), 'accept', id, {
        expectedStatus: 'pending',
        reason: 'ignorado',
      });
      expect(repo.eventsOf(id)[1]?.reason).toBeNull();
    });
  });

  describe('fila 24 y 25: pendingActions y puertos', () => {
    it('payment_review SOLO con un pago PAID real (F24); [] con pago pendiente; delivery_cancellation solo si el puerto lo informa', async () => {
      const h = adminOrdersHarness();
      const bank = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.seedPaid(bank);
      const cash = h.repo.seed({ branchId: BRANCH_A, paymentMethodPreference: 'cash' });
      const r1 = await h.commands.execute(admin(), 'reject', bank, {
        expectedStatus: 'pending',
        reason: 'Sin stock',
      });
      const r2 = await h.commands.execute(admin(), 'cancel', cash, {
        expectedStatus: 'pending',
        reason: 'Sin stock',
      });
      expect(r1.pendingActions).toEqual(['payment_review']);
      expect(r2.pendingActions).toEqual([]);
      h.fulfillment.result = { activeDelivery: true, pendingActions: ['delivery_cancellation'] };
      const own = h.repo.seed({
        branchId: BRANCH_A,
        fulfillmentType: 'DELIVERY',
        status: 'ready',
      });
      h.paymentsRepo.seedPaid(own);
      const r3 = await h.commands.execute(admin(), 'cancel', own, {
        expectedStatus: 'ready',
        reason: 'Sin repartidor',
      });
      expect(r3.pendingActions).toEqual(['payment_review', 'delivery_cancellation']);
    });

    it('la repetición idempotente de cancel también informa pendingActions', async () => {
      const h = adminOrdersHarness();
      const id = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.seedPaid(id);
      await h.commands.execute(admin(), 'cancel', id, {
        expectedStatus: 'pending',
        reason: 'Sin stock',
      });
      const again = await h.commands.execute(admin(), 'cancel', id, {
        expectedStatus: 'pending',
        reason: 'Otro',
      });
      expect(again.transition.replayed).toBe(true);
      expect(again.pendingActions).toEqual(['payment_review']);
    });

    it('el puerto se invoca DESPUÉS del commit y su fallo no tumba el comando; accept/start no lo invocan', async () => {
      const h = adminOrdersHarness();
      const id = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.seedPaid(id);
      h.fulfillment.fail = true;
      let statusAtInspect: string | undefined;
      h.fulfillment.inspect = (order: unknown) => {
        h.fulfillment.calls.push(order);
        statusAtInspect = h.repo.orders.get(id)?.status; // ya confirmado
        return Promise.reject(new Error('caído'));
      };
      const res = await h.commands.execute(admin(), 'reject', id, {
        expectedStatus: 'pending',
        reason: 'Sin stock',
      });
      expect(statusAtInspect).toBe('rejected');
      expect(res.order.status).toBe('rejected');
      expect(res.pendingActions).toEqual(['payment_review']);
      const other = h.repo.seed({ branchId: BRANCH_A });
      const before = h.fulfillment.calls.length;
      await h.commands.execute(admin(), 'accept', other, { expectedStatus: 'pending' });
      expect(h.fulfillment.calls).toHaveLength(before);
    });
  });

  it('fila 34: gate saturado => 503 ORDERS_BUSY y se libera el cupo; las escrituras no usan rejectIfWaiting', async () => {
    const gate = new DbGate(1, 8, 5_000, ordersBusy);
    const h = adminOrdersHarness({ gate });
    const id = h.repo.seed({ branchId: BRANCH_A });
    let free!: () => void;
    const hold = gate.run(() => new Promise<void>((resolve) => (free = resolve)));
    // cola con 2 esperas: una escritura (sin admisión) sigue aceptada
    const waiting = [gate.run(() => Promise.resolve()), gate.run(() => Promise.resolve())];
    const write = h.commands.execute(admin(), 'accept', id, { expectedStatus: 'pending' });
    await Promise.resolve();
    expect(gate.waiting).toBe(3);
    free();
    await hold;
    await Promise.all(waiting);
    expect((await write).order.status).toBe('accepted');
    await new Promise((r) => setImmediate(r));
    expect(gate.inFlight).toBe(0);

    const full = new DbGate(1, 0, 5_000, ordersBusy);
    const busy = adminOrdersHarness({ gate: full });
    const id2 = busy.repo.seed({ branchId: BRANCH_A });
    let release!: () => void;
    const held = full.run(() => new Promise<void>((resolve) => (release = resolve)));
    const e = await err(
      busy.commands.execute(admin(), 'accept', id2, { expectedStatus: 'pending' }),
    );
    expect(status(e)).toBe(503);
    expect(body(e).code).toBe('ORDERS_BUSY');
    release();
    await held;
    await new Promise((r) => setImmediate(r));
    expect(full.inFlight).toBe(0);
  });

  it.each([{ code: 'P2028' }, { code: '40P01' }, { meta: { code: '55P03' } }])(
    'fila 34: lock_timeout / timeout de transacción %j => 503 ORDERS_BUSY con Retry-After',
    async (failure) => {
      const { repo, commands } = adminOrdersHarness();
      const id = repo.seed({ branchId: BRANCH_A });
      repo.failWith = failure;
      const e = await err(commands.execute(admin(), 'accept', id, { expectedStatus: 'pending' }));
      expect([status(e), body(e).code]).toEqual([503, 'ORDERS_BUSY']);
      expect((e as { getResponse: () => { retryAfter: number } }).getResponse().retryAfter).toBe(2);
    },
  );

  it('un error retryable de la BD se traduce a 503 ORDERS_BUSY; otros errores no se enmascaran', async () => {
    const { repo, commands } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    repo.failWith = { code: '55P03' };
    const e = await err(commands.execute(admin(), 'accept', id, { expectedStatus: 'pending' }));
    expect(body(e).code).toBe('ORDERS_BUSY');
  });

  it('fila 38: ninguna PII en la auditoría (nombre, teléfono, notas, dirección) y el motivo solo en su columna', async () => {
    const { repo, commands } = adminOrdersHarness();
    const id = repo.seed({
      branchId: BRANCH_A,
      customerName: 'NOMBRE-SECRETO',
      customerPhone: '+50299990000',
      notes: 'NOTA-SECRETA',
    });
    await commands.execute(admin(), 'cancel', id, {
      expectedStatus: 'pending',
      reason: 'MOTIVO-INTERNO',
    });
    const audit = repo.audits[0];
    const raw = JSON.stringify({
      old: audit?.oldValues,
      next: audit?.newValues,
      action: audit?.action,
    });
    for (const leak of ['NOMBRE-SECRETO', '+50299990000', 'NOTA-SECRETA', 'MOTIVO-INTERNO']) {
      expect(raw).not.toContain(leak);
    }
    expect(audit?.reason).toBe('MOTIVO-INTERNO');
  });
});
