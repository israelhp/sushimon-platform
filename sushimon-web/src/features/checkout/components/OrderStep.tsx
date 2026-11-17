'use client';

import { Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { blockerMessageKey } from '@/features/cart/components/CartPanel';
import { CartLineItem } from '@/features/cart/components/CartLineItem';
import { useEditLine } from '@/features/cart/use-edit-line';
import { UndoRow, useUndoRemove } from '@/features/cart/use-undo-remove';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useCheckoutDraft } from '../checkout-context';
import type { CheckoutData } from '../use-checkout-data';
import { useCheckoutSteps } from './parts';

/** Paso 1 · Tu pedido: líneas editables (cantidad, quitar), "agregar más" e indicaciones para el restaurante. */
export function OrderStep({ data }: { data: CheckoutData }) {
  const t = useTranslations();
  const steps = useCheckoutSteps();
  const { draft, dispatch } = useCheckoutDraft();
  const edit = useEditLine();
  const undo = useUndoRemove();
  const [notesOpen, setNotesOpen] = useState(() => !!draft.notes.trim());
  const { view } = data;
  const onlyPending = view.blockers.length > 0 && view.blockers.every((b) => b === 'PENDING');

  // Los marcadores «Deshacer» ocupan el lugar de la fila quitada (inline: alcanzables con teclado).
  const items: (
    | { kind: 'row'; row: (typeof view.rows)[number]; index: number }
    | { kind: 'undo'; item: (typeof undo.pending)[number] }
  )[] = view.rows.map((row, index) => ({ kind: 'row' as const, row, index }));
  for (const item of undo.pending)
    items.splice(Math.min(item.index, items.length), 0, { kind: 'undo', item });

  return (
    <section aria-label={steps[0]} className="flex flex-col gap-3">
      {view.blockers.length > 0 && !view.blockers.includes('EMPTY') ? (
        // El MISMO motivo que el cajón. Si se intenta continuar con algo bloqueado, el foco llega aquí (`data-focus-error`).
        <div
          data-focus-error
          tabIndex={-1}
          role={onlyPending ? 'status' : 'alert'}
          className="notice notice-warn outline-none"
        >
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>
            {view.blockers
              // Con otra sucursal TODAS las líneas quedan marcadas: el motivo es la sucursal, no «productos no disponibles».
              .filter((b) => !(b === 'INVALID_LINES' && view.blockers.includes('BRANCH_MISMATCH')))
              .map((b) => (
                <p key={b} className="m-0">
                  {t(
                    b === 'INVALID_LINES' ? 'checkoutFlow.unavailableNotice' : blockerMessageKey(b),
                  )}
                </p>
              ))}
          </div>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((entry) =>
          entry.kind === 'row' ? (
            <CartLineItem
              key={entry.row.line.lineId}
              row={entry.row}
              index={entry.index}
              catalog={view.catalog}
              size="comfortable"
              onEdit={edit}
              onRemove={undo.remove}
            />
          ) : (
            <UndoRow
              key={`undo-${entry.item.id}`}
              item={entry.item}
              onUndo={undo.undo}
              onDismiss={undo.dismiss}
            />
          ),
        )}
      </ul>
      <p className="m-0 text-[12px] text-muted">{t('cart.estimateNote')}</p>
      <Link
        href={STORE_ROUTES.menu}
        className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-sm font-extrabold text-secondary no-underline"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> {t('checkout.addMore')}
      </Link>
      {notesOpen ? (
        <div>
          <label className="lbl" htmlFor="d-notes">
            {t('checkout.notesLabel')}{' '}
            <span className="font-normal text-muted">({t('common.optional')})</span>
          </label>
          <textarea
            id="d-notes"
            className="input min-h-[88px] resize-y"
            maxLength={280}
            placeholder={t('checkout.notesPh')}
            value={draft.notes}
            onChange={(e) => dispatch({ type: 'notes', notes: e.target.value })}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="inline-flex min-h-[40px] items-center gap-1.5 self-start text-sm font-extrabold text-secondary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> {t('checkout.addNotes')}
        </button>
      )}
    </section>
  );
}

/** Esqueleto mientras carga el catálogo con un carrito no vacío. */
export function OrderStepSkeleton({ lines }: { lines: number }) {
  return (
    <ul aria-busy="true" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {Array.from({ length: Math.min(lines, 3) }, (_, i) => (
        <li
          key={i}
          className="flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card"
        >
          <Skeleton className="h-16 w-16 flex-none" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
