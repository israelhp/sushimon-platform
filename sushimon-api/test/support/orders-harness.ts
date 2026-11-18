import { createHash } from 'node:crypto';
import { QuoteTokenVerifier } from '../../src/checkout/quote-token.verifier.js';
import { DbGate } from '../../src/common/concurrency/db-gate.js';
import type { Principal } from '../../src/auth/auth.types.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { hashGuestToken } from '../../src/orders/order-access-token.js';
import { hashesEqual } from '../../src/orders/order-idempotency.js';
import { OrderQuoteGuard } from '../../src/orders/order-quote-guard.js';
import { buildOrderRecord } from '../../src/orders/order-record.js';
import type { OrderEventsPublisher } from '../../src/orders/order-events.publisher.js';
import type { SnapshotNames } from '../../src/orders/order-snapshot.reader.js';
import { ordersBusy } from '../../src/orders/orders-errors.js';
import type { OrdersRepository } from '../../src/orders/orders.repository.js';
import { OrdersService } from '../../src/orders/orders.service.js';
import type {
  CreateOutcome,
  IdempotencyClaim,
  NewOrder,
  OrderRecord,
  StoredIdempotency,
} from '../../src/orders/orders.types.js';
import type { OrderCreateRequestDto } from '../../src/orders/dto/order-create-request.dto.js';
import { checkoutHarness, principal, P1, A } from './checkout-harness.js';

export { A, P1, principal };

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

interface StoredOrder {
  record: OrderRecord;
  email: string | null;
  input: NewOrder;
}

/**
 * Repositorio de pedidos EN MEMORIA con la misma semántica observable que `OrdersRepository`: reclamo de clave antes del
 * pedido (un concurrente espera al ganador y recibe el mismo pedido), transacción atómica (si falla algo no queda nada:
 * ni pedido, ni clave, ni token), número de secuencia que no se reutiliza y borrado perezoso de claves vencidas.
 */
export class FakeOrdersRepo {
  orders = new Map<string, StoredOrder>();
  keys = new Map<string, { requestHash: Uint8Array; orderId: string; expiresAt: Date }>();
  tokens: { orderId: string; hash: string; expiresAt: Date; revokedAt: Date | null }[] = [];
  history: { orderId: string; oldStatus: string | null; newStatus: string }[] = [];
  audits: { entityId: string; action: string; actorId: string | null; newValues: unknown }[] = [];
  calls: string[] = [];
  nextNumber = 1001n;
  /** Si está definido, la creación falla en ese paso DESPUÉS de reclamar la clave (rollback completo). */
  failAt: 'items' | 'audit' | null = null;
  /** Gancho para simular latencia/concurrencia dentro de la transacción. */
  hook: (() => Promise<void>) | null = null;
  /** Error de la BD que debe lanzar la transacción (p. ej. `lock_timeout`). */
  failWith: unknown = null;
  private readonly inflight = new Map<string, Promise<CreateOutcome>>();

  asRepository = () => this as unknown as OrdersRepository;
  private k = (scope: string, keyHash: Uint8Array) => `${scope}|${hex(keyHash)}`;

  findIdempotent(scope: string, keyHash: Buffer, now: Date): Promise<StoredIdempotency | null> {
    this.calls.push('findIdempotent');
    const row = this.keys.get(this.k(scope, keyHash));
    return Promise.resolve(
      row
        ? { requestHash: row.requestHash, orderId: row.orderId, expired: row.expiresAt <= now }
        : null,
    );
  }

  purgeExpired(scope: string, keyHash: Buffer, now: Date, expiredSeen: boolean): Promise<void> {
    this.calls.push(expiredSeen ? 'purgeExpired:key' : 'purgeExpired');
    const key = this.k(scope, keyHash);
    const row = this.keys.get(key);
    if (expiredSeen && row && row.expiresAt <= now) this.keys.delete(key);
    return Promise.resolve();
  }

  countPending(customerId: string, since: Date): Promise<number> {
    this.calls.push('countPending');
    let n = 0;
    for (const { record } of this.orders.values()) {
      if (
        record.status === 'pending' &&
        record.placedAt >= since &&
        record.customerId === customerId
      )
        n += 1;
    }
    return Promise.resolve(n);
  }

  async createOrder(claim: IdempotencyClaim, order: NewOrder): Promise<CreateOutcome> {
    this.calls.push('createOrder');
    const key = this.k(claim.scope, claim.keyHash);
    const running = this.inflight.get(key);
    if (running) await running.catch(() => undefined); // el concurrente espera al ganador
    const existing = this.keys.get(key);
    if (existing) {
      return hashesEqual(existing.requestHash, claim.requestHash)
        ? { kind: 'replay', orderId: existing.orderId }
        : { kind: 'reused' };
    }
    const run = (async (): Promise<CreateOutcome> => {
      if (this.hook) await this.hook();
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- simula el error crudo del driver (objeto con `code`)
      if (this.failWith) throw this.failWith;
      const number = this.nextNumber;
      this.nextNumber += 1n; // un número consumido por una transacción revertida NO se reutiliza
      if (this.failAt === 'items') throw new Error('fallo parcial: order_items');
      const now = new Date();
      const record = buildOrderRecord(order, {
        orderNumber: number,
        placedAt: now,
        updatedAt: now,
      });
      if (this.failAt === 'audit') throw new Error('fallo parcial: audit');
      // COMMIT: todo o nada.
      this.keys.set(key, {
        requestHash: claim.requestHash,
        orderId: order.orderId,
        expiresAt: claim.expiresAt,
      });
      this.orders.set(order.orderId, { record, email: order.customerEmail, input: order });
      this.history.push({ orderId: order.orderId, oldStatus: null, newStatus: 'pending' });
      if (order.guestToken) {
        this.tokens.push({
          orderId: order.orderId,
          hash: hex(order.guestToken.hash),
          expiresAt: order.guestToken.expiresAt,
          revokedAt: null,
        });
      }
      this.audits.push({
        entityId: order.orderId,
        action: 'order.created',
        actorId: null,
        newValues: {
          status: 'pending',
          fulfillmentType: order.fulfillmentType,
          deliveryProvider: order.deliveryProvider,
          total: order.total,
          itemCount: order.itemCount,
          actor: order.customerId === null ? 'guest' : 'customer',
        },
      });
      return {
        kind: 'created',
        orderId: order.orderId,
        orderNumber: number,
        placedAt: now,
        updatedAt: now,
      };
    })();
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(key);
    }
  }

  findById(id: string): Promise<OrderRecord | null> {
    this.calls.push('findById');
    return Promise.resolve(this.orders.get(id)?.record ?? null);
  }

  findForCustomer(id: string, customerId: string): Promise<OrderRecord | null> {
    this.calls.push('findForCustomer');
    const record = this.orders.get(id)?.record;
    return Promise.resolve(record && record.customerId === customerId ? record : null);
  }

  findForGuestToken(id: string, tokenHash: Buffer, now: Date): Promise<OrderRecord | null> {
    this.calls.push('findForGuestToken');
    const ok = this.tokens.some(
      (t) =>
        t.orderId === id && t.hash === hex(tokenHash) && t.revokedAt === null && t.expiresAt > now,
    );
    return Promise.resolve(ok ? (this.orders.get(id)?.record ?? null) : null);
  }

  issueGuestToken(
    orderId: string,
    issued: { hash: Buffer; expiresAt: Date },
    now: Date,
  ): Promise<void> {
    this.calls.push('issueGuestToken');
    this.tokens.push({
      orderId,
      hash: hex(issued.hash),
      expiresAt: issued.expiresAt,
      revokedAt: null,
    });
    // Como el repositorio real: solo se revocan los activos que excedan los 5 más recientes.
    const active = this.tokens.filter((t) => t.orderId === orderId && t.revokedAt === null);
    for (const t of active.slice(0, Math.max(0, active.length - 5))) t.revokedAt = now;
    return Promise.resolve();
  }

  tokenIsActive = (token: string, now: Date) =>
    this.tokens.some(
      (t) => t.hash === hex(hashGuestToken(token)) && t.revokedAt === null && t.expiresAt > now,
    );
}

/** Lector de nombres en memoria; cuenta las llamadas (presupuesto: UNA lectura por pedido, 3 consultas por lote). */
export class FakeSnapshotReader {
  calls = 0;
  modifierNames = new Map<string, string>();
  promotionNames = new Map<string, string>();
  productNames = new Map<string, string>();
  missingProducts = new Set<string>();
  constructor(private readonly h: ReturnType<typeof checkoutHarness>) {}

  read(input: {
    productIds: readonly string[];
    modifierIds: readonly string[];
    promotionIds: readonly string[];
  }): Promise<SnapshotNames> {
    this.calls += 1;
    const products = new Map<string, string>();
    for (const id of input.productIds) {
      if (this.missingProducts.has(id)) continue;
      products.set(
        id,
        this.productNames.get(id) ?? this.h.world.products.get(id)?.name ?? `P ${id}`,
      );
    }
    const modifiers = new Map(
      input.modifierIds.map((id) => [id, this.modifierNames.get(id) ?? `Extra ${id.slice(-4)}`]),
    );
    const promotions = new Map(
      input.promotionIds.map((id) => [id, this.promotionNames.get(id) ?? `Promo ${id.slice(-4)}`]),
    );
    return Promise.resolve({ products, modifiers, promotions });
  }
}

export interface FakeCustomer {
  id: string;
  authUserId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

/** `IdentityService` mínimo: `ensureCustomer` crea la fila (idempotente); `findCustomer` NO crea. */
export class FakeIdentity {
  customers = new Map<string, FakeCustomer>();
  ensureCalls = 0;
  defaultPhone: string | null = null;

  asService = () => this as unknown as IdentityService;

  ensureCustomer(p: Principal): Promise<FakeCustomer> {
    this.ensureCalls += 1;
    let row = this.customers.get(p.authUserId);
    if (!row) {
      row = {
        id: `c0000000-0000-4000-8000-${String(this.customers.size + 1).padStart(12, '0')}`,
        authUserId: p.authUserId,
        fullName: p.displayName ?? 'Cliente',
        email: p.email,
        phone: this.defaultPhone,
        createdAt: new Date(),
      };
      this.customers.set(p.authUserId, row);
    }
    return Promise.resolve(row);
  }

  findCustomer(p: Principal): Promise<FakeCustomer | null> {
    return Promise.resolve(this.customers.get(p.authUserId) ?? null);
  }
}

export const SECRET = 'o'.repeat(40);
/** Clave determinista y con entropía suficiente (>= 10 caracteres distintos) para el número `n`. */
export const keyOf = (n: number | string): string =>
  createHash('sha256').update(`key-${n}`).digest('base64url').slice(0, 32);
export const KEY_A = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
export const KEY_B = 'b1b2c3d4-e5f6-4789-8abc-def012345678';

export const GUEST_CONTACT = { fullName: 'Ana Pérez', phone: '5555 1234' };

/** Cotizador real (F19) + guard, repositorio, lector, identidad y servicio de pedidos (F20) reales sobre dobles en memoria. */
export function ordersHarness(
  opts: { secret?: string | undefined; gate?: DbGate; checkoutGate?: DbGate } = {},
) {
  const secret = 'secret' in opts ? opts.secret : SECRET;
  const h = checkoutHarness({
    secret,
    ...(opts.checkoutGate ? { gate: opts.checkoutGate } : {}),
  });
  const repo = new FakeOrdersRepo();
  const reader = new FakeSnapshotReader(h);
  const identity = new FakeIdentity();
  const verifier = new QuoteTokenVerifier(secret);
  const guard = new OrderQuoteGuard(verifier, h.service, h.clock);
  const published: { orderId: string; branchId: string }[] = [];
  const events: OrderEventsPublisher & { fail: boolean } = {
    fail: false,
    orderCreated: (e) => {
      published.push(e);
      return events.fail ? Promise.reject(new Error('publisher caído')) : Promise.resolve();
    },
  };
  const gate = opts.gate ?? new DbGate(2, 8, 1_500, ordersBusy);
  const service = new OrdersService(
    identity.asService(),
    repo.asRepository(),
    reader as never,
    guard,
    verifier,
    h.clock,
    gate,
    events,
  );

  /** Cotiza como el cliente y arma el cuerpo de `POST /v1/orders` con el token aceptado. */
  async function orderBody(
    over: Partial<OrderCreateRequestDto> = {},
    who?: Principal,
  ): Promise<OrderCreateRequestDto> {
    const base = h.body(
      over.fulfillment || over.cart || over.couponCode !== undefined
        ? {
            ...(over.cart ? { cart: over.cart } : {}),
            ...(over.fulfillment ? { fulfillment: over.fulfillment } : {}),
            ...(over.couponCode !== undefined ? { couponCode: over.couponCode } : {}),
          }
        : {},
    );
    const quote = await h.service.quote(who, base);
    return {
      cart: base.cart,
      fulfillment: base.fulfillment,
      ...(base.couponCode !== undefined ? { couponCode: base.couponCode } : {}),
      quoteToken: quote.quote.token ?? 'sin-token',
      ...(who ? {} : { contact: GUEST_CONTACT }),
      ...over,
    };
  }

  return {
    ...h,
    ordersRepo: repo,
    reader,
    identity,
    verifier,
    guard,
    events,
    published,
    gate,
    service: h.service,
    orders: service,
    orderBody,
  };
}

export type OrdersHarness = ReturnType<typeof ordersHarness>;
