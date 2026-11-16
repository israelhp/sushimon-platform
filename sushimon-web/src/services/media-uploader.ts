import type { DataClient } from '@/lib/data-access/types';
import { putSimulatedMediaObject } from './media';
import { MediaClientError, hexToBase64, sha256HexOfBlob } from '@/lib/media-optimize';
import { registerSimulatedObject } from '@/lib/media-simulated';

/**
 * F14 — Subida del objeto. `MediaUploader` abstrae el PUT directo a la `uploadUrl` firmada:
 *  - http: `XMLHttpRequest` (progreso real, cancelable) con los `headers` EXACTOS que devolvió la API (están firmados: ni se
 *    añade ni se cambia ninguna; sin credenciales ni cookies). Solo `https`. La URL firmada no se registra ni se guarda.
 *  - mock: «sube» a un almacén SIMULADO en memoria; no hace ninguna petición de red.
 * Errores tipados con `MediaClientError` (`network`, `uploadRejected`, `aborted`).
 */

export interface UploadRequest {
  assetId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  body: Blob;
}

export interface UploadOptions {
  /** Fracción 0..1. */
  onProgress?: (fraction: number) => void;
  /** Cancelar la subida (rechaza con `aborted`). */
  signal?: AbortSignal;
}

export interface MediaUploader {
  readonly kind: 'http' | 'mock';
  upload(request: UploadRequest, options?: UploadOptions): Promise<void>;
}

const aborted = () => new MediaClientError('aborted', 'Subida cancelada');

/** Cabeceras prohibidas para `setRequestHeader` que el navegador gestiona solo (no se reenvían manualmente). */
const BROWSER_MANAGED_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'transfer-encoding',
]);

export function createXhrMediaUploader(
  createXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): MediaUploader {
  return {
    kind: 'http',
    upload(request, { onProgress, signal } = {}) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(aborted());
        let target: URL;
        try {
          target = new URL(request.uploadUrl);
        } catch {
          return reject(new MediaClientError('invalid', 'URL de subida inválida'));
        }
        if (target.protocol !== 'https:') {
          return reject(new MediaClientError('invalid', 'La URL de subida debe ser https'));
        }
        const xhr = createXhr();
        const onAbort = () => xhr.abort();
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        xhr.open('PUT', request.uploadUrl, true);
        xhr.withCredentials = false;
        // Solo las cabeceras firmadas, tal cual las devolvió la API, salvo las que el navegador no deja fijar
        // (`Content-Length`, `Host`…): las calcula él mismo a partir del cuerpo, que es el Blob exacto cuyo tamaño se firmó.
        for (const [name, value] of Object.entries(request.headers)) {
          if (BROWSER_MANAGED_HEADERS.has(name.toLowerCase())) continue;
          xhr.setRequestHeader(name, value);
        }
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            onProgress?.(Math.min(1, event.loaded / event.total));
          }
        };
        xhr.onload = () => {
          cleanup();
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress?.(1);
            resolve();
          } else {
            reject(
              new MediaClientError(
                'uploadRejected',
                `El almacenamiento rechazó la subida (${xhr.status})`,
                xhr.status,
              ),
            );
          }
        };
        xhr.onerror = () => {
          cleanup();
          reject(new MediaClientError('network', 'Sin conexión con el almacenamiento'));
        };
        xhr.ontimeout = xhr.onerror;
        xhr.onabort = () => {
          cleanup();
          reject(aborted());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        xhr.send(request.body);
      });
    },
  };
}

/**
 * Almacén SIMULADO: verifica lo que R2 verificaría al recibir el PUT (cabeceras firmadas presentes y checksum del cuerpo) y
 * registra el objeto en el store mock (vía `/v1/demo/media/objects/*`, que solo existe en el mock). Sin red.
 */
export function createMockMediaUploader(client: DataClient): MediaUploader {
  return {
    kind: 'mock',
    async upload(request, { onProgress, signal } = {}) {
      if (signal?.aborted) throw aborted();
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]),
      );
      for (const step of [0.25, 0.6, 0.9]) {
        onProgress?.(step);
        await Promise.resolve();
        if (signal?.aborted) throw aborted();
      }
      const checksumHex = await sha256HexOfBlob(request.body);
      const signed = headers['x-amz-checksum-sha256'];
      if (!signed || !headers['content-type'] || signed !== hexToBase64(checksumHex)) {
        throw new MediaClientError(
          'uploadRejected',
          'Almacén simulado: cabeceras o checksum no coinciden',
          400,
        );
      }
      await putSimulatedMediaObject(client, request.assetId, {
        sizeBytes: request.body.size,
        contentType: headers['content-type'],
        checksumSha256: checksumHex,
      });
      registerSimulatedObject(request.assetId, request.body);
      onProgress?.(1);
    },
  };
}

/** Selecciona el uploader por el tipo de cliente de datos (mock → almacén simulado; http → PUT directo). */
export const createMediaUploader = (client: DataClient): MediaUploader =>
  client.kind === 'mock' ? createMockMediaUploader(client) : createXhrMediaUploader();
