import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BUSINESS_TIMEZONE, CLOCK, SystemClock } from '../branch-schedule/clock.js';
import type { Env } from '../config/env.js';
import { MediaModule } from '../media/media.module.js';
import { BannersReadRepository } from './banners-read.repository.js';
import { BannersTimeService } from './banners-time.service.js';
import { PublicBannersController } from './public-banners.controller.js';
import { PublicBannersReader } from './public-banners.reader.js';

/**
 * Lectura PÚBLICA de banners (F16 D10). Exporta `PublicBannersReader` para F17 y `BannersTimeService` (reloj) para la
 * administración. Solo depende de `media` (`MediaUrlService`); NO importa `PromotionsModule` (usa las funciones puras de
 * `promotion-schedule.ts`) ni el módulo administrativo. `media` y `promotions` no importan `banners`.
 */
@Module({
  imports: [MediaModule],
  controllers: [PublicBannersController],
  providers: [
    BannersReadRepository,
    BannersTimeService,
    PublicBannersReader,
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: BUSINESS_TIMEZONE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        config.get('BUSINESS_TIMEZONE', { infer: true }),
    },
  ],
  exports: [PublicBannersReader, BannersTimeService],
})
export class BannersReadModule {}
