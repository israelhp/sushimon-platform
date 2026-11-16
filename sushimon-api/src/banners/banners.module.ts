import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { MediaModule } from '../media/media.module.js';
import { AdminBannersController } from './admin-banners.controller.js';
import { AdminBannersService } from './admin-banners.service.js';
import { BannersReadModule } from './banners-read.module.js';
import { BannersRepository } from './banners.repository.js';

/**
 * F16 · administración de banners (`/v1/admin/banners`). La lectura pública vive en `BannersReadModule` (se re-exporta
 * para que F17 pueda importar solo `PublicBannersReader`). Dependencias en una sola dirección:
 * `banners -> media (MediaUrlService) -> audit`, `banners -> auth`; `media` y `promotions` no importan `banners`.
 */
@Module({
  imports: [AuditModule, MediaModule, BannersReadModule],
  controllers: [AdminBannersController],
  providers: [BannersRepository, AdminBannersService],
  exports: [BannersReadModule],
})
export class BannersModule {}
