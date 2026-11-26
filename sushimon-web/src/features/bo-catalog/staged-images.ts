'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { moveWithin } from '@/lib/category-tree';
import { MEDIA_PER_PRODUCT_MAX, isAllowedMime } from '@/lib/media-rules';

/**
 * Imágenes elegidas en el ALTA de un producto, antes de que exista su id. Viven solo en el navegador (vista previa `blob:`);
 * no se llama a la API de medios hasta que el producto se crea (entonces pasan a la cola de F14).
 */
export interface StagedImage {
  id: string;
  file: File;
  previewUrl: string | null;
  alt: string;
}

export interface StagedAddResult {
  added: number;
  /** Tipo MIME declarado fuera de la lista blanca (el tipo real lo vuelve a validar la optimización por bytes). */
  rejectedType: number;
  /** No cupieron por el tope por producto. */
  rejectedFull: number;
}

let seq = 0;

function previewOf(file: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

const revoke = (url: string | null) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

export function useStagedImages(max = MEDIA_PER_PRODUCT_MAX) {
  const [items, setItems] = useState<StagedImage[]>([]);
  const ref = useRef<StagedImage[]>([]);

  const commit = useCallback((next: StagedImage[]) => {
    ref.current = next;
    setItems(next);
  }, []);

  const add = useCallback(
    (files: readonly File[]): StagedAddResult => {
      const result: StagedAddResult = { added: 0, rejectedType: 0, rejectedFull: 0 };
      const next = [...ref.current];
      for (const file of files) {
        // Un tipo vacío (algunos navegadores con AVIF) pasa: la optimización valida el tipo real por bytes.
        if (file.type !== '' && !isAllowedMime(file.type)) {
          result.rejectedType += 1;
        } else if (next.length >= max) {
          result.rejectedFull += 1;
        } else {
          next.push({ id: `st${++seq}`, file, previewUrl: previewOf(file), alt: '' });
          result.added += 1;
        }
      }
      if (result.added > 0) commit(next);
      return result;
    },
    [commit, max],
  );

  const remove = useCallback(
    (id: string) => {
      revoke(ref.current.find((i) => i.id === id)?.previewUrl ?? null);
      commit(ref.current.filter((i) => i.id !== id));
    },
    [commit],
  );

  /** Devuelve la posición nueva (0-based) o `null` si no se puede mover. */
  const move = useCallback(
    (id: string, dir: -1 | 1): number | null => {
      const order = moveWithin(
        ref.current.map((i) => i.id),
        id,
        dir,
      );
      if (!order) return null;
      commit(order.map((x) => ref.current.find((i) => i.id === x)!));
      return order.indexOf(id);
    },
    [commit],
  );

  const setAlt = useCallback(
    (id: string, alt: string) => commit(ref.current.map((i) => (i.id === id ? { ...i, alt } : i))),
    [commit],
  );

  /** Vacía la lista y libera las vistas previas. */
  const clear = useCallback(() => {
    for (const i of ref.current) revoke(i.previewUrl);
    commit([]);
  }, [commit]);

  useEffect(
    () => () => {
      for (const i of ref.current) revoke(i.previewUrl);
    },
    [],
  );

  return { items, add, remove, move, setAlt, clear };
}

export type StagedImages = ReturnType<typeof useStagedImages>;
