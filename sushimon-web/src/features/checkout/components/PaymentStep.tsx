'use client';

import { Banknote } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format';
import type { CheckoutData } from '../use-checkout-data';
import { useCheckoutSteps } from './parts';

/**
 * Paso 4 · Pago (F24, spec 025 §12.1). SOLO efectivo: no hay nada que elegir, así que se muestra como información (no como un
 * grupo de opciones) con la instrucción según la modalidad y el total cotizado. NADA se marca como pagado: el pedido nace con
 * el pago en efectivo `PENDING` y el personal registra el cobro al recibir el dinero. Sin tarjeta, transferencia ni
 * comprobantes. El cuerpo de `createOrder` declara `paymentMethodPreference: 'cash'`.
 */
export function PaymentStep({ data }: { data: CheckoutData }) {
  const t = useTranslations();
  const locale = useLocale();
  const steps = useCheckoutSteps();
  const waiting = data.quote.status === 'loading' || data.quote.status === 'expired';
  return (
    <section aria-label={steps[3]}>
      <h2 className="lbl">{t('payment.title')}</h2>
      <div
        className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card"
        data-testid="payment-cash"
      >
        <span
          className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-subtle text-secondary"
          aria-hidden="true"
        >
          <Banknote className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="m-0 font-bold">{t('payment.cash')}</p>
          <p className="m-0 mt-1 text-[14px] text-muted" data-testid="payment-instructions">
            {t(data.type === 'delivery' ? 'payment.cashDelivery' : 'payment.cashPickup')}
          </p>
          <p className="m-0 mt-2 text-[15px]" data-testid="payment-total">
            <span className="text-muted">{t('payment.totalToPay')}: </span>
            <strong>{waiting ? '…' : formatMoney(data.total, locale)}</strong>
            {data.totalIsEstimate && !waiting ? (
              <span className="ml-1 text-[12px] text-muted">
                ({t('checkout.quote.estimatedTag')})
              </span>
            ) : null}
          </p>
          <p className="m-0 mt-2 text-[13px] text-muted">{t('payment.notPaidYet')}</p>
        </div>
      </div>
    </section>
  );
}
