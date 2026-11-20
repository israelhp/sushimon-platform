import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import type { StaffContext } from '../identity/identity.types.js';
import type {
  CreateRiderRequest,
  UpdateRiderAvailabilityRequest,
  UpdateRiderRequest,
  UpdateRiderStatusRequest,
} from './dto/riders-requests.dto.js';
import type { AdminRiderDto } from './dto/riders-responses.dto.js';
import {
  changedFieldsOf,
  normalizeCreate,
  normalizeReason,
  normalizeUpdate,
} from './rider-policy.js';
import { toDetail } from './rider-view.js';
import {
  RIDER_ACTIVE_DELIVERIES_PORT,
  type RiderActiveDeliveriesPort,
} from './ports/rider-active-deliveries.port.js';
import {
  branchNotAvailable,
  riderActionForbidden,
  riderHasActiveDelivery,
  riderInactive,
  riderNotFound,
  RIDERS_DB_GATE,
  ridersBusy,
  riderVersionConflict,
  translateRidersDbError,
} from './riders-errors.js';
import { RidersRepository } from './riders.repository.js';
import type { RiderRecord, RidersTx } from './riders.types.js';

const ENTITY = 'rider';

/**
 * Comandos de motoristas (F27, spec 028 §3.2 y §7). Cada cambio y su auditoría van en UNA transacción corta (sin I/O externo).
 * Concurrencia: `expectedVersion` con CAS en la sentencia (edición), valor explícito idempotente (estado y disponibilidad) y
 * `SELECT … FOR UPDATE` en las transiciones peligrosas (desactivar, `UNAVAILABLE`, traslado), que F28 comparte. Precedencia:
 * 404 -> 403 `RIDER_ACTION_FORBIDDEN` -> 422 -> 409. Auditoría SIN nombre, teléfono ni placa; logs solo con ids.
 */
@Injectable()
export class RidersCommandsService {
  private readonly logger = new Logger(RidersCommandsService.name);

  constructor(
    @Inject(RidersRepository) private readonly repo: RidersRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(RIDER_ACTIVE_DELIVERIES_PORT) private readonly busyPort: RiderActiveDeliveriesPort,
    @Inject(RIDERS_DB_GATE) private readonly gate: DbGate,
  ) {}

  async create(staff: StaffContext, body: CreateRiderRequest): Promise<AdminRiderDto> {
    const data = normalizeCreate(body); // 400 antes de tocar la BD
    if (!this.authorization.canAccess(staff, 'riders.create', data.branchId)) {
      throw riderActionForbidden();
    }
    const rider = await this.db(
      () =>
        this.repo.transaction(async (tx) => {
          const created = await tx.insert(data);
          if (!created) throw branchNotAvailable();
          await tx.audit({
            actorId: staff.staffId,
            branchId: created.branchId,
            entityType: ENTITY,
            entityId: created.id,
            action: 'rider.created',
            newValues: {
              branchId: created.branchId,
              vehicleType: created.vehicleType,
              active: true,
              availability: 'UNAVAILABLE',
            },
          });
          return created;
        }),
      { branchCheck: true },
    );
    this.logger.log(`motorista creado riderId=${rider.id}`);
    return this.view(rider);
  }

  async update(staff: StaffContext, id: string, body: UpdateRiderRequest): Promise<AdminRiderDto> {
    const { expectedVersion, patch } = normalizeUpdate(body);
    const readScope = this.scopeOf(staff, 'riders.read');
    const moving = patch.branchId !== undefined;

    const rider = await this.db(
      () =>
        this.repo.transaction(async (tx) => {
          const found = await tx.read(id, readScope, {
            lock: moving,
            ...(patch.branchId !== undefined ? { destBranchId: patch.branchId } : {}),
          });
          if (!found) throw riderNotFound();
          const current = found.rider;
          if (!this.authorization.canAccess(staff, 'riders.update', current.branchId)) {
            throw riderActionForbidden();
          }
          const target = patch.branchId !== undefined && patch.branchId !== current.branchId;
          if (target) {
            if (!this.authorization.canAccess(staff, 'riders.update', patch.branchId ?? null)) {
              throw riderActionForbidden();
            }
            if (found.destActive !== true) throw branchNotAvailable();
          }
          if (current.version !== expectedVersion) throw riderVersionConflict(current.version);

          const changedFields = changedFieldsOf(current, patch);
          if (changedFields.length === 0 && !target) return current; // sin cambio real: ni escritura ni evento
          if (target) await this.assertNoActiveDelivery(tx, current.id);

          const effective = target ? patch : { ...patch, branchId: undefined };
          const updated = await tx.update(current.id, expectedVersion, current.branchId, effective);
          if (!updated) {
            const again = await tx.read(id, readScope);
            if (!again) throw riderNotFound();
            throw riderVersionConflict(again.rider.version);
          }
          if (changedFields.length > 0) {
            await tx.audit({
              actorId: staff.staffId,
              branchId: updated.branchId,
              entityType: ENTITY,
              entityId: updated.id,
              action: 'rider.updated',
              newValues: { changedFields },
            });
          }
          if (target) {
            await tx.audit({
              actorId: staff.staffId,
              branchId: updated.branchId,
              entityType: ENTITY,
              entityId: updated.id,
              action: 'rider.branch_changed',
              oldValues: { branchId: current.branchId },
              newValues: { branchId: updated.branchId, availability: 'UNAVAILABLE' },
            });
          }
          return updated;
        }),
      { branchCheck: true },
    );
    return this.view(rider);
  }

  async setStatus(
    staff: StaffContext,
    id: string,
    body: UpdateRiderStatusRequest,
  ): Promise<AdminRiderDto> {
    const readScope = this.scopeOf(staff, 'riders.read');
    const reason = normalizeReason(body.reason);
    const rider = await this.db(() =>
      this.repo.transaction(async (tx) => {
        const found = await tx.read(id, readScope, { lock: !body.active });
        if (!found) throw riderNotFound();
        const current = found.rider;
        if (!this.authorization.canAccess(staff, 'riders.update', current.branchId)) {
          throw riderActionForbidden();
        }
        if (current.active === body.active) return current; // idempotente: sin escritura ni evento
        if (!body.active) await this.assertNoActiveDelivery(tx, current.id);

        const updated = await tx.setActive(current.id, current.branchId, body.active);
        if (!updated)
          return this.settled(tx, id, readScope, current, (r) => r.active === body.active);
        await tx.audit({
          actorId: staff.staffId,
          branchId: updated.branchId,
          entityType: ENTITY,
          entityId: updated.id,
          action: body.active ? 'rider.activated' : 'rider.deactivated',
          reason,
          oldValues: { active: current.active },
          newValues: { active: updated.active, availability: updated.availability },
        });
        return updated;
      }),
    );
    return this.view(rider);
  }

  async setAvailability(
    staff: StaffContext,
    id: string,
    body: UpdateRiderAvailabilityRequest,
  ): Promise<AdminRiderDto> {
    const readScope = this.scopeOf(staff, 'riders.read');
    const rider = await this.db(() =>
      this.repo.transaction(async (tx) => {
        const found = await tx.read(id, readScope, { lock: body.availability === 'UNAVAILABLE' });
        if (!found) throw riderNotFound();
        const current = found.rider;
        if (!this.authorization.canAccess(staff, 'riders.update', current.branchId)) {
          throw riderActionForbidden();
        }
        if (body.availability === 'AVAILABLE' && !current.active) throw riderInactive();
        if (current.availability === body.availability) return current; // idempotente
        if (body.availability === 'UNAVAILABLE') await this.assertNoActiveDelivery(tx, current.id);

        const updated = await tx.setAvailability(current.id, current.branchId, body.availability);
        if (!updated) {
          const again = await tx.read(id, readScope);
          if (again && body.availability === 'AVAILABLE' && !again.rider.active) {
            throw riderInactive();
          }
          return this.settled(
            tx,
            id,
            readScope,
            current,
            (r) => r.availability === body.availability,
          );
        }
        await tx.audit({
          actorId: staff.staffId,
          branchId: updated.branchId,
          entityType: ENTITY,
          entityId: updated.id,
          action: 'rider.availability_changed',
          oldValues: { availability: current.availability },
          newValues: { availability: updated.availability },
        });
        return updated;
      }),
    );
    return this.view(rider);
  }

  /**
   * Un escritor concurrente se adelantó: se relee; si ya tiene el valor pedido (en la misma sucursal) es «sin cambio» (200 sin
   * auditar). Cualquier otro estado intermedio es reintentable (503).
   */
  private async settled(
    tx: RidersTx,
    id: string,
    scope: string[] | null,
    before: RiderRecord,
    satisfied: (r: RiderRecord) => boolean,
  ): Promise<RiderRecord> {
    const again = await tx.read(id, scope);
    if (!again) throw riderNotFound();
    if (again.rider.branchId === before.branchId && satisfied(again.rider)) return again.rider;
    throw ridersBusy();
  }

  /** Solo cuando el puerto afirma conocer las entregas (`known`) y el motorista tiene una activa. */
  private async assertNoActiveDelivery(tx: RidersTx, riderId: string): Promise<void> {
    const busy = await this.busyPort.findBusy({ riderIds: [riderId] }, tx.client);
    if (busy.known && busy.busyIds.has(riderId)) throw riderHasActiveDelivery();
  }

  private async view(rider: RiderRecord): Promise<AdminRiderDto> {
    const busy = await this.db(() => this.busyPort.findBusy({ riderIds: [rider.id] }));
    return toDetail(rider, busy);
  }

  private scopeOf(staff: StaffContext, permission: string): string[] | null {
    const scope = this.authorization.scopeFor(staff, permission);
    return scope.allBranches ? null : scope.branchIds;
  }

  private async db<T>(task: () => Promise<T>, ctx: { branchCheck?: boolean } = {}): Promise<T> {
    try {
      return await this.gate.run(task);
    } catch (error) {
      throw translateRidersDbError(error, ctx);
    }
  }
}
