'use client';

import { useEffect, useState } from 'react';

/** Devuelve `value` tras `delayMs` sin cambios (búsquedas: una consulta por pausa de escritura, no por tecla). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
