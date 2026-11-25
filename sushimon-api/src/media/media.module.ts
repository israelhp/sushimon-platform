import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { isMockAllowedNodeEnv, type Env } from '../config/env.js';
import { AdminMediaController } from './admin-media.controller.js';
import { AdminMediaService } from './admin-media.service.js';
import { MEDIA_CONFIG, resolveMediaConfig, r2Endpoint, type MediaConfig } from './media-config.js';
import { MediaCleanupService } from './media-cleanup.service.js';
import { MediaQueryService } from './media-query.service.js';
import { MEDIA_STORAGE_PORT, type MediaStoragePort } from './media-storage.port.js';
import { MediaUrlService } from './media-url.service.js';
import { MediaRepository } from './media.repository.js';
import { MockMediaStorageAdapter } from './mock-media-storage.adapter.js';
import { UnavailableMediaStorageAdapter } from './unavailable-media-storage.adapter.js';

/** Configuración pública de medios desde el entorno validado. Sin credenciales. */
export function buildMediaConfig(config: ConfigService<Env, true>): MediaConfig {
  const get = <K extends keyof Env>(key: K): Env[K] => config.get(key, { infer: true });
  return resolveMediaConfig(
    {
      NODE_ENV: get('NODE_ENV'),
      R2_ACCOUNT_ID: get('R2_ACCOUNT_ID'),
      R2_ENDPOINT: get('R2_ENDPOINT'),
      R2_BUCKET: get('R2_BUCKET'),
      R2_ACCESS_KEY_ID: get('R2_ACCESS_KEY_ID'),
      R2_SECRET_ACCESS_KEY: get('R2_SECRET_ACCESS_KEY'),
      R2_PUBLIC_BASE_URL: get('R2_PUBLIC_BASE_URL'),
      MEDIA_STORAGE_ADAPTER: get('MEDIA_STORAGE_ADAPTER'),
      MEDIA_MAX_BYTES: get('MEDIA_MAX_BYTES'),
      MEDIA_UPLOAD_TTL_SECONDS: get('MEDIA_UPLOAD_TTL_SECONDS'),
    },
    process.env['NODE_ENV'] ?? null,
  );
}

/** Selección del adaptador SOLO por configuración validada (fábrica asíncrona: el SDK se importa solo en modo R2). El mock jamás se instancia en producción. */
export async function selectMediaStorage(
  config: ConfigService<Env, true>,
  media: MediaConfig,
): Promise<MediaStoragePort> {
  if (media.mode === 'MOCK') {
    // Defensa en profundidad: `validateEnv` ya impide arrancar así.
    if (!isMockAllowedNodeEnv(process.env['NODE_ENV'])) {
      throw new Error('El almacenamiento simulado solo se permite con NODE_ENV=development o test');
    }
    new Logger('MediaModule').warn(
      'Almacenamiento de medios SIMULADO (adaptador mock): no sube ni verifica nada real',
    );
    return new MockMediaStorageAdapter();
  }
  if (media.mode === 'R2') {
    // Carga perezosa: el SDK de AWS (pesado) solo se carga en modo R2; MOCK y UNAVAILABLE nunca lo importan.
    const { createR2Client, R2MediaStorageAdapter } = await import('./r2-media-storage.adapter.js');
    const client = createR2Client({
      endpoint: r2Endpoint({
        R2_ENDPOINT: config.get('R2_ENDPOINT', { infer: true }),
        R2_ACCOUNT_ID: config.get('R2_ACCOUNT_ID', { infer: true }),
      }),
      region: config.get('R2_REGION', { infer: true }),
      accessKeyId: config.get('R2_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('R2_SECRET_ACCESS_KEY', { infer: true }),
    });
    return new R2MediaStorageAdapter(client, media.bucket as string);
  }
  return new UnavailableMediaStorageAdapter();
}

/**
 * F14: medios en Cloudflare R2. Exporta `MediaUrlService` (URL públicas estables, para F11/F16/F17) y
 * `MediaCleanupService.purgeExpired()` (para un job futuro). No importa `ProductsModule`: `products -> media`.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminMediaController],
  providers: [
    MediaRepository,
    MediaUrlService,
    MediaQueryService,
    MediaCleanupService,
    AdminMediaService,
    { provide: MEDIA_CONFIG, inject: [ConfigService], useFactory: buildMediaConfig },
    {
      provide: MEDIA_STORAGE_PORT,
      inject: [ConfigService, MEDIA_CONFIG],
      useFactory: selectMediaStorage,
    },
  ],
  exports: [MediaUrlService, MediaCleanupService, AdminMediaService, MEDIA_CONFIG],
})
export class MediaModule {}
