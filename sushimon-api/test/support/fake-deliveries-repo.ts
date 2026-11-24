import { randomUUID } from 'node:crypto';
import type { AuditEventInput } from '../../src/audit/audit.service.js';
import { DeliveriesRepository } from '../../src/deliveries/deliveries.repository.js';
import type {
  ChangeInput,
  DeliveriesTx,
  DeliveryDetailRecord,
  DeliveryLastEvent,
  DeliveryListFilter,
  DeliveryListRow,
  DeliveryRow,
  OrderForDelivery,
} from '../../src/deliveries/deliveries.types.js';
import {
  deliveryTransitionAllowed,
  isOccupying,
  OPEN_STATUSES,
  type DeliveryStatus,
} from '../../src/deliveries/delivery-policy.js';
import { AdminOrdersRepository } from '../../src/orders/admin/admin-orders.repository.js';
import type {
  AdminOrderRow,
  TransitionState,
  TransitionTx,
} from '../../src/orders/admin/admin-orders.types.js';
import type {
  RiderActiveDeliveriesPort,
  RiderBusyQuery,
  RiderBusyResult,
} from '../../src/riders/ports/rider-active-deliveries.port.js';
import { RIDER_ACTIVE_DELIVERIES_PORT } from '../../src/riders/ports/rider-active-deliveries.port.js';
import type { FakeRidersRepo } from './fake-riders-repo.js';

export { RIDER_ACTIVE_DELIVERIES_PORT };

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

export interface FakeOrder {
  id: string;
  orderNumber: bigint;
  branchId: string;
  status: string;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  deliveryProvider: 'OWN' | 'PEDIDOSYA' | null;
  customerName: string;
  customerPhone: string;
  municipalityName: string;
  zone: string | null;
  addressLine: string;
  referenceNote: string | null;
  updatedAt: Date;
}

interface FakeDelivery {
  id: string;
  orderId: string;
  branchId: string;
  status: DeliveryStatus;
  version: number;
  riderId: string | null;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  returnedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeDeliveryHistory {
  deliveryId: string;
  oldStatus: string | null;
  status: string;
  event: string;
  riderId: string | null;
  reason: string | null;
  changedBy: string | null;
  changedAt: Date;
}

export interface FakeOrderHistory {
  orderId: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string | null;
  reason: string | null;
  changedAt: Date;
}

let orderSeq = 0;

/**
 * Doble del puerto de ocupación sobre las entregas EN MEMORIA (`known = true`, como el adaptador real): un motorista está
 * ocupado con una entrega `assigned|picked_up|delivered`. Registra cada consulta.
 */
export class FakeActiveDeliveriesPort implements RiderActiveDeliveriesPort {
  queries: RiderBusyQuery[] = [];
  /** `false` simula el adaptador «sin entregas» (falla CERRADO esperado). */
  known = true;
  constructor(private readonly repo: FakeDeliveriesRepo) {}
  findBusy(query: RiderBusyQuery): Promise<RiderBusyResult> {
    this.queries.push(query);
    const busy = new Set<string>();
    if (this.known) {
      for (const d of this.repo.deliveries.values()) {
        if (d.riderId === null || !isOccupying(d.status)) continue;
        if ('riderIds' in query && !query.riderIds.includes(d.riderId)) continue;
        if (
          'branchIds' in query &&
          query.branchIds !== null &&
          !query.branchIds.includes(d.branchId)
        ) {
          continue;
        }
        busy.add(d.riderId);
      }
    }
    return Promise.resolve({ known: this.known, busyIds: busy });
  }
}

/**
 * Repositorio de entregas EN MEMORIA con la semántica observable del real: alcance por sucursal, CAS por versión y estado,
 * `UNIQUE(order_id)`, índice único parcial «una entrega activa por motorista» (23505), grafo de estados (23514), historial y
 * auditoría atómicos (si algo falla se restauran entregas, pedidos, historiales y auditoría) y transacciones SERIALIZADAS (el
 * candado real `FOR UPDATE`/`FOR SHARE` se prueba en `deliveries.int-spec.ts`). También hace de `AdminOrdersRepository` para que
 * `OrderTransitionsService.apply` escriba el pedido en LA MISMA transacción (`ordersRepository()`).
 */
export class FakeDeliveriesRepo {
  orders = new Map<string, FakeOrder>();
  deliveries = new Map<string, FakeDelivery>();
  history: FakeDeliveryHistory[] = [];
  orderHistory: FakeOrderHistory[] = [];
  /** Auditoría de entregas Y de pedidos (en orden de escritura). */
  audits: AuditEventInput[] = [];
  branches = new Map<string, string>();
  staffNames = new Map<string, string>();
  calls: string[] = [];
  failAudit = false;
  /** Error crudo de BD que lanza la transacción al abrirse (p. ej. `lock_timeout` 55P03). */
  failWith: unknown = null;
  /** Error crudo de BD que lanza `change` (p. ej. 23514 de la coherencia diferida). */
  changeFailWith: unknown = null;
  /** Error crudo de BD que lanza `insert` (p. ej. 23514 de la coherencia diferida). */
  insertFailWith: unknown = null;
  /** Error crudo de BD que lanza `list`. */
  listFailWith: unknown = null;
  /** Gancho entre las sentencias de una transacción (para forzar intercalados). */
  afterRead: (() => void) | null = null;
  private lock: Promise<void> = Promise.resolve();
  private tick = Date.parse('2026-11-18T19:00:00.000Z');

  constructor(private readonly riders: FakeRidersRepo) {}

  asRepository = (): DeliveriesRepository => this as unknown as DeliveriesRepository;
  /** Doble de `AdminOrdersRepository` que comparte el estado de ESTA transacción. */
  ordersRepository = (): AdminOrdersRepository =>
    ({
      transitionTx: () => this.orderTx(),
      currentOf: (id: string) => this.orderCurrentOf(id),
    }) as unknown as AdminOrdersRepository;
  port = (): FakeActiveDeliveriesPort => new FakeActiveDeliveriesPort(this);

  now = (): Date => new Date((this.tick += 1000));

  addBranch(name: string): string {
    const id = randomUUID();
    this.branches.set(id, name);
    return id;
  }

  seedOrder(
    over: Partial<FakeOrder> & { branchId: string; fulfillmentType?: 'PICKUP' | 'DELIVERY' },
  ): FakeOrder {
    orderSeq += 1;
    const fulfillmentType = over.fulfillmentType ?? 'DELIVERY';
    const order: FakeOrder = {
      id: randomUUID(),
      orderNumber: BigInt(2000 + orderSeq),
      status: 'ready',
      deliveryProvider: fulfillmentType === 'DELIVERY' ? 'OWN' : null,
      customerName: 'CLIENTE-SECRETO',
      customerPhone: '+50255559999',
      municipalityName: 'Guatemala',
      zone: 'Zona 10',
      addressLine: 'DIRECCION-SECRETA 5a Av 10-10',
      referenceNote: 'REFERENCIA-SECRETA',
      updatedAt: this.now(),
      ...over,
      fulfillmentType,
    };
    this.orders.set(order.id, order);
    return order;
  }

  /** Siembra una entrega directamente (fila preexistente) con su historial `created` (+ asignación si hay motorista). */
  seedDelivery(over: {
    orderId: string;
    status?: DeliveryStatus;
    riderId?: string | null;
    version?: number;
  }): FakeDelivery {
    const order = this.orders.get(over.orderId);
    if (!order) throw new Error('pedido inexistente');
    const status = over.status ?? 'pending';
    const t = this.now();
    const d: FakeDelivery = {
      id: randomUUID(),
      orderId: order.id,
      branchId: order.branchId,
      status,
      version: over.version ?? 1,
      riderId: over.riderId ?? null,
      assignedAt: ['assigned', 'picked_up', 'delivered', 'returned'].includes(status) ? t : null,
      pickedUpAt: ['picked_up', 'delivered', 'returned'].includes(status) ? t : null,
      deliveredAt: ['delivered', 'returned'].includes(status) ? t : null,
      returnedAt: status === 'returned' ? t : null,
      cancelledAt: status === 'cancelled' ? t : null,
      createdAt: t,
      updatedAt: t,
    };
    this.deliveries.set(d.id, d);
    this.history.push({
      deliveryId: d.id,
      oldStatus: null,
      status: 'pending',
      event: 'created',
      riderId: null,
      reason: null,
      changedBy: null,
      changedAt: t,
    });
    if (status !== 'pending') {
      const event: Record<string, string> = {
        assigned: 'rider_assigned',
        picked_up: 'picked_up',
        delivered: 'delivered',
        returned: 'returned',
        cancelled: 'cancelled',
      };
      this.history.push({
        deliveryId: d.id,
        oldStatus: 'pending',
        status,
        event: event[status] ?? 'created',
        riderId: d.riderId,
        reason: null,
        changedBy: null,
        changedAt: new Date(t.getTime() + 1),
      });
    }
    return d;
  }

  eventsOf(deliveryId: string): FakeDeliveryHistory[] {
    return this.history.filter((h) => h.deliveryId === deliveryId);
  }
  deliveryOf(orderId: string): FakeDelivery | undefined {
    return [...this.deliveries.values()].find((d) => d.orderId === orderId);
  }
  auditsOf(entityType: string): AuditEventInput[] {
    return this.audits.filter((a) => a.entityType === entityType);
  }

  // ---------- proyección ----------

  private lastEventOf(id: string): DeliveryLastEvent | null {
    const last = this.eventsOf(id)
      .slice()
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
      .pop();
    return last
      ? {
          event: last.event,
          oldStatus: last.oldStatus,
          status: last.status,
          riderId: last.riderId,
          changedBy: last.changedBy,
          changedAt: last.changedAt,
        }
      : null;
  }

  private rowOf(d: FakeDelivery, withLast: boolean): DeliveryRow {
    const o = this.orders.get(d.orderId) as FakeOrder;
    const r = d.riderId ? this.riders.riders.get(d.riderId) : undefined;
    return {
      id: d.id,
      orderId: d.orderId,
      branchId: d.branchId,
      branchName: this.branches.get(d.branchId) ?? '?',
      status: d.status,
      version: d.version,
      riderId: d.riderId,
      assignedAt: d.assignedAt,
      pickedUpAt: d.pickedUpAt,
      deliveredAt: d.deliveredAt,
      returnedAt: d.returnedAt,
      cancelledAt: d.cancelledAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      orderStatus: o.status,
      orderNumber: o.orderNumber,
      fulfillmentType: o.fulfillmentType,
      deliveryProvider: o.deliveryProvider,
      municipalityName: o.municipalityName,
      zone: o.zone,
      riderName: r?.fullName ?? null,
      riderVehicleType: r?.vehicleType ?? null,
      riderPhoneMasked: r ? `${r.phone.slice(0, 4)}****${r.phone.slice(-4)}` : null,
      ...(withLast ? { lastEvent: this.lastEventOf(d.id) } : {}),
    };
  }

  private visible = (d: { branchId: string }, scope: string[] | null): boolean =>
    scope === null || scope.includes(d.branchId);
  private key = (d: Date) => d.toISOString().replace('Z', '000Z');

  // ---------- lecturas ----------

  branchExists(branchId: string): Promise<boolean> {
    this.calls.push('branchExists');
    return Promise.resolve(this.branches.has(branchId));
  }

  currentOf(id: string): Promise<{ status: string; version: number } | null> {
    const d = this.deliveries.get(id);
    return Promise.resolve(d ? { status: d.status, version: d.version } : null);
  }

  orderCurrentOf(id: string): Promise<{ status: string; updatedAt: Date } | null> {
    const o = this.orders.get(id);
    return Promise.resolve(o ? { status: o.status, updatedAt: o.updatedAt } : null);
  }

  list(f: DeliveryListFilter): Promise<DeliveryListRow[]> {
    this.calls.push('list');
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- simula el error crudo del driver
    if (this.listFailWith) return Promise.reject(this.listFailWith);
    if (f.branchIds !== null && f.branchIds.length === 0) return Promise.resolve([]);
    const open = OPEN_STATUSES as readonly string[];
    const rows = [...this.deliveries.values()]
      .filter((d) => this.visible(d, f.branchIds))
      .filter((d) => f.statuses.includes(d.status))
      .filter(
        (d) =>
          open.includes(d.status) ||
          (d.createdAt >= f.from && (f.to === null || d.createdAt <= f.to)),
      )
      .filter((d) => f.riderId === null || d.riderId === f.riderId)
      .map((d) => ({ d, key: this.key(d.createdAt) }))
      .sort((a, b) => (a.key === b.key ? (a.d.id < b.d.id ? 1 : -1) : a.key < b.key ? 1 : -1))
      .filter(
        (r) =>
          !f.cursor ||
          r.key < f.cursor.createdAtKey ||
          (r.key === f.cursor.createdAtKey && r.d.id < f.cursor.id),
      )
      .slice(0, f.limit + 1)
      .map((r) => ({ ...this.rowOf(r.d, false), createdAtKey: r.key }));
    return Promise.resolve(rows);
  }

  findDetail(
    id: string,
    scope: string[] | null,
    contactScope: string[] | null,
  ): Promise<DeliveryDetailRecord | null> {
    this.calls.push('findDetail');
    const d = this.deliveries.get(id);
    if (!d || !this.visible(d, scope)) return Promise.resolve(null);
    const o = this.orders.get(d.orderId) as FakeOrder;
    const contactVisible =
      (OPEN_STATUSES as readonly string[]).includes(d.status) &&
      (contactScope === null || contactScope.includes(o.branchId));
    const events = this.eventsOf(id)
      .slice()
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    return Promise.resolve({
      row: this.rowOf(d, false),
      contactVisible,
      customer: contactVisible ? { name: o.customerName, phone: o.customerPhone } : null,
      address: contactVisible
        ? {
            municipalityName: o.municipalityName,
            zone: o.zone,
            addressLine: o.addressLine,
            referenceNote: o.referenceNote,
          }
        : null,
      history: events.slice(-50).map((e) => ({
        event: e.event,
        oldStatus: e.oldStatus,
        status: e.status,
        riderId: e.riderId,
        riderName: e.riderId ? (this.riders.riders.get(e.riderId)?.fullName ?? null) : null,
        reason: e.reason,
        actorName: e.changedBy ? (this.staffNames.get(e.changedBy) ?? null) : null,
        at: e.changedAt,
      })),
      historyTruncated: events.length > 50,
    });
  }

  // ---------- transacciones ----------

  async transaction<T>(fn: (tx: DeliveriesTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    const snapshot = {
      deliveries: new Map([...this.deliveries].map(([k, v]) => [k, { ...v }])),
      orders: new Map([...this.orders].map(([k, v]) => [k, { ...v }])),
      history: [...this.history],
      orderHistory: [...this.orderHistory],
      audits: [...this.audits],
    };
    try {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- simula el error crudo del driver
      if (this.failWith) throw this.failWith;
      return await fn(this.txOf());
    } catch (error) {
      this.deliveries = snapshot.deliveries;
      this.orders = snapshot.orders;
      this.history = snapshot.history;
      this.orderHistory = snapshot.orderHistory;
      this.audits = snapshot.audits;
      throw error;
    } finally {
      release();
    }
  }

  private txOf(): DeliveriesTx {
    return {
      client: {} as DeliveriesTx['client'],
      readDelivery: (id, scope, opts) => {
        this.calls.push(opts?.lock ? 'read:lock' : 'read');
        const d = this.deliveries.get(id);
        const row = d && this.visible(d, scope) ? this.rowOf(d, true) : null;
        this.afterRead?.();
        return Promise.resolve(row);
      },
      lockRider: (riderId) => {
        this.calls.push('lockRider');
        const r = this.riders.riders.get(riderId);
        return Promise.resolve(r ? { id: r.id, branchId: r.branchId } : null);
      },
      readDeliveryLocked: (id) => {
        this.calls.push('readLocked');
        const d = this.deliveries.get(id);
        return Promise.resolve(d ? this.rowOf(d, true) : null);
      },
      readOrderForCreate: (orderId, scope): Promise<OrderForDelivery | null> => {
        this.calls.push('readOrder');
        const o = this.orders.get(orderId);
        if (!o || !this.visible(o, scope)) return Promise.resolve(null);
        const d = this.deliveryOf(orderId);
        const read: OrderForDelivery = {
          orderId: o.id,
          branchId: o.branchId,
          status: o.status,
          fulfillmentType: o.fulfillmentType,
          deliveryProvider: o.deliveryProvider,
          updatedAt: o.updatedAt,
          existing: d ? { id: d.id, status: d.status, version: d.version } : null,
        };
        this.afterRead?.();
        return Promise.resolve(read);
      },
      insert: (orderId, branchId, changedBy) => {
        this.calls.push('insert');
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- simula el error crudo del driver
        if (this.insertFailWith) return Promise.reject(this.insertFailWith);
        const o = this.orders.get(orderId);
        if (!o || o.fulfillmentType !== 'DELIVERY' || o.deliveryProvider !== 'OWN') {
          return Promise.reject(pgError('23514'));
        }
        if (this.deliveryOf(orderId)) return Promise.resolve(null);
        const t = this.now();
        const d: FakeDelivery = {
          id: randomUUID(),
          orderId,
          branchId,
          status: 'pending',
          version: 1,
          riderId: null,
          assignedAt: null,
          pickedUpAt: null,
          deliveredAt: null,
          returnedAt: null,
          cancelledAt: null,
          createdAt: t,
          updatedAt: t,
        };
        this.deliveries.set(d.id, d);
        this.history.push({
          deliveryId: d.id,
          oldStatus: null,
          status: 'pending',
          event: 'created',
          riderId: null,
          reason: null,
          changedBy,
          changedAt: t,
        });
        return Promise.resolve({
          ...this.rowOf(d, false),
          lastEvent: this.lastEventOf(d.id),
        });
      },
      change: (input: ChangeInput) => {
        this.calls.push('change');
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- simula el error crudo del driver
        if (this.changeFailWith) return Promise.reject(this.changeFailWith);
        const d = this.deliveries.get(input.id);
        if (!d || d.version !== input.expectedVersion || !input.fromStatuses.includes(d.status)) {
          return Promise.resolve(null);
        }
        const t = this.now();
        const next = { ...d };
        switch (input.change.kind) {
          case 'assign':
            next.status = 'assigned';
            next.riderId = input.change.riderId;
            next.assignedAt = t;
            break;
          case 'unassign':
            next.status = 'pending';
            next.riderId = null;
            next.assignedAt = null;
            break;
          case 'pick_up':
            next.status = 'picked_up';
            next.pickedUpAt = t;
            break;
          case 'deliver':
            next.status = 'delivered';
            next.deliveredAt = t;
            break;
          case 'return':
            next.status = 'returned';
            next.returnedAt = t;
            break;
          case 'cancel':
            next.status = 'cancelled';
            next.riderId = null;
            next.assignedAt = null;
            next.cancelledAt = t;
            break;
          case 'reopen':
            next.status = 'pending';
            next.cancelledAt = null;
            break;
        }
        next.version = d.version + 1;
        next.updatedAt = t;
        // trigger `deliveries_guard`: grafo de estados
        if (!deliveryTransitionAllowed(d.status, next.status, next.riderId !== d.riderId)) {
          return Promise.reject(pgError('23514'));
        }
        // índice único parcial `deliveries_one_active_per_rider_idx`
        if (
          next.riderId !== null &&
          isOccupying(next.status) &&
          [...this.deliveries.values()].some(
            (x) => x.id !== d.id && x.riderId === next.riderId && isOccupying(x.status),
          )
        ) {
          return Promise.reject(pgError('23505'));
        }
        this.deliveries.set(d.id, next);
        this.history.push({
          deliveryId: d.id,
          oldStatus: input.oldStatus,
          status: next.status,
          event: input.event,
          riderId: input.historyRiderId,
          reason: input.reason,
          changedBy: input.changedBy,
          changedAt: t,
        });
        return Promise.resolve({ ...this.rowOf(next, false), lastEvent: this.lastEventOf(d.id) });
      },
      audit: (event) => {
        this.calls.push('audit');
        if (this.failAudit) return Promise.reject(new Error('audit down'));
        this.audits.push(event);
        return Promise.resolve();
      },
    };
  }

  /** `TransitionTx` del pedido sobre el MISMO estado transaccional (la restauración de `transaction` lo cubre). */
  private orderTx(): TransitionTx {
    const rowOf = (o: FakeOrder): AdminOrderRow => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      branchId: o.branchId,
      branchName: this.branches.get(o.branchId) ?? '?',
      fulfillmentType: o.fulfillmentType,
      deliveryProvider: o.deliveryProvider,
      customerName: o.customerName,
      itemCount: 3,
      total: '185.00',
      paymentMethodPreference: null,
      paymentStatus: 'pending',
      paymentPaidAt: null,
      scheduledFor: null,
      placedAt: o.updatedAt,
      updatedAt: o.updatedAt,
    });
    return {
      readOrder: (id) => {
        this.calls.push('order:read');
        const o = this.orders.get(id);
        return Promise.resolve(o ? rowOf(o) : null);
      },
      casAndRecord: ({ orderId, expected, to, changedBy, reason }) => {
        this.calls.push('order:cas');
        const o = this.orders.get(orderId);
        if (!o || o.status !== expected) return Promise.resolve(null);
        const at = this.now();
        o.status = to;
        o.updatedAt = at;
        this.orderHistory.push({
          orderId,
          oldStatus: expected,
          newStatus: to,
          changedBy,
          reason,
          changedAt: at,
        });
        return Promise.resolve(at);
      },
      readState: (id): Promise<TransitionState | null> => {
        this.calls.push('order:state');
        const o = this.orders.get(id);
        if (!o) return Promise.resolve(null);
        const last = this.orderHistory
          .filter((h) => h.orderId === id)
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
        this.calls.push('order:audit');
        if (this.failAudit) return Promise.reject(new Error('audit down'));
        this.audits.push(event);
        return Promise.resolve();
      },
    };
  }
}
