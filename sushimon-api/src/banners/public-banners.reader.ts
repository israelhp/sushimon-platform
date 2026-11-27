import { Inject, Injectable } from '@nestjs/common';
import { MediaUrlService } from '../media/media-url.service.js';
import { translateBannerDbError } from './banner-db-errors.js';
import { BannersReadRepository } from './banners-read.repository.js';
import { MAX_BANNERS, type StoreBannerView } from './banners.types.js';

/**
 * Lector público REUTILIZABLE de banners. Lo consume `GET /v1/store/banners` y F17 (`getStoreBootstrap`) importando solo
 * este proveedor exportado. Devuelve los activos (máx. 5) en orden de creación, con la URL pública permanente de la imagen
 * y SIN ids de asset ni claves de objeto. La falta de base pública de imágenes oculta los banners (nunca 5xx). No depende
 * del reloj, de la sucursal ni del idioma.
 */
@Injectable()
export class PublicBannersReader {
  constructor(
    @Inject(BannersReadRepository) private readonly repo: BannersReadRepository,
    @Inject(MediaUrlService) private readonly urls: MediaUrlService,
  ) {}

  async findActiveBanners(): Promise<StoreBannerView[]> {
    try {
      const rows = await this.repo.findActive(MAX_BANNERS);
      return rows.flatMap((r) => {
        const url = this.urls.tryPublicUrl(r.objectKey);
        return url === null ? [] : [{ id: r.id, image: { url, mimeType: r.mimeType }, alt: r.alt }];
      });
    } catch (error) {
      throw translateBannerDbError(error);
    }
  }
}
