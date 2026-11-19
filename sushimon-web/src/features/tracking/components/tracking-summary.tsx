'use client';

import { useLocale, useTranslations } from 'next-intl';
import { moneyToCents } from '@/lib/checkout-quote';
import type { OrderDetail } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';

/**
 * F21 — Resumen del pedido (líneas e importes) tomado UNA sola vez de `getOrder`: el polling usa solo el seguimiento. Presenta
 * lo que el servidor entregó; no calcula importes.
 */
export function TrackingSummary({ order }: { order: OrderDetail }) {
  const t = useTranslations('orders.received');
  const locale = useLocale();
  const money = (value: string) => formatMoney((moneyToCents(value) ?? 0) / 100, locale);
  const discount = (moneyToCents(order.discountTotal) ?? 0) > 0;
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {order.lines.map((line, i) => (
          <li key={`${line.productName}-${i}`} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 font-bold">
                {line.quantity} × {line.productName}
              </p>
              {line.modifiers.length > 0 ? (
                <p className="m-0 text-[13px] text-muted">
                  {t('extras')}: {line.modifiers.map((m) => m.name).join(', ')}
                </p>
              ) : null}
            </div>
            <span className="flex-none font-bold">{money(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className="m-0 mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-[15px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t('subtotal')}</dt>
          <dd className="m-0">{money(order.subtotal)}</dd>
        </div>
        {discount ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('discount')}</dt>
            <dd className="m-0">−{money(order.discountTotal)}</dd>
          </div>
        ) : null}
        {order.fulfillmentType === 'DELIVERY' ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('fee')}</dt>
            <dd className="m-0">{money(order.deliveryFee)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 text-[18px] font-extrabold">
          <dt>{t('total')}</dt>
          <dd className="m-0">{money(order.total)}</dd>
        </div>
      </dl>
    </>
  );
}
