'use client';

import {
  Banknote,
  Clock,
  CreditCard,
  Phone,
  ShoppingBag,
  Store,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { moneyToCents } from '@/lib/checkout-quote';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { formatMoney } from '@/lib/format';
import { formatWhen } from '@/features/order-mode/when';
import { localDate } from '@/lib/time';
import { formatAddress, type CheckoutStep } from '../checkout-model';
import { useCheckoutDraft } from '../checkout-context';
import type { CheckoutData } from '../use-checkout-data';
import { ReviewRow, useCheckoutSteps } from './parts';

/** Paso 5 · Confirmación (revisión final): cada fila lleva a su paso con "Cambiar". */
export function ReviewStep({
  data,
  goTo,
  summary,
  error,
}: {
  data: CheckoutData;
  goTo: (step: CheckoutStep) => void;
  /** Resumen de compra (solo móvil/tablet: en escritorio vive en la columna lateral). */
  summary: ReactNode;
  error: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const steps = useCheckoutSteps();
  const { draft } = useCheckoutDraft();
  const { type, branch, now } = data;
  const shown = data.shownQuote;
  const shownFee = moneyToCents(shown?.deliveryFee);
  const delivery = type === 'delivery';
  const edit = (title: string) => `${t('common.change')} ${title}`;
  const when = formatWhen(data.when, now ? localDate(now) : null, locale, {
    asap: t('when.asap'),
    today: t('when.today'),
    tomorrow: t('when.tomorrow'),
  });
  const PayIcon = draft.payment === 'card' ? CreditCard : Banknote;
  const row = (
    title: string,
    step: CheckoutStep,
    icon: ReactNode,
    children: ReactNode,
    key: string,
  ) => (
    <ReviewRow
      key={key}
      icon={icon}
      title={title}
      onEdit={() => goTo(step)}
      editLabel={t('common.change')}
      editAria={edit(title)}
    >
      {children}
    </ReviewRow>
  );

  return (
    <section aria-label={steps[4]} className="flex flex-col gap-4">
      {/* F20 aún no existe: la confirmación es SIEMPRE simulada (con datos de demostración o con la API real). */}
      <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <SimulationBadge kind="simulation" /> {t('checkout.quote.simulationFinal')}
      </p>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {row(
          steps[0] ?? '',
          1,
          <ShoppingBag className="h-5 w-5" />,
          <>
            {t('common.products', { a: data.units })}
            {shown ? ` · ${formatMoney((moneyToCents(shown.subtotal) ?? 0) / 100, locale)}` : ''}
          </>,
          'products',
        )}
        {row(
          delivery ? t('mode.delivery') : t('mode.pickupLong'),
          2,
          delivery ? <Truck className="h-5 w-5" /> : <Store className="h-5 w-5" />,
          delivery ? formatAddress(draft.address, t('checkoutFlow.zoneInline')) : branch?.name,
          'where',
        )}
        {row(t('checkout.when'), 2, <Clock className="h-5 w-5" />, when, 'when')}
        {row(
          delivery ? t('delivery.title') : t('delivery.branch'),
          3,
          <Store className="h-5 w-5" />,
          <>
            {delivery && shownFee !== null
              ? `${formatMoney(shownFee / 100, locale)} · ${branch?.name ?? ''}`
              : branch?.name}
            {delivery && shown?.fulfillment.delivery?.selectedProvider ? (
              <span className="block text-[13px] font-normal text-muted">
                {t('checkout.quote.provider')}:{' '}
                {t(`checkout.quote.providers.${shown.fulfillment.delivery.selectedProvider}`)}
              </span>
            ) : null}
            {shown?.coupon?.status === 'APPLIED' && data.appliedCoupon ? (
              <span className="block text-[13px] font-normal text-muted">
                {t('checkout.quote.couponLine', { a: data.appliedCoupon })} ·{' '}
                {t('checkout.quote.coupon.applied')}
              </span>
            ) : null}
          </>,
          'shipping',
        )}
        {row(
          t('checkout.contact'),
          2,
          <Phone className="h-5 w-5" />,
          <>
            {draft.contact.name} · {draft.contact.phone}
            <span className="block break-words text-[13px] font-normal text-muted">
              {t('checkout.sendTo', { a: draft.contact.email })}
            </span>
          </>,
          'contact',
        )}
        {row(
          t('checkout.pay'),
          4,
          <PayIcon className="h-5 w-5" />,
          draft.payment === 'card' ? t('payment.cardLabel') : t('payment.cash'),
          'pay',
        )}
      </div>
      <div className="lg:hidden">{summary}</div>
      {error ? (
        <div className="notice notice-warn" role="alert">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>{error}</div>
        </div>
      ) : null}
    </section>
  );
}
