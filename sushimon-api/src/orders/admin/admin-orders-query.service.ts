import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../../auth/authorization.service.js';
import { CLOCK, type Clock } from '../../branch-schedule/clock.js';
import { parseInstant } from '../../branch-schedule/business-time.js';
import { DbGate, type DbGateRunOptions } from '../../common/concurrency/db-gate.js';
import type { StaffContext } from '../../identity/identity.types.js';
import { ORDERS_DB_GATE, translateOrdersDbError } from '../orders-errors.js';
import { actionsForStaff } from './admin-orders.actions.js';
import { decodeCursor, encodeCursor } from './admin-orders-cursor.js';
import { toBoard, toDetail, toSummary } from './admin-orders.mapper.js';
import { AdminOrdersRepository } from './admin-orders.repository.js';
import type { ListFilter } from './admin-orders.types.js';
import {
  ADMIN_BOARD_DEFAULT_LIMIT,
  ADMIN_LIST_DEFAULT_LIMIT,
  type BoardAdminOrdersQuery,
  type ListAdminOrdersQuery,
} from './dto/admin-orders-requests.dto.js';
import type {
  AdminOrderBoardDto,
  AdminOrderDetailDto,
  AdminOrderPageDto,
  AdminOrderSummaryDto,
} from './dto/admin-orders-responses.dto.js';
import { dbErrorCodes } from '../../common/db/db-error-codes.js';
import {
  adminBranchNotFound,
  adminOrderNotFound,
  orderCursorInvalid,
} from './order-admin-errors.js';

/** Lecturas de bajo valor: con el cupo lleno se rechazan si ya hay 2 esperas; las plazas 3..8 son de las escrituras. */
const READ_ADMISSION: DbGateRunOptions = { rejectIfWaiting: 2 };
const DAY_MS = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_RANGE_DAYS = 92;
export const TERMINAL_WINDOW_MS = 24 * 3_600_000;
const ORDER_NUMBER = /^(?:MON-)?(\d{1,15})$/i;

/** Lecturas del backoffice de pedidos (F22): alcance de `orders.read` aplicado EN SQL, sin N+1, sin PII innecesaria. */
@Injectable()
export class AdminOrdersQueryService {
  constructor(
    @Inject(AdminOrdersRepository) private readonly repo: AdminOrdersRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_DB_GATE) private readonly gate: DbGate,
  ) {}

  async list(staff: StaffContext, query: ListAdminOrdersQuery): Promise<AdminOrderPageDto> {
    const now = this.clock.now();
    const filter = this.buildFilter(query, now);
    const limit = filter.limit;
    return this.db(async () => {
      const branchIds = await this.resolveScope(staff, query.branchId);
      const rows = await this.repo.list({ ...filter, branchIds });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => toSummary(row, actionsForStaff(this.authorization, staff, row))),
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ placedAtKey: last.placedAtKey, id: last.id })
            : null,
        generatedAt: now.toISOString(),
      };
    }, READ_ADMISSION);
  }

  async board(staff: StaffContext, query: BoardAdminOrdersQuery): Promise<AdminOrderBoardDto> {
    const now = this.clock.now();
    const limit = query.limit ?? ADMIN_BOARD_DEFAULT_LIMIT;
    const since = new Date(now.getTime() - TERMINAL_WINDOW_MS);
    return this.db(async () => {
      const branchIds = await this.resolveScope(staff, query.branchId);
      const counts = await this.repo.boardCounts(branchIds, since);
      const rows = await this.repo.boardCards(branchIds, since, limit);
      const cards = new Map<string, AdminOrderSummaryDto[]>();
      for (const row of rows) {
        const list = cards.get(row.status) ?? [];
        list.push(toSummary(row, actionsForStaff(this.authorization, staff, row)));
        cards.set(row.status, list);
      }
      return toBoard({ generatedAt: now, branchId: query.branchId ?? null, counts, cards });
    }, READ_ADMISSION);
  }

  async detail(staff: StaffContext, id: string): Promise<AdminOrderDetailDto> {
    const scope = this.authorization.scopeFor(staff, 'orders.read');
    const branchIds = scope.allBranches ? null : scope.branchIds;
    const found = await this.db(() => this.repo.findDetail(id, branchIds), READ_ADMISSION);
    if (!found) throw adminOrderNotFound();
    return toDetail(
      found,
      actionsForStaff(this.authorization, staff, found.row),
      this.authorization.canAccess(staff, 'payments.confirm', found.row.branchId),
    );
  }

  /** `null` = todas las sucursales; lista = SOLO esas. `branchId` ajeno o inexistente => 404 `BRANCH_NOT_FOUND`. */
  private async resolveScope(staff: StaffContext, branchId?: string): Promise<string[] | null> {
    const scope = this.authorization.scopeFor(staff, 'orders.read');
    if (branchId === undefined) return scope.allBranches ? null : scope.branchIds;
    if (!this.authorization.canAccess(staff, 'orders.read', branchId)) throw adminBranchNotFound();
    if (scope.allBranches && !(await this.repo.branchExists(branchId))) throw adminBranchNotFound();
    return [branchId];
  }

  private buildFilter(query: ListAdminOrdersQuery, now: Date): Omit<ListFilter, 'branchIds'> {
    const from =
      query.from !== undefined
        ? this.instant(query.from)
        : now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS;
    const to = query.to !== undefined ? this.instant(query.to) : null;
    if (to !== null && to <= from) throw new BadRequestException('to debe ser posterior a from');
    if ((to ?? now.getTime()) - from > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    }
    const cursor = query.cursor !== undefined ? decodeCursor(query.cursor, now) : null;
    const q = query.q?.trim() ?? null;
    const numeric = q !== null ? ORDER_NUMBER.exec(q) : null;
    return {
      status: query.status ?? null,
      fulfillmentType: query.fulfillmentType ?? null,
      orderNumber: numeric ? BigInt(numeric[1] as string) : null,
      nameContains: q !== null && !numeric ? q : null,
      from: new Date(from),
      to: to !== null ? new Date(to) : null,
      cursor,
      limit: query.limit ?? ADMIN_LIST_DEFAULT_LIMIT,
    };
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
      if (dbErrorCodes(error).some((c) => c === '22007' || c === '22008'))
        throw orderCursorInvalid();
      throw translateOrdersDbError(error);
    }
  }
}
