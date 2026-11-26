'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { moneyToCents } from '@/lib/checkout-quote';
import { formatMoney } from '@/lib/format';
import type { CheckoutData } from '../use-checkout-data';

/**
 * Desglose de importes del resumen. SOLO muestra valores del SERVIDOR (subtotal, extras, descuento, tarifa y total). Mientras se
 * recalcula se conserva la última respuesta de la MISMA sesión atenuada y rotulada «Actualizando…» (`aria-busy`): nunca se
 * presenta como vigente ni habilita nada. Sin respuesta previa hay un esqueleto; sin cotización posible (error, sin dirección…)
 * solo el subtotal local rotulado «estimado». Los anuncios van en UNA región `aria-live` del flujo, no aquí.
 */
export function QuoteBreakdown({ data }: { data: CheckoutData }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents / 100, locale);
  const { quote: state, shownQuote: quote, totalChange } = data;
  const updating = state.updating;
  const waiting = !quote && (state.status === 'loading' || state.status === 'expired');

  if (waiting) {
    return (
      <div className="mt-1 min-h-[132px] border-t border-line px-4 py-3" aria-busy="true">
        <div aria-hidden="true" className="flex flex-col gap-2.5" data-testid="summary-skeleton">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-2/3 self-end" />
        </div>
      </div>
    );
  }

  if (!quote) {
    // Sin cotización del servidor: el subtotal local es solo una ESTIMACIÓN (nunca el total definitivo).
    return (
      <div className="mt-1 min-h-[132px] border-t border-line px-4 py-3 text-[15px]">
        <div className="flex justify-between">
          <span className="text-muted">
            {t('quote.subtotal')} <span className="text-[12px]">({t('quote.estimatedTag')})</span>
          </span>
          <span>{formatMoney(data.subtotal, locale)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">{t('quote.deliveryFee')}</span>
          <span>{t('quote.pending')}</span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-line pt-2">
          <span className="font-extrabold">{t('estimatedTotal')}</span>
          <span className="font-display text-[28px]" data-testid="summary-total">
            {formatMoney(data.total, locale)}
          </span>
        </div>
        <p className="m-0 mt-2 text-[12px] leading-snug text-muted" data-testid="summary-status">
          {state.status === 'error'
            ? t('quote.status.error')
            : state.status === 'idle'
              ? t('quote.status.idle')
              : t('quote.estimatedSubtotalNote')}
        </p>
      </div>
    );
  }

  const subtotal = moneyToCents(quote.subtotal);
  const extras = moneyToCents(quote.extrasTotal) ?? 0;
  const discount = moneyToCents(quote.discountTotal) ?? 0;
  const fee = moneyToCents(quote.deliveryFee);
  const total = moneyToCents(quote.total);
  return (
    <div
      className={cn(
        'mt-1 min-h-[132px] border-t border-line px-4 py-3 text-[15px]',
        updating && 'opacity-60',
      )}
      aria-busy={updating || undefined}
      data-updating={updating || undefined}
    >
      {updating ? (
        <p className="m-0 mb-1 text-[12px] font-bold text-fg" data-testid="summary-updating">
          {t('quote.updating')}
        </p>
      ) : null}
      <div className="flex justify-between">
        <span className="text-muted">{t('quote.subtotal')}</span>
        <span data-testid="summary-subtotal">{subtotal === null ? '—' : money(subtotal)}</span>
      </div>
      {extras > 0 ? (
        <div className="flex justify-between text-[13px] text-muted">
          <span>{t('quote.includesExtras', { a: money(extras) })}</span>
        </div>
      ) : null}
      {discount > 0 ? (
        <div className="flex justify-between text-success">
          <span>
            {t('quote.discount')}
            {quote.coupon?.status === 'APPLIED' ? ` · ${t('quote.coupon.applied')}` : ''}
          </span>
          <span data-testid="summary-discount">−{money(discount)}</span>
        </div>
      ) : null}
      <div className="flex justify-between">
        <span className="text-muted">{t('quote.deliveryFee')}</span>
        <span data-testid="summary-fee">{fee === null ? t('quote.unverified') : money(fee)}</span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-line pt-2">
        <span className="font-extrabold">{t('quote.total')}</span>
        <span className="font-display text-[28px]" data-testid="summary-total">
          {total === null ? '—' : money(total)}
        </span>
      </div>
      {total === null ? (
        <p className="m-0 mt-2 text-[12px] leading-snug text-muted">{t('quote.noTotal')}</p>
      ) : null}
      {!updating && totalChange ? (
        <p className="m-0 mt-2 text-[12px] font-bold text-fg" data-testid="summary-total-changed">
          {t('quote.totalChanged', {
            from: money(moneyToCents(totalChange.from) ?? 0),
            to: money(moneyToCents(totalChange.to) ?? 0),
          })}
        </p>
      ) : null}
    </div>
  );
}
