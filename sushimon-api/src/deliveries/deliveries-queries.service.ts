import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { parseInstant } from '../branch-schedule/business-time.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import { DbGate, type DbGateRunOptions } from '../common/concurrency/db-gate.js';
import { dbErrorCodes } from '../common/db/db-error-codes.js';
import type { StaffContext } from '../identity/identity.types.js';
import { adminBranchNotFound } from '../orders/admin/order-admin-errors.js';
import {
  decodeDeliveryCursor,
  encodeDeliveryCursor,
  filterFingerprint,
} from './delivery-cursor.js';
import {
  deliveryCursorInvalid,
  deliveryNotFound,
  DELIVERIES_DB_GATE,
  translateDeliveriesDbError,
} from './delivery-errors.js';
import { availableDeliveryActionsFor, OPEN_STATUSES } from './delivery-policy.js';
import { toDetail, toSummary } from './delivery-view.js';
import { DeliveriesRepository } from './deliveries.repository.js';
import type { DeliveryRow } from './deliveries.types.js';
import {
  DELIVERY_LIST_DEFAULT_LIMIT,
  type ListAdminDeliveriesQuery,
} from './dto/deliveries-requests.dto.js';
import type { AdminDeliveryDto, AdminDeliveryPageDto } from './dto/deliveries-responses.dto.js';

/** Lecturas de bajo valor: con el cupo lleno se rechazan si ya hay 2 esperas; las plazas siguientes son de las escrituras. */
const READ_ADMISSION: DbGateRunOptions = { rejectIfWaiting: 2 };
const DAY_MS = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_RANGE_DAYS = 92;

/**
 * Lecturas del backoffice de entregas (F28, spec 029 §4.2 y §4.3): el alcance de `deliveries.read` se aplica EN SQL (anti-IDOR),
 * sin N+1 y sin PII del cliente en el listado. Presupuesto: listado 1 sentencia (+1 solo si una página VACÍA con `branchId` y
 * alcance global debe distinguir sucursal inexistente), detalle 2. Sin logs de datos personales.
 */
@Injectable()
export class DeliveriesQueriesService {
  constructor(
    @Inject(DeliveriesRepository) private readonly repo: DeliveriesRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DELIVERIES_DB_GATE) private readonly gate: DbGate,
  ) {}

  async list(staff: StaffContext, query: ListAdminDeliveriesQuery): Promise<AdminDeliveryPageDto> {
    const now = this.clock.now();
    const scope = this.authorization.scopeFor(staff, 'deliveries.read');
    // `branchId` fuera de alcance => 404 uniforme (como F22); un id inexistente con alcance global se detecta si la página queda vacía.
    if (
      query.branchId !== undefined &&
      !this.authorization.canAccess(staff, 'deliveries.read', query.branchId)
    ) {
      throw adminBranchNotFound();
    }
    const branchIds =
      query.branchId !== undefined ? [query.branchId] : scope.allBranches ? null : scope.branchIds;
    const statuses = query.status ?? [...OPEN_STATUSES];
    const { from, to } = this.range(query, now);
    const fingerprint = filterFingerprint({
      statuses,
      riderId: query.riderId ?? null,
      branchId: query.branchId ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
    });
    const cursor =
      query.cursor !== undefined ? decodeDeliveryCursor(query.cursor, fingerprint, now) : null;
    const limit = query.limit ?? DELIVERY_LIST_DEFAULT_LIMIT;

    return this.db(async () => {
      const rows = await this.repo.list({
        branchIds,
        statuses,
        riderId: query.riderId ?? null,
        from: new Date(from),
        to: to !== null ? new Date(to) : null,
        cursor,
        limit,
      });
      if (
        rows.length === 0 &&
        query.branchId !== undefined &&
        scope.allBranches &&
        !(await this.repo.branchExists(query.branchId))
      ) {
        throw adminBranchNotFound();
      }
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => toSummary(row, this.actionsFor(staff, row))),
        nextCursor:
          rows.length > limit && last
            ? encodeDeliveryCursor({ createdAtKey: last.createdAtKey, id: last.id }, fingerprint)
            : null,
        generatedAt: now.toISOString(),
      };
    }, READ_ADMISSION);
  }

  async detail(staff: StaffContext, id: string): Promise<AdminDeliveryDto> {
    const read = this.authorization.scopeFor(staff, 'deliveries.read');
    const orders = this.authorization.scopeFor(staff, 'orders.read');
    const update = this.authorization.scopeFor(staff, 'deliveries.update');
    const found = await this.db(
      () =>
        this.repo.findDetail(
          id,
          read.allBranches ? null : read.branchIds,
          orders.allBranches ? null : orders.branchIds,
          update.allBranches ? null : update.branchIds,
        ),
      READ_ADMISSION,
    );
    if (!found) throw deliveryNotFound();
    return toDetail(found, this.actionsFor(staff, found.row));
  }

  private actionsFor(staff: StaffContext, row: DeliveryRow) {
    return availableDeliveryActionsFor(row, row.orderStatus, (permission) =>
      this.authorization.canAccess(staff, permission, row.branchId),
    );
  }

  /** `from` por omisión = ahora − 7 días; `to` > `from`; rango <= 92 días. Solo acota `returned|cancelled`. */
  private range(query: ListAdminDeliveriesQuery, now: Date): { from: number; to: number | null } {
    const from =
      query.from !== undefined
        ? this.instant(query.from)
        : now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS;
    const to = query.to !== undefined ? this.instant(query.to) : null;
    if (to !== null && to <= from) throw new BadRequestException('to debe ser posterior a from');
    if ((to ?? now.getTime()) - from > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    }
    return { from, to };
  }

  private instant(value: string): number {
    const ms = parseInstant(value);
    if (ms === null) throw new BadRequestException('Fecha inválida (ISO 8601 con zona)');
    return ms;
  }

  private async db<T>(task: () => Promise<T>, options?: DbGateRunOptions): Promise<T> {
    try {
      return await this.gate.run(task, options);
    } catch (error) {
      // 22007/22008: instante inválido o fuera de rango en la BD (cursor manipulado que superó el formato) => 400, nunca 500.
      if (dbErrorCodes(error).some((c) => c === '22007' || c === '22008')) {
        throw deliveryCursorInvalid();
      }
      throw translateDeliveriesDbError(error);
    }
  }
}
