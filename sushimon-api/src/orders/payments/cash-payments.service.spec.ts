import {
  adminOrdersHarness,
  BRANCH_A,
  BRANCH_B,
  NOW,
} from '../../../test/support/admin-orders-harness.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from '../../../test/support/staff-context.js';
import { DbGate } from '../../common/concurrency/db-gate.js';
import { ordersBusy } from '../orders-errors.js';

const KEY_A = 'aaaa1111-bbbb-4222-8ccc-dddd33334444';
const KEY_B = 'eeee5555-ffff-4666-8777-888899990000';
const ALL = ROLE_PERMISSIONS['admin'] as string[];
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

const admin = () => globalStaff(ALL);
const other = () => globalStaff(ALL, { staffId: OTHER_ID, fullName: 'Otra Cajera' });
const cashierAt = (branch: string) =>
  scopedStaff(['orders.read', 'payments.read', 'payments.confirm'], [branch]);
const readerAt = (branch: string) => scopedStaff(['orders.read', 'payments.read'], [branch]);
const confirmOnly = (branch: string) => scopedStaff(['orders.read', 'payments.confirm'], [branch]);

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const resp = (e: unknown) =>
  (e as { getResponse: () => Record<string, unknown> }).getResponse() as {
    code?: string;
    extra?: { current?: Record<string, unknown> };
    violations?: { code: string }[];
  };
const status = (e: unknown) => (e as { getStatus: () => number }).getStatus();
const body = (tendered: unknown, receivedConfirmed: unknown) =>
  ({ tendered, receivedConfirmed }) as never;

function setup() {
  const h = adminOrdersHarness();
  h.repo.staffNames.set(ADMIN_ID, 'Ana Admin');
  h.repo.staffNames.set(OTHER_ID, 'Otra Cajera');
  const pay = (
    staff = admin(),
    orderId: string,
    over: { key?: unknown; tendered?: unknown; confirmed?: unknown } = {},
  ) =>
    h.cashPayments.register(
      staff,
      orderId,
      'key' in over ? over.key : KEY_A,
      body(
        'tendered' in over ? over.tendered : '200.00',
        'confirmed' in over ? over.confirmed : true,
      ),
    );
  return { ...h, pay };
}

describe('CashPaymentsService.register (S, F24)', () => {
  it('#9 pago exacto: total 185.00 con 185.00 => 201 (no replay), cambio 0.00 e ingreso 185.00', async () => {
    const { repo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_A, total: '185.00' });
    const r = await pay(admin(), id, { tendered: '185.00' });
    expect(r.replayed).toBe(false);
    expect(r.body.payment.reception).toMatchObject({
      amountApplied: '185.00',
      tendered: '185.00',
      change: '0.00',
    });
  });

  it('#10 con cambio: total 185.00 con 200.00 => cambio 15.00 (lo calcula el servidor) y el ingreso es 185.00', async () => {
    const { repo, paymentsRepo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_A, total: '185.00' });
    const r = await pay(admin(), id);
    expect(r.body).toMatchObject({
      replayed: false,
      appliedByMe: true,
      payment: {
        status: 'PAID',
        amountDue: '185.00',
        outstanding: '0.00',
        reception: {
          amountApplied: '185.00',
          tendered: '200.00',
          change: '15.00',
          collectorType: 'STAFF',
        },
      },
    });
    // #15: `payments.amount = orders.total` no cambia; el ingreso es `amount`, jamás `tendered`
    const stored = paymentsRepo.payments.get(id);
    expect(stored?.amount).toBe('185.00');
    expect(repo.orders.get(id)?.total).toBe('185.00');
  });

  it('#11 insuficiente (184.99) => 422 CASH_AMOUNT_INSUFFICIENT sin escribir nada (sin evento ni auditoría)', async () => {
    const { repo, paymentsRepo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_A, total: '185.00' });
    const e = await err(pay(admin(), id, { tendered: '184.99' }));
    expect([status(e), resp(e).code]).toEqual([422, 'CASH_AMOUNT_INSUFFICIENT']);
    expect(paymentsRepo.payments.get(id)?.status).toBe('pending');
    expect(paymentsRepo.eventsOf(id).map((x) => x.type)).toEqual(['created']);
    expect(paymentsRepo.audits).toEqual([]);
    expect(paymentsRepo.calls).not.toContain('markPaid');
  });

  it('#14 tope: 5000.00 => ok; 5000.01 => 422 CASH_TENDERED_TOO_LARGE', async () => {
    const { repo, pay } = setup();
    const a = repo.seed({ branchId: BRANCH_A, total: '185.00' });
    const b = repo.seed({ branchId: BRANCH_A, total: '185.00' });
    expect((await pay(admin(), a, { tendered: '5000.00' })).body.payment.reception?.change).toBe(
      '4815.00',
    );
    const e = await err(pay(admin(), b, { tendered: '5000.01' }));
    expect([status(e), resp(e).code]).toEqual([422, 'CASH_TENDERED_TOO_LARGE']);
  });

  it('#12 importes inválidos => 400 PAYMENT_AMOUNT_INVALID sin tocar la BD; casilla ausente/false => 400 PAYMENT_CONFIRMATION_REQUIRED', async () => {
    const { repo, paymentsRepo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_A });
    for (const bad of [
      '-5',
      '0',
      '0.00',
      '',
      'abc',
      '1e2',
      '1,000.00',
      'NaN',
      '200.001',
      200,
      null,
    ]) {
      const e = await err(pay(admin(), id, { tendered: bad }));
      expect([status(e), resp(e).code]).toEqual([400, 'PAYMENT_AMOUNT_INVALID']);
    }
    for (const c of [false, undefined, 'true', 1, null]) {
      const e = await err(pay(admin(), id, { confirmed: c }));
      expect([status(e), resp(e).code]).toEqual([400, 'PAYMENT_CONFIRMATION_REQUIRED']);
    }
    expect(paymentsRepo.calls).toEqual([]); // ni una sentencia
  });

  it('#22 Idempotency-Key ausente o malformada => 400 IDEMPOTENCY_KEY_INVALID', async () => {
    const { repo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_A });
    for (const key of [undefined, '', 'corta', 'x'.repeat(129), 'con espacios y ñ 1234567890abc']) {
      const e = await err(pay(admin(), id, { key }));
      expect([status(e), resp(e).code]).toEqual([400, 'IDEMPOTENCY_KEY_INVALID']);
    }
  });

  it('#27 #29 el empleado es el del JWT y la sucursal la del pedido (nunca la entrada); auditoría payment.cash_received sin PII', async () => {
    const { repo, paymentsRepo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_B, total: '185.00', customerName: 'Cliente Secreto' });
    await pay(scopedStaff(ALL, [BRANCH_B]), id);
    const stored = paymentsRepo.payments.get(id);
    expect(stored?.staffId).toBe(ADMIN_ID);
    expect(stored?.context).toBe('BRANCH');
    expect(paymentsRepo.audits).toHaveLength(1);
    const [audit] = paymentsRepo.audits;
    expect(audit).toMatchObject({
      actorId: ADMIN_ID,
      branchId: BRANCH_B,
      entityType: 'payment',
      entityId: stored?.id,
      action: 'payment.cash_received',
      oldValues: { status: 'pending' },
      newValues: {
        orderId: id,
        status: 'paid',
        amount: '185.00',
        tendered: '200.00',
        change: '15.00',
        context: 'BRANCH',
      },
    });
    const json = JSON.stringify(audit);
    expect(json).not.toContain('Cliente Secreto');
    expect(json).not.toContain(KEY_A);
    expect(json).not.toMatch(/hash/i);
  });

  it('#37 registrar el pago NO cambia orders.status ni updated_at; el estado manda y PAID solo sale de este POST', async () => {
    const { repo, pay } = setup();
    const id = repo.seed({ branchId: BRANCH_A, status: 'preparing' });
    const before = { ...repo.orders.get(id) };
    await pay(admin(), id);
    expect(repo.orders.get(id)?.status).toBe('preparing');
    expect(repo.orders.get(id)?.updatedAt).toEqual(before.updatedAt);
    expect(repo.eventsOf(id)).toHaveLength(1); // ningún evento nuevo de estado
  });

  it('#33 PICKUP: contexto BRANCH; completar el pedido (picked_up) con pago PENDING es válido y no marca PAID', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A, status: 'ready' });
    await h.commands.execute(admin(), 'complete', id, { expectedStatus: 'ready' });
    expect(h.repo.orders.get(id)?.status).toBe('picked_up');
    expect((await h.cashPayments.get(admin(), id)).status).toBe('PENDING');
    const r = await h.pay(admin(), id); // se cobra luego, con el pedido ya entregado (P84/P90)
    expect(r.body.payment).toMatchObject({ status: 'PAID', collectionContext: 'BRANCH' });
  });

  it('#34 DELIVERY OWN: mismo endpoint, contexto OWN_DELIVERY derivado del pedido; mover el pedido no marca PAID', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A, fulfillmentType: 'DELIVERY', status: 'accepted' });
    await h.commands.execute(admin(), 'start_preparing', id, { expectedStatus: 'accepted' });
    expect((await h.cashPayments.get(admin(), id)).status).toBe('PENDING');
    const r = await h.pay(admin(), id);
    expect(r.body.payment.reception?.context).toBe('OWN_DELIVERY');
    expect(r.body.payment.collectionContext).toBe('OWN_DELIVERY');
  });

  it('#36 PedidosYa: registration bloqueada (PROVIDER_BLOCKED_EXTERNAL), collectionContext null y POST 422 sin escribir', async () => {
    const h = setup();
    const id = h.repo.seed({
      branchId: BRANCH_A,
      fulfillmentType: 'DELIVERY',
      deliveryProvider: 'PEDIDOSYA',
    });
    const view = await h.cashPayments.get(admin(), id);
    expect(view).toMatchObject({
      collectionContext: null,
      registration: { allowed: false, blockedReason: 'PROVIDER_BLOCKED_EXTERNAL' },
    });
    const e = await err(h.pay(admin(), id));
    expect([status(e), resp(e).code, resp(e).violations?.[0]?.code]).toEqual([
      422,
      'PAYMENT_NOT_COLLECTABLE',
      'PROVIDER_BLOCKED_EXTERNAL',
    ]);
    expect(h.paymentsRepo.payments.get(id)?.status).toBe('pending');
  });

  it('DELIVERY con deliveryProvider NULL: GET y POST coinciden (registration bloqueada y 422), sin escribir', async () => {
    const h = setup();
    const id = h.repo.seed({
      branchId: BRANCH_A,
      fulfillmentType: 'DELIVERY',
      deliveryProvider: null,
    });
    const view = await h.cashPayments.get(admin(), id);
    expect(view).toMatchObject({
      collectionContext: null,
      registration: { allowed: false, blockedReason: 'PROVIDER_BLOCKED_EXTERNAL' },
    });
    const e = await err(h.pay(admin(), id));
    expect([status(e), resp(e).code, resp(e).violations?.[0]?.code]).toEqual([
      422,
      'PAYMENT_NOT_COLLECTABLE',
      'PROVIDER_BLOCKED_EXTERNAL',
    ]);
    expect(h.paymentsRepo.calls).not.toContain('markPaid');
  });

  it('#61 pedido histórico sin fila de pago: lectura CASH/PENDING, POST 422 LEGACY_PAYMENT_METHOD; sus transiciones F22 siguen', async () => {
    const h = setup();
    const id = h.repo.seed({
      branchId: BRANCH_A,
      paymentStatus: null,
      paymentMethodPreference: 'bank_transfer',
    });
    const view = await h.cashPayments.get(admin(), id);
    expect(view).toMatchObject({
      method: 'CASH',
      status: 'PENDING',
      registration: { allowed: false, blockedReason: 'LEGACY_PAYMENT_METHOD' },
      reception: null,
    });
    const e = await err(h.pay(admin(), id));
    expect([status(e), resp(e).code, resp(e).violations?.[0]?.code]).toEqual([
      422,
      'PAYMENT_NOT_COLLECTABLE',
      'LEGACY_PAYMENT_METHOD',
    ]);
    const moved = await h.commands.execute(admin(), 'accept', id, { expectedStatus: 'pending' });
    expect(moved.order).toMatchObject({
      status: 'accepted',
      paymentMethodPreference: null,
      paymentStatus: 'PENDING',
    });
  });

  it('#62 total 0: AMOUNT_ZERO en la lectura y 422 en el POST', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A, total: '0.00' });
    expect((await h.cashPayments.get(admin(), id)).registration).toEqual({
      allowed: false,
      blockedReason: 'AMOUNT_ZERO',
    });
    const e = await err(h.pay(admin(), id, { tendered: '1.00' }));
    expect([status(e), resp(e).violations?.[0]?.code]).toEqual([422, 'AMOUNT_ZERO']);
  });

  describe('idempotencia y doble pago (#16 #17 #18 #21 #22)', () => {
    it('#18 misma clave y cuerpo => replay con la recepción ORIGINAL (mismo receivedAt, cambio y empleado), sin escribir', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      const first = await h.pay(admin(), id);
      const writes = h.paymentsRepo.calls.filter((c) => c === 'markPaid').length;
      const again = await h.pay(admin(), id);
      expect(again.replayed).toBe(true);
      expect(again.body.replayed).toBe(true);
      expect(again.body.appliedByMe).toBe(true);
      expect(again.body.payment.reception).toEqual(first.body.payment.reception);
      expect(h.paymentsRepo.calls.filter((c) => c === 'markPaid')).toHaveLength(writes);
      expect(h.paymentsRepo.audits).toHaveLength(1);
      expect(h.paymentsRepo.eventsOf(id).filter((e) => e.type === 'cash_received')).toHaveLength(1);
    });

    it('#18 appliedByMe=false para otra persona que repite la misma clave y cuerpo', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), id);
      const again = await h.pay(other(), id);
      expect(again).toMatchObject({ replayed: true, body: { appliedByMe: false } });
    });

    it('#16 doble pago con OTRA clave => 409 PAYMENT_ALREADY_REGISTERED con `current` y sin escribir', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), id);
      const e = await err(h.pay(admin(), id, { key: KEY_B }));
      expect([status(e), resp(e).code]).toEqual([409, 'PAYMENT_ALREADY_REGISTERED']);
      expect(resp(e).extra?.current).toMatchObject({
        orderId: id,
        status: 'PAID',
        outstanding: '0.00',
      });
      expect(h.paymentsRepo.audits).toHaveLength(1);
    });

    it('#22 misma clave con OTRO cuerpo (otro tendered) => 409 IDEMPOTENCY_KEY_REUSED; la misma clave en OTRO pedido es independiente', async () => {
      const h = setup();
      const a = h.repo.seed({ branchId: BRANCH_A });
      const b = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), a);
      const e = await err(h.pay(admin(), a, { tendered: '300.00' }));
      expect([status(e), resp(e).code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(resp(e).extra).toBeUndefined();
      expect((await h.pay(admin(), b)).replayed).toBe(false); // misma KEY_A en otro pedido
    });

    it('`100` y `100.00` son el mismo cuerpo canónico (replay)', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A, total: '50.00' });
      await h.pay(admin(), id, { tendered: '100' });
      expect((await h.pay(admin(), id, { tendered: '100.00' })).replayed).toBe(true);
    });

    it('#17 doble clic: dos POST simultáneos con la MISMA clave => uno 201 y otro replay; UN evento y UNA auditoría', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      const [a, b] = await Promise.all([h.pay(admin(), id), h.pay(admin(), id)]);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(h.paymentsRepo.eventsOf(id).filter((e) => e.type === 'cash_received')).toHaveLength(1);
      expect(h.paymentsRepo.audits).toHaveLength(1);
    });

    it('carrera con claves distintas: exactamente 1 gana (201) y el resto 409 PAYMENT_ALREADY_REGISTERED', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      const keys = Array.from({ length: 8 }, (_, i) => `k${i}-abcdefghijklmnopqrstuvwxyz`);
      const results = await Promise.all(keys.map((key) => err(h.pay(admin(), id, { key }))));
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r !== null).map((r) => resp(r).code)).toEqual(
        Array(7).fill('PAYMENT_ALREADY_REGISTERED'),
      );
      expect(h.paymentsRepo.eventsOf(id).filter((e) => e.type === 'cash_received')).toHaveLength(1);
    });

    it('#21 respuesta perdida: se confirma pero el cliente reintenta con la misma clave => 200 replay y NO cobra otra vez', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), id); // la respuesta "se pierde"
      const retry = await h.pay(admin(), id);
      expect(retry.replayed).toBe(true);
      expect(h.paymentsRepo.audits).toHaveLength(1);
    });

    it('#20 idempotencia persistente: una instancia NUEVA del servicio (reinicio) sigue respondiendo replay', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), id);
      const { CashPaymentsService } = await import('./cash-payments.service.js');
      const fresh = new CashPaymentsService(
        h.paymentsRepo.asRepository(),
        h.authorization,
        h.clock,
        h.gate,
      );
      expect((await fresh.register(admin(), id, KEY_A, body('200.00', true))).replayed).toBe(true);
    });

    it('solo se guardan hashes sha256 (32 bytes): nunca la clave en claro', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), id);
      const stored = h.paymentsRepo.payments.get(id);
      expect(stored?.keyHash).toHaveLength(32);
      expect(stored?.requestHash).toHaveLength(32);
      expect(JSON.stringify(h.paymentsRepo.audits)).not.toContain(KEY_A);
    });
  });

  describe('autorización y anti-IDOR (#23 #25 #26)', () => {
    it('#25 con orders.read pero sin payments.confirm en SU sucursal => 403 PAYMENT_ACTION_FORBIDDEN (sin escribir)', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      const e = await err(h.pay(readerAt(BRANCH_A), id));
      expect([status(e), resp(e).code]).toEqual([403, 'PAYMENT_ACTION_FORBIDDEN']);
      expect(h.paymentsRepo.calls).not.toContain('markPaid');
    });

    it('#25 payments.confirm en OTRA sucursal solamente => 403 (no basta la unión plana)', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      const staff = scopedStaff(['orders.read'], [BRANCH_A]);
      staff.grants['payments.confirm'] = { allBranches: false, branchIds: [BRANCH_B] };
      const e = await err(h.pay(staff, id));
      expect(resp(e).code).toBe('PAYMENT_ACTION_FORBIDDEN');
    });

    it('#25 sin orders.read en la sucursal del pedido => 404 (no ve el pedido), aunque tenga payments.confirm', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_B });
      const e = await err(h.pay(confirmOnly(BRANCH_A), id));
      expect([status(e), resp(e).code]).toEqual([404, 'ORDER_NOT_FOUND']);
    });

    it('#26 inexistente y otra sucursal => el MISMO 404 con el MISMO número de sentencias en las tres operaciones', async () => {
      const h = setup();
      const foreign = h.repo.seed({ branchId: BRANCH_B });
      const missing = 'c0000000-0000-4000-8000-0000000000ff';
      const staff = cashierAt(BRANCH_A);
      const run = async (op: (id: string) => Promise<unknown>, id: string) => {
        h.paymentsRepo.calls.length = 0;
        const e = await err(op(id));
        return { status: status(e), body: resp(e), calls: [...h.paymentsRepo.calls] };
      };
      for (const op of [
        (id: string) => h.cashPayments.get(staff, id),
        (id: string) => h.cashPayments.history(staff, id),
        (id: string) => h.pay(staff, id),
      ]) {
        const a = await run(op, foreign);
        const b = await run(op, missing);
        expect(a).toEqual(b);
        expect(a.status).toBe(404);
        expect(a.body.code).toBe('ORDER_NOT_FOUND');
      }
    });

    it('alcance global funciona y la lectura exige el alcance de payments.read (no de orders.read)', async () => {
      const h = setup();
      const a = h.repo.seed({ branchId: BRANCH_A });
      const b = h.repo.seed({ branchId: BRANCH_B });
      const staff = scopedStaff(['orders.read', 'payments.read'], [BRANCH_A]);
      staff.grants['orders.read'] = { allBranches: true, branchIds: [] };
      expect((await h.cashPayments.get(staff, a)).orderId).toBe(a);
      expect(resp(await err(h.cashPayments.get(staff, b))).code).toBe('ORDER_NOT_FOUND');
      expect((await h.pay(admin(), b)).replayed).toBe(false);
    });

    it('#23 registration.blockedReason = NO_PERMISSION para quien solo lee; PEDIDO cobrable para quien confirma', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      expect((await h.cashPayments.get(readerAt(BRANCH_A), id)).registration).toEqual({
        allowed: false,
        blockedReason: 'NO_PERMISSION',
      });
      expect((await h.cashPayments.get(cashierAt(BRANCH_A), id)).registration).toEqual({
        allowed: true,
        blockedReason: null,
      });
    });
  });

  describe('cancelado/rechazado (#38 #39)', () => {
    it.each(['rejected', 'cancelled'])(
      '#38 pedido %s SIN pago: 409 ORDER_NOT_PAYABLE; sigue PENDING; sin refundReview ni pendingActions',
      async (st) => {
        const h = setup();
        const id = h.repo.seed({ branchId: BRANCH_A, status: st });
        const e = await err(h.pay(admin(), id));
        expect([status(e), resp(e).code]).toEqual([409, 'ORDER_NOT_PAYABLE']);
        expect(resp(e).extra?.current).toMatchObject({
          status: 'PENDING',
          possibleRefundReview: false,
        });
        expect(h.paymentsRepo.payments.get(id)?.status).toBe('pending');
        expect(h.paymentsRepo.audits).toEqual([]);
      },
    );

    it('#39 pagado y LUEGO cancelado/rechazado: sigue PAID, possibleRefundReview=true y pendingActions=[payment_review] (lectura real)', async () => {
      const h = setup();
      const a = h.repo.seed({ branchId: BRANCH_A });
      const b = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), a);
      await h.pay(admin(), b);
      const cancelled = await h.commands.execute(admin(), 'cancel', a, {
        expectedStatus: 'pending',
        reason: 'Cliente se arrepintió',
      });
      const rejected = await h.commands.execute(admin(), 'reject', b, {
        expectedStatus: 'pending',
        reason: 'Sin stock',
      });
      expect(cancelled.pendingActions).toEqual(['payment_review']);
      expect(rejected.pendingActions).toEqual(['payment_review']);
      const view = await h.cashPayments.get(admin(), a);
      expect(view).toMatchObject({
        status: 'PAID',
        possibleRefundReview: true,
        orderStatus: 'cancelled',
      });
      expect(view.registration).toEqual({ allowed: false, blockedReason: 'ALREADY_PAID' });
    });

    it('un replay de un pedido pagado y luego cancelado sigue siendo replay (no 409 ORDER_NOT_PAYABLE)', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      await h.pay(admin(), id);
      await h.commands.execute(admin(), 'cancel', id, {
        expectedStatus: 'pending',
        reason: 'Motivo cualquiera',
      });
      expect((await h.pay(admin(), id)).replayed).toBe(true);
    });

    it('el bloqueo FOR SHARE del pedido viaja al repositorio: markPaid recibe el orderId del pedido', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      const spy = vi.spyOn(h.paymentsRepo, 'transaction');
      await h.pay(admin(), id);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(h.paymentsRepo.lastMarkInput?.orderId).toBe(id);
    });

    it('cancelar ANTES de cobrar gana la carrera: el cobro recibe 409 ORDER_NOT_PAYABLE', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.beforeMark = async () => {
        await h.commands.execute(admin(), 'cancel', id, {
          expectedStatus: 'pending',
          reason: 'Motivo cualquiera',
        });
      };
      const e = await err(h.pay(admin(), id));
      expect([status(e), resp(e).code]).toEqual([409, 'ORDER_NOT_PAYABLE']);
      expect(h.paymentsRepo.payments.get(id)?.status).toBe('pending');
    });
  });

  describe('atomicidad (#32) y gate', () => {
    it('#32 si falla la auditoría revierte TODO: pago pending, sin evento ni auditoría', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.failAudit = true;
      const e = await err(h.pay(admin(), id));
      expect(e).toBeInstanceOf(Error);
      expect(h.paymentsRepo.payments.get(id)?.status).toBe('pending');
      expect(h.paymentsRepo.eventsOf(id).map((x) => x.type)).toEqual(['created']);
      expect(h.paymentsRepo.audits).toEqual([]);
      expect(h.repo.orders.get(id)?.paymentStatus).toBe('pending');
    });

    it('#32 si falla el INSERT del evento (markPaid) no queda pago ni auditoría y no hay éxito falso', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.failMarkPaid = true;
      expect(await err(h.pay(admin(), id))).toBeInstanceOf(Error);
      expect(h.paymentsRepo.payments.get(id)?.status).toBe('pending');
      expect(h.paymentsRepo.audits).toEqual([]);
    });

    it('lock_timeout / saturación => 503 ORDERS_BUSY (reintentable con la misma clave)', async () => {
      const h = setup();
      const id = h.repo.seed({ branchId: BRANCH_A });
      h.paymentsRepo.failWith = { code: '55P03' };
      const e = await err(h.pay(admin(), id));
      expect([status(e), resp(e).code]).toEqual([503, 'ORDERS_BUSY']);
      h.paymentsRepo.failWith = null;
      expect((await h.pay(admin(), id)).replayed).toBe(false); // mismo intento, ahora sí
    });

    it('#59 gate saturado: las lecturas se rechazan con 2 esperas (503) y se libera el cupo', async () => {
      const gate = new DbGate(1, 8, 5_000, ordersBusy);
      const h = adminOrdersHarness({ gate });
      const { CashPaymentsService } = await import('./cash-payments.service.js');
      const { FakePaymentsRepo } = await import('../../../test/support/fake-payments-repo.js');
      const pr = new FakePaymentsRepo(h.repo);
      const svc = new CashPaymentsService(pr.asRepository(), h.authorization, h.clock, gate);
      const id = h.repo.seed({ branchId: BRANCH_A });
      let release!: () => void;
      const hold = gate.run(() => new Promise<void>((r) => (release = r)));
      const queued = [gate.run(() => Promise.resolve()), gate.run(() => Promise.resolve())];
      const e = await err(svc.get(admin(), id));
      expect(resp(e).code).toBe('ORDERS_BUSY');
      release();
      await Promise.all([hold, ...queued]);
      expect((await svc.get(admin(), id)).orderId).toBe(id);
    });
  });

  it('#53 presupuesto de sentencias: registro 3 (replay 1); get 1; history 1', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A });
    const count = async (fn: () => Promise<unknown>) => {
      h.paymentsRepo.calls.length = 0;
      await fn();
      return h.paymentsRepo.calls.filter((c) => !['transaction'].includes(c)).length;
    };
    expect(await count(() => h.pay(admin(), id))).toBe(3); // read + markPaid + audit
    expect(await count(() => h.pay(admin(), id))).toBe(1); // replay: solo la lectura
    expect(await count(() => h.cashPayments.get(admin(), id))).toBe(1);
    expect(await count(() => h.cashPayments.history(admin(), id))).toBe(1);
  });
});

describe('CashPaymentsService.get / history (#8 #28 #30)', () => {
  it('#8 devuelve pedido, total, GTQ, CASH, estado, pendiente, contexto y registration; con PAID la recepción', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A, total: '185.00', fulfillmentType: 'DELIVERY' });
    const pending = await h.cashPayments.get(admin(), id);
    expect(pending).toMatchObject({
      orderId: id,
      method: 'CASH',
      status: 'PENDING',
      amountDue: '185.00',
      outstanding: '185.00',
      paidAt: null,
      currency: 'GTQ',
      fulfillmentType: 'DELIVERY',
      deliveryProvider: 'OWN',
      collectionContext: 'OWN_DELIVERY',
      branchId: BRANCH_A,
      reception: null,
      possibleRefundReview: false,
      registration: { allowed: true, blockedReason: null },
      generatedAt: NOW.toISOString(),
    });
    await h.pay(admin(), id);
    const paid = await h.cashPayments.get(admin(), id);
    expect(paid.reception).toMatchObject({
      amountApplied: '185.00',
      tendered: '200.00',
      change: '15.00',
      collectorName: 'Ana Admin',
      context: 'OWN_DELIVERY',
      branchId: BRANCH_A,
    });
    expect(paid.paidAt).toBe(paid.reception?.receivedAt);
  });

  it('#30 historial: CREATED y CASH_RECEIVED en orden, con nombre del actor y montos; sin ids de empleado ni hashes', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A });
    expect((await h.cashPayments.history(admin(), id)).items.map((e) => e.type)).toEqual([
      'CREATED',
    ]);
    await h.pay(admin(), id);
    const history = await h.cashPayments.history(admin(), id);
    expect(history.items).toEqual([
      {
        seq: 1,
        type: 'CREATED',
        at: expect.any(String) as string,
        actorName: null,
        amountDue: '185.00',
        tendered: null,
        change: null,
      },
      {
        seq: 2,
        type: 'CASH_RECEIVED',
        at: expect.any(String) as string,
        actorName: 'Ana Admin',
        amountDue: '185.00',
        tendered: '200.00',
        change: '15.00',
      },
    ]);
    const json = JSON.stringify(history);
    expect(json).not.toContain(ADMIN_ID);
    expect(json).not.toMatch(/hash|staffId/i);
  });

  it('un pedido histórico sin pago tiene historial vacío (no 404)', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A, paymentStatus: null });
    expect((await h.cashPayments.history(admin(), id)).items).toEqual([]);
  });

  it('la lectura no expone empleado en el pago PENDING ni claves internas (barrido de claves)', async () => {
    const h = setup();
    const id = h.repo.seed({ branchId: BRANCH_A });
    await h.pay(admin(), id);
    const json = JSON.stringify(await h.cashPayments.get(admin(), id));
    expect(json).not.toMatch(
      /receivedByStaffId|confirmKeyHash|confirmRequestHash|staffId|keyHash/i,
    );
    expect(json).not.toContain(ADMIN_ID);
  });
});
