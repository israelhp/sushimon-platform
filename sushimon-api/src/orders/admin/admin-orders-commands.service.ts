import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuthorizationService } from '../../auth/authorization.service.js';
import { DbGate } from '../../common/concurrency/db-gate.js';
import type { StaffContext } from '../../identity/identity.types.js';
import { ORDERS_DB_GATE, translateOrdersDbError } from '../orders-errors.js';
import {
  ORDER_FULFILLMENT_PORT,
  type OrderFulfillmentPort,
} from '../ports/order-fulfillment.port.js';
import {
  ORDER_PAYMENT_READ_PORT,
  type OrderPaymentReadPort,
} from '../ports/order-payment-read.port.js';
import { actionsForStaff } from './admin-orders.actions.js';
import { toSummary } from './admin-orders.mapper.js';
import { AdminOrdersRepository } from './admin-orders.repository.js';
import type { AdminOrderRow } from './admin-orders.types.js';
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN } from './dto/admin-orders-requests.dto.js';
import type { AdminOrderTransitionResultDto } from './dto/admin-orders-responses.dto.js';
import {
  adminOrderNotFound,
  orderActionForbidden,
  orderReasonRequired,
} from './order-admin-errors.js';
import {
  COMMAND_SPECS,
  isOrderStatus,
  type OrderCommand,
  type OrderStatus,
} from './order-transition.matrix.js';
import { OrderTransitionsService } from './order-transitions.service.js';

/** Control (Cc), formato (Cf: bidi, ancho cero…) y separadores de línea/párrafo (Zl, Zp). */
export const FORBIDDEN_REASON_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Comandos de transición del backoffice (F22): validan, autorizan por recurso, aplican y calculan `pendingActions`. */
@Injectable()
export class AdminOrdersCommandsService {
  private readonly logger = new Logger(AdminOrdersCommandsService.name);

  constructor(
    @Inject(AdminOrdersRepository) private readonly repo: AdminOrdersRepository,
    @Inject(OrderTransitionsService) private readonly transitions: OrderTransitionsService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ORDERS_DB_GATE) private readonly gate: DbGate,
    @Inject(ORDER_FULFILLMENT_PORT) private readonly fulfillment: OrderFulfillmentPort,
    @Inject(ORDER_PAYMENT_READ_PORT) private readonly payments: OrderPaymentReadPort,
  ) {}

  async execute(
    staff: StaffContext,
    command: OrderCommand,
    orderId: string,
    body: { expectedStatus: string; reason?: string | undefined },
  ): Promise<AdminOrderTransitionResultDto> {
    const spec = COMMAND_SPECS[command];
    const reason = spec.reasonRequired ? this.normalizeReason(body.reason) : null;
    const expectedStatus = body.expectedStatus;
    if (!isOrderStatus(expectedStatus)) throw new BadRequestException('expectedStatus inválido');

    // Sin `rejectIfWaiting`: las escrituras del personal tienen prioridad sobre el sondeo (spec §7).
    const outcome = await this.db(() =>
      this.repo.transaction((tx) =>
        this.transitions.apply(tx, {
          orderId,
          expectedStatus,
          to: spec.to,
          actor: { kind: 'staff', staffId: staff.staffId },
          reason,
          auditAction: spec.auditAction,
          authorize: (order) => {
            // 404 uniforme si no ve el pedido; 403 solo si lo ve pero no tiene el permiso del comando EN SU sucursal.
            if (!this.authorization.canAccess(staff, 'orders.read', order.branchId)) {
              throw adminOrderNotFound();
            }
            if (!this.authorization.canAccess(staff, spec.permission, order.branchId)) {
              throw orderActionForbidden();
            }
          },
        }),
      ),
    );

    // Tras el COMMIT y en solo lectura: un fallo de un puerto jamás revierte ni retrasa la transición.
    const pendingActions = spec.reasonRequired ? await this.pendingActionsOf(outcome.order) : [];
    return {
      order: toSummary(outcome.order, actionsForStaff(this.authorization, staff, outcome.order)),
      transition: {
        from: outcome.from,
        to: outcome.to,
        at: outcome.at.toISOString(),
        replayed: outcome.replayed,
        appliedByMe: outcome.appliedByMe,
      },
      pendingActions,
    };
  }

  /** `reject`/`cancel`: recortado, 3..280, sin caracteres de control. Ausente/vacío/corto => `ORDER_REASON_REQUIRED`. */
  private normalizeReason(raw: string | undefined): string {
    const reason = typeof raw === 'string' ? raw.trim() : '';
    if (reason.length < ADMIN_REASON_MIN) throw orderReasonRequired();
    if (reason.length > ADMIN_REASON_MAX || FORBIDDEN_REASON_CHARS.test(reason)) {
      throw new BadRequestException('reason inválido');
    }
    return reason;
  }

  private async pendingActionsOf(
    order: AdminOrderRow,
  ): Promise<('payment_review' | 'delivery_cancellation')[]> {
    const out: ('payment_review' | 'delivery_cancellation')[] = [];
    try {
      const pay = await this.payments.inspect(order.id);
      out.push(...pay.pendingActions);
    } catch {
      this.logger.warn(`OrderPaymentReadPort falló orderId=${order.id}`);
    }
    try {
      const delivery = await this.fulfillment.inspect({
        orderId: order.id,
        branchId: order.branchId,
        fulfillmentType: order.fulfillmentType as 'PICKUP' | 'DELIVERY',
        deliveryProvider: order.deliveryProvider as 'OWN' | 'PEDIDOSYA' | null,
        status: order.status as OrderStatus,
      });
      out.push(...delivery.pendingActions);
    } catch {
      this.logger.warn(`OrderFulfillmentPort falló orderId=${order.id}`);
    }
    return out;
  }

  private async db<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await this.gate.run(task);
    } catch (error) {
      throw translateOrdersDbError(error);
    }
  }
}
