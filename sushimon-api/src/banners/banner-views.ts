import type { BannerRecord } from './banners.types.js';
import type { AdminBannerDto } from './dto/banner-responses.dto.js';

/** Vista administrativa (contrato `AdminBanner`). Pura: recibe el resolutor de URL pública. */
export function bannerView(
  r: BannerRecord,
  imageUrl: (objectKey: string) => string | null,
): AdminBannerDto {
  return {
    id: r.id,
    image: {
      assetId: r.image.assetId,
      url: imageUrl(r.image.objectKey),
      mimeType: r.image.mimeType,
      sizeBytes: r.image.sizeBytes,
    },
    imageAlt: r.imageAlt,
    active: r.active,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
