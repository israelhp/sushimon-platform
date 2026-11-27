import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { BannersReadRepository } from './banners-read.repository.js';
import { PublicBannersController } from './public-banners.controller.js';
import { PublicBannersReader } from './public-banners.reader.js';

/**
 * Lectura PÚBLICA de banners (F16). Exporta `PublicBannersReader` para F17. Solo depende de `media` (`MediaUrlService`);
 * no conoce nada administrativo. `media` no importa `banners`.
 */
@Module({
  imports: [MediaModule],
  controllers: [PublicBannersController],
  providers: [BannersReadRepository, PublicBannersReader],
  exports: [PublicBannersReader],
})
export class BannersReadModule {}
