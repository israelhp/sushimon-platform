'use client';

import { Info, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import type { ContinueBlocker } from '@/lib/cart-rules';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useOrderSheet } from '@/features/store-shell/store-shell-context';
import { useCart, useCartActions, useCartNotice } from '../cart-context';
import { useEditLine } from '../use-edit-line';
import { UndoRow, useUndoRemove } from '../use-undo-remove';
import type { CartView } from '../use-cart-view';
import { CartLineItem, centsMoney } from './CartLineItem';

const BLOCKER_KEY = {
  EMPTY: 'cart.blocked.empty',
  NO_BRANCH: 'cart.blocked.noBranch',
  BRANCH_MISMATCH: 'cart.blocked.mismatch',
  PENDING: 'cart.blocked.pending',
  ERROR: 'cart.blocked.error',
  INVALID_LINES: 'cart.blocked.invalid',
} as const satisfies Record<ContinueBlocker, string>;

/** Motivo (traducible) por el que «Continuar» está bloqueado: el mismo en el cajón, el resumen y el checkout. */
export const blockerMessageKey = (blocker: ContinueBlocker) => BLOCKER_KEY[blocker];

/**
 * Aviso único y no bloqueante (carrito anterior descartado, dañado, vencido, sin almacenamiento…). Es un recordatorio VISUAL: el
 * anuncio para lectores de pantalla sale por UN solo canal (el aviso del `CartAnnouncer`), así que no lleva `role`.
 */
export function CartNoticeBanner() {
  const t = useTranslations();
  const { notice } = useCartNotice();
  const { dismissNotice } = useCartActions();
  if (!notice) return null;
  return (
    <div className="notice notice-warn mx-4 mt-3">
      <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <div className="flex-1">{t(`cart.notice.${notice}`)}</div>
      <button
        type="button"
        onClick={dismissNotice}
        aria-label={t('cart.notice.dismiss')}
        className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full hover:bg-subtle"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Cuerpo del carrito compartido por el cajón y el resumen del menú: vacío, cargando (`aria-busy`), error de verificación con
 * «Reintentar», lista de líneas con sus estados, «Deshacer» inline y «Vaciar» con confirmación. Mismo origen de datos (`CartView`).
 */
export function CartPanelBody({
  view,
  onNavigate,
  emptyAction = true,
}: {
  view: CartView;
  /** Se invoca antes de salir a otra pantalla (cierra el cajón). */
  onNavigate?: () => void;
  emptyAction?: boolean;
}) {
  const t = useTranslations();
  const cart = useCart();
  const { notify } = useToast();
  const orderSheet = useOrderSheet();
  const edit = useEditLine();
  const undo = useUndoRemove();
  const [confirmClear, setConfirmClear] = useState(false);

  if (!cart.ready) {
    return (
      <div aria-busy="true" className="p-4">
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (cart.lines.length === 0 && undo.pending.length === 0) {
    return (
      <>
        <CartNoticeBanner />
        <EmptyState
          title={t('cart.empty')}
          description={t('cart.emptySub')}
          compact={!emptyAction}
          action={
            emptyAction ? (
              <Link
                href={STORE_ROUTES.menu}
                onClick={onNavigate}
                className="btn btn-primary !min-h-[44px]"
              >
                {t('common.goMenu')}
              </Link>
            ) : undefined
          }
        />
      </>
    );
  }

  // Los marcadores «Deshacer» ocupan el lugar de la fila quitada.
  const items: (
    | { kind: 'row'; row: CartView['rows'][number]; index: number }
    | { kind: 'undo'; item: (typeof undo.pending)[number] }
  )[] = view.rows.map((row, index) => ({ kind: 'row' as const, row, index }));
  for (const item of undo.pending) {
    items.splice(Math.min(item.index, items.length), 0, { kind: 'undo', item });
  }

  return (
    <>
      <CartNoticeBanner />
      <p role="status" className="sr-only">
        {t('cart.updated', { a: cart.count })}
      </p>
      {view.blockers.includes('NO_BRANCH') ? (
        <div className="notice notice-warn mx-4 mt-3">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div className="flex-1">
            {t('cart.blocked.noBranch')}{' '}
            <button
              type="button"
              className="min-h-[44px] underline"
              onClick={() => orderSheet.open('now')}
            >
              {t('cart.chooseBranch')}
            </button>
          </div>
        </div>
      ) : null}
      {view.status === 'error' ? (
        <div role="alert" className="notice notice-warn mx-4 mt-3">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div className="flex-1">
            {t('cart.verifyError')}{' '}
            <button
              type="button"
              className="min-h-[44px] font-extrabold underline"
              onClick={view.retry}
            >
              {t('ui.retry')}
            </button>
          </div>
        </div>
      ) : view.status === 'pending' ? (
        <p aria-busy="true" className="m-0 mx-4 mt-3 text-[13px] text-muted">
          {t('cart.verifying')}
        </p>
      ) : null}
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2.5 overflow-y-auto px-4 py-3">
        {items.map((entry) =>
          entry.kind === 'row' ? (
            <CartLineItem
              key={entry.row.line.lineId}
              row={entry.row}
              index={entry.index}
              catalog={view.catalog}
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
      {cart.lines.length > 0 ? (
        <div className="flex justify-end px-4 pb-2">
          <Button
            variant="link"
            className="!min-h-[44px] !py-0 text-[13px] !text-muted"
            onClick={() => setConfirmClear(true)}
          >
            {t('cart.clear')}
          </Button>
        </div>
      ) : null}
      {confirmClear ? (
        <Modal
          open
          layer="top"
          role="alertdialog"
          onClose={() => setConfirmClear(false)}
          title={t('cart.clearConfirmTitle')}
          footer={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn flex-1"
                autoFocus
                onClick={() => setConfirmClear(false)}
              >
                {t('cart.keep')}
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => {
                  cart.clear();
                  setConfirmClear(false);
                  notify(t('cart.cleared'));
                }}
              >
                {t('cart.clearConfirm')}
              </button>
            </div>
          }
        >
          <p className="m-0">{t('cart.clearConfirmBody')}</p>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Pie del carrito: subtotal ESTIMADO, aviso de que las promociones y el total final se validan en el checkout, «Continuar» (solo
 * si la revalidación lo permite; si no, `aria-disabled` con el motivo enlazado) y «Seguir comprando».
 */
export function CartFooter({
  view,
  units,
  onNavigate,
  showKeepShopping = true,
}: {
  view: CartView;
  units: number;
  onNavigate?: () => void;
  showKeepShopping?: boolean;
}) {
  const t = useTranslations();
  const reason = view.blockers[0];
  return (
    <div className="flex flex-col gap-2.5 pt-0.5">
      <div className="flex items-baseline justify-between">
        <span className="font-bold">{t('cart.subtotal')}</span>
        <strong className="font-display text-[26px]">{centsMoney(view.subtotalCents)}</strong>
      </div>
      <p className="m-0 text-[12px] text-muted">{t('cart.estimateNote')}</p>
      {view.canContinue ? (
        <Link
          href={STORE_ROUTES.checkout}
          onClick={onNavigate}
          className="btn btn-primary w-full !justify-between !px-6"
        >
          <span>{t('common.continue')}</span>
          <span className="text-sm">{t('common.products', { a: units })}</span>
        </Link>
      ) : (
        <>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby="cart-blocked-reason"
            onClick={(event) => event.preventDefault()}
            className="btn btn-primary w-full cursor-not-allowed !justify-between !px-6 opacity-50"
          >
            <span>{t('common.continue')}</span>
            <span className="text-sm">{t('common.products', { a: units })}</span>
          </button>
          {reason ? (
            <p
              id="cart-blocked-reason"
              className={
                reason === 'PENDING'
                  ? 'm-0 text-[12px] text-muted'
                  : 'm-0 text-[12px] font-bold text-danger'
              }
            >
              {t(BLOCKER_KEY[reason])}
            </p>
          ) : null}
        </>
      )}
      {showKeepShopping ? (
        <Link
          href={STORE_ROUTES.menu}
          onClick={onNavigate}
          className="inline-flex min-h-[44px] items-center justify-center text-sm font-extrabold text-secondary no-underline"
        >
          {t('cart.keepShopping')}
        </Link>
      ) : null}
    </div>
  );
}
