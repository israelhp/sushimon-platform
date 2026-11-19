import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import { assertFulfillmentShape, assertQuoteLimits } from '../checkout/checkout-policy.js';
import { QuoteTokenVerifier } from '../checkout/quote-token.verifier.js';
import type { DbGate, DbGateRunOptions } from '../common/concurrency/db-gate.js';
import { centsToDecimal, decimalToCents } from '../common/money/money.js';
import { IdentityService } from '../identity/identity.service.js';
import { hashGuestToken, GUEST_TOKEN_PATTERN, issueGuestToken } from './order-access-token.js';
import {
  normalizeAddressText,
  normalizeNotes,
  resolveContact,
  type AddressText,
} from './order-contact.policy.js';
import { ORDER_EVENTS_PUBLISHER, type OrderEventsPublisher } from './order-events.publisher.js';
import {
  canonicalOrderBody,
  IDEMPOTENCY_TTL_MS,
  hashesEqual,
  keyHashOf,
  parseIdempotencyKey,
  scopeOf,
} from './order-idempotency.js';
import { toOrderDetail } from './order-mapper.js';
import { buildOrderRecord } from './order-record.js';
import { OrderQuoteGuard, type GuardedQuote } from './order-quote-guard.js';
import { OrderSnapshotReader, type SnapshotNames } from './order-snapshot.reader.js';
import {
  idempotencyInProgress,
  idempotencyKeyReused,
  isLockTimeout,
  ORDERS_DB_GATE,
  ordersBusy,
  ordersUnavailable,
  paymentMethodUnavailable,
  pendingOrdersLimit,
  quoteChanged,
  translateOrdersDbError,
} from './orders-errors.js';
import { toOrderTracking } from './order-tracking.mapper.js';
import type { OrderTrackingRecord } from './order-tracking.types.js';
import { OrdersRepository } from './orders.repository.js';
import type { NewOrder, StoredIdempotency } from './orders.types.js';
import type { OrderCreateRequestDto } from './dto/order-create-request.dto.js';
import type { OrderCreatedDto, OrderDetailDto } from './dto/order-responses.dto.js';
import type { OrderTrackingDto } from './dto/order-tracking.dto.js';

/** Tope provisional de pedidos `pending` por cliente/teléfono en 24 h (P51). No es atómico: puede excederse por 1. */
export const MAX_PENDING_ORDERS = 3;
const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface CreateOrderResult {
  /** 201 (creado) o 200 (repetición idempotente). */
  replayed: boolean;
  body: OrderCreatedDto;
}

/**
 * Admisión de LECTURAS (F21): con el cupo lleno, una lectura se rechaza (503 `ORDERS_BUSY`) si ya hay 2 esperas en cola;
 * las plazas 3..8 quedan reservadas a las escrituras (`create`). Spec 022 §6.6.
 */
const READ_ADMISSION: DbGateRunOptions = { rejectIfWaiting: 2 };

/** 404 idéntico (mismo cuerpo) para pedido inexistente, ajeno, token inválido/vencido/revocado y pedido de invitado con JWT. */
const orderNotFound = () => new NotFoundException('Pedido no encontrado');

/**
 * Creación y lectura de pedidos (F20, spec 021, ADR-0026). Orquesta; las reglas viven en sus colaboradores:
 * `OrderQuoteGuard` (token + recotización), `order-idempotency`/`OrdersRepository` (protocolo en BD),
 * `order-contact.policy`, `order-access-token`. Los importes salen de la RECOTIZACIÓN, jamás del cliente. Sin pagos,
 * sin entregas, sin notificaciones (el puerto de eventos se invoca tras el commit y es no-op).
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(OrdersRepository) private readonly repo: OrdersRepository,
    @Inject(OrderSnapshotReader) private readonly snapshots: OrderSnapshotReader,
    @Inject(OrderQuoteGuard) private readonly quoteGuard: OrderQuoteGuard,
    @Inject(QuoteTokenVerifier) private readonly verifier: QuoteTokenVerifier,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_DB_GATE) private readonly gate: DbGate,
    @Inject(ORDER_EVENTS_PUBLISHER) private readonly events: OrderEventsPublisher,
  ) {}

  async create(
    principal: Principal | undefined,
    rawKey: unknown,
    body: OrderCreateRequestDto,
  ): Promise<CreateOrderResult> {
    const key = parseIdempotencyKey(rawKey);
    // Fail-closed: sin secreto nunca se crea un pedido sin verificar la cotización.
    if (!this.verifier.configured) throw ordersUnavailable();
    this.assertShape(principal, body);

    const address = this.addressTextOf(body);
    const notes = normalizeNotes(body.notes);
    const preference = body.paymentMethodPreference ?? null;
    if (preference === 'card') throw paymentMethodUnavailable();
    const keyHash = keyHashOf(key);
    const now = this.clock.now();

    // Sección 1 del gate (pre-chequeos, una sola adquisición): actor, contacto/huella, repetición y tope de pendientes.
    // `customer_id` sale SIEMPRE de la sesión (nunca del cuerpo). La repetición se resuelve ANTES de validar el token:
    // un reintento tras `QUOTE_EXPIRED` natural devuelve el pedido original.
    const pre = await this.db(async () => {
      const customer = principal ? await this.identity.ensureCustomer(principal) : null;
      const customerId = customer?.id ?? null;
      const contact = resolveContact(
        body.contact,
        customer
          ? { fullName: customer.fullName, phone: customer.phone, email: customer.email }
          : null,
      );
      const scope = scopeOf(customerId);
      const requestHash = this.verifier.bodyHash(
        canonicalOrderBody({ body, contact, address, notes, paymentMethodPreference: preference }),
      );
      const stored = await this.repo.findIdempotent(scope, keyHash, now);
      // Tope P51 SOLO para clientes autenticados (por `customer_id`): bloquear invitados por teléfono permitiría a
      // cualquiera impedir los pedidos de otra persona. No es atómico: puede excederse por 1.
      const pending =
        stored && !stored.expired
          ? 0
          : customerId === null
            ? 0
            : await this.repo.countPending(customerId, new Date(now.getTime() - PENDING_WINDOW_MS));
      return { customerId, contact, scope, requestHash, stored, pending };
    });
    const { customerId, contact, scope, requestHash, stored } = pre;
    if (stored && !stored.expired) return this.replay(stored, requestHash);
    if (pre.pending >= MAX_PENDING_ORDERS) throw pendingOrdersLimit();

    // Token + recotización + comparación: gate propio del cotizador de F19, NUNCA anidado en el de pedidos (sin
    // interbloqueo). Como el resto del trabajo cabe en UNA sección más, un 503 `ORDERS_BUSY` pierde como mucho una cola.
    const guarded = await this.quoteGuard.check(principal, body, body.quoteToken);

    // Sección 2 del gate (una sola adquisición): nombres de snapshot por lote (3 consultas), armado del pedido con los
    // importes de la RECOTIZACIÓN y transacción corta que SOLO escribe.
    const issued = customerId === null ? issueGuestToken(now) : null;
    let outcome;
    let order: NewOrder;
    try {
      ({ outcome, order } = await this.gate.run(async () => {
        const names = await this.snapshots.read({
          productIds: [...new Set(guarded.quote.lines.map((l) => l.productId))],
          modifierIds: [
            ...new Set(guarded.quote.lines.flatMap((l) => l.modifiers.map((m) => m.optionId))),
          ],
          promotionIds: [
            ...new Set(
              guarded.quote.lines.flatMap((l) => (l.promotionId === null ? [] : [l.promotionId])),
            ),
          ],
        });
        const built = this.buildOrder({
          body,
          guarded,
          names,
          customerId,
          contact,
          address,
          notes,
          preference,
          guestToken: issued ? { hash: issued.hash, expiresAt: issued.expiresAt } : null,
        });
        await this.repo.purgeExpired(scope, keyHash, now, stored?.expired === true);
        const created = await this.repo.createOrder(
          { scope, keyHash, requestHash, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) },
          built,
        );
        return { outcome: created, order: built };
      }));
    } catch (error) {
      if (isLockTimeout(error)) throw idempotencyInProgress();
      throw translateOrdersDbError(error);
    }
    if (outcome.kind === 'reused') throw idempotencyKeyReused();
    if (outcome.kind === 'replay') {
      return this.replay({ requestHash, orderId: outcome.orderId, expired: false }, requestHash);
    }

    const record = buildOrderRecord(order, outcome);
    this.logger.log(
      `order.created orderId=${order.orderId} branch=${order.branchId} type=${order.fulfillmentType} items=${order.itemCount} actor=${customerId === null ? 'guest' : 'customer'}`,
    );
    this.publishCreated(order.orderId, order.branchId);
    return {
      replayed: false,
      body: {
        order: toOrderDetail(record),
        access: issued
          ? { guestToken: issued.token, expiresAt: issued.expiresAt.toISOString() }
          : null,
      },
    };
  }

  /** `GET /v1/orders/{id}`: dueño por JWT o token de invitado; todo lo demás => el MISMO 404. */
  async get(
    principal: Principal | undefined,
    id: string,
    rawToken: string | undefined,
  ): Promise<OrderDetailDto> {
    const hash = this.guestHashOf(rawToken);
    // Una adquisición del gate por consulta (comportamiento de F20); admisión de lectura: no quita plazas a la escritura.
    const found = await this.authorizedRead(principal, hash, {
      byToken: (h, now) => this.db(() => this.repo.findForGuestToken(id, h, now), READ_ADMISSION),
      byOwner: async (p) => {
        const customer = await this.db(() => this.identity.findCustomer(p), READ_ADMISSION);
        return customer
          ? this.db(() => this.repo.findForCustomer(id, customer.id), READ_ADMISSION)
          : null;
      },
    });
    if (found) return toOrderDetail(found);
    throw orderNotFound();
  }

  /**
   * `GET /v1/orders/{id}/tracking` (F21, spec 022): MISMA autorización que `get` (404 uniforme), solo lectura y UNA sola
   * adquisición del gate (con admisión de lectura: si la cola ya tiene 2 esperas se rechaza al instante con 503
   * `ORDERS_BUSY`, dejando las plazas restantes a `createOrder`). El dueño se autoriza por join en la misma consulta
   * (`findTrackingForOwnerAuthUser`): sin `findCustomer`. Sin escrituras ni auditoría.
   */
  async getTracking(
    principal: Principal | undefined,
    id: string,
    rawToken: string | undefined,
  ): Promise<OrderTrackingDto> {
    const hash = this.guestHashOf(rawToken);
    const now = this.clock.now();
    const found = await this.db(
      () =>
        this.authorizedRead<OrderTrackingRecord>(principal, hash, {
          byToken: (h, at) => this.repo.findTrackingForGuestToken(id, h, at),
          byOwner: (p) => this.repo.findTrackingForOwnerAuthUser(id, p.authUserId),
        }),
      READ_ADMISSION,
    );
    if (!found) throw orderNotFound();
    this.logger.debug(`order.tracking orderId=${found.id} status=${found.status}`);
    return toOrderTracking(found, now);
  }

  /** Hash del token de invitado, o `undefined` sin token. Un formato imposible => 400 sin tocar la BD. */
  private guestHashOf(rawToken: string | undefined): Buffer | undefined {
    if (rawToken === undefined) return undefined;
    if (!GUEST_TOKEN_PATTERN.test(rawToken)) {
      throw new BadRequestException(['X-Order-Token: formato inválido']);
    }
    return hashGuestToken(rawToken);
  }

  /**
   * Autorización de lectura compartida (dueño por JWT o token de invitado): primero el token, después el dueño. Cada
   * finder decide cómo accede a la BD (y si usa el gate por paso o ya está dentro de una sola adquisición). Devuelve `null`
   * en TODO caso denegado: el llamador responde el mismo 404.
   */
  private async authorizedRead<T>(
    principal: Principal | undefined,
    hash: Buffer | undefined,
    finders: {
      byToken: (hash: Buffer, now: Date) => Promise<T | null>;
      byOwner: (principal: Principal) => Promise<T | null>;
    },
  ): Promise<T | null> {
    if (hash !== undefined) {
      const byToken = await finders.byToken(hash, this.clock.now());
      if (byToken) return byToken;
    }
    return principal ? finders.byOwner(principal) : null;
  }

  // ---------- repetición idempotente ----------

  private async replay(stored: StoredIdempotency, requestHash: Buffer): Promise<CreateOrderResult> {
    if (!hashesEqual(stored.requestHash, requestHash)) throw idempotencyKeyReused();
    // UNA adquisición del gate: lectura del pedido y, si es de invitado, emisión del token adicional.
    return this.db(async () => {
      const record = await this.repo.findById(stored.orderId);
      if (!record) throw ordersBusy(); // la fila de la clave existe pero el pedido aún no es visible: reintentar
      let access: OrderCreatedDto['access'] = null;
      if (record.customerId === null) {
        // El cliente pudo no recibir el primer token: se emite OTRO (el vigente NO se revoca; ver `issueGuestToken`).
        const now = this.clock.now();
        const issued = issueGuestToken(now);
        await this.repo.issueGuestToken(record.id, issued, now);
        access = { guestToken: issued.token, expiresAt: issued.expiresAt.toISOString() };
      }
      return { replayed: true, body: { order: toOrderDetail(record), access } };
    });
  }

  // ---------- validaciones de forma (antes de tocar la BD) ----------

  private assertShape(principal: Principal | undefined, body: OrderCreateRequestDto): void {
    assertQuoteLimits(body.cart.lines);
    assertFulfillmentShape(body.fulfillment);
    if (body.fulfillment.customerAddressId !== undefined && !principal) {
      throw new UnauthorizedException('No autenticado');
    }
    const { fulfillment, deliveryAddress } = body;
    if (fulfillment.type === 'PICKUP') {
      if (deliveryAddress !== undefined) {
        throw new BadRequestException(['deliveryAddress: no se admite con PICKUP']);
      }
    } else if (fulfillment.customerAddressId !== undefined) {
      if (deliveryAddress !== undefined) {
        throw new BadRequestException([
          'deliveryAddress: no se admite con customerAddressId (se copia la dirección guardada)',
        ]);
      }
    } else if (deliveryAddress === undefined) {
      throw new BadRequestException(['deliveryAddress: es obligatorio con municipalityId']);
    }
  }

  private addressTextOf(body: OrderCreateRequestDto): AddressText | null {
    return body.deliveryAddress ? normalizeAddressText(body.deliveryAddress) : null;
  }

  // ---------- armado del pedido (puro; importes de la recotización) ----------

  private buildOrder(input: {
    body: OrderCreateRequestDto;
    guarded: GuardedQuote;
    names: SnapshotNames;
    customerId: string | null;
    contact: { fullName: string; phone: string; email: string | null };
    address: AddressText | null;
    notes: string | null;
    preference: 'cash' | 'bank_transfer' | null;
    guestToken: { hash: Buffer; expiresAt: Date } | null;
  }): NewOrder {
    const { guarded, names, body } = input;
    const quote = guarded.quote;
    const changed = () => quoteChanged([{ field: 'lines', previous: null, current: null }], quote);

    const promotionCents = new Map<string, number>();
    const lines = quote.lines.map((l, i) => {
      const productName = names.products.get(l.productId);
      if (productName === undefined) throw changed(); // el producto dejó de existir entre medias
      if (l.unitPrice === null || l.extrasPerUnit === null || l.discount === null) {
        throw new Error('línea sin importes en una cotización que puede continuar');
      }
      const discount = decimalToCents(l.discount);
      if (discount > 0) {
        if (l.promotionId === null) throw new Error('descuento sin promoción');
        promotionCents.set(l.promotionId, (promotionCents.get(l.promotionId) ?? 0) + discount);
      }
      return {
        lineNo: i + 1,
        productId: l.productId,
        productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        extrasPerUnit: l.extrasPerUnit,
        lineDiscount: l.discount,
        modifiers: l.modifiers.map((m) => {
          const modifierName = names.modifiers.get(m.optionId);
          if (modifierName === undefined) throw changed();
          return { modifierId: m.optionId, modifierName, unitExtraPrice: m.extraPrice };
        }),
      };
    });
    const promotions = [...promotionCents].map(([promotionId, cents]) => {
      const promotionName = names.promotions.get(promotionId);
      if (promotionName === undefined) throw changed();
      return { promotionId, promotionName, amount: centsToDecimal(cents) };
    });

    const total = quote.total;
    const fee = quote.deliveryFee;
    if (total === null || fee === null) throw new Error('cotización sin total');
    // Invariantes monetarias (también las exige la BD con CHECK): nunca se persiste un total incoherente.
    const promoSum = promotions.reduce((s, p) => s + decimalToCents(p.amount), 0);
    if (
      promoSum !== decimalToCents(quote.discountTotal) ||
      decimalToCents(total) !==
        decimalToCents(quote.subtotal) - decimalToCents(quote.discountTotal) + decimalToCents(fee)
    ) {
      throw new Error('importes incoherentes en la recotización');
    }

    const isDelivery = body.fulfillment.type === 'DELIVERY';
    const place = guarded.resolved.place;
    let address: NewOrder['address'] = null;
    if (isDelivery) {
      if (!place) throw new Error('entrega sin lugar resuelto');
      const saved = place.savedAddress;
      const text = saved ?? input.address;
      if (!text) throw new Error('entrega sin dirección');
      address = {
        municipalityName: place.municipalityName,
        zone: place.zone,
        addressLine: text.addressLine,
        referenceNote: text.referenceNote,
        latitude: saved?.latitude ?? null,
        longitude: saved?.longitude ?? null,
      };
    }

    return {
      orderId: randomUUID(),
      customerId: input.customerId,
      branchId: body.cart.branchId,
      customerName: input.contact.fullName,
      customerPhone: input.contact.phone,
      customerEmail: input.contact.email,
      fulfillmentType: body.fulfillment.type,
      deliveryProvider: isDelivery ? 'OWN' : null,
      notes: input.notes,
      subtotal: quote.subtotal,
      extrasTotal: quote.extrasTotal,
      discountTotal: quote.discountTotal,
      deliveryFee: fee,
      total,
      paymentMethodPreference: input.preference,
      address,
      lines,
      promotions,
      guestToken: input.guestToken,
      itemCount: lines.length,
    };
  }

  // ---------- infraestructura ----------

  /** Gate propio (`ORDERS_DB_GATE`) + traducción de «ocupado o sin conexión» a 503 `ORDERS_BUSY`. */
  private async db<T>(task: () => Promise<T>, options?: DbGateRunOptions): Promise<T> {
    try {
      return await this.gate.run(task, options);
    } catch (error) {
      throw translateOrdersDbError(error);
    }
  }

  /** Después del commit; un fallo (síncrono o asíncrono) se registra y NUNCA afecta la respuesta. */
  private publishCreated(orderId: string, branchId: string): void {
    try {
      this.events.orderCreated({ orderId, branchId }).catch(() => {
        this.logger.warn(`orderCreated no publicado orderId=${orderId}`);
      });
    } catch {
      this.logger.warn(`orderCreated no publicado orderId=${orderId}`);
    }
  }
}
