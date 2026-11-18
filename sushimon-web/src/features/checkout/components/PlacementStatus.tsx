'use client';

import { Info, Loader2, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { moneyToCents } from '@/lib/checkout-quote';
import type { OrderQuoteChange } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import type { PlaceFailure } from '../place-order-errors';
import { blockerMessageKey } from '@/lib/checkout-quote';
import type { PlaceState } from '../use-place-order';

/**
 * Texto (clave `checkout.order.*`) que se anuncia en la ÚNICA región `aria-live` del checkout para este estado, o `null`.
 * Los fallos «blandos» (la pantalla se recotiza sola) se anuncian aquí en lugar de abrir otra región.
 */
export function placementLiveKey(state: PlaceState): string | null {
  if (state.status === 'sending') return state.retrying ? 'retrying' : 'liveSending';
  if (state.status === 'success') return 'liveReceived';
  if (state.status === 'failed') {
    const k = state.failure.kind;
    if (k === 'quoteExpired') return 'expired';
    if (k === 'quoteInvalid') return 'quoteInvalid';
    if (k === 'keyReused') return 'keyReused';
  }
  return null;
}

const MESSAGE_KEY: Partial<Record<PlaceFailure['kind'], string>> = {
  ambiguous: 'ambiguous',
  busy: 'busy',
  unavailable: 'unavailable',
  quoteExpired: 'expired',
  quoteInvalid: 'quoteInvalid',
  keyReused: 'keyReused',
  blocked: 'blocked',
  rateLimited: 'rateLimited',
  pendingLimit: 'pendingLimit',
  paymentUnavailable: 'paymentUnavailable',
  contactIncomplete: 'contactIncomplete',
  providerNotSelectable: 'providerNotSelectable',
  address: 'address',
  invalid: 'invalid',
  unknown: 'unknown',
};

/**
 * F20 — Estado de la confirmación bajo la revisión: «Enviando…» / «Comprobando tu pedido…» (visible; el anuncio a lectores va en la
 * única región `aria-live` del checkout) y los fallos con su texto por CÓDIGO estable. `QUOTE_CHANGED` abre un `alertdialog` con el
 * nuevo total y exige re-aceptación explícita. NUNCA muestra un éxito: ese estado lo presenta `OrderReceived`.
 */
export function PlacementStatus({
  state,
  onRetry,
  onAcceptChange,
  onCancelChange,
  lineName = () => '',
}: {
  state: PlaceState;
  onRetry: () => void;
  onAcceptChange: () => void;
  onCancelChange: () => void;
  /** Nombre del producto de una línea bloqueada (por `lineIndex`). */
  lineName?: (lineIndex: number | undefined) => string;
}) {
  const tr = useTranslations();
  const t = (key: string, values?: Record<string, string>) =>
    tr(`checkout.order.${key}` as 'checkout.order.sending', values);
  const tq = (key: string) => tr(`checkout.quote.${key}` as 'checkout.quote.provider');
  const locale = useLocale();
  const money = (v: string | null | undefined) => {
    const cents = moneyToCents(v);
    return cents === null ? (v ?? '') : formatMoney(cents / 100, locale);
  };

  if (state.status === 'sending') {
    return (
      <p className="m-0 flex items-center gap-2 text-[14px] text-muted" data-testid="placing">
        <Loader2 className="anim-spin h-4 w-4 flex-none" aria-hidden="true" />
        {state.retrying ? t('retrying') : t('sending')}
      </p>
    );
  }
  if (state.status !== 'failed') return null;
  const { failure } = state;

  if (failure.kind === 'quoteChanged') {
    const total = failure.quote.total;
    const valueOf = (c: OrderQuoteChange, which: 'previous' | 'current') => {
      const v = c[which];
      if (v === null || v === undefined) return '';
      if (c.field === 'provider') return tq(`providers.${v as 'OWN' | 'PEDIDOSYA'}`);
      return money(v);
    };
    return (
      <Modal
        open
        layer="top"
        role="alertdialog"
        onClose={onCancelChange}
        title={t('changedTitle')}
        footer={
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn btn-primary w-full"
              autoFocus
              onClick={onAcceptChange}
            >
              {t('changedAccept')}
            </button>
            <button type="button" className="btn w-full" onClick={onCancelChange}>
              {t('changedCancel')}
            </button>
          </div>
        }
      >
        <p className="m-0 mb-3">{t('changedIntro')}</p>
        <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          {failure.changes.map((c) => (
            <li key={c.field} className="text-[14px]">
              <strong>{t(`field.${c.field}`)}</strong>
              {c.field === 'lines' ? (
                <span className="block text-muted">{t('changedLines')}</span>
              ) : (
                <span className="block text-muted">
                  {t('changedBefore', { a: valueOf(c, 'previous') })} ·{' '}
                  {t('changedNow', { a: valueOf(c, 'current') })}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="m-0 text-[18px] font-extrabold" data-testid="changed-total">
          {t('field.total')}: {money(total)}
        </p>
      </Modal>
    );
  }

  if (failure.kind === 'blocked') {
    return (
      <div role="alert" className="notice notice-warn" data-testid="placement-failure">
        <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
        <div>
          <p className="m-0">{t('blocked')}</p>
          <ul className="m-0 mt-1 list-disc pl-5">
            {failure.blockers.length === 0 ? (
              <li>{t('blockedGeneric')}</li>
            ) : (
              failure.blockers.map((b, i) => (
                <li key={`${b.code}-${b.lineIndex ?? i}`}>
                  {tr(blockerMessageKey(b.code) as 'checkout.quote.blockers.UNKNOWN', {
                    name: lineName(b.lineIndex),
                  })}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    );
  }

  const key = MESSAGE_KEY[failure.kind] ?? 'unknown';
  const message = t(key);
  if (failure.kind === 'ambiguous' || failure.kind === 'busy' || failure.kind === 'rateLimited') {
    return (
      <ErrorNotice
        message={message}
        onRetry={onRetry}
        cooldownSec={failure.kind === 'rateLimited' ? (failure.retryAfterSec ?? 3) : 0}
      />
    );
  }
  const soft =
    failure.kind === 'quoteExpired' ||
    failure.kind === 'quoteInvalid' ||
    failure.kind === 'keyReused';
  return (
    <div
      // Los avisos blandos no abren otra región viva: se anuncian en la región única del checkout (`placementLiveKey`).
      role={soft ? undefined : 'alert'}
      className={soft ? 'notice notice-info' : 'notice notice-warn'}
      data-testid="placement-failure"
    >
      {soft ? (
        <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      ) : (
        <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      )}
      <div>{message}</div>
    </div>
  );
}
