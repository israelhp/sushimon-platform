'use client';

import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Diálogos abiertos (el último es el superior): solo él reacciona a Esc/Tab cuando hay varios apilados. */
const dialogStack: HTMLElement[] = [];

/**
 * Comportamiento de diálogos (equivale al hook `As` del prototipo, más trampa de foco):
 * al abrir bloquea el scroll del body y enfoca el contenedor; Esc cierra; Tab/Shift+Tab no salen del diálogo;
 * al cerrar restaura el overflow y devuelve el foco al elemento que lo abrió.
 */
export function useDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const self = ref.current;
    if (self) dialogStack.push(self);

    const onKey = (e: KeyboardEvent) => {
      if (self && dialogStack[dialogStack.length - 1] !== self) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = focusables(ref.current);
      if (items.length === 0) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!ref.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = self ? dialogStack.lastIndexOf(self) : -1;
      if (i >= 0) dialogStack.splice(i, 1);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  return ref;
}

const noopSubscribe = () => () => {};
/** `true` solo en el navegador tras hidratar (para portales). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
