'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { planBranchSwitch, type LineStatus, type PlanItem } from '@/lib/cart-rules';
import { usePublicBranches } from '@/features/branches/hooks';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { useCart } from '../cart-context';
import { useBranchLive } from '../use-branch-live';
import { centsMoney } from './CartLineItem';

function reasonKey(status: LineStatus) {
  switch (status) {
    case 'UNAVAILABLE':
      return 'cart.status.unavailable';
    case 'INACTIVE':
      return 'cart.branchSwitch.notSold';
    case 'MODIFIER_INVALID':
      return 'cart.status.modifierInvalid';
    case 'OPTION_UNAVAILABLE':
      return 'cart.status.optionUnavailable';
    default:
      return 'cart.status.notFound';
  }
}

/**
 * Diálogo de la política de sucursal (se carga solo cuando hay desajuste; ver `CartBranchGuard`). Spec 019 §4: el carrito es de UNA sucursal. Si la del modo de pedido difiere de la del carrito con
 * líneas, este diálogo muestra el PLAN por línea (se mantiene, cambia de precio, se quita y por qué) contra el menú y las fichas
 * de la sucursal nueva y deja elegir: conservar las válidas, vaciar y empezar (con confirmación) o mantener la sucursal anterior.
 * Hasta confirmar el carrito sigue asociado a la anterior; NUNCA se vacía ni se mezcla en silencio.
 */
export function CartBranchDialog() {
  const t = useTranslations();
  const cart = useCart();
  const { mode, update } = useOrderMode();
  const { notify } = useToast();
  const branches = usePublicBranches();
  // La confirmación de «vaciar» vale solo para la sucursal que se está resolviendo (si cambia, vuelve a pedirse).
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const target = mode.branchId;
  const confirmEmpty = confirmFor !== null && confirmFor === target;
  const setConfirmEmpty = (on: boolean) => setConfirmFor(on ? target : null);
  const mismatch =
    cart.ready && cart.lines.length > 0 && target !== null && cart.branchId !== target;
  const live = useBranchLive({
    branchId: mismatch ? target : null,
    lines: cart.lines,
    enabled: mismatch,
  });
  const plan = useMemo(
    () =>
      mismatch && target
        ? planBranchSwitch(
            { v: 2, branchId: cart.branchId, updatedAt: 0, lines: [...cart.lines] },
            target,
            { cards: live.cards, details: live.details },
          )
        : null,
    [mismatch, target, cart.branchId, cart.lines, live.cards, live.details],
  );
  if (!mismatch || !plan || !target) return null;
  const nameOf = (id: string | null) => branches.data?.find((b) => b.id === id)?.name ?? '';
  const from = nameOf(cart.branchId);
  const to = nameOf(target);
  const previousExists = Boolean(branches.data?.some((b) => b.id === cart.branchId));
  const revert = () => {
    if (previousExists) update({ branchId: cart.branchId });
  };
  const rowOf = (item: PlanItem) => cart.lines.find((l) => l.lineId === item.lineId);

  return (
    <Modal
      open
      layer="top"
      role="alertdialog"
      // Sin sucursal anterior a la que volver, Esc no hace nada: hay que elegir una salida visible.
      onClose={revert}
      title={t('cart.branchSwitch.title')}
      footer={
        <div className="flex flex-col gap-2">
          {confirmEmpty ? (
            <>
              <p className="m-0 text-sm font-bold">
                {t('cart.branchSwitch.emptyConfirmBody', {
                  a: to || t('cart.branchSwitch.another'),
                })}
              </p>
              <button
                type="button"
                className="btn w-full"
                autoFocus
                onClick={() => setConfirmEmpty(false)}
              >
                {t('cart.keep')}
              </button>
              <button
                type="button"
                className="btn w-full !border-danger !bg-danger !text-onprimary"
                onClick={() => {
                  cart.clear();
                  setConfirmEmpty(false);
                  notify(t('cart.cleared'));
                }}
              >
                {t('cart.branchSwitch.emptyConfirm')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={!plan.ready || plan.keepCount === 0}
                onClick={() => {
                  cart.switchBranch(plan);
                  notify(t('cart.branchSwitch.done', { a: to }));
                }}
              >
                {t('cart.branchSwitch.apply', { a: plan.keepCount })}
              </button>
              <button type="button" className="btn w-full" onClick={() => setConfirmEmpty(true)}>
                {t('cart.branchSwitch.empty', { a: to || t('cart.branchSwitch.another') })}
              </button>
              {previousExists ? (
                <button type="button" className="btn w-full" onClick={revert}>
                  {t('cart.branchSwitch.revert', { a: from })}
                </button>
              ) : null}
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        {!previousExists ? (
          <p role="status" className="m-0 text-[13px] font-bold text-secondary">
            {t('cart.branchSwitch.previousGone')}
          </p>
        ) : null}
        <p className="m-0">
          {t('cart.branchSwitch.intro', {
            a: from || t('cart.branchSwitch.another'),
            b: to || t('cart.branchSwitch.another'),
          })}
        </p>
        {live.status === 'error' ? (
          <div role="alert" className="notice notice-warn">
            <div className="flex-1">
              {t('cart.verifyError')}{' '}
              <button
                type="button"
                className="min-h-[44px] font-extrabold underline"
                onClick={live.retry}
              >
                {t('ui.retry')}
              </button>
            </div>
          </div>
        ) : !plan.ready ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <p role="status" className="m-0 text-sm text-muted">
              {t('cart.verifying')}
            </p>
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface p-0">
              {plan.items.map((item) => {
                const line = rowOf(item);
                if (!line) return null;
                return (
                  <li
                    key={item.lineId}
                    className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold">
                        {line.quantity}× {line.display.name}
                      </span>
                      {item.outcome === 'REMOVE' ? (
                        <span className="mt-0.5 block text-[12px] font-bold text-danger">
                          {t('cart.branchSwitch.willRemove')}: {t(reasonKey(item.status))}
                        </span>
                      ) : item.outcome === 'KEEP_PRICE_CHANGED' ? (
                        <span className="mt-0.5 block text-[12px] font-bold text-secondary">
                          {t('cart.status.priceChanged', {
                            a: centsMoney(item.beforeUnitCents),
                            b: centsMoney(item.afterUnitCents ?? 0),
                          })}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[12px] text-muted">
                          {t('cart.branchSwitch.keeps')}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {plan.removeCount > 0 ? (
              <p role="status" className="m-0 text-[13px] font-bold text-danger">
                {t('cart.branchSwitch.removeNote', { a: plan.removeCount, b: to })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
