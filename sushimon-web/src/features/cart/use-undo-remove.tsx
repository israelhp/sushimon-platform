'use client';

import { useTranslations } from 'next-intl';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { REJECTION_KEY } from './use-add-to-cart';
import { useCartActions, type RemovedLine } from './cart-context';

/** Tiempo para deshacer (se pausa con el puntero o el foco encima). */
export const UNDO_MS = 8000;

export interface PendingUndo {
  id: number;
  removed: RemovedLine;
  name: string;
  /** Posición que ocupaba la línea (el marcador aparece ahí). */
  index: number;
}

/**
 * «Deshacer» INLINE: al quitar una línea la fila se reemplaza por «X eliminado · Deshacer» DENTRO del contenedor (cajón o paso del
 * checkout), así es alcanzable con teclado (un toast fuera del diálogo no lo es). Varias eliminaciones seguidas conservan cada una
 * su propio marcador: ninguna se pierde en silencio.
 */
export function useUndoRemove() {
  const cart = useCartActions();
  const { notify } = useToast();
  const t = useTranslations();
  const [pending, setPending] = useState<PendingUndo[]>([]);
  const counter = useRef(0);

  const remove = useCallback(
    (lineId: string, name: string, index: number) => {
      const removed = cart.remove(lineId);
      if (!removed) return;
      setPending((p) => [...p, { id: ++counter.current, removed, name, index }]);
    },
    [cart],
  );
  const dismiss = useCallback((id: number) => setPending((p) => p.filter((x) => x.id !== id)), []);
  const undo = useCallback(
    (item: PendingUndo) => {
      const result = cart.restore(item.removed);
      if (!result.ok) notify(t(REJECTION_KEY[result.reason]), { tone: 'warn' });
      setPending((p) => p.filter((x) => x.id !== item.id));
    },
    [cart, notify, t],
  );
  return { pending, remove, undo, dismiss };
}

/** Marcador «X eliminado · Deshacer»: recibe el foco al aparecer y se descarta solo (pausado con puntero/foco). */
export const UndoRow = memo(function UndoRow({
  item,
  onUndo,
  onDismiss,
}: {
  item: PendingUndo;
  onUndo: (item: PendingUndo) => void;
  onDismiss: (id: number) => void;
}) {
  const t = useTranslations();
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { id } = item;
  const arm = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onDismiss(id), UNDO_MS);
  }, [id, onDismiss]);
  useEffect(() => {
    // Primero el temporizador y luego el foco: con el foco encima el aviso queda en pausa (`onFocus` lo detiene).
    arm();
    button.current?.focus();
    return () => clearTimeout(timer.current);
  }, [arm]);
  return (
    <li
      role="status"
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={arm}
      onFocus={() => clearTimeout(timer.current)}
      onBlur={arm}
      className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-subtle px-3.5 py-2 text-[14px]"
    >
      <span className="min-w-0 truncate">{t('product.removed', { a: item.name })}</span>
      <button
        ref={button}
        type="button"
        onClick={() => onUndo(item)}
        className="inline-flex min-h-[44px] flex-none items-center px-2 font-extrabold text-secondary underline"
      >
        {t('cart.undo')}
      </button>
    </li>
  );
});
