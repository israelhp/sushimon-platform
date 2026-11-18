'use client';

import { Loader2, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { COUPON_MAX_LENGTH, normalizeCoupon } from '@/lib/checkout-quote';
import type { CheckoutData } from '../use-checkout-data';

/**
 * Cupón de descuento (F19). El texto escrito NO cotiza: se aplica con «Aplicar» o Enter y solo el cupón APLICADO entra en la
 * cotización. El servidor responde únicamente `APPLIED|NOT_APPLIED`: ante cualquier cosa distinta de aplicado se muestra UN mensaje
 * genérico (no se distingue entre inexistente, vencido, de otra sucursal o sin ahorro). Un 429 es un error LOCAL del campo.
 * `aria-invalid` solo tras la respuesta `NOT_APPLIED` y con `data-skip-focus` (no captura el foco de «primer error» del flujo).
 */
export function CouponField({ data }: { data: CheckoutData }) {
  const t = useTranslations('checkout');
  const id = useId();
  const messageId = `${id}-msg`;
  const applied = data.appliedCoupon;
  const status = data.serverQuote?.coupon?.status ?? null;
  const checking = applied !== '' && data.quote.status !== 'ready' && data.quote.status !== 'error';
  const notApplied = applied !== '' && !checking && status === 'NOT_APPLIED';
  const accepted = applied !== '' && !checking && status === 'APPLIED';
  const canApply = normalizeCoupon(data.coupon) !== '' && normalizeCoupon(data.coupon) !== applied;
  const message = checking
    ? t('quote.coupon.checking')
    : notApplied
      ? t('quote.coupon.notApplied')
      : accepted
        ? t('quote.coupon.applied')
        : data.couponNotice === 'rate-limited'
          ? t('quote.coupon.rateLimited')
          : '';
  const apply = () => {
    if (canApply) data.applyCoupon();
  };
  return (
    <div>
      <label className="lbl flex items-center gap-1.5" htmlFor={id}>
        <Tag className="h-4 w-4 text-secondary" aria-hidden="true" /> {t('quote.coupon.label')}{' '}
        <span className="font-normal text-muted">({t('quote.coupon.optional')})</span>
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          className="input min-w-0 flex-1"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={COUPON_MAX_LENGTH}
          placeholder={t('quote.coupon.placeholder')}
          value={data.coupon}
          onChange={(e) => data.setCoupon(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          aria-invalid={notApplied || undefined}
          data-skip-focus
          aria-describedby={message ? messageId : undefined}
        />
        <button
          type="button"
          className="btn !min-h-[44px] !px-4 text-sm"
          onClick={apply}
          aria-disabled={!canApply || undefined}
        >
          {t('quote.coupon.apply')}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
        <span
          id={messageId}
          className={
            notApplied || data.couponNotice === 'rate-limited'
              ? 'err !mt-0'
              : 'text-[13px] text-muted'
          }
        >
          {checking ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="anim-spin h-3.5 w-3.5" aria-hidden="true" /> {message}
            </span>
          ) : (
            message
          )}
        </span>
        {applied !== '' && !checking ? (
          <button
            type="button"
            className="link-btn !min-h-[44px] text-sm"
            onClick={data.removeCoupon}
          >
            {t('quote.coupon.remove')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
