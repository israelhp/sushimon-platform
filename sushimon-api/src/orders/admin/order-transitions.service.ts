import { Injectable } from '@nestjs/common';
import {
  adminOrderNotFound,
  orderStateConflict,
  orderTransitionInvalid,
} from './order-admin-errors.js';
import { evaluateTransition } from './order-transition.matrix.js';
import type { AdminOrderRow, TransitionTx } from './admin-orders.types.js';

export type TransitionActor = { kind: 'staff'; staffId: string } | { kind: 'system' };

export interface ApplyTransitionInput {
  orderId: string;
  expectedStatus: string;
  to: string;
  actor: TransitionActor;
  reason?: string | null;
  /** Acción de auditoría (`order.accepted`, …). */
  auditAction: string;
  /**
   * Autorización por recurso, OBLIGATORIA: se invoca tras leer el pedido y ANTES de la matriz (404/403). Los actores `system`
   * (p. ej. F28) pasan un callback explícito que documente por qué no hay autorización de personal
   * (`() => undefined`); omitirlo es un error de programación y falla.
   */
  authorize: (order: AdminOrderRow) => void;
  /** Solo F28: habilita `ready → on_the_way` / `on_the_way → delivered` en entrega propia. */
  allowOwnDispatch?: boolean;
}

export interface TransitionOutcome {
  /** Fila del pedido DESPUÉS de la transición (o la vigente en una repetición). */
  order: AdminOrderRow;
  from: string;
  to: string;
  /** Momento real en que se aplicó (en una repetición, el de la original). */
  at: Date;
  replayed: boolean;
  appliedByMe: boolean;
}

/**
 * ÚNICO servicio de dominio que escribe `orders.status` (F22, spec 023 §5 y §9; F28 lo reutiliza con SU transacción).
 * Compare-and-set sobre `status` (monótono: sin ABA), historial y auditoría en la misma transacción, repetición idempotente.
 * No decide permisos de rol: eso lo hace `authorize` (resource-level) y el controlador. No llama a servicios externos.
 */
@Injectable()
export class OrderTransitionsService {
  async apply(tx: TransitionTx, input: ApplyTransitionInput): Promise<TransitionOutcome> {
    const { orderId, expectedStatus: expected, to } = input;
    if (typeof input.authorize !== 'function') {
      throw new Error('OrderTransitionsService.apply exige `authorize` (callback explícito)');
    }
    const staffId = input.actor.kind === 'staff' ? input.actor.staffId : null;

    const order = await tx.readOrder(orderId);
    if (!order) throw adminOrderNotFound();
    input.authorize(order);

    const verdict = evaluateTransition(
      expected,
      to,
      { fulfillmentType: order.fulfillmentType, deliveryProvider: order.deliveryProvider },
      { allowOwnDispatch: input.allowOwnDispatch === true },
    );
    if (!verdict.ok) {
      throw orderTransitionInvalid(verdict.code, {
        status: order.status,
        updatedAt: order.updatedAt,
      });
    }

    if (order.status === expected) {
      const at = await tx.casAndRecord({
        orderId,
        expected,
        to,
        changedBy: staffId,
        reason: input.reason ?? null,
      });
      if (at) {
        await tx.audit({
          actorId: staffId,
          branchId: order.branchId,
          entityType: 'order',
          entityId: orderId,
          action: input.auditAction,
          reason: input.reason ?? null,
          oldValues: { status: expected, fulfillmentType: order.fulfillmentType },
          newValues: { status: to, fulfillmentType: order.fulfillmentType },
        });
        return {
          order: { ...order, status: to, updatedAt: at },
          from: expected,
          to,
          at,
          replayed: false,
          appliedByMe: true,
        };
      }
    }

    // Otra transacción ganó, o la persona veía un estado viejo: ¿repetición exacta o conflicto?
    const state = await tx.readState(orderId);
    if (!state) throw adminOrderNotFound();
    const last = state.lastEvent;
    if (
      state.status === to &&
      last !== null &&
      last.oldStatus === expected &&
      last.newStatus === to
    ) {
      return {
        order: { ...order, status: state.status, updatedAt: state.updatedAt },
        from: expected,
        to,
        at: last.changedAt,
        replayed: true,
        appliedByMe: staffId !== null && last.changedBy === staffId,
      };
    }
    throw orderStateConflict({ status: state.status, updatedAt: state.updatedAt });
  }
}
