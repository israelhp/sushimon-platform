import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import type { StaffContext } from '../identity/identity.types.js';
import { AdminOrdersRepository } from '../orders/admin/admin-orders.repository.js';
import { adminOrderNotFound, orderStateConflict } from '../orders/admin/order-admin-errors.js';
import { OrderTransitionsService } from '../orders/admin/order-transitions.service.js';
import { riderNotFound } from '../riders/riders-errors.js';
import { RiderEligibilityService } from '../riders/rider-eligibility.service.js';
import {
  classifyDeliveryDbError,
  deliveriesBusy,
  deliveryActionForbidden,
  deliveryNotFound,
  deliveryOrderNotEligible,
  deliveryReasonRequired,
  deliveryStateConflict,
  DELIVERIES_DB_GATE,
  riderNotEligible,
  translateDeliveriesDbError,
} from './delivery-errors.js';
import {
  availableDeliveryActionsFor,
  COMMAND_SPECS,
  INVALID_REASON,
  isOpen,
  normalizeDeliveryReason,
  orderEligibilityViolations,
  type DeliveryCommand,
  type DeliveryCommandSpec,
} from './delivery-policy.js';
import { toSummary } from './delivery-view.js';
import { DeliveriesRepository } from './deliveries.repository.js';
import type { DeliveriesTx, DeliveryRow, OrderForDelivery } from './deliveries.types.js';
import type { AdminDeliveryCommandResultDto } from './dto/deliveries-responses.dto.js';

const ENTITY = 'delivery';

/** Comandos de estado (todos menos asignar, que tiene su propio algoritmo de bloqueos). */
export type SimpleDeliveryCommand = Exclude<DeliveryCommand, 'assign'>;

/** Resultado de un comando: `replayed` decide el código HTTP en la creación (200 repetición, 201 crea/reabre). */
export type CommandOutcome = AdminDeliveryCommandResultDto;

interface FailureContext {
  deliveryId?: string;
  orderId?: string;
  assign?: boolean;
  /** `true` solo cuando el actor YA superó 404/403: únicamente entonces un error de guarda se explica con el estado vigente. */
  authorized: boolean;
}

/**
 * Comandos de entregas propias (F28, spec 029 §3.2, §6, §9 y §10). Cada comando es UNA transacción corta, en UN solo `gate.run`,
 * con el orden de bloqueos motorista → entrega → pedido (S2: SIEMPRE se lee sin bloqueo, se autoriza y SOLO entonces se bloquea;
 * un actor sin permiso o alcance no bloquea ninguna fila): solo asignar bloquea al motorista; el pedido solo cambia por
 * `OrderTransitionsService.apply` (misma transacción, `allowOwnDispatch`, `authorize` explícito) y NUNCA por SQL directo.
 * Precedencia: 401 → 403 (permiso base/aal2) → 400 (forma) → 404 (alcance) → 403 `DELIVERY_ACTION_FORBIDDEN` → 404
 * `RIDER_NOT_FOUND` → 409 (versión/estado, incluida la repetición idempotente) → 422 (elegibilidad). Repeticiones, conflictos y
 * rechazos NO escriben nada. Auditoría SIN PII (solo ids y estados); logs solo con ids.
 */
@Injectable()
export class DeliveriesCommandsService {
  private readonly logger = new Logger(DeliveriesCommandsService.name);

  constructor(
    @Inject(DeliveriesRepository) private readonly repo: DeliveriesRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(OrderTransitionsService) private readonly transitions: OrderTransitionsService,
    @Inject(AdminOrdersRepository) private readonly orders: AdminOrdersRepository,
    @Inject(RiderEligibilityService) private readonly eligibility: RiderEligibilityService,
    @Inject(DELIVERIES_DB_GATE) private readonly gate: DbGate,
  ) {}

  // ---------- crear / reabrir ----------

  async create(staff: StaffContext, orderId: string): Promise<CommandOutcome> {
    const readScope = this.scopeOf(staff, 'deliveries.read');
    // S5: el pedido se autoriza TAMBIÉN con `orders.read` en su sucursal (intersección de alcances EN SQL): sin él, 404 uniforme
    // `ORDER_NOT_FOUND` (igual que un pedido fuera de alcance), sin desglose de qué permiso falta.
    const orderScope = intersectScopes(readScope, this.scopeOf(staff, 'orders.read'));
    const ctx: FailureContext = { orderId, authorized: false };
    const outcome = await this.db(
      () =>
        this.repo.transaction(async (tx) => {
          const order = await tx.readOrderForCreate(orderId, orderScope);
          if (!order) throw adminOrderNotFound();
          if (!this.authorization.canAccess(staff, 'deliveries.assign', order.branchId)) {
            throw deliveryActionForbidden();
          }
          ctx.authorized = true;
          const existing = order.existing;
          if (existing) {
            if (isOpen(existing.status))
              return this.replayExisting(tx, staff, existing.id, readScope);
            if (existing.status === 'returned') throw deliveryStateConflict(existing);
            // `cancelled`: se REABRE (el historial conserva el ciclo anterior); exige el pedido todavía despachable.
            this.assertOrderEligible(order);
            const reopened = await tx.change({
              id: existing.id,
              expectedVersion: existing.version,
              fromStatuses: ['cancelled'],
              change: { kind: 'reopen' },
              event: 'reopened',
              oldStatus: 'cancelled',
              historyRiderId: null,
              reason: null,
              changedBy: staff.staffId,
            });
            if (!reopened) return this.replayExisting(tx, staff, existing.id, readScope, true);
            await this.record(tx, staff, 'delivery.reopened', reopened, null, 'cancelled');
            return this.applied(staff, reopened, 'cancelled', 'reopened');
          }
          this.assertOrderEligible(order);
          const created = await tx.insert(order.orderId, order.branchId, staff.staffId);
          // 0 filas = otra transacción creó la entrega entre la lectura y el INSERT (UNIQUE(order_id)): idempotente.
          if (!created) {
            const again = await tx.readOrderForCreate(orderId, orderScope);
            if (!again?.existing) throw deliveriesBusy();
            return this.replayExisting(tx, staff, again.existing.id, readScope, true);
          }
          await this.record(tx, staff, 'delivery.created', created, null, null);
          return this.applied(staff, created, null, 'created');
        }),
      ctx,
    );
    if (!outcome.transition.replayed) {
      this.logger.log(`entrega ${outcome.transition.event} deliveryId=${outcome.delivery.id}`);
    }
    return outcome;
  }

  // ---------- asignar / reasignar ----------

  async assign(
    staff: StaffContext,
    id: string,
    body: { riderId: string; expectedVersion: number },
  ): Promise<CommandOutcome> {
    const spec = COMMAND_SPECS.assign;
    const readScope = this.scopeOf(staff, 'deliveries.read');
    const ctx: FailureContext = { deliveryId: id, assign: true, authorized: false };
    const outcome = await this.db(
      () =>
        this.repo.transaction(async (tx) => {
          // 1. Lectura con alcance, SIN bloqueo: 404 uniforme / 403 por sucursal de la entrega.
          const visible = await tx.readDelivery(id, readScope);
          if (!visible) throw deliveryNotFound();
          this.assertCan(staff, spec.permissions, visible.branchId);
          ctx.authorized = true;
          // 2. Bloqueo del MOTORISTA (primero del orden), ya autorizado el actor. El alcance de `riders.read` va EN el SQL del
          //    bloqueo (S2): inexistente, de otra sucursal o sin alcance => 404 uniforme y NINGUNA fila bloqueada.
          const rider = await tx.lockRider(body.riderId, this.scopeOf(staff, 'riders.read'));
          if (!rider || !this.authorization.canAccess(staff, 'riders.read', rider.branchId)) {
            throw riderNotFound();
          }
          // 3. Relectura bloqueada: entrega y luego pedido (FOR UPDATE OF d FOR SHARE OF o).
          const locked = await tx.readDeliveryLocked(id);
          if (!locked) throw deliveryNotFound();
          // Repetición: ya asignada a ESTE motorista => 200 `replayed` sin escribir (estado deseado alcanzado).
          if (locked.status === 'assigned' && locked.riderId === body.riderId) {
            return this.replayResult(staff, locked);
          }
          if (
            !(spec.from as readonly string[]).includes(locked.status) ||
            locked.version !== body.expectedVersion
          ) {
            throw deliveryStateConflict(locked);
          }
          this.assertOrderEligible({
            status: locked.orderStatus,
            fulfillmentType: locked.fulfillmentType,
            deliveryProvider: locked.deliveryProvider,
          });
          // 4. Elegibilidad (F27) con la MISMA transacción, tras el bloqueo del motorista. `branchId` sale de la BD.
          const eligibility = await this.eligibility.evaluate(
            { riderId: body.riderId, branchId: locked.branchId },
            tx.client,
          );
          if (eligibility.reasons.includes('NOT_FOUND')) throw riderNotFound();
          // Falla CERRADO: jamás se asigna con un puerto de ocupación que no conoce las entregas.
          if (!eligibility.busyKnown) throw deliveriesBusy();
          if (!eligibility.eligible) {
            throw riderNotEligible(
              eligibility.reasons.filter(
                (r): r is Exclude<typeof r, 'NOT_FOUND'> => r !== 'NOT_FOUND',
              ),
            );
          }
          const reassign = locked.status === 'assigned';
          const updated = await tx.change({
            id,
            expectedVersion: body.expectedVersion,
            fromStatuses: spec.from,
            change: { kind: 'assign', riderId: body.riderId },
            event: reassign ? 'rider_reassigned' : 'rider_assigned',
            oldStatus: locked.status,
            historyRiderId: body.riderId,
            reason: null,
            changedBy: staff.staffId,
          });
          if (!updated) throw await this.conflictOf(tx, id, readScope);
          await this.record(
            tx,
            staff,
            reassign ? 'delivery.rider_reassigned' : 'delivery.rider_assigned',
            updated,
            null,
            locked.status,
            locked.riderId,
          );
          return this.applied(
            staff,
            updated,
            locked.status,
            reassign ? 'rider_reassigned' : 'rider_assigned',
          );
        }),
      ctx,
    );
    if (!outcome.transition.replayed) {
      this.logger.log(`entrega ${outcome.transition.event} deliveryId=${id}`);
    }
    return outcome;
  }

  // ---------- desasignar, recoger, entregar, retorno, cancelar ----------

  async execute(
    staff: StaffContext,
    command: SimpleDeliveryCommand,
    id: string,
    body: { expectedVersion: number; reason?: string | null | undefined },
  ): Promise<CommandOutcome> {
    const spec = COMMAND_SPECS[command];
    const reason = this.reasonOf(spec, body.reason); // 400 antes de tocar la BD
    const readScope = this.scopeOf(staff, 'deliveries.read');
    const ctx: FailureContext = { deliveryId: id, authorized: false };
    const outcome = await this.db(
      () =>
        this.repo.transaction(async (tx) => {
          // 1. Lectura con alcance SIN bloqueo y autorización (S2); solo entonces `FOR UPDATE OF d` (la entrega es el primer
          //    bloqueo; no hay motorista que bloquear). El último evento solo se lee en la relectura bloqueada (P5).
          const visible = await tx.readDelivery(id, readScope);
          if (!visible) throw deliveryNotFound();
          this.assertCan(staff, spec.permissions, visible.branchId);
          ctx.authorized = true;
          const found = await tx.readDelivery(id, readScope, { lock: true, lastEvent: true });
          if (!found) throw deliveryNotFound();
          // Repetición idempotente: ya en el destino, `version = esperada + 1` y último evento = este comando.
          if (this.isReplay(found, spec, body.expectedVersion))
            return this.replayResult(staff, found);
          if (
            !(spec.from as readonly string[]).includes(found.status) ||
            found.version !== body.expectedVersion
          ) {
            throw deliveryStateConflict(found);
          }
          // 2. El pedido (si el comando lo mueve) cambia SOLO por `apply`, en ESTA transacción: entrega → pedido.
          if (spec.order) await this.applyOrderStep(tx, staff, spec, found);
          // 3. Entrega + historial (CAS por versión y estado).
          const updated = await tx.change({
            id,
            expectedVersion: body.expectedVersion,
            fromStatuses: spec.from,
            change: this.changeOf(command),
            event: spec.event,
            oldStatus: found.status,
            historyRiderId: found.riderId,
            reason,
            changedBy: staff.staffId,
          });
          if (!updated) throw await this.conflictOf(tx, id, readScope);
          await this.record(
            tx,
            staff,
            spec.auditAction,
            updated,
            reason,
            found.status,
            found.riderId,
          );
          return this.applied(staff, updated, found.status, spec.event);
        }),
      ctx,
    );
    if (!outcome.transition.replayed) {
      this.logger.log(`entrega ${spec.event} deliveryId=${id}`);
    }
    return outcome;
  }

  // ---------- piezas ----------

  private changeOf(command: SimpleDeliveryCommand) {
    switch (command) {
      case 'unassign':
        return { kind: 'unassign' } as const;
      case 'mark_picked_up':
        return { kind: 'pick_up' } as const;
      case 'mark_delivered':
        return { kind: 'deliver' } as const;
      case 'return_to_branch':
        return { kind: 'return' } as const;
      case 'cancel':
        return { kind: 'cancel' } as const;
    }
  }

  private async applyOrderStep(
    tx: DeliveriesTx,
    staff: StaffContext,
    spec: DeliveryCommandSpec,
    found: DeliveryRow,
  ): Promise<void> {
    const step = spec.order;
    if (!step) return;
    const outcome = await this.transitions.apply(this.orders.transitionTx(tx.client), {
      orderId: found.orderId,
      expectedStatus: step.expected,
      to: step.to,
      actor: { kind: 'staff', staffId: staff.staffId },
      auditAction: step.auditAction,
      allowOwnDispatch: true,
      // El despacho es una acción logística: se autoriza con `deliveries.update` EN la sucursal del pedido (no `orders.*`).
      authorize: (order) => {
        if (!this.authorization.canAccess(staff, 'deliveries.update', order.branchId)) {
          throw deliveryActionForbidden();
        }
      },
    });
    // `apply` informa repetición pero la ENTREGA no lo era: estados divergentes (no puede ocurrir por la coherencia diferida).
    if (outcome.replayed) {
      throw orderStateConflict({
        status: outcome.order.status,
        updatedAt: outcome.order.updatedAt,
      });
    }
  }

  private reasonOf(spec: DeliveryCommandSpec, raw: string | null | undefined): string | null {
    if (spec.reason === 'none') return null;
    const text = typeof raw === 'string' ? raw : undefined;
    const reason = normalizeDeliveryReason(
      text,
      spec.reason === 'required' ? 'required' : 'optional',
    );
    if (reason === INVALID_REASON) throw deliveryReasonRequired();
    return reason;
  }

  private assertCan(staff: StaffContext, permissions: readonly string[], branchId: string): void {
    if (!permissions.every((p) => this.authorization.canAccess(staff, p, branchId))) {
      throw deliveryActionForbidden();
    }
  }

  private assertOrderEligible(
    order: Pick<OrderForDelivery, 'status' | 'fulfillmentType' | 'deliveryProvider'>,
  ): void {
    const violations = orderEligibilityViolations(order);
    if (violations.length > 0) throw deliveryOrderNotEligible(violations);
  }

  private isReplay(
    found: DeliveryRow,
    spec: DeliveryCommandSpec,
    expectedVersion: number,
  ): boolean {
    return (
      found.status === spec.to &&
      found.version === expectedVersion + 1 &&
      found.lastEvent?.event === spec.event
    );
  }

  /** Entrega ya existente y abierta (o creada por una carrera): 200 `replayed` con la fila vigente, SIN escribir. */
  private async replayExisting(
    tx: DeliveriesTx,
    staff: StaffContext,
    deliveryId: string,
    scope: string[] | null,
    afterRace = false,
  ): Promise<CommandOutcome> {
    const row = await tx.readDelivery(deliveryId, scope, { lastEvent: true });
    if (!row) throw deliveryNotFound();
    // Tras una carrera la entrega puede haberse movido a un estado terminal: no es una repetición del «crear».
    if (afterRace && !isOpen(row.status)) throw deliveryStateConflict(row);
    return this.replayResult(staff, row);
  }

  private replayResult(staff: StaffContext, row: DeliveryRow): CommandOutcome {
    const last = row.lastEvent ?? null;
    return {
      delivery: toSummary(row, this.actionsFor(staff, row)),
      transition: {
        from: last?.oldStatus ?? null,
        to: row.status,
        event: last?.event ?? 'created',
        at: (last?.changedAt ?? row.createdAt).toISOString(),
        replayed: true,
        appliedByMe: last !== null && last.changedBy === staff.staffId,
      },
    };
  }

  private applied(
    staff: StaffContext,
    row: DeliveryRow,
    from: string | null,
    event: string,
  ): CommandOutcome {
    return {
      delivery: toSummary(row, this.actionsFor(staff, row)),
      transition: {
        from,
        to: row.status,
        event,
        at: row.updatedAt.toISOString(),
        replayed: false,
        appliedByMe: true,
      },
    };
  }

  private async record(
    tx: DeliveriesTx,
    staff: StaffContext,
    action: string,
    after: DeliveryRow,
    reason: string | null,
    oldStatus: string | null,
    oldRiderId: string | null = null,
  ): Promise<void> {
    await tx.audit({
      actorId: staff.staffId,
      branchId: after.branchId,
      entityType: ENTITY,
      entityId: after.id,
      action,
      reason,
      // Solo ids y estados (spec §10): jamás nombre, teléfono, dirección ni motivo en los valores.
      oldValues:
        oldStatus === null
          ? null
          : { status: oldStatus, riderId: oldRiderId, orderId: after.orderId },
      newValues: { status: after.status, riderId: after.riderId, orderId: after.orderId },
    });
  }

  /** El CAS no encontró la fila (otra transacción ganó): relee y responde 409 con el estado VIGENTE. */
  private async conflictOf(tx: DeliveriesTx, id: string, scope: string[] | null): Promise<Error> {
    const again = await tx.readDelivery(id, scope);
    return again ? deliveryStateConflict(again) : deliveryNotFound();
  }

  private actionsFor(staff: StaffContext, row: DeliveryRow) {
    return availableDeliveryActionsFor(row, row.orderStatus, (permission) =>
      this.authorization.canAccess(staff, permission, row.branchId),
    );
  }

  private scopeOf(staff: StaffContext, permission: string): string[] | null {
    const scope = this.authorization.scopeFor(staff, permission);
    return scope.allBranches ? null : scope.branchIds;
  }

  /**
   * Un solo `gate.run` por operación. Traducción de errores de BD: `23505` del índice «una entrega activa por motorista» =>
   * 422 `RIDER_NOT_ELIGIBLE`/`BUSY` (la carrera pierde); `23514`/`42501` (guardas y coherencia diferida: otra transacción movió
   * la entrega o el pedido) => 409 con el estado vigente (releído FUERA de la transacción fallida y solo si el actor ya estaba
   * autorizado); `55P03`/ocupado => 503 `DELIVERIES_BUSY`. Mensajes internos del trigger nunca salen.
   */
  private async db<T>(task: () => Promise<T>, ctx: FailureContext): Promise<T> {
    try {
      return await this.gate.run(task);
    } catch (error) {
      const kind = classifyDeliveryDbError(error, { assign: ctx.assign === true });
      if (kind === 'rider_busy') throw riderNotEligible(['BUSY']);
      if (kind === 'guard' || kind === 'order_has_active_delivery') {
        throw await this.conflictAfterGuard(ctx);
      }
      throw translateDeliveriesDbError(error);
    }
  }

  private async conflictAfterGuard(ctx: FailureContext): Promise<unknown> {
    if (!ctx.authorized) return deliveriesBusy();
    try {
      if (ctx.deliveryId) {
        const current = await this.repo.currentOf(ctx.deliveryId);
        if (current) return deliveryStateConflict(current);
      } else if (ctx.orderId) {
        const current = await this.repo.orderCurrentOf(ctx.orderId);
        if (current) return orderStateConflict(current);
      }
    } catch {
      // la relectura falló: se responde reintentable
    }
    return deliveriesBusy();
  }
}

/** Intersección de dos alcances de sucursal (`null` = todas): lista vacía = ninguna. */
function intersectScopes(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const allowed = new Set(b);
  return a.filter((id) => allowed.has(id));
}
