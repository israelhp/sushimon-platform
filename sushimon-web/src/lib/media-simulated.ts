import { SIMULATED_MEDIA_HOST, isSimulatedMediaUrl } from './media-rules';
import { safeMediaUrl } from './product-rules';

/**
 * F14 — SIMULADO (solo mock). Las URLs públicas de la demo usan el host RESERVADO `*.invalid` (nunca resuelve): no se piden por
 * red. Lo subido en esta pestaña se guarda como Blob en memoria para mostrarlo con un `blob:` local; tras recargar (o con
 * assets sembrados) no hay bytes y la UI usa la ilustración / un cuadro «simulado». En http este módulo no interviene.
 */

const objects = new Map<string, Blob>();
const objectUrls = new Map<string, string>();

/** `https://media-simulado.invalid/products/2026/<assetId>.webp` */
export const simulatedPublicUrl = (assetId: string, extension: string, year: number): string =>
  `https://${SIMULATED_MEDIA_HOST}/products/${year}/${assetId}.${extension}`;

const assetIdOfUrl = (url: string): string | null => {
  const m = /\/([^/]+)\.(?:jpg|png|webp|avif)$/.exec(new URL(url).pathname);
  return m?.[1] ?? null;
};

export function registerSimulatedObject(assetId: string, blob: Blob): void {
  objects.set(assetId, blob);
  const previous = objectUrls.get(assetId);
  if (previous && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previous);
  objectUrls.delete(assetId);
}

export function clearSimulatedObjects(): void {
  if (typeof URL.revokeObjectURL === 'function') {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  }
  objects.clear();
  objectUrls.clear();
}

/**
 * `src` seguro para un `<img>`: https normal, o el `blob:` local de un objeto simulado de ESTA sesión; `null` si es simulado y
 * no hay bytes (no se pide jamás un host `.invalid`) o la URL no es https.
 */
export function displayMediaSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!isSimulatedMediaUrl(url)) return safeMediaUrl(url);
  try {
    const id = assetIdOfUrl(url);
    const blob = id ? objects.get(id) : undefined;
    if (!id || !blob || typeof URL.createObjectURL !== 'function') return null;
    let objectUrl = objectUrls.get(id);
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(blob);
      objectUrls.set(id, objectUrl);
    }
    return objectUrl;
  } catch {
    return null;
  }
}
