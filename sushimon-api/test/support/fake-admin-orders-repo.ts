import type { AuditEventInput } from '../../src/audit/audit.service.js';
import type { AdminOrdersRepository } from '../../src/orders/admin/admin-orders.repository.js';
import type {
  AdminHistoryRow,
  AdminOrderDetailRecord,
  AdminOrderListRow,
  AdminOrderRow,
  BoardCounts,
  ListFilter,
  TransitionState,
  TransitionTx,
} from '../../src/orders/admin/admin-orders.types.js';
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
} from '../../src/orders/admin/order-transition.matrix.js';
import type { OrderRecord } from '../../src/orders/orders.types.js';

const dec = (value: string) => ({ toFixed: () => value });

export interface FakeHistoryEvent {
  orderId: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string | null;
  reason: string | null;
  changedAt: Date;
}

export interface SeedOrder {
  id?: string;
  branchId: string;
  branchName?: string;
  status?: string;
  fulfillmentType?: 'PICKUP' | 'DELIVERY';
  deliveryProvider?: 'OWN' | 'PEDIDOSYA' | null;
  paymentMethodPreference?: 'cash' | 'bank_transfer' | null;
  /** F24: estado del pago (`null` = pedido histórico sin fila de pago). Por defecto `pending`. */
  paymentStatus?: 'pending' | 'paid' | null;
  paymentPaidAt?: Date | null;
  customerName?: string;
  customerPhone?: string;
  notes?: string | null;
  placedAt?: Date;
  total?: string;
  itemCount?: number;
}

let seq = 0;
export const orderId = (n: number): string =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Repositorio de gestión de pedidos EN MEMORIA con la semántica observable del real: lecturas sin candado, `casAndRecord` con
 * candado de fila (la 2.ª transacción ESPERA a que la 1.ª confirme y reevalúa `status = expected`), escrituras en cola hasta
 * el COMMIT (si algo falla no queda nada: ni estado, ni historial, ni auditoría).
 */
export class FakeAdminOrdersRepo {
  orders = new Map<string, AdminOrderRow & { customerPhone: string; notes: string | null }>();
  history: FakeHistoryEvent[] = [];
  audits: AuditEventInput[] = [];
  staffNames = new Map<string, string>();
  knownBranches = new Set<string>();
  calls: string[] = [];
  /** Hace fallar `audit` (rollback completo). */
  failAudit = false;
  /** Gancho entre la lectura 1 y el CAS (para forzar intercalados). */
  beforeCas: (() => Promise<void>) | null = null;
  /** Error crudo de BD que lanza la transacción (p. ej. `lock_timeout`). */
  failWith: unknown = null;
  /** Error crudo de BD que lanza `list` (p. ej. 22008 de un cursor fuera de rango). */
  listFailWith: unknown = null;
  private lock: Promise<void> = Promise.resolve();
  private tick = Date.parse('2026-11-18T18:00:00.000Z');

  asRepository = (): AdminOrdersRepository => this as unknown as AdminOrdersRepository;
  now = (): Date => new Date((this.tick += 1));

  seed(o: SeedOrder): string {
    seq += 1;
    const id = o.id ?? orderId(seq);
    const placedAt = o.placedAt ?? this.now();
    const status = o.status ?? 'pending';
    this.knownBranches.add(o.branchId);
    this.orders.set(id, {
      id,
      orderNumber: BigInt(1000 + seq),
      status,
      branchId: o.branchId,
      branchName: o.branchName ?? `Sucursal ${o.branchId.slice(0, 4)}`,
      fulfillmentType: o.fulfillmentType ?? 'PICKUP',
      deliveryProvider:
        o.fulfillmentType === 'DELIVERY'
          ? o.deliveryProvider === undefined
            ? 'OWN'
            : o.deliveryProvider
          : null,
      customerName: o.customerName ?? 'Ana Pérez',
      itemCount: o.itemCount ?? 3,
      total: o.total ?? '185.00',
      paymentMethodPreference: o.paymentMethodPreference ?? null,
      paymentStatus: o.paymentStatus === undefined ? 'pending' : o.paymentStatus,
      paymentPaidAt: o.paymentPaidAt ?? null,
      scheduledFor: null,
      placedAt,
      updatedAt: placedAt,
      customerPhone: o.customerPhone ?? '+50255551234',
      notes: o.notes ?? null,
    });
    this.history.push({
      orderId: id,
      oldStatus: null,
      newStatus: 'pending',
      changedBy: null,
      reason: null,
      changedAt: placedAt,
    });
    return id;
  }

  eventsOf(id: string): FakeHistoryEvent[] {
    return this.history.filter((h) => h.orderId === id);
  }

  private rowOf(id: string): AdminOrderRow | null {
    const o = this.orders.get(id);
    if (!o) return null;
    const { customerPhone: _p, notes: _n, ...row } = o;
    void _p;
    void _n;
    return { ...row };
  }

  private inScope(branchIds: string[] | null, o: AdminOrderRow): boolean {
    return branchIds === null || branchIds.includes(o.branchId);
  }

  // ---------- lecturas ----------

  branchExists(branchId: string): Promise<boolean> {
    this.calls.push('branchExists');
    return Promise.resolve(this.knownBranches.has(branchId));
  }

  private key = (d: Date) => d.toISOString().replace('Z', '000Z');

  list(filter: ListFilter): Promise<AdminOrderListRow[]> {
    this.calls.push('list');
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- simula el error crudo del driver
    if (this.listFailWith) return Promise.reject(this.listFailWith);
    const rows = [...this.orders.values()]
      .filter((o) => this.inScope(filter.branchIds, o))
      .filter((o) => o.placedAt >= filter.from && (!filter.to || o.placedAt <= filter.to))
      .filter((o) => !filter.status || filter.status.includes(o.status))
      .filter((o) => !filter.fulfillmentType || o.fulfillmentType === filter.fulfillmentType)
      .filter((o) => filter.orderNumber === null || o.orderNumber === filter.orderNumber)
      .filter(
        (o) =>
          filter.nameContains === null ||
          o.customerName.toLowerCase().includes(filter.nameContains.toLowerCase()),
      )
      .map((o) => ({ row: this.rowOf(o.id) as AdminOrderRow, key: this.key(o.placedAt) }))
      .sort((a, b) => (a.key === b.key ? (a.row.id < b.row.id ? 1 : -1) : a.key < b.key ? 1 : -1))
      .filter(
        (r) =>
          !filter.cursor ||
          r.key < filter.cursor.placedAtKey ||
          (r.key === filter.cursor.placedAtKey && r.row.id < filter.cursor.id),
      )
      .slice(0, filter.limit + 1)
      .map((r) => ({ ...r.row, placedAtKey: r.key }));
    return Promise.resolve(rows);
  }

  boardCounts(branchIds: string[] | null, terminalSince: Date): Promise<BoardCounts[]> {
    this.calls.push('boardCounts');
    const out = new Map<string, BoardCounts>();
    for (const o of this.orders.values()) {
      if (!this.inScope(branchIds, o)) continue;
      const active = (ACTIVE_STATUSES as readonly string[]).includes(o.status);
      if (!active && o.placedAt < terminalSince) continue;
      const c = out.get(o.status) ?? { status: o.status, count: 0, oldest: null };
      c.count += 1;
      if (!c.oldest || o.placedAt < c.oldest) c.oldest = o.placedAt;
      out.set(o.status, c);
    }
    return Promise.resolve([...out.values()]);
  }

  boardCards(
    branchIds: string[] | null,
    terminalSince: Date,
    activeLimit: number,
  ): Promise<AdminOrderRow[]> {
    this.calls.push('boardCards');
    const rows: AdminOrderRow[] = [];
    for (const status of ACTIVE_STATUSES) {
      rows.push(
        ...[...this.orders.values()]
          .filter((o) => o.status === status && this.inScope(branchIds, o))
          .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime())
          .slice(0, activeLimit)
          .map((o) => this.rowOf(o.id) as AdminOrderRow),
      );
    }
    for (const status of TERMINAL_STATUSES) {
      rows.push(
        ...[...this.orders.values()]
          .filter(
            (o) => o.status === status && this.inScope(branchIds, o) && o.placedAt >= terminalSince,
          )
          .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
          .slice(0, 10)
          .map((o) => this.rowOf(o.id) as AdminOrderRow),
      );
    }
    return Promise.resolve(rows);
  }

  findDetail(id: string, branchIds: string[] | null): Promise<AdminOrderDetailRecord | null> {
    this.calls.push('findDetail');
    const o = this.orders.get(id);
    if (!o || !this.inScope(branchIds, o)) return Promise.resolve(null);
    const row = this.rowOf(id) as AdminOrderRow;
    const record: OrderRecord = {
      id,
      orderNumber: o.orderNumber,
      customerId: null,
      branchId: o.branchId,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      fulfillmentType: o.fulfillmentType,
      deliveryProvider: o.deliveryProvider,
      notes: o.notes,
      status: o.status,
      subtotal: dec('170.00'),
      extrasTotal: dec('15.00'),
      discountTotal: dec('0.00'),
      deliveryFee: dec(o.fulfillmentType === 'DELIVERY' ? '0.00' : '0.00'),
      total: dec(o.total),
      paymentMethodPreference: o.paymentMethodPreference,
      placedAt: o.placedAt,
      updatedAt: o.updatedAt,
      address:
        o.fulfillmentType === 'DELIVERY'
          ? {
              municipalityName: 'Guatemala',
              zone: 'Zona 10',
              addressLine: '5a Av 10-10',
              referenceNote: null,
            }
          : null,
      items: [
        {
          lineNo: 1,
          productName: 'Roll Mon',
          quantity: o.itemCount,
          unitPrice: dec('50.00'),
          extrasPerUnit: dec('5.00'),
          lineDiscount: dec('0.00'),
          notes: null,
          modifiers: [{ modifierName: 'Extra aguacate', unitExtraPrice: dec('5.00') }],
        },
      ],
      promotions: [],
    };
    const events = this.eventsOf(id)
      .slice()
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const truncated = events.length > 50;
    const shown: AdminHistoryRow[] = events.slice(-50).map((e) => ({
      oldStatus: e.oldStatus,
      newStatus: e.newStatus,
      changedAt: e.changedAt,
      reason: e.reason,
      actorName: e.changedBy ? (this.staffNames.get(e.changedBy) ?? null) : null,
    }));
    return Promise.resolve({ row, record, history: shown, historyTruncated: truncated });
  }

  /** F28: estado vigente del pedido para el `current` del 409 `ORDER_HAS_ACTIVE_DELIVERY`. */
  currentOf(id: string): Promise<{ status: string; updatedAt: Date } | null> {
    this.calls.push('currentOf');
    const o = this.orders.get(id);
    return Promise.resolve(o ? { status: o.status, updatedAt: o.updatedAt } : null);
  }

  // ---------- transacciones ----------

  async transaction<T>(fn: (tx: TransitionTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- simula el error crudo del driver
    if (this.failWith) throw this.failWith;
    const staged = {
      updates: [] as { id: string; status: string; at: Date }[],
      events: [] as FakeHistoryEvent[],
      audits: [] as AuditEventInput[],
    };
    let release: (() => void) | null = null;
    const tx: TransitionTx = {
      readOrder: (id) => {
        this.calls.push('readOrder');
        return Promise.resolve(this.rowOf(id));
      },
      casAndRecord: async ({ orderId: id, expected, to, changedBy, reason }) => {
        this.calls.push('casAndRecord');
        if (this.beforeCas) await this.beforeCas();
        // candado de fila: espera a que la transacción anterior confirme o revierta
        const previous = this.lock;
        let done!: () => void;
        this.lock = new Promise<void>((resolve) => (done = resolve));
        release = done;
        await previous;
        const o = this.orders.get(id);
        if (!o || o.status !== expected) return null;
        const at = this.now();
        staged.updates.push({ id, status: to, at });
        staged.events.push({
          orderId: id,
          oldStatus: expected,
          newStatus: to,
          changedBy,
          reason,
          changedAt: at,
        });
        return at;
      },
      readState: (id): Promise<TransitionState | null> => {
        this.calls.push('readState');
        const o = this.orders.get(id);
        if (!o) return Promise.resolve(null);
        const last = this.eventsOf(id)
          .slice()
          .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
          .pop();
        return Promise.resolve({
          status: o.status,
          updatedAt: o.updatedAt,
          lastEvent: last
            ? {
                oldStatus: last.oldStatus,
                newStatus: last.newStatus,
                changedBy: last.changedBy,
                changedAt: last.changedAt,
              }
            : null,
        });
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
      // COMMIT: todo o nada
      for (const u of staged.updates) {
        const o = this.orders.get(u.id);
        if (o) {
          o.status = u.status;
          o.updatedAt = u.at;
        }
      }
      this.history.push(...staged.events);
      this.audits.push(...staged.audits);
      return result;
    } finally {
      (release as (() => void) | null)?.();
    }
  }
}
