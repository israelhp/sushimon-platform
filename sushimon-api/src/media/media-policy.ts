import { HttpStatus } from '@nestjs/common';
import { codedException } from '../common/errors/coded-exception.js';
import type {
  AdminMediaAssetView,
  MediaAssetRow,
  MediaKind,
  MediaStorageMode,
} from './media.types.js';

/** Reglas puras de medios (F14): MIME, tamaño, checksum, clave de objeto y firma real. Sin I/O. */

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

const EXTENSION: Readonly<Record<AllowedMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Tope de tamaño de las imágenes de banner (F16): 1 MiB; el resto de tipos usa `MEDIA_MAX_BYTES`. */
export const BANNER_IMAGE_MAX_BYTES = 1_048_576;

/** Tamaño máximo por tipo: nunca supera el global configurado; los banners, además, 1 MiB (CHECK `media_assets_banner_size_chk`). */
export function maxBytesFor(kind: MediaKind, globalMax: number): number {
  return kind === 'BANNER_IMAGE' ? Math.min(globalMax, BANNER_IMAGE_MAX_BYTES) : globalMax;
}

/** Prefijo de la clave de objeto por tipo (CHECK `media_assets_key_prefix_chk`): lo decide el tipo, jamás el cliente. */
const KEY_PREFIX: Readonly<Record<MediaKind, string>> = {
  PRODUCT_IMAGE: 'products',
  BANNER_IMAGE: 'banners',
};

/** Cabecera de caché del objeto: la clave nunca se reutiliza, así que es inmutable. */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Intents PENDING vigentes por empleado. */
export const PENDING_LIMIT_PER_STAFF = 50;
/** PENDING caducados purgados por petición (la purga corre dentro de la petición del intent: lote pequeño). */
export const PURGE_BATCH = 20;
/** Presupuesto total de tiempo (ms) de la purga perezosa dentro de una petición. */
export const PURGE_BUDGET_MS = 3_000;
/**
 * Margen tras `expires_at` antes de borrar un PENDING y su objeto: igual al TTL máximo de la URL firmada (300 s). Una URL
 * firmada puede seguir aceptando el PUT hasta `expires_at`; con el margen la purga nunca borra un objeto cuyo PUT siga vigente.
 */
export const PURGE_GRACE_MS = 5 * 60_000;
/** Bytes iniciales que se leen para validar la firma real. */
export const SIGNATURE_BYTES = 32;
export const MAX_PAGE = 200;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

// ---------- errores de dominio ----------

const coded = (status: HttpStatus, code: string, message: string) =>
  codedException(status, code, message);

export const mediaNotFound = () =>
  coded(HttpStatus.NOT_FOUND, 'MEDIA_NOT_FOUND', 'Medio no encontrado');
export const mediaInUse = () =>
  coded(
    HttpStatus.CONFLICT,
    'MEDIA_IN_USE',
    'El medio está en uso por uno o más productos o banners',
  );
export const uploadExpired = () =>
  coded(HttpStatus.GONE, 'MEDIA_UPLOAD_EXPIRED', 'La subida caducó; solicita una nueva');
export const objectMissing = () =>
  coded(HttpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_OBJECT_MISSING', 'El archivo aún no se ha subido');
export const contentMismatch = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MEDIA_CONTENT_MISMATCH',
    'El archivo subido no coincide con lo declarado; solicita una nueva subida',
  );
/** Mensaje fijo: jamás detalles del proveedor, de la URL ni de credenciales. */
export const storageUnavailable = () =>
  coded(
    HttpStatus.SERVICE_UNAVAILABLE,
    'MEDIA_STORAGE_UNAVAILABLE',
    'El almacenamiento de imágenes no está disponible',
  );
export const mediaBusy = () =>
  coded(
    HttpStatus.SERVICE_UNAVAILABLE,
    'MEDIA_BUSY',
    'La biblioteca de medios está ocupada; reintenta en unos segundos',
  );
export const assetNotReady = () =>
  coded(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MEDIA_ASSET_NOT_READY',
    'El medio aún no está confirmado',
  );
export const alreadyAttached = () =>
  coded(HttpStatus.CONFLICT, 'MEDIA_ALREADY_ATTACHED', 'El medio ya está en este producto');
export const reorderMismatch = () =>
  coded(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MEDIA_REORDER_MISMATCH',
    'orderedIds debe contener exactamente las imágenes del producto',
  );
export const productMediaNotFound = () =>
  coded(
    HttpStatus.NOT_FOUND,
    'PRODUCT_MEDIA_NOT_FOUND',
    'La imagen no existe o no pertenece al producto',
  );

// ---------- intent ----------

export interface IntentInput {
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/** Orden de la spec (D6): MIME => 422 `MEDIA_TYPE_NOT_ALLOWED`; tamaño => 422 `MEDIA_TOO_LARGE`. */
export function validateIntent(input: IntentInput, maxBytes: number): AllowedMime {
  if (!isAllowedMime(input.mimeType)) {
    throw codedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'MEDIA_TYPE_NOT_ALLOWED',
      'Solo se admiten imágenes JPEG, PNG, WebP o AVIF',
      [
        {
          path: 'mimeType',
          code: 'MEDIA_TYPE_NOT_ALLOWED',
          message: 'Tipo de archivo no permitido',
        },
      ],
    );
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > maxBytes) {
    throw codedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'MEDIA_TOO_LARGE',
      `El archivo supera el máximo de ${maxBytes} bytes`,
      [{ path: 'sizeBytes', code: 'MEDIA_TOO_LARGE', message: 'Tamaño fuera de rango' }],
    );
  }
  return input.mimeType;
}

export const pendingLimitReached = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MEDIA_PENDING_LIMIT_REACHED',
    `Hay demasiadas subidas pendientes (máximo ${PENDING_LIMIT_PER_STAFF}); espera a que caduquen`,
    [
      {
        path: 'kind',
        code: 'MEDIA_PENDING_LIMIT_REACHED',
        message: 'Demasiadas subidas pendientes',
      },
    ],
  );

/** SHA-256 hex (64, minúsculas) -> base64, formato de `x-amz-checksum-sha256`. */
export function checksumHexToBase64(hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('checksum hexadecimal inválido');
  return Buffer.from(hex, 'hex').toString('base64');
}

const OBJECT_KEY_RE = /^[a-z0-9][a-z0-9/_.-]*$/;

/** Misma regla que `media_assets_object_key_chk`. */
export function isValidObjectKey(key: string): boolean {
  return OBJECT_KEY_RE.test(key) && !key.includes('..') && !key.includes('//') && key.length <= 200;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `<products|banners>/<yyyy>/<uuid>.<ext>`: el prefijo lo decide el tipo y la extensión el MIME verificado, jamás el
 * nombre del archivo ni el cliente.
 */
export function buildObjectKey(
  mime: AllowedMime,
  uuid: string,
  now: Date,
  kind: MediaKind = 'PRODUCT_IMAGE',
): string {
  if (!UUID_RE.test(uuid)) throw new Error('uuid inválido para la clave de objeto');
  const key = `${KEY_PREFIX[kind]}/${now.getUTCFullYear()}/${uuid}.${EXTENSION[mime]}`;
  if (!isValidObjectKey(key)) throw new Error('clave de objeto inválida');
  return key;
}

// ---------- firma real (magic bytes) ----------

const ascii = (bytes: Uint8Array, from: number, text: string): boolean =>
  bytes.length >= from + text.length &&
  [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0));

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/**
 * Tipo de imagen según los bytes iniciales (JPEG FFD8FF; PNG 89504E470D0A1A0A; WebP `RIFF....WEBP`; AVIF `ftyp` con
 * marca mayor `avif`/`avis`). `null` si no corresponde a ninguno (HTML renombrado, SVG, GIF, cuerpo truncado…).
 */
export function detectImageType(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis')))
    return 'image/avif';
  return null;
}

export const signatureMatches = (mime: string, bytes: Uint8Array): boolean =>
  detectImageType(bytes) === mime;

/** `Content-Type` sin parámetros y en minúsculas (`image/png; charset=x` -> `image/png`). */
export const baseContentType = (value: string | null | undefined): string | null =>
  value ? (value.split(';')[0] ?? '').trim().toLowerCase() : null;

// ---------- vistas ----------

export function toAssetView(
  row: MediaAssetRow,
  mode: MediaStorageMode,
  publicUrl: (key: string) => string | null,
): AdminMediaAssetView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    url: row.status === 'READY' ? publicUrl(row.objectKey) : null,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    usageCount: row.usageCount,
    storageMode: mode,
  };
}
