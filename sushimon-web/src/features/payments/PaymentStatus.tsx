'use client';

import { CircleCheck, Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type {
  OrderDetailPayment,
  OrderReceiptPayment,
  OrderTracking,
} from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { moneyToCents } from '@/lib/checkout-quote';

/**
 * F24 (spec 025 §12.1) — Estado REAL del pago en efectivo para el cliente (detalle, seguimiento, confirmación y recibo). Ícono +
 * texto (nunca solo color). `PENDING`: sin textos de dinero recibido y con la indicación de cuándo se paga; `PAID`: fecha y, solo
 * en el recibo (`receipt`), importe aplicado, efectivo entregado y cambio. NUNCA muestra al empleado ni el historial: el contrato
 * público no los trae. El pago NO forma parte del seguimiento operativo (`steps`/`events`).
 */

type PublicPayment = OrderDetailPayment | OrderTracking['payment'] | OrderReceiptPayment;

export function PaymentStatus({
  payment,
  fulfillmentType,
  receipt,
  closed = false,
  className,
}: {
  payment: PublicPayment;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  /** Recibo: con `PAID` añade importe pagado, efectivo entregado y cambio. */
  receipt?: OrderReceiptPayment;
  /** Pedido rechazado o cancelado: con el pago `PENDING` NO se pide pagar (no se cobra). */
  closed?: boolean;
  className?: string;
}) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const paid = payment.status === 'PAID';
  const money = (value: string | null | undefined) =>
    formatMoney((moneyToCents(value) ?? 0) / 100, locale);
  const Icon = paid ? CircleCheck : Clock;
  return (
    <div
      className={cn('flex flex-col gap-1.5', className)}
      data-testid="payment-status"
      data-payment-status={paid ? 'PAID' : 'PENDING'}
    >
      <p className="m-0 flex items-center gap-2 font-bold" data-testid="payment-line">
        <Icon
          className={cn('h-5 w-5 flex-none', paid ? 'text-success' : 'text-muted')}
          aria-hidden="true"
        />
        <span>
          {t('cash')}: {t(`status.${paid ? 'PAID' : 'PENDING'}`)}
        </span>
      </p>
      {paid ? (
        <>
          {payment.paidAt ? (
            <p className="m-0 text-[13px] text-muted" data-testid="payment-paid-at">
              {t('paidAt', { when: formatDateTime(payment.paidAt, locale) })}
            </p>
          ) : null}
          {receipt && receipt.status === 'PAID' ? (
            <dl className="m-0 mt-1 flex flex-col gap-1 text-[14px]" data-testid="payment-receipt">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('amountPaid')}</dt>
                <dd className="m-0">{money(receipt.amountPaid)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('tendered')}</dt>
                <dd className="m-0">{money(receipt.tendered)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('change')}</dt>
                <dd className="m-0">{money(receipt.change)}</dd>
              </div>
            </dl>
          ) : null}
        </>
      ) : (
        <p
          className="m-0 text-[13px] text-muted"
          data-testid={closed ? 'payment-closed' : 'payment-hint'}
        >
          {closed
            ? t('notCharged')
            : t(fulfillmentType === 'PICKUP' ? 'hint.PICKUP' : 'hint.DELIVERY')}
        </p>
      )}
    </div>
  );
}
