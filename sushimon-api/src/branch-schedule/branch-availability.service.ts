import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { codedException } from '../common/errors/coded-exception.js';
import { evaluateAvailability, HORIZON_MS } from './availability.js';
import type {
  AvailabilityInput,
  BranchAvailabilityPort,
  BranchAvailabilityResult,
} from './branch-availability.port.js';
import {
  BranchScheduleRepository,
  type ScheduleSnapshot,
  type ScheduleTx,
} from './branch-schedule.repository.js';
import { BUSINESS_TIMEZONE, CLOCK, type Clock } from './clock.js';
import type { BranchAvailabilityDto } from './dto/branch-schedule-responses.dto.js';
import { rowsToDays, toWeeklyIntervals } from './schedule-policy.js';

const NOT_FOUND = 'Sucursal no encontrada';
/** `at` válido: 2000-01-01 .. 2100-01-01 (UTC). Fuera de rango = entrada inválida, no un 500. */
const MIN_AT = Date.UTC(2000, 0, 1);
const MAX_AT = Date.UTC(2100, 0, 1);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const date = (ms: number | null): Date | null => (ms === null ? null : new Date(ms));

const invalid = (message: string): never => {
  throw codedException(HttpStatus.BAD_REQUEST, 'INVALID_AVAILABILITY_INPUT', message);
};

/**
 * Motor único de disponibilidad (D9/D11): `loadSchedule` (UNA consulta, una conexión, varias sucursales) + función
 * pura `evaluate` (sin I/O ni reloj). Implementa el puerto interno que consumen F17/F19/F20 y alimenta el endpoint
 * público. Siempre lee de la BD; no cachea entre peticiones.
 */
@Injectable()
export class BranchAvailabilityService implements BranchAvailabilityPort {
  constructor(
    @Inject(BranchScheduleRepository) private readonly repo: BranchScheduleRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BUSINESS_TIMEZONE) private readonly timeZone: string,
  ) {}

  async getAvailability(input: AvailabilityInput): Promise<BranchAvailabilityResult> {
    const [result] = await this.getAvailabilityMany({
      branchIds: [input.branchId],
      at: input.at,
      ...(input.orderCutoffMinutes !== undefined
        ? { orderCutoffMinutes: input.orderCutoffMinutes }
        : {}),
      ...(input.tx ? { tx: input.tx } : {}),
    });
    return result as BranchAvailabilityResult;
  }

  async getAvailabilityMany(input: {
    branchIds: readonly string[];
    at: Date;
    orderCutoffMinutes?: number;
    tx?: ScheduleTx;
  }): Promise<BranchAvailabilityResult[]> {
    const at = this.validAt(input.at);
    const cutoff = input.orderCutoffMinutes;
    if (cutoff !== undefined && (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1440)) {
      invalid('orderCutoffMinutes debe estar entre 0 y 1440');
    }
    const ids = [...new Set(input.branchIds)];
    const snapshots = await this.repo.loadSchedule(ids, new Date(at), new Date(at + HORIZON_MS), {
      ...(input.tx ? { tx: input.tx } : {}),
    });
    const byId = new Map(snapshots.map((s) => [s.branchId, s]));
    return input.branchIds.map((id) => {
      const snapshot = byId.get(id);
      if (!snapshot) throw new NotFoundException(NOT_FOUND);
      return this.evaluate(snapshot, at, cutoff);
    });
  }

  /** Función pura sobre un snapshot ya cargado: sin I/O ni reloj. */
  evaluate(snapshot: ScheduleSnapshot, at: number, cutoff?: number): BranchAvailabilityResult {
    const r = evaluateAvailability({
      active: snapshot.active,
      intervals: toWeeklyIntervals(rowsToDays(snapshot.hours)),
      closures: snapshot.closures,
      at,
      timeZone: this.timeZone,
      ...(cutoff !== undefined ? { orderCutoffMinutes: cutoff } : {}),
    });
    return {
      branchId: snapshot.branchId,
      timezone: this.timeZone,
      at: new Date(at),
      isOpenNow: r.isOpenNow,
      isAcceptingOrders: r.isAcceptingOrders,
      reason: r.reason,
      nextOpensAt: date(r.nextOpensAt),
      nextClosesAt: date(r.nextClosesAt),
      nextTransitionAt: date(r.nextTransitionAt),
    };
  }

  async canAcceptOrder(input: { branchId: string; at: Date; tx?: ScheduleTx }) {
    const r = await this.getAvailability(input);
    return { accepted: r.isAcceptingOrders, reason: r.reason, nextOpensAt: r.nextOpensAt };
  }

  canAcceptOrderNow(branchId: string, tx?: ScheduleTx) {
    return this.canAcceptOrder({ branchId, at: this.clock.now(), ...(tx ? { tx } : {}) });
  }

  /** Respuesta HTTP pública: reloj del servidor; inexistente o inactiva => 404 (sin distinguir). */
  async getPublic(branchId: string): Promise<BranchAvailabilityDto> {
    const r = await this.getAvailability({ branchId, at: this.clock.now() });
    if (r.reason === 'INACTIVE') throw new NotFoundException(NOT_FOUND);
    return {
      branchId: r.branchId,
      timezone: r.timezone,
      serverTime: r.at.toISOString(),
      isOpenNow: r.isOpenNow,
      isAcceptingOrders: r.isAcceptingOrders,
      reason: r.reason,
      nextOpensAt: iso(r.nextOpensAt?.getTime() ?? null),
      nextClosesAt: iso(r.nextClosesAt?.getTime() ?? null),
      nextTransitionAt: iso(r.nextTransitionAt?.getTime() ?? null),
    };
  }

  private validAt(at: Date): number {
    const ms = at instanceof Date ? at.getTime() : Number.NaN;
    if (!Number.isFinite(ms) || ms < MIN_AT || ms >= MAX_AT) {
      return invalid('`at` debe ser un instante válido entre los años 2000 y 2100');
    }
    return ms;
  }
}
