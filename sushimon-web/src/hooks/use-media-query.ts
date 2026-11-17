'use client';

import { useSyncExternalStore } from 'react';

/**
 * `true` si la media query coincide AHORA (y se actualiza al cambiar). En el servidor y durante la hidratación es `false`; sin
 * `matchMedia` (pruebas en jsdom) usa `fallback`. Sirve para NO montar (ni consultar datos de) lo que el CSS solo esconde.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(query).matches
        : fallback,
    () => false,
  );
}
