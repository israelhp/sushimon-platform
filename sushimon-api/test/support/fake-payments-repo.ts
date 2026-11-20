import type { AuditEventInput } from '../../src/audit/audit.service.js';
import { PaymentsRepository } from '../../src/orders/payments/payments.repository.js';
import type {
  MarkPaidInput,
  PaymentEventRow,
  PaymentHistoryRecord,
  PaymentOrderView,
  PaymentRow,
  PaymentsTx,
} from '../../src/orders/payments/payments.types.js';
import type { FakeAdminOrdersRepo } from './fake-admin-orders-repo.js';

export interface FakePayment {
  id: string;
  orderId: string;
  status: 'pending' | 'paid';
  amount: string;
  tendered: string | null;
  change: string | null;
  receivedAt: Date | null;
  context: string | null;
  staffId: string | null;
  collectorName: string | null;
  keyHash: Buffer | null;
  requestHash: Buffer | null;
}

export interface FakePaymentEvent {
  id: string;
  orderId: string;
  type: 'created' | 'cash_received';
  at: Date;
  actorStaffId: string | null;
  amount: string;
  tendered: string | null;
  change: string | null;
}

const cents = (v: string): number => Math.round(Number(v) * 100);
const money = (c: number): string => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

/**
 * Repositorio de pagos EN MEMORIA con la semántica observable del real, sobre los pedidos de `FakeAdminOrdersRepo`
 * (comparten el mapa de pedidos: así F22 y F24 ven el mismo estado). Lecturas sin candado; `markPaid` toma un candado de fila
 * (el 2.º registro ESPERA al 1.º y reevalúa `status = 'pending'`); las escrituras quedan en cola hasta el COMMIT (si algo falla
 * no queda nada: ni pago, ni evento, ni auditoría). NUNCA toca `orders.status` ni `updated_at` (solo el espejo `paymentStatus`).
 */
export class FakePaymentsRepo {
  payments = new Map<string, FakePayment>();
  events: FakePaymentEvent[] = [];
  audits: AuditEventInput[] = [];
  calls: string[] = [];
  /** Hace fallar `audit` (rollback completo). */
  failAudit = false;
  /** Hace fallar `markPaid` DESPUÉS de tomar el candado (p. ej. el INSERT del evento). */
  failMarkPaid = false;
  /** Gancho entre la lectura 1 y `markPaid` (forzar intercalados). */
  beforeMark: (() => Promise<void>) | null = null;
  /** Error crudo de BD que lanza la transacción (p. ej. `lock_timeout`). */
  failWith: unknown = null;
  /** Último `MarkPaidInput` recibido (verifica que el pedido a bloquear viaja al repositorio). */
  lastMarkInput: MarkPaidInput | null = null;
  private lock: Promise<void> = Promise.resolve();
  private tick = Date.parse('2026-11-18T19:00:00.000Z');
  private seq = 0;

  constructor(readonly orders: FakeAdminOrdersRepo) {}

  asRepository = (): PaymentsRepository => this as unknown as PaymentsRepository;
  private now = (): Date => new Date((this.tick += 1));
  private nextId = (prefix: string): string =>
    `${prefix}0000000-0000-4000-8000-${String((this.seq += 1)).padStart(12, '0')}`;

  /** Crea (si falta) el pago `pending` del pedido y su evento `created`; los pedidos históricos (`paymentStatus: null`) no tienen. */
  private ensure(orderId: string): FakePayment | null {
    const existing = this.payments.get(orderId);
    if (existing) return existing;
    const order = this.orders.orders.get(orderId);
    if (!order || order.paymentStatus === null) return null;
    const payment: FakePayment = {
      id: this.nextId('d'),
      orderId,
      status: 'pending',
      amount: order.total,
      tendered: null,
      change: null,
      receivedAt: null,
      context: null,
      staffId: null,
      collectorName: null,
      keyHash: null,
      requestHash: null,
    };
    this.payments.set(orderId, payment);
    this.events.push({
      id: this.nextId('e'),
      orderId,
      type: 'created',
      at: order.placedAt,
      actorStaffId: null,
      amount: order.total,
      tendered: null,
      change: null,
    });
    if (order.paymentStatus === 'paid') {
      // Pago sembrado como pagado: recepción completa y coherente (tendered = total salvo que se indique otra cosa).
      Object.assign(payment, {
        status: 'paid',
        tendered: order.total,
        change: '0.00',
        receivedAt: order.paymentPaidAt ?? this.now(),
        context: order.fulfillmentType === 'PICKUP' ? 'BRANCH' : 'OWN_DELIVERY',
        staffId: 'ffffffff-0000-4000-8000-0000000000aa',
        collectorName: 'Cajera Previa',
        keyHash: Buffer.alloc(32, 7),
        requestHash: Buffer.alloc(32, 9),
      } satisfies Partial<FakePayment>);
    }
    return payment;
  }

  /** Marca como pagado un pedido sembrado (sin pasar por el servicio): recepción completa. */
  seedPaid(
    orderId: string,
    over: Partial<
      Pick<FakePayment, 'tendered' | 'staffId' | 'collectorName' | 'keyHash' | 'requestHash'>
    > = {},
  ): FakePayment {
    const order = this.orders.orders.get(orderId);
    if (!order) throw new Error('pedido inexistente');
    order.paymentStatus = 'pending';
    const p = this.ensure(orderId) as FakePayment;
    const tendered = over.tendered ?? order.total;
    const receivedAt = this.now();
    Object.assign(p, {
      status: 'paid',
      tendered,
      change: money(cents(tendered) - cents(p.amount)),
      receivedAt,
      context: order.fulfillmentType === 'PICKUP' ? 'BRANCH' : 'OWN_DELIVERY',
      staffId: over.staffId ?? 'ffffffff-0000-4000-8000-0000000000aa',
      collectorName: over.collectorName ?? 'Cajera Previa',
      keyHash: over.keyHash ?? Buffer.alloc(32, 7),
      requestHash: over.requestHash ?? Buffer.alloc(32, 9),
    } satisfies Partial<FakePayment>);
    order.paymentStatus = 'paid';
    order.paymentPaidAt = receivedAt;
    this.events.push({
      id: this.nextId('e'),
      orderId,
      type: 'cash_received',
      at: receivedAt,
      actorStaffId: p.staffId,
      amount: p.amount,
      tendered,
      change: p.change,
    });
    return p;
  }

  eventsOf(orderId: string): FakePaymentEvent[] {
    return this.events.filter((e) => e.orderId === orderId);
  }

  private view(orderId: string, branchIds: string[] | null): PaymentOrderView | null {
    const o = this.orders.orders.get(orderId);
    if (!o || (branchIds !== null && !branchIds.includes(o.branchId))) return null;
    const p = this.ensure(orderId);
    const payment: PaymentRow | null = p
      ? {
          id: p.id,
          status: p.status,
          amount: p.amount,
          tendered: p.tendered,
          change: p.change,
          receivedAt: p.receivedAt,
          collectionContext: p.context,
          receivedByStaffId: p.staffId,
          collectorName: p.collectorName,
          confirmKeyHash: p.keyHash,
          confirmRequestHash: p.requestHash,
        }
      : null;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      orderStatus: o.status,
      branchId: o.branchId,
      fulfillmentType: o.fulfillmentType,
      deliveryProvider: o.deliveryProvider,
      total: o.total,
      payment,
    };
  }

  // ---------- lecturas ----------

  findForStaff(orderId: string, branchIds: string[] | null): Promise<PaymentOrderView | null> {
    this.calls.push('findForStaff');
    if (branchIds !== null && branchIds.length === 0) return Promise.resolve(null);
    return Promise.resolve(this.view(orderId, branchIds));
  }

  findHistory(orderId: string, branchIds: string[] | null): Promise<PaymentHistoryRecord | null> {
    this.calls.push('findHistory');
    const o = this.orders.orders.get(orderId);
    if (!o || (branchIds !== null && !branchIds.includes(o.branchId))) return Promise.resolve(null);
    this.ensure(orderId);
    const events: PaymentEventRow[] = this.eventsOf(orderId)
      .slice()
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((e) => ({
        id: e.id,
        type: e.type,
        at: e.at,
        actorName: e.actorStaffId
          ? (this.orders.staffNames.get(e.actorStaffId) ?? 'Empleado')
          : null,
        amount: e.amount,
        tendered: e.tendered,
        change: e.change,
      }));
    return Promise.resolve({ orderId, orderNumber: o.orderNumber, events });
  }

  hasPaidOnClosedOrder(orderId: string): Promise<boolean> {
    this.calls.push('hasPaidOnClosedOrder');
    const o = this.orders.orders.get(orderId);
    const p = this.payments.get(orderId);
    return Promise.resolve(
      !!o && !!p && p.status === 'paid' && ['rejected', 'cancelled'].includes(o.status),
    );
  }

  // ---------- transacción ----------

  async transaction<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- simula el error crudo del driver
    if (this.failWith) throw this.failWith;
    const staged = {
      paid: [] as { orderId: string; input: MarkPaidInput; receivedAt: Date; change: string }[],
      audits: [] as AuditEventInput[],
    };
    let release: (() => void) | null = null;
    const tx: PaymentsTx = {
      read: (orderId, branchIds) => {
        this.calls.push('read');
        if (branchIds !== null && branchIds.length === 0) return Promise.resolve(null);
        return Promise.resolve(this.view(orderId, branchIds));
      },
      markPaid: async (input) => {
        this.calls.push('markPaid');
        this.lastMarkInput = input;
        if (this.beforeMark) await this.beforeMark();
        // candado de fila: espera a que la transacción anterior confirme o revierta
        const previous = this.lock;
        let done!: () => void;
        this.lock = new Promise<void>((resolve) => (done = resolve));
        release = done;
        await previous;
        const p = [...this.payments.values()].find((x) => x.id === input.paymentId);
        const o = p ? this.orders.orders.get(p.orderId) : undefined;
        if (!p || !o || p.status !== 'pending' || ['rejected', 'cancelled'].includes(o.status)) {
          return null;
        }
        if (this.failMarkPaid) throw new Error('fallo al insertar el evento');
        const receivedAt = this.now();
        const change = money(cents(input.tendered) - cents(p.amount));
        staged.paid.push({ orderId: p.orderId, input, receivedAt, change });
        return { receivedAt, change };
      },
      audit: (event) => {
        this.calls.push('audit');
        if (this.failAudit) return Promise.reject(new Error('fallo de auditoría'));
        staged.audits.push(event);
        return Promise.resolve();
      },
    };
    try {
      const result = await fn(tx);
      // COMMIT: todo o nada (solo el pago y su evento; `orders.status`/`updated_at` NO se tocan)
      for (const s of staged.paid) {
        const p = this.payments.get(s.orderId) as FakePayment;
        const o = this.orders.orders.get(s.orderId);
        const staff = this.orders.staffNames.get(s.input.staffId) ?? 'Empleado';
        Object.assign(p, {
          status: 'paid',
          tendered: s.input.tendered,
          change: s.change,
          receivedAt: s.receivedAt,
          context: s.input.context,
          staffId: s.input.staffId,
          collectorName: staff,
          keyHash: s.input.keyHash,
          requestHash: s.input.requestHash,
        } satisfies Partial<FakePayment>);
        if (o) {
          o.paymentStatus = 'paid';
          o.paymentPaidAt = s.receivedAt;
        }
        this.events.push({
          id: this.nextId('e'),
          orderId: s.orderId,
          type: 'cash_received',
          at: s.receivedAt,
          actorStaffId: s.input.staffId,
          amount: p.amount,
          tendered: s.input.tendered,
          change: s.change,
        });
      }
      this.audits.push(...staged.audits);
      return result;
    } finally {
      (release as (() => void) | null)?.();
    }
  }
}
