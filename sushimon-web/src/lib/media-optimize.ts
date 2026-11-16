import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_SIDE_PX,
  MEDIA_WEBP_QUALITY,
  fitWithin,
  planOptimization,
  sniffImageMime,
  type MediaErrorKind,
  type MediaMime,
} from './media-rules';

/**
 * F14 — Optimización ANTES de subir (sin dependencias): WebP calidad ~0.82 y lado máximo 1600 px con canvas; WebP/AVIF que ya
 * cumplen los límites se respetan; GIF, SVG y cualquier otro tipo se rechazan (por BYTES, no por extensión). SHA-256 con Web
 * Crypto. El canvas se abstrae en `ImageProcessor` para poder inyectar un doble en pruebas (jsdom no tiene canvas).
 */

/** Error del lado del cliente con la misma clase de mensaje que los códigos del servidor. */
export class MediaClientError extends Error {
  constructor(
    readonly kind: MediaErrorKind,
    message: string,
    /** Estado HTTP del PUT directo (solo `uploadRejected`). */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MediaClientError';
  }
}

export const isMediaClientError = (error: unknown): error is MediaClientError =>
  error instanceof MediaClientError;

export interface ImageProcessor {
  /** Dimensiones reales; lanza si el navegador no puede decodificar la imagen. */
  measure(blob: Blob): Promise<{ width: number; height: number }>;
  /** Redimensiona a `size` y codifica en WebP con la calidad dada. */
  encodeWebp(blob: Blob, size: { width: number; height: number }, quality: number): Promise<Blob>;
}

/** Implementación del navegador: `createImageBitmap` + canvas (OffscreenCanvas si existe). */
export const browserImageProcessor: ImageProcessor = {
  async measure(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  },
  async encodeWebp(blob, size, quality) {
    const bitmap = await createImageBitmap(blob);
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(size.width, size.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d no disponible');
        ctx.drawImage(bitmap, 0, 0, size.width, size.height);
        return await canvas.convertToBlob({ type: 'image/webp', quality });
      }
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d no disponible');
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (out) => (out ? resolve(out) : reject(new Error('toBlob sin resultado'))),
          'image/webp',
          quality,
        ),
      );
    } finally {
      bitmap.close();
    }
  },
};

async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** SHA-256 en hexadecimal minúsculas con Web Crypto (`crypto.subtle`; requiere contexto seguro: https o localhost). */
export async function sha256HexOfBlob(
  blob: Blob,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<string> {
  if (!subtle) {
    throw new MediaClientError('decode', 'Web Crypto no está disponible en este navegador');
  }
  const digest = await subtle.digest('SHA-256', (await readBytes(blob)) as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex → base64 (formato de la cabecera `x-amz-checksum-sha256`). */
export function hexToBase64(hex: string): string {
  const bytes = hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
  return btoa(String.fromCharCode(...bytes));
}

export interface OptimizedImage {
  /** Lo que se sube (con el `type` correcto). */
  blob: Blob;
  mimeType: MediaMime;
  sizeBytes: number;
  checksumSha256: string;
  width: number;
  height: number;
  /** false = se subió el original (WebP/AVIF que ya cumplían). */
  recompressed: boolean;
}

export interface OptimizeOptions {
  processor?: ImageProcessor;
  subtle?: SubtleCrypto;
}

/**
 * Valida (tipo REAL por bytes), redimensiona/recomprime y calcula el SHA-256. Lanza `MediaClientError`:
 * `typeNotAllowed` (no es JPEG/PNG/WebP/AVIF), `decode` (no se pudo leer/codificar), `tooLarge` (> 5 MiB tras optimizar).
 */
export async function optimizeImage(
  file: Blob,
  { processor = browserImageProcessor, subtle }: OptimizeOptions = {},
): Promise<OptimizedImage> {
  if (file.size === 0) throw new MediaClientError('decode', 'El archivo está vacío');
  const mime = sniffImageMime(await readBytes(file.slice(0, 32)));
  if (!mime) {
    throw new MediaClientError('typeNotAllowed', 'Solo se admiten JPEG, PNG, WebP o AVIF');
  }
  let dims: { width: number; height: number };
  try {
    dims = await processor.measure(file);
  } catch {
    throw new MediaClientError('decode', 'No se pudo leer la imagen');
  }
  if (!(dims.width > 0 && dims.height > 0)) {
    throw new MediaClientError('decode', 'La imagen no tiene dimensiones válidas');
  }
  const plan = planOptimization({
    mimeType: mime,
    width: dims.width,
    height: dims.height,
    sizeBytes: file.size,
  });
  let blob: Blob;
  let outMime: MediaMime;
  let size = dims;
  if (plan === 'keep') {
    blob = new Blob([file], { type: mime });
    outMime = mime;
  } else {
    size = fitWithin(dims.width, dims.height, MEDIA_MAX_SIDE_PX);
    try {
      const encoded = await processor.encodeWebp(file, size, MEDIA_WEBP_QUALITY);
      blob = new Blob([encoded], { type: 'image/webp' });
    } catch {
      throw new MediaClientError('decode', 'No se pudo optimizar la imagen');
    }
    outMime = 'image/webp';
  }
  if (blob.size > MEDIA_MAX_BYTES) {
    throw new MediaClientError('tooLarge', 'La imagen supera 5 MiB incluso optimizada');
  }
  if (blob.size === 0) throw new MediaClientError('decode', 'La optimización no produjo datos');
  return {
    blob,
    mimeType: outMime,
    sizeBytes: blob.size,
    checksumSha256: await sha256HexOfBlob(blob, subtle),
    width: size.width,
    height: size.height,
    recompressed: plan === 'convert',
  };
}
