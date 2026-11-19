import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../../auth/auth.types.js';
import { parseInstant } from '../../branch-schedule/business-time.js';
import { CLOCK, type Clock } from '../../branch-schedule/clock.js';
import type { DbGate } from '../../common/concurrency/db-gate.js';
import { dbErrorCodes } from '../../common/db/db-error-codes.js';
import { orderCursorInvalid } from '../admin/order-admin-errors.js';
import { decodeCursor, encodeCursor } from '../order-cursor.js';
import { READ_ADMISSION } from '../order-read-access.js';
import { ORDERS_DB_GATE, translateOrdersDbError } from '../orders-errors.js';
import {
  MY_ORDERS_DEFAULT_LIMIT,
  type ListMyOrdersQuery,
  type MyOrderPageDto,
} from './dto/my-orders.dto.js';
import { toMyOrderSummary } from './my-orders.mapper.js';
import { MyOrdersRepository } from './my-orders.repository.js';
import type { MyOrdersFilter } from './my-orders.types.js';

const DAY_MS = 86_400_000;
/** Rango máximo cuando llegan `from` y `to` (spec 024 §4.1). Sin ellos se pagina todo el historial (P75). */
export const MY_ORDERS_MAX_RANGE_DAYS = 366;

/**
 * Historial del cliente autenticado (F23, spec 024). Una sola lectura bajo `ORDERS_DB_GATE` con admisión de lectura. El
 * propietario sale SOLO del `sub` del JWT (aplicado en SQL). Sin escrituras ni auditoría; logs sin PII (solo el conteo).
 */
@Injectable()
export class MyOrdersService {
  private readonly logger = new Logger(MyOrdersService.name);

  constructor(
    @Inject(MyOrdersRepository) private readonly repo: MyOrdersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_DB_GATE) private readonly gate: DbGate,
  ) {}

  async list(principal: Principal, query: ListMyOrdersQuery): Promise<MyOrderPageDto> {
    const now = this.clock.now();
    const filter = this.buildFilter(principal.authUserId, query, now);
    let rows;
    try {
      rows = await this.gate.run(() => this.repo.list(filter), READ_ADMISSION);
    } catch (error) {
      // 22007/22008: instante inválido o fuera de rango en la BD (cursor manipulado que superó el formato) => 400, nunca 500.
      if (dbErrorCodes(error).some((c) => c === '22007' || c === '22008')) {
        throw query.cursor !== undefined
          ? orderCursorInvalid()
          : new BadRequestException('Fecha fuera de rango');
      }
      throw translateOrdersDbError(error);
    }
    const page = rows.slice(0, filter.limit);
    const last = page[page.length - 1];
    this.logger.debug(`order.history count=${page.length}`);
    return {
      items: page.map(toMyOrderSummary),
      nextCursor:
        rows.length > filter.limit && last
          ? encodeCursor({ placedAtKey: last.placedAtKey, id: last.id })
          : null,
      generatedAt: now.toISOString(),
    };
  }

  private buildFilter(authUserId: string, query: ListMyOrdersQuery, now: Date): MyOrdersFilter {
    const from = query.from !== undefined ? this.instant(query.from, 'from') : null;
    const to = query.to !== undefined ? this.instant(query.to, 'to') : null;
    if (from !== null && to !== null) {
      if (to <= from) throw new BadRequestException('to debe ser posterior a from');
      if (to - from > MY_ORDERS_MAX_RANGE_DAYS * DAY_MS) {
        throw new BadRequestException(`El rango máximo es de ${MY_ORDERS_MAX_RANGE_DAYS} días`);
      }
    }
    return {
      authUserId,
      status: query.status ?? null,
      branchId: query.branchId ?? null,
      from: from !== null ? new Date(from) : null,
      to: to !== null ? new Date(to) : null,
      cursor: query.cursor !== undefined ? decodeCursor(query.cursor, now) : null,
      limit: query.limit ?? MY_ORDERS_DEFAULT_LIMIT,
    };
  }

  private instant(value: string, name: string): number {
    const ms = parseInstant(value);
    if (ms === null) throw new BadRequestException(`${name}: fecha inválida (ISO 8601 con zona)`);
    return ms;
  }
}
