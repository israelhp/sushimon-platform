'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { useClientReady } from '@/features/store/client-ready';

/**
 * Burbuja con el número de UNIDADES del carrito (encabezado y barra móvil). Solo anima cuando el número CAMBIA después de que el
 * navegador tomó el control: el primer valor tras la hidratación aparece sin «rebote» (y `prefers-reduced-motion` ya lo anula en CSS).
 */
export function CountBadge({ count, className }: { count: number; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ready = useClientReady();
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    const el = ref.current;
    if (el && previous.current !== null && previous.current !== count) {
      el.classList.remove('anim-bump');
      void el.offsetWidth; // reinicia la animación aunque el número cambie dos veces seguidas
      el.classList.add('anim-bump');
    }
    previous.current = count;
  }, [count, ready]);
  if (count <= 0) return null;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(className, 'after:content-[attr(data-count)]')}
      data-count={count}
    ></span>
  );
}
