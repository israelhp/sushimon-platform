import { PRODUCT_ALT_MAX, PRODUCT_MEDIA_MAX } from '@/lib/product-rules';

/**
 * F14 — Reglas puras de medios (spec 015). Las usan el adaptador mock (para emular al servidor), la optimización del
 * cliente y la UI para avisar antes de enviar; la autoridad es siempre la API (MIME en lista blanca, tamaño, firma real).
 * Sin React ni red.
 */

/** MIME aceptados (SVG y GIF quedan fuera a propósito). */
export const MEDIA_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type MediaMime = (typeof MEDIA_ALLOWED_MIME)[number];

/** Tope duro por archivo (5 MiB; coincide con el `CHECK` de la BD). */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** Lado máximo tras optimizar en el cliente. */
export const MEDIA_MAX_SIDE_PX = 1600;
/** Calidad WebP de la optimización del cliente. */
export const MEDIA_WEBP_QUALITY = 0.82;
/** Imágenes por producto (tope de F11). */
export const MEDIA_PER_PRODUCT_MAX = PRODUCT_MEDIA_MAX;
export const MEDIA_ALT_MAX = PRODUCT_ALT_MAX;
/** Intents PENDING vigentes por empleado. */
export const MEDIA_PENDING_LIMIT = 50;
/** Vigencia del intent y de la URL firmada (máx. 300 s). */
export const MEDIA_UPLOAD_TTL_SECONDS = 300;
export const MEDIA_PAGE_SIZE_MAX = 100;
export const MEDIA_PAGE_MAX = 200;
/** Host RESERVADO (`.invalid`, RFC 2606): las URLs simuladas jamás resuelven ni apuntan a un dominio real. */
export const SIMULATED_MEDIA_HOST = 'media-simulado.invalid';
export const SIMULATED_UPLOAD_HOST = 'almacen-simulado.invalid';

/** F16: tipos de medio (`kind`). El prefijo de la clave de objeto y el tope de tamaño los decide el tipo, nunca el cliente. */
export const MEDIA_KINDS = ['PRODUCT_IMAGE', 'BANNER_IMAGE'] as const;
export type MediaKindValue = (typeof MEDIA_KINDS)[number];
export const isMediaKind = (value: unknown): value is MediaKindValue =>
  typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
/** Prefijo de la clave de objeto por tipo (`products/<yyyy>/…`, `banners/<yyyy>/…`). */
export const MEDIA_KEY_PREFIX: Record<MediaKindValue, string> = {
  PRODUCT_IMAGE: 'products',
  BANNER_IMAGE: 'banners',
};
/** Tope de tamaño por tipo: banners 1 MiB (CHECK propio en la BD); productos 5 MiB. */
export const MEDIA_MAX_BYTES_BY_KIND: Record<MediaKindValue, number> = {
  PRODUCT_IMAGE: MEDIA_MAX_BYTES,
  BANNER_IMAGE: 1024 * 1024,
};

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const isAllowedMime = (mime: unknown): mime is MediaMime =>
  typeof mime === 'string' && (MEDIA_ALLOWED_MIME as readonly string[]).includes(mime);

export const isValidChecksum = (value: unknown): value is string =>
  typeof value === 'string' && SHA256_HEX_PATTERN.test(value);

const EXTENSION: Record<MediaMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
export const extensionForMime = (mime: MediaMime): string => EXTENSION[mime];

/** ¿Cabe otra imagen en un producto que ya tiene `count`? */
export const canAttachMore = (count: number, extra = 1): boolean =>
  count + extra <= MEDIA_PER_PRODUCT_MAX;

/** Cuántas imágenes más admite un producto con `count` (nunca negativo). */
export const remainingSlots = (count: number): number => Math.max(0, MEDIA_PER_PRODUCT_MAX - count);

/** ¿La URL pública es simulada (host `.invalid`)? Nunca debe pedirse por red. */
export function isSimulatedMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.invalid');
  } catch {
    return false;
  }
}

// ── Firma real por bytes iniciales ────────────────────────────────────────────────────────

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

/**
 * Tipo REAL de una imagen por sus bytes iniciales (JPEG, PNG, WebP, AVIF) o `null` (GIF, SVG, HTML renombrado, truncado…).
 * El `File.type` lo pone el navegador por la extensión y no es de fiar.
 */
export function sniffImageMime(bytes: Uint8Array): MediaMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

// ── Dimensiones y plan de optimización ────────────────────────────────────────────────────

/** Reduce proporcionalmente para que el lado mayor no pase de `max` (nunca agranda; mínimo 1 px). */
export function fitWithin(
  width: number,
  height: number,
  max = MEDIA_MAX_SIDE_PX,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type OptimizationPlan = 'keep' | 'convert';

/**
 * WebP y AVIF que ya cumplen los límites (lado ≤ 1600 y ≤ 5 MiB) se suben tal cual; JPEG/PNG (y los que se pasan) se
 * recomprimen a WebP.
 */
export function planOptimization(input: {
  mimeType: MediaMime;
  width: number;
  height: number;
  sizeBytes: number;
}): OptimizationPlan {
  const modern = input.mimeType === 'image/webp' || input.mimeType === 'image/avif';
  const within = Math.max(input.width, input.height) <= MEDIA_MAX_SIDE_PX;
  return modern && within && input.sizeBytes <= MEDIA_MAX_BYTES ? 'keep' : 'convert';
}

// ── Perfil de banner (F16): proporción 3:1, lado largo ≤ 1920 px y ≤ 1 MiB ───────────────────

export const BANNER_ASPECT = 3;
export const BANNER_MAX_SIDE_PX = 1920;
export const BANNER_MAX_BYTES = 1024 * 1024;
/** Calidades WebP que se prueban en orden hasta que quepa en 1 MiB. */
export const BANNER_WEBP_QUALITIES = [0.82, 0.7, 0.55, 0.4] as const;
/** Tolerancia de la proporción para respetar una imagen ya optimizada (±1 %). */
const BANNER_ASPECT_TOLERANCE = 0.01;

export interface BannerGeometry {
  /** Recorte centrado del origen con proporción EXACTA 3:1. */
  crop: { x: number; y: number; width: number; height: number };
  /** Tamaño de salida (3:1, ancho ≤ 1920; nunca agranda). */
  size: { width: number; height: number };
}

/**
 * Recorte centrado a 3:1 y reducción a ≤ 1920 px de ancho. Una imagen más ancha que 3:1 pierde los lados; una más alta pierde
 * arriba y abajo (el texto del banner es estructurado, no va incrustado: la zona segura es la central). Nunca agranda.
 */
export function bannerGeometry(width: number, height: number): BannerGeometry {
  const wide = width / height > BANNER_ASPECT;
  const cropWidth = wide ? Math.max(1, Math.round(height * BANNER_ASPECT)) : width;
  const cropHeight = wide ? height : Math.max(1, Math.round(width / BANNER_ASPECT));
  const outWidth = Math.min(cropWidth, BANNER_MAX_SIDE_PX);
  return {
    crop: {
      x: Math.floor((width - cropWidth) / 2),
      y: Math.floor((height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    },
    size: { width: outWidth, height: Math.max(1, Math.round(outWidth / BANNER_ASPECT)) },
  };
}

/** WebP/AVIF que ya son 3:1 (±1 %), ≤ 1920 px y ≤ 1 MiB se suben tal cual; el resto se recorta y recomprime a WebP. */
export function planBannerOptimization(input: {
  mimeType: MediaMime;
  width: number;
  height: number;
  sizeBytes: number;
}): OptimizationPlan {
  const modern = input.mimeType === 'image/webp' || input.mimeType === 'image/avif';
  const ratioOk =
    Math.abs(input.width / input.height - BANNER_ASPECT) / BANNER_ASPECT <= BANNER_ASPECT_TOLERANCE;
  return modern &&
    ratioOk &&
    input.width <= BANNER_MAX_SIDE_PX &&
    input.sizeBytes <= BANNER_MAX_BYTES
    ? 'keep'
    : 'convert';
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
    : `${Math.max(1, Math.round(bytes / 1024))} KiB`;

// ── Forma de las solicitudes (400) ────────────────────────────────────────────────────────

/** Problemas de FORMA del cuerpo de `createAdminMediaUpload` (propiedades desconocidas incluidas). MIME y tamaño son 422. */
export function intentShapeProblems(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return ['Cuerpo de la solicitud inválido'];
  const body = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(body)) {
    if (!['kind', 'mimeType', 'sizeBytes', 'checksumSha256'].includes(key)) {
      problems.push(`${key}: campo no permitido`);
    }
  }
  if (!isMediaKind(body.kind)) problems.push('kind: debe ser PRODUCT_IMAGE o BANNER_IMAGE');
  if (typeof body.mimeType !== 'string' || body.mimeType.length === 0) {
    problems.push('mimeType: debe ser texto');
  }
  if (!Number.isInteger(body.sizeBytes) || (body.sizeBytes as number) < 1) {
    problems.push('sizeBytes: entero mayor o igual a 1');
  }
  if (!isValidChecksum(body.checksumSha256)) {
    problems.push('checksumSha256: 64 caracteres hexadecimales en minúsculas');
  }
  return problems;
}

// ── Códigos de error → clase de mensaje ───────────────────────────────────────────────────

export type MediaErrorKind =
  | 'typeNotAllowed'
  | 'tooLarge'
  | 'contentMismatch'
  | 'objectMissing'
  | 'uploadExpired'
  | 'pendingLimit'
  | 'alreadyAttached'
  | 'inUse'
  | 'productMediaInvalid'
  | 'assetNotReady'
  | 'reorderMismatch'
  | 'notFound'
  | 'productNotFound'
  | 'busy'
  | 'storageUnavailable'
  | 'decode'
  | 'network'
  | 'uploadRejected'
  | 'aborted'
  | 'forbidden'
  | 'unauthorized'
  | 'invalid'
  | 'other';

const KIND_BY_CODE: Record<string, MediaErrorKind> = {
  MEDIA_TYPE_NOT_ALLOWED: 'typeNotAllowed',
  MEDIA_TOO_LARGE: 'tooLarge',
  MEDIA_CONTENT_MISMATCH: 'contentMismatch',
  MEDIA_OBJECT_MISSING: 'objectMissing',
  MEDIA_UPLOAD_EXPIRED: 'uploadExpired',
  MEDIA_PENDING_LIMIT_REACHED: 'pendingLimit',
  MEDIA_ALREADY_ATTACHED: 'alreadyAttached',
  MEDIA_IN_USE: 'inUse',
  PRODUCT_MEDIA_INVALID: 'productMediaInvalid',
  MEDIA_ASSET_NOT_READY: 'assetNotReady',
  MEDIA_REORDER_MISMATCH: 'reorderMismatch',
  MEDIA_NOT_FOUND: 'notFound',
  PRODUCT_MEDIA_NOT_FOUND: 'notFound',
  PRODUCT_NOT_FOUND: 'productNotFound',
  MEDIA_BUSY: 'busy',
  PRODUCTS_BUSY: 'busy',
  MEDIA_STORAGE_UNAVAILABLE: 'storageUnavailable',
};

/** Clase de mensaje para un `ErrorResponse.code`; `null` si no es de medios (la UI usa entonces el estado HTTP). */
export const mediaErrorKindForCode = (code: string | undefined): MediaErrorKind | null =>
  (code && KIND_BY_CODE[code]) || null;

/** ¿Reintentar tal cual tiene sentido? (`MEDIA_UPLOAD_EXPIRED` exige un intent NUEVO, no repetir el PUT). */
export const isRetryableKind = (kind: MediaErrorKind): boolean =>
  kind === 'busy' ||
  kind === 'network' ||
  kind === 'objectMissing' ||
  kind === 'storageUnavailable';
