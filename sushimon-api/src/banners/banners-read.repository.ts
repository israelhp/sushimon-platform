import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { StoreBannerRow } from './banners.types.js';

interface RawRow {
  id: string;
  alt: string;
  object_key: string;
  mime_type: string;
}

/**
 * Lectura pública de banners (F16 simplificado): UNA consulta. Activos con imagen READY de tipo BANNER_IMAGE y fila `es`
 * con texto alternativo, en orden de creación. IGNORA fechas, sucursales, promoción y CTA de filas antiguas.
 */
@Injectable()
export class BannersReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findActive(limit: number): Promise<StoreBannerRow[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT b.id::text AS id, t.image_alt AS alt, ma.object_key, ma.mime_type
        FROM app.banners b
        JOIN app.media_assets ma ON ma.id = b.image_asset_id AND ma.status = 'READY' AND ma.kind = 'BANNER_IMAGE'
        JOIN app.banner_translations t ON t.banner_id = b.id AND t.locale = 'es' AND t.image_alt IS NOT NULL
       WHERE b.active
       ORDER BY b.created_at ASC, b.id ASC
       LIMIT ${limit}::int`;
    return rows.map((r) => ({
      id: r.id,
      alt: r.alt,
      objectKey: r.object_key,
      mimeType: r.mime_type,
    }));
  }
}
