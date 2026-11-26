'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataClient } from '@/lib/data-access/provider';
import {
  MediaClientError,
  isMediaClientError,
  optimizeImage,
  type OptimizedImage,
} from '@/lib/media-optimize';
import { MEDIA_PER_PRODUCT_MAX } from '@/lib/media-rules';
import { attachProductMedia, completeMediaUpload, createMediaUploadIntent } from '@/services/media';
import { createMediaUploader } from '@/services/media-uploader';
import { useInvalidateMedia } from './hooks';
import { mediaErrorKind, queuedSlots, type QueueItem } from './media-view';
import { useMediaTools } from './tools';

interface Entry {
  file: Blob;
  optimized?: OptimizedImage;
  /** Asset ya READY (un reintento retoma en el vínculo, sin subir otra vez). */
  assetId?: string;
  /** Producto destino fijado al encolar (alta: el id existe solo después de crear el producto). */
  productId?: string;
  /** Texto alternativo elegido antes de subir (se envía al adjuntar). */
  altText?: string | null;
  abort?: AbortController;
}

let itemSeq = 0;

/** Vista previa local (`blob:`); `null` si el entorno no puede crearla (nunca rompe la cola). */
function previewOf(file: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

/**
 * Cola de subida de un producto. Procesa los archivos EN ORDEN DE SELECCIÓN, uno a la vez (el vínculo exige orden y el producto
 * se bloquea al escribir): optimizar → pedir intent → PUT directo (con progreso) → complete → adjuntar. Cada archivo conserva su
 * estado; un fallo no detiene a los demás. «Reintentar» pide un intent NUEVO (y retoma en el vínculo si el asset ya está READY).
 * `MEDIA_UPLOAD_EXPIRED` y los errores del PUT se resuelven igual: reintentar.
 */
export function useUploadQueue(productId: string | undefined, attachedCount: number) {
  const client = useDataClient();
  const tools = useMediaTools();
  const invalidate = useInvalidateMedia();
  const uploader = useMemo(() => tools.uploader ?? createMediaUploader(client), [tools, client]);
  const [items, setItems] = useState<QueueItem[]>([]);
  const entries = useRef(new Map<string, Entry>());
  const itemsRef = useRef<QueueItem[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  // Valores vigentes sin recrear callbacks: `add` puede llamarse en el mismo tick en que se crea el producto.
  const productIdRef = useRef(productId);
  const attachedRef = useRef(attachedCount);
  useEffect(() => {
    productIdRef.current = productId;
    attachedRef.current = attachedCount;
  }, [productId, attachedCount]);

  const commit = useCallback((next: QueueItem[]) => {
    itemsRef.current = next;
    if (alive.current) setItems(next);
  }, []);
  const patch = useCallback(
    (id: string, change: Partial<QueueItem>) =>
      commit(itemsRef.current.map((i) => (i.id === id ? { ...i, ...change } : i))),
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      const entry = entries.current.get(id);
      entry?.abort?.abort();
      entries.current.delete(id);
      const item = itemsRef.current.find((i) => i.id === id);
      if (item?.previewUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(item.previewUrl);
      }
      commit(itemsRef.current.filter((i) => i.id !== id));
    },
    [commit],
  );

  const run = useCallback(
    async (id: string) => {
      const entry = entries.current.get(id);
      if (!entry) return;
      try {
        if (!entry.assetId) {
          if (!entry.optimized) {
            patch(id, { status: 'optimizing', error: undefined });
            entry.optimized = await optimizeImage(entry.file, { processor: tools.processor });
          }
          const o = entry.optimized;
          patch(id, { status: 'uploading', progress: 0, error: undefined });
          const intent = await createMediaUploadIntent(client, {
            kind: 'PRODUCT_IMAGE',
            mimeType: o.mimeType,
            sizeBytes: o.sizeBytes,
            checksumSha256: o.checksumSha256,
          });
          if (intent.deduplicated || intent.asset.status === 'READY') {
            entry.assetId = intent.assetId;
          } else {
            if (!intent.uploadUrl || !intent.headers) {
              throw new MediaClientError('other', 'La API no devolvió la URL de subida');
            }
            entry.abort = new AbortController();
            await uploader.upload(
              {
                assetId: intent.assetId,
                uploadUrl: intent.uploadUrl,
                headers: intent.headers,
                body: o.blob,
              },
              { onProgress: (progress) => patch(id, { progress }), signal: entry.abort.signal },
            );
            patch(id, { status: 'confirming', progress: 1 });
            const asset = await completeMediaUpload(client, intent.assetId);
            entry.assetId = asset.id;
          }
        }
        patch(id, { status: 'attaching', progress: 1 });
        const target = entry.productId ?? productIdRef.current;
        if (!target) throw new MediaClientError('other', 'El producto aún no existe');
        await attachProductMedia(client, target, {
          assetId: entry.assetId,
          ...(entry.altText ? { altText: entry.altText } : {}),
        });
        entry.optimized = undefined;
        patch(id, { status: 'done' });
        await invalidate();
      } catch (error) {
        if (isMediaClientError(error) && error.kind === 'aborted') {
          // Cancelada por la persona: se quita de la cola (el intent PENDING caduca solo).
          remove(id);
          return;
        }
        patch(id, { status: 'error', error: mediaErrorKind(error) });
      } finally {
        if (entries.current.get(id)) entries.current.get(id)!.abort = undefined;
      }
    },
    [client, invalidate, patch, remove, tools.processor, uploader],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'queued');
        if (!next || !alive.current) break;
        await run(next.id);
      }
    } finally {
      running.current = false;
    }
  }, [run]);

  /**
   * Añade archivos; los que no caben (tope de 8 por producto) quedan como error `productMediaInvalid`. `options.productId`
   * fija el destino (producto recién creado) y `options.altTexts` el texto alternativo por archivo (mismo orden).
   */
  const add = useCallback(
    (
      files: readonly File[],
      options: { productId?: string; altTexts?: readonly (string | null | undefined)[] } = {},
    ) => {
      let free = MEDIA_PER_PRODUCT_MAX - attachedRef.current - queuedSlots(itemsRef.current);
      const added: QueueItem[] = files.map((file, index) => {
        const id = `up${++itemSeq}`;
        entries.current.set(id, {
          file,
          productId: options.productId,
          altText: options.altTexts?.[index] ?? null,
        });
        const fits = free > 0;
        if (fits) free -= 1;
        return {
          id,
          name: file.name,
          previewUrl: previewOf(file),
          status: fits ? 'queued' : 'error',
          progress: 0,
          error: fits ? undefined : 'productMediaInvalid',
        };
      });
      commit([...itemsRef.current, ...added]);
      void pump();
    },
    [commit, pump],
  );

  const retry = useCallback(
    (id: string) => {
      if (!entries.current.has(id)) return;
      patch(id, { status: 'queued', error: undefined, progress: 0 });
      void pump();
    },
    [patch, pump],
  );

  const clearDone = useCallback(() => {
    for (const i of itemsRef.current.filter((x) => x.status === 'done')) {
      if (i.previewUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(i.previewUrl);
      }
      entries.current.delete(i.id);
    }
    commit(itemsRef.current.filter((i) => i.status !== 'done'));
  }, [commit]);

  useEffect(() => {
    alive.current = true;
    const map = entries.current;
    return () => {
      alive.current = false;
      for (const entry of map.values()) entry.abort?.abort();
      if (typeof URL.revokeObjectURL === 'function') {
        for (const i of itemsRef.current) if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      }
    };
  }, []);

  return { items, add, retry, remove, clearDone };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
