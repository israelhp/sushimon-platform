import { Inject, Injectable } from '@nestjs/common';
import { BUSINESS_TIMEZONE, CLOCK, type Clock } from '../branch-schedule/clock.js';

/** Reloj del servidor y zona del negocio para banners (la vigencia es en instantes; la zona solo para horarios de promoción). */
@Injectable()
export class BannersTimeService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BUSINESS_TIMEZONE) readonly timeZone: string,
  ) {}

  now(): Date {
    return this.clock.now();
  }
}
