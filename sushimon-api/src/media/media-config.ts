import type { Env } from '../config/env.js';
import { r2GroupState } from '../config/env.js';
import type { StorageKind } from './media.types.js';

/** Token de la configuración PÚBLICA de medios (sin secretos): modo, límites, bucket y base pública. */
export const MEDIA_CONFIG = Symbol('MEDIA_CONFIG');

/** Hosts reservados (RFC 2606): el adaptador simulado jamás apunta a un dominio real. */
export const MOCK_PUBLIC_BASE_URL = 'https://media.mock.invalid';
export const MOCK_UPLOAD_BASE_URL = 'https://upload.mock.invalid';
export const MOCK_BUCKET = 'sushimon-media-mock';

export interface MediaConfig {
  mode: StorageKind;
  maxBytes: number;
  uploadTtlSeconds: number;
  /** Bucket que se guarda en `media_assets.bucket` (null sin almacenamiento). */
  bucket: string | null;
  /** `R2_PUBLIC_BASE_URL` (o la simulada). Sin barra final. null sin almacenamiento. */
  publicBaseUrl: string | null;
}

type MediaEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'R2_ACCOUNT_ID'
  | 'R2_ENDPOINT'
  | 'R2_BUCKET'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_PUBLIC_BASE_URL'
  | 'MEDIA_STORAGE_ADAPTER'
  | 'MEDIA_MAX_BYTES'
  | 'MEDIA_UPLOAD_TTL_SECONDS'
>;

/**
 * Resuelve la configuración pública. `validateEnv` ya impide las combinaciones inválidas; aquí hay defensa en
 * profundidad (p. ej. mock con NODE_ENV=production o `r2` sin grupo completo). Nunca devuelve credenciales.
 */
export function resolveMediaConfig(env: MediaEnv, nodeEnv: unknown = env.NODE_ENV): MediaConfig {
  const limits = { maxBytes: env.MEDIA_MAX_BYTES, uploadTtlSeconds: env.MEDIA_UPLOAD_TTL_SECONDS };
  const group = r2GroupState(env);
  const complete = group.anyDefined && group.missing.length === 0;

  if (env.MEDIA_STORAGE_ADAPTER === 'mock') {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error(
        'El almacenamiento simulado de medios solo se permite con NODE_ENV=development o test',
      );
    }
    if (group.anyDefined)
      throw new Error('El almacenamiento simulado no puede combinarse con variables R2');
    return { mode: 'MOCK', ...limits, bucket: MOCK_BUCKET, publicBaseUrl: MOCK_PUBLIC_BASE_URL };
  }
  if (env.MEDIA_STORAGE_ADAPTER === 'r2' && !complete) {
    throw new Error('MEDIA_STORAGE_ADAPTER=r2 exige el grupo completo de variables R2');
  }
  if (!complete) return { mode: 'UNAVAILABLE', ...limits, bucket: null, publicBaseUrl: null };
  return {
    mode: 'R2',
    ...limits,
    bucket: env.R2_BUCKET as string,
    publicBaseUrl: normalizeBase(env.R2_PUBLIC_BASE_URL as string),
  };
}

/** Origen + ruta sin barra final. */
export function normalizeBase(raw: string): string {
  const url = new URL(raw);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Endpoint S3 del adaptador real: `R2_ENDPOINT` o el de la cuenta. */
export function r2Endpoint(env: Pick<Env, 'R2_ENDPOINT' | 'R2_ACCOUNT_ID'>): string {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT.replace(/\/+$/, '');
  return `https://${env.R2_ACCOUNT_ID as string}.r2.cloudflarestorage.com`;
}
