import { Inject, Injectable } from '@nestjs/common';
import { BUSINESS_TIMEZONE, CLOCK, type Clock } from '../branch-schedule/clock.js';
import {
  analyzeTiming,
  isInScheduleLocal,
  lifecycleOf,
  localClockOf,
  sharedTimingOf,
  type LocalClock,
  type PromotionTiming,
  type SharedTiming,
  type TimedPromotion,
} from './promotion-schedule.js';
import type { PromotionLifecycle } from './promotions.types.js';

/**
 * Tiempo y vigencia de promociones con el reloj del servidor y la zona del negocio. Delgado: la lógica está en
 * `promotion-schedule.ts` (pura). La vigencia NO consulta el horario de apertura de la sucursal (spec D6).
 */
@Injectable()
export class PromotionTimeService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BUSINESS_TIMEZONE) readonly timeZone: string,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  localClock(nowMs: number): LocalClock {
    return localClockOf(nowMs, this.timeZone);
  }

  /** Hora local y resolutor de desfases del instante: se crean una vez y se pasan a `timing`/`liveNow`. */
  sharedFor(nowMs: number): SharedTiming & { clock: LocalClock } {
    const shared = sharedTimingOf(nowMs, this.timeZone);
    return { ...shared, clock: localClockOf(nowMs, this.timeZone) };
  }

  timing(p: TimedPromotion, nowMs: number, shared?: SharedTiming): PromotionTiming {
    return analyzeTiming(p, nowMs, this.timeZone, shared);
  }

  lifecycle(p: TimedPromotion, nowMs: number): PromotionLifecycle {
    return lifecycleOf(p, nowMs);
  }

  /** `RUNNING` y dentro del horario semanal en este instante. */
  liveNow(p: TimedPromotion, nowMs: number, clock?: LocalClock): boolean {
    return (
      lifecycleOf(p, nowMs) === 'RUNNING' &&
      isInScheduleLocal(p.schedule, clock ?? localClockOf(nowMs, this.timeZone))
    );
  }
}
