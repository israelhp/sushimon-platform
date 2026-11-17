'use client';

import { ArrowRight, Loader2, Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format';
import type { CheckoutData } from '../use-checkout-data';

export interface SummaryAction {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  isLast: boolean;
}

/**
 * "Resumen de compra": líneas, subtotal, envío (estimado a domicilio; "Por calcular" hasta cotizar) y total.
 * Los montos son SOLO para mostrar: el precio final lo devuelve el servidor al crear el pedido.
 */
export function OrderSummary({
  data,
  onEdit,
  action,
}: {
  data: CheckoutData;
  onEdit: () => void;
  action: SummaryAction;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const money = (value: number) => formatMoney(value, locale);
  const { rows, type, subtotal, shipping, total } = data;

  return (
    <section
      className="rounded-2xl border border-line bg-surface shadow-card"
      aria-labelledby="summary-title"
    >
      <div className="flex items-center gap-2 px-4 pt-4">
        <h2 id="summary-title" className="disp flex-1 text-[20px]">
          {t('checkout.summary')}
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-extrabold text-secondary"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t('common.edit')}
        </button>
      </div>
      <ul className="m-0 list-none px-4 pt-2">
        {rows.map(({ line, name, subtotalCents }) => (
          <li
            key={line.lineId}
            className="flex justify-between gap-3 border-b border-dashed border-line py-2 text-[14px] last:border-0"
          >
            <span className="min-w-0">
              <strong>{line.quantity}×</strong> {name}
              {line.display.options.map((o) => (
                <small key={`${o.groupId}:${o.optionId}`} className="block text-[12px] text-muted">
                  + {o.optionName}
                </small>
              ))}
              {line.note ? (
                <small className="block truncate text-[12px] text-muted" title={line.note}>
                  {line.note}
                </small>
              ) : null}
            </span>
            <span className="flex-none font-bold">{money(subtotalCents / 100)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-line px-4 py-3 text-[15px]">
        <div className="flex justify-between">
          <span className="text-muted">{t('common.subtotal')}</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">
            {type === 'delivery' ? t('checkout.estimatedShipping') : t('checkout.shipping')}
          </span>
          <span>
            {type === 'delivery'
              ? shipping != null
                ? money(shipping)
                : t('checkout.toQuote')
              : type === 'pickup'
                ? t('checkout.pickupFree')
                : '—'}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-line pt-2">
          <span className="font-extrabold">
            {type === 'delivery' ? t('checkout.estimatedTotal') : t('common.total')}
          </span>
          <span className="font-display text-[28px]" data-testid="summary-total">
            {money(total)}
          </span>
        </div>
        {type === 'delivery' ? (
          <p className="m-0 mt-2 text-[11.5px] leading-snug text-muted">
            {t('delivery.disclaimer')}
          </p>
        ) : null}
      </div>
      <div className="hidden px-4 pb-4 lg:block">
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          aria-busy={action.busy}
          className="btn btn-primary w-full"
        >
          {action.busy ? <Loader2 className="anim-spin h-5 w-5" aria-hidden="true" /> : null}
          {action.label}
          {!action.isLast && !action.busy ? (
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          ) : null}
        </button>
      </div>
    </section>
  );
}
