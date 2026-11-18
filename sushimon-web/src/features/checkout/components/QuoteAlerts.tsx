'use client';

import { Info, Loader2, Pencil, RotateCcw, Store, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCart } from '@/features/cart/cart-context';
import { useAvailabilityText } from '@/features/branch-schedule/use-availability-text';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import {
  blockerMessageKey,
  configKey,
  moneyToCents,
  noticeMessageKey,
  type QuoteErrorKind,
} from '@/lib/checkout-quote';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { CheckoutQuote } from '@/lib/data-access/models';
import type { CheckoutStep } from '../checkout-model';
import type { CheckoutData } from '../use-checkout-data';
import { quoteLineName, rowNamesByConfig } from './quote-helpers';
import { useScheduleAction } from './use-schedule-action';

const ERROR_KEY: Record<QuoteErrorKind, string> = {
  offline: 'offline',
  busy: 'busy',
  'rate-limited': 'rateLimited',
  'branch-unavailable': 'branchUnavailable',
  session: 'session',
  'not-found': 'notFound',
  invalid: 'invalid',
  unknown: 'unknown',
};

/**
 * Bloqueos y avisos de la cotización (`blockers[]`, `notices[]`) con textos es/en por CÓDIGO estable, más los estados de error
 * y vencimiento. Cada bloqueo trae su acción (corregir línea, completar dirección, recoger en sucursal, programar con datos
 * simulados). NUNCA modifica el carrito en silencio: «Actualizar precio» es una acción explícita del cliente.
 * El contenedor de bloqueos lleva `data-focus-error`: al intentar avanzar el flujo enfoca el primer bloqueo.
 */
export function QuoteAlerts({
  data,
  goTo,
}: {
  data: CheckoutData;
  goTo: (step: CheckoutStep) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const cart = useCart();
  const { update } = useOrderMode();
  const availabilityText = useAvailabilityText();
  const schedule = useScheduleAction(data, goTo);
  const { quote: state, shownQuote: quote } = data;
  const updating = state.updating;
  const names = rowNamesByConfig(data.rows);
  const money = (cents: number | null) => (cents === null ? '' : formatMoney(cents / 100, locale));

  if (state.status === 'error') {
    const kind = state.errorKind ?? 'unknown';
    return (
      <div data-focus-error tabIndex={-1} className="outline-none">
        <ErrorNotice
          message={t(`checkout.quote.errors.${ERROR_KEY[kind]}`)}
          onRetry={state.refetch}
          cooldownSec={kind === 'rate-limited' ? state.retryAfterSec : 0}
        />
      </div>
    );
  }

  const info = (message: string, key: string) => (
    <p key={key} className="notice notice-info m-0">
      <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );

  if (data.branchMismatch) {
    return (
      <div data-focus-error tabIndex={-1} className="outline-none">
        {info(t('checkout.quote.branchMismatch'), 'mismatch')}
      </div>
    );
  }
  if (data.addressPending) {
    return (
      <div data-focus-error tabIndex={-1} className="outline-none">
        <div className="notice notice-warn items-center" role="alert">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <span>{t('checkout.quote.blockers.ADDRESS_INCOMPLETE')}</span>
            <button type="button" className="link-btn !min-h-0 text-sm" onClick={() => goTo(2)}>
              <Pencil className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              {t('checkout.quote.actions.completeAddress')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!quote) return null;

  const scheduled = data.when.kind === 'scheduled' && data.scheduledSupported;
  const blockers = quote.blockers.filter((b) => !(scheduled && b.code === 'BRANCH_CLOSED'));
  const lineBlocked = blockers.some((b) => b.scope === 'LINE');
  const addressBlocked = blockers.some((b) => b.code === 'ADDRESS_INCOMPLETE');
  const fulfillmentBlocked = blockers.some((b) => b.scope === 'FULFILLMENT');
  const closed = blockers.some((b) => b.code === 'BRANCH_CLOSED');

  const lineName = (index: number | undefined) => {
    const line = index === undefined ? undefined : quote.lines[index];
    return line
      ? quoteLineName(
          names,
          updating ? undefined : data.quoteInputs?.cart.lines[index as number],
          line.productId,
        )
      : '';
  };
  const blockerText = (code: string, lineIndex: number | undefined) => {
    const text = t(blockerMessageKey(code), { name: lineName(lineIndex) });
    if (code !== 'BRANCH_CLOSED') return text;
    const next = quote.branch.nextOpensAt;
    return next
      ? `${text} ${t('checkout.quote.opensAt', { when: availabilityText.when(next, quote.quote.generatedAt) })}`
      : text;
  };

  const updatePrice = (index: number) => {
    const line = quote.lines[index];
    const cents = line ? moneyToCents(line.unitPrice) : null;
    if (!line || cents === null) return;
    const sent = data.quoteInputs?.cart.lines[index];
    const key = sent ? configKey(sent.productId, sent.selections) : '';
    for (const row of data.rows) {
      if (configKey(row.line.productId, row.line.selections) !== key) continue;
      cart.applyRevalidation([
        {
          lineId: row.line.lineId,
          unitCents: cents,
          name: row.line.display.name,
          imageUrl: row.line.display.imageUrl,
          options: row.line.display.options,
        },
      ]);
      cart.acknowledgePrice(row.line.lineId);
    }
    // El aviso viene de la cotización anterior: se recotiza con el precio ya reconocido.
    state.refetch();
  };

  const noticeText = (notice: CheckoutQuote['notices'][number]) => {
    const line = notice.lineIndex === undefined ? undefined : quote.lines[notice.lineIndex];
    if (notice.code === 'PRICE_CHANGED' && line) {
      const from = moneyToCents(line.previousUnitPrice);
      const to = moneyToCents(line.unitPrice);
      const name = quoteLineName(
        names,
        updating ? undefined : data.quoteInputs?.cart.lines[notice.lineIndex as number],
        line.productId,
      );
      return from !== null && to !== null
        ? t('checkout.quote.notices.PRICE_CHANGED', { name, from: money(from), to: money(to) })
        : t('checkout.quote.notices.PRICE_CHANGED_NOPREV', { name });
    }
    return t(noticeMessageKey(notice.code));
  };

  return (
    <div
      className={cn('flex flex-col gap-2.5', updating && 'opacity-60')}
      aria-busy={updating || undefined}
    >
      {state.status === 'expired' ? (
        <p className="m-0 flex items-center gap-2 text-[13px] font-bold text-fg">
          <Loader2 className="anim-spin h-4 w-4 flex-none" aria-hidden="true" />
          {t('checkout.quote.status.expired')}
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <div
          data-focus-error
          tabIndex={-1}
          role="alert"
          className="notice notice-warn flex-col items-stretch outline-none"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
            <ul className="m-0 list-none space-y-1 p-0">
              {blockers.map((b, i) => (
                <li key={`${b.code}-${b.lineIndex ?? i}`} data-blocker={b.code}>
                  {blockerText(b.code, b.lineIndex)}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 pl-[26px]">
            {lineBlocked ? (
              <button
                type="button"
                className="btn !min-h-[42px] !px-4 text-sm"
                onClick={() => goTo(1)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />{' '}
                {t('checkout.quote.actions.reviewOrder')}
              </button>
            ) : null}
            {addressBlocked ? (
              <button
                type="button"
                className="btn !min-h-[42px] !px-4 text-sm"
                onClick={() => goTo(2)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />{' '}
                {t('checkout.quote.actions.completeAddress')}
              </button>
            ) : null}
            {fulfillmentBlocked && data.type === 'delivery' ? (
              <button
                type="button"
                className="btn btn-primary !min-h-[42px] !px-4 text-sm"
                onClick={() => update({ type: 'pickup' })}
              >
                <Store className="h-4 w-4" aria-hidden="true" />{' '}
                {t('checkout.quote.actions.switchPickup')}
              </button>
            ) : null}
            {closed && data.scheduledSupported ? (
              <button type="button" className="btn !min-h-[42px] !px-4 text-sm" onClick={schedule}>
                {t('checkout.quote.actions.schedule')}
              </button>
            ) : null}
            {closed && !data.scheduledSupported ? (
              <>
                <span className="w-full text-[13px]">{t('checkout.quote.closedHint')}</span>
                <button
                  type="button"
                  className="btn !min-h-[42px] !px-4 text-sm"
                  onClick={() => document.getElementById('checkout-branch-list')?.focus()}
                >
                  <Store className="h-4 w-4" aria-hidden="true" />{' '}
                  {t('checkout.quote.viewBranches')}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {quote.notices.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {quote.notices.map((n, i) => (
            <li
              key={`${n.code}-${n.lineIndex ?? i}`}
              className="notice notice-info"
              data-notice={n.code}
            >
              <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                <span>{noticeText(n)}</span>
                {n.code === 'PRICE_CHANGED' && n.lineIndex !== undefined ? (
                  <button
                    type="button"
                    className="link-btn !min-h-[36px] text-sm"
                    aria-label={t('checkout.quote.actions.updatePriceAria', {
                      name: lineName(n.lineIndex),
                    })}
                    aria-disabled={updating || undefined}
                    onClick={() => {
                      if (!updating) updatePrice(n.lineIndex as number);
                    }}
                  >
                    <RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                    {t('checkout.quote.actions.updatePrice')}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
