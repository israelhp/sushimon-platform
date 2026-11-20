import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthorizationService } from '../../auth/authorization.service.js';
import { CLOCK, type Clock } from '../../branch-schedule/clock.js';
import { DbGate, type DbGateRunOptions } from '../../common/concurrency/db-gate.js';
import type { StaffContext } from '../../identity/identity.types.js';
import { adminOrderNotFound } from '../admin/order-admin-errors.js';
import { hashesEqual, keyHashOf, parseIdempotencyKey } from '../order-idempotency.js';
import {
  idempotencyKeyReused,
  ordersBusy,
  ORDERS_DB_GATE,
  translateOrdersDbError,
} from '../orders-errors.js';
import {
  centsToMoney,
  dbMoneyToCents,
  parseTenderedCents,
  requestHashOf,
  settleCash,
} from './cash-amount.js';
import type {
  AdminCashPaymentRequest,
  AdminCashPaymentResultDto,
  AdminOrderPaymentDto,
  AdminPaymentHistoryDto,
} from './dto/admin-payments.dto.js';
import {
  CLOSED_ORDER_STATUSES,
  collectionContextOf,
  isPaid,
  notCollectableOf,
  toAdminPayment,
  toPaymentHistory,
} from './payment-view.js';
import {
  cashAmountInsufficient,
  cashTenderedTooLarge,
  orderNotPayable,
  paymentActionForbidden,
  paymentAlreadyRegistered,
  paymentConfirmationRequired,
  paymentNotCollectable,
} from './payments-errors.js';
import { PaymentsRepository } from './payments.repository.js';
import type { PaymentOrderView } from './payments.types.js';

/** Lecturas de bajo valor: con el cupo lleno se rechazan si ya hay 2 esperas; las plazas 3..8 son de las escrituras. */
const READ_ADMISSION: DbGateRunOptions = { rejectIfWaiting: 2 };

export interface RegisterOutcome {
  body: AdminCashPaymentResultDto;
  /** `true` = repetición idempotente (HTTP 200 + `Idempotent-Replayed`); `false` = primer registro (HTTP 201). */
  replayed: boolean;
}

/**
 * Registro y lectura del pago en EFECTIVO de un pedido (F24, spec 025). ÚNICO servicio que escribe `payments`; F28 lo reutiliza
 * con SU transacción (`register` recibe el actor). Compare-and-set sobre `status = 'pending'`, evento y auditoría en la misma
 * transacción, idempotencia persistente por hash, autorización por sucursal EN SQL (anti-IDOR) y sin llamadas externas. Registrar
 * el pago NO cambia `orders.status` ni `updated_at`. Logs: solo ids y resultado (nunca importes, claves ni hashes).
 */
@Injectable()
export class CashPaymentsService {
  private readonly logger = new Logger(CashPaymentsService.name);

  constructor(
    @Inject(PaymentsRepository) private readonly repo: PaymentsRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_DB_GATE) private readonly gate: DbGate,
  ) {}

  async get(staff: StaffContext, orderId: string): Promise<AdminOrderPaymentDto> {
    const branchIds = this.scopeOf(staff, 'payments.read');
    const view = await this.db(() => this.repo.findForStaff(orderId, branchIds), READ_ADMISSION);
    if (!view) throw adminOrderNotFound();
    return toAdminPayment(view, this.canConfirm(staff, view), this.clock.now());
  }

  async history(staff: StaffContext, orderId: string): Promise<AdminPaymentHistoryDto> {
    const branchIds = this.scopeOf(staff, 'payments.read');
    const record = await this.db(() => this.repo.findHistory(orderId, branchIds), READ_ADMISSION);
    if (!record) throw adminOrderNotFound();
    return toPaymentHistory(record, this.clock.now());
  }

  async register(
    staff: StaffContext,
    orderId: string,
    rawKey: unknown,
    body: AdminCashPaymentRequest,
  ): Promise<RegisterOutcome> {
    // Validación ANTES de tocar la BD (400): clave, importe (centavos enteros, sin redondeo) y confirmación física.
    const key = parseIdempotencyKey(rawKey);
    const tenderedCents = parseTenderedCents(body.tendered);
    if (body.receivedConfirmed !== true) throw paymentConfirmationRequired();
    const keyHash = keyHashOf(key);
    const requestHash = requestHashOf(orderId, tenderedCents);
    // Visibilidad = `orders.read` en la sucursal del pedido (EN SQL: inexistente y ajeno => el mismo 404).
    const branchIds = this.scopeOf(staff, 'orders.read');

    // Sin `rejectIfWaiting`: el cobro (escritura del personal) tiene prioridad sobre el sondeo.
    const outcome = await this.db(() =>
      this.repo.transaction(async (tx) => {
        const view = await tx.read(orderId, branchIds);
        if (!view) throw adminOrderNotFound();
        if (!this.canConfirm(staff, view)) throw paymentActionForbidden();

        const existing = this.existing(staff, view, keyHash, requestHash);
        if (existing) return existing;

        const pay = view.payment;
        const amountCents = pay ? dbMoneyToCents(pay.amount) : null;
        if (!pay || amountCents === null) throw paymentNotCollectable('LEGACY_PAYMENT_METHOD');
        const settlement = settleCash(amountCents, tenderedCents);
        if (!settlement.ok) {
          throw settlement.reason === 'INSUFFICIENT'
            ? cashAmountInsufficient()
            : cashTenderedTooLarge();
        }
        const context = collectionContextOf(view.fulfillmentType, view.deliveryProvider);
        if (context === null) throw paymentNotCollectable('PROVIDER_BLOCKED_EXTERNAL');

        const tendered = centsToMoney(tenderedCents);
        const marked = await tx.markPaid({
          paymentId: pay.id,
          orderId: view.orderId,
          tendered,
          staffId: staff.staffId,
          context,
          keyHash,
          requestHash,
        });
        if (!marked) {
          // Carrera perdida (otro cobro o una cancelación ganó): se relee y se decide con el mismo árbol (replay | 409).
          const current = await tx.read(orderId, branchIds);
          if (!current) throw adminOrderNotFound();
          const after = this.existing(staff, current, keyHash, requestHash);
          if (after) return after;
          throw ordersBusy(); // estado intermedio inesperado: reintentable con la MISMA clave
        }
        await tx.audit({
          actorId: staff.staffId,
          branchId: view.branchId,
          entityType: 'payment',
          entityId: pay.id,
          action: 'payment.cash_received',
          oldValues: { status: 'pending' },
          newValues: {
            orderId: view.orderId,
            status: 'paid',
            amount: pay.amount,
            tendered,
            change: marked.change,
            context,
          },
        });
        const paidView: PaymentOrderView = {
          ...view,
          payment: {
            ...pay,
            status: 'paid',
            tendered,
            change: marked.change,
            receivedAt: marked.receivedAt,
            collectionContext: context,
            receivedByStaffId: staff.staffId,
            collectorName: staff.fullName,
          },
        };
        return {
          view: paidView,
          replayed: false,
          appliedByMe: true,
        } satisfies PaymentResolution;
      }),
    );

    this.logger.log(
      `cobro en efectivo ${outcome.replayed ? 'repetido' : 'registrado'} orderId=${orderId} paymentId=${outcome.view.payment?.id ?? 'n/a'}`,
    );
    return {
      body: {
        payment: toAdminPayment(outcome.view, true, this.clock.now()),
        replayed: outcome.replayed,
        appliedByMe: outcome.appliedByMe,
      },
      replayed: outcome.replayed,
    };
  }

  /**
   * Árbol de decisión sobre el estado leído. `null` = el pago está `pending`, el pedido es cobrable y se puede escribir.
   * Devuelve la repetición idempotente o lanza el 409/422 que corresponda (con `current` cuando aplica).
   */
  private existing(
    staff: StaffContext,
    view: PaymentOrderView,
    keyHash: Buffer,
    requestHash: Buffer,
  ): PaymentResolution | null {
    const pay = view.payment;
    if (pay && isPaid(pay.status)) {
      const sameKey = pay.confirmKeyHash !== null && hashesEqual(pay.confirmKeyHash, keyHash);
      if (sameKey) {
        const sameBody =
          pay.confirmRequestHash !== null && hashesEqual(pay.confirmRequestHash, requestHash);
        if (!sameBody) throw idempotencyKeyReused();
        return { view, replayed: true, appliedByMe: pay.receivedByStaffId === staff.staffId };
      }
      throw paymentAlreadyRegistered(this.currentOf(staff, view));
    }
    if (CLOSED_ORDER_STATUSES.includes(view.orderStatus)) {
      throw orderNotPayable(this.currentOf(staff, view));
    }
    const blocked = notCollectableOf({
      orderStatus: view.orderStatus,
      fulfillmentType: view.fulfillmentType,
      deliveryProvider: view.deliveryProvider,
      total: view.total,
      paymentStatus: pay?.status ?? null,
      paidAt: pay?.receivedAt ?? null,
    });
    if (blocked) throw paymentNotCollectable(blocked);
    return null;
  }

  private currentOf(staff: StaffContext, view: PaymentOrderView): AdminOrderPaymentDto {
    return toAdminPayment(view, this.canConfirm(staff, view), this.clock.now());
  }

  private canConfirm(staff: StaffContext, view: PaymentOrderView): boolean {
    return this.authorization.canAccess(staff, 'payments.confirm', view.branchId);
  }

  /** `null` = todas las sucursales; lista = SOLO esas (nunca la unión plana deprecada). */
  private scopeOf(staff: StaffContext, permission: string): string[] | null {
    const scope = this.authorization.scopeFor(staff, permission);
    return scope.allBranches ? null : scope.branchIds;
  }

  private async db<T>(task: () => Promise<T>, options?: DbGateRunOptions): Promise<T> {
    try {
      return await this.gate.run(task, options);
    } catch (error) {
      throw translateOrdersDbError(error);
    }
  }
}

interface PaymentResolution {
  view: PaymentOrderView;
  replayed: boolean;
  appliedByMe: boolean;
}
