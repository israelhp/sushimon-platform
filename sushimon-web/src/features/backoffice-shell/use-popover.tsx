'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Estado abierto/cerrado de un menú desplegable simple (sucursal, usuario, notificaciones). */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

/**
 * Contenedor de un menú desplegable (botón + panel). Mientras está abierto se cierra al hacer clic fuera o al
 * pulsar Esc (devolviendo el foco al botón que lo abrió).
 */
export function PopoverRoot({
  open,
  onDismiss,
  className,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onDismiss();
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup], [aria-expanded]')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onDismiss]);

  return (
    <div className={className} ref={rootRef}>
      {children}
    </div>
  );
}
