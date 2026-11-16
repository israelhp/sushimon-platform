'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mediaErrorKind } from '@/features/media/media-view';
import { useInvalidateMedia } from '@/features/media/hooks';
import { useMediaTools } from '@/features/media/tools';
import { useDataClient } from '@/lib/data-access/provider';
import { MediaClientError, isMediaClientError, optimizeImage } from '@/lib/media-optimize';
import type { MediaErrorKind } from '@/lib/media-rules';
import { completeMediaUpload, createMediaUploadIntent } from '@/services/media';
import { createMediaUploader } from '@/services/media-uploader';
import type { ImageValue } from './banners-view';

export type UploadStatus = 'idle' | 'optimizing' | 'uploading' | 'confirming' | 'done' | 'error';

export interface UploadState {
  status: UploadStatus;
  /** 0..1 (solo `uploading`). */
  progress: number;
  error?: MediaErrorKind;
  fileName?: string;
}

const IDLE: UploadState = { status: 'idle', progress: 0 };

/** Vista previa local (`blob:`); `null` si el entorno no puede crearla. */
function previewOf(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/**
 * F16 — Subida de la imagen de UN banner con el gestor de medios de F14: optimizar en el navegador (perfil `banner`: recorte
 * centrado 3:1, ancho ≤ 1920 px, ≤ 1 MiB) → pedir intent `BANNER_IMAGE` → PUT directo (almacén SIMULADO en el mock; R2 en http,
 * sin probar) → confirmar. Devuelve la imagen lista para el formulario. Un fallo deja el estado `error` con su clase de mensaje y NO
 * toca el resto del formulario (los textos se conservan, p. ej. con `MEDIA_STORAGE_UNAVAILABLE`).
 */
export function useBannerImageUpload() {
  const client = useDataClient();
  const tools = useMediaTools();
  const invalidate = useInvalidateMedia();
  const uploader = useMemo(() => tools.uploader ?? createMediaUploader(client), [tools, client]);
  const [state, setState] = useState<UploadState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const previews = useRef<string[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  const patch = useCallback((change: Partial<UploadState>) => {
    if (alive.current) setState((s) => ({ ...s, ...change }));
  }, []);

  const upload = useCallback(
    async (file: File): Promise<ImageValue | null> => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setState({ status: 'optimizing', progress: 0, fileName: file.name });
      try {
        const optimized = await optimizeImage(file, {
          processor: tools.processor,
          profile: 'banner',
        });
        patch({ status: 'uploading', progress: 0 });
        const intent = await createMediaUploadIntent(client, {
          kind: 'BANNER_IMAGE',
          mimeType: optimized.mimeType,
          sizeBytes: optimized.sizeBytes,
          checksumSha256: optimized.checksumSha256,
        });
        let asset = intent.asset;
        if (!(intent.deduplicated || asset.status === 'READY')) {
          if (!intent.uploadUrl || !intent.headers) {
            throw new MediaClientError('other', 'La API no devolvió la URL de subida');
          }
          await uploader.upload(
            {
              assetId: intent.assetId,
              uploadUrl: intent.uploadUrl,
              headers: intent.headers,
              body: optimized.blob,
            },
            { onProgress: (progress) => patch({ progress }), signal: controller.signal },
          );
          patch({ status: 'confirming', progress: 1 });
          asset = await completeMediaUpload(client, intent.assetId);
        }
        const previewSrc = previewOf(optimized.blob);
        if (previewSrc) previews.current.push(previewSrc);
        patch({ status: 'done', progress: 1 });
        await invalidate();
        return {
          assetId: asset.id,
          url: asset.url,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          previewSrc,
        };
      } catch (error) {
        if (isMediaClientError(error) && error.kind === 'aborted') {
          patch({ status: 'idle', progress: 0 });
          return null;
        }
        patch({ status: 'error', error: mediaErrorKind(error) });
        return null;
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [client, invalidate, patch, tools.processor, uploader],
  );

  const reset = useCallback(() => setState(IDLE), []);

  // Libera las vistas previas locales al salir del formulario.
  useEffect(() => {
    const list = previews.current;
    return () => {
      if (typeof URL.revokeObjectURL === 'function')
        for (const url of list) URL.revokeObjectURL(url);
    };
  }, []);

  return { state, upload, reset, cancel: () => abort.current?.abort() };
}
