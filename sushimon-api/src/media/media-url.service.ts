import { Inject, Injectable } from '@nestjs/common';
import { MEDIA_CONFIG, type MediaConfig } from './media-config.js';
import { storageUnavailable } from './media-policy.js';

/** URL de un medio respecto a la base pública configurada. */
export type MediaUrlClass =
  | { kind: 'external' }
  /** `objectKey` es null si la URL está bajo el host de medios pero no cuelga de la base (query, otra ruta…). */
  | { kind: 'media'; objectKey: string | null };

/**
 * URL públicas estables de los medios: `R2_PUBLIC_BASE_URL` + `/` + clave de objeto. NUNCA URLs firmadas ni persistidas
 * por este servicio. Exportado por `MediaModule` para F16 (banners) y F17 (agregados).
 */
@Injectable()
export class MediaUrlService {
  private readonly base: string | null;
  private readonly baseHost: string | null;

  constructor(@Inject(MEDIA_CONFIG) config: MediaConfig) {
    this.base = config.publicBaseUrl;
    this.baseHost = config.publicBaseUrl
      ? new URL(config.publicBaseUrl).hostname.toLowerCase()
      : null;
  }

  /** Hay base pública (R2 o mock). */
  get configured(): boolean {
    return this.base !== null;
  }

  /** URL pública de la clave; sin base configurada lanza 503 `MEDIA_STORAGE_UNAVAILABLE` (error controlado). */
  publicUrl(objectKey: string): string {
    if (this.base === null) throw storageUnavailable();
    return `${this.base}/${objectKey}`;
  }

  /** Como `publicUrl` pero `null` sin base (listados que no deben fallar). */
  tryPublicUrl(objectKey: string): string | null {
    return this.base === null ? null : `${this.base}/${objectKey}`;
  }

  /** Clasifica una URL YA normalizada (`URL.href`). Sin base configurada todo es externo. */
  classify(url: string): MediaUrlClass {
    if (this.base === null || this.baseHost === null) return { kind: 'external' };
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return { kind: 'external' };
    }
    if (host !== this.baseHost) return { kind: 'external' };
    const prefix = `${this.base}/`;
    return { kind: 'media', objectKey: url.startsWith(prefix) ? url.slice(prefix.length) : null };
  }

  /**
   * Lista efectiva de `PRODUCT_MEDIA_ALLOWED_HOSTS`: si no está vacía se añade el host de medios (para que el catálogo
   * pueda referenciar R2). Vacía = cualquier host https público: no cambia.
   */
  effectiveAllowedHosts(configured: readonly string[]): readonly string[] {
    if (configured.length === 0 || this.baseHost === null) return configured;
    return configured.includes(this.baseHost) ? configured : [...configured, this.baseHost];
  }
}
