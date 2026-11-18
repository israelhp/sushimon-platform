'use client';

import { Banknote, CreditCard, Landmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useIsSimulation } from '@/features/orders/hooks';
import { effectivePayment } from '../checkout-model';
import { useCheckoutDraft } from '../checkout-context';
import { ChoiceCard, useCheckoutSteps } from './parts';

/**
 * Paso 4 · Pago. Con la API real solo se declara una PREFERENCIA (efectivo o transferencia; el pago se coordina con el
 * restaurante) y la tarjeta NeoNet no se ofrece (`BLOCKED_EXTERNAL`). Con datos simulados la tarjeta es la pasarela de
 * demostración, rotulada «Simulación».
 */
export function PaymentStep() {
  const t = useTranslations();
  const steps = useCheckoutSteps();
  const simulation = useIsSimulation();
  const { draft, dispatch } = useCheckoutDraft();
  const payment = effectivePayment(draft.payment, simulation);
  return (
    <section aria-label={steps[3]}>
      <h2 className="lbl flex flex-wrap items-center gap-2">
        {t('payment.title')} {simulation ? <SimulationBadge kind="simulation" /> : null}
      </h2>
      <div
        className="flex flex-col gap-2.5"
        role="radiogroup"
        aria-label={t('payment.methodsAria')}
      >
        {simulation ? (
          <ChoiceCard
            on={payment === 'card'}
            onClick={() => dispatch({ type: 'payment', payment: 'card' })}
            icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
            title={t('payment.card')}
            sub={`${t('payment.cardSub')} · ${t('payment.cardLabel')}`}
            badge={<SimulationBadge kind="simulation">{t('common.simulation')}</SimulationBadge>}
          />
        ) : null}
        <ChoiceCard
          on={payment === 'cash'}
          onClick={() => dispatch({ type: 'payment', payment: 'cash' })}
          icon={<Banknote className="h-5 w-5" aria-hidden="true" />}
          title={t('payment.cash')}
          sub={t('payment.cashSub')}
        />
        <ChoiceCard
          on={payment === 'bank_transfer'}
          onClick={() => dispatch({ type: 'payment', payment: 'bank_transfer' })}
          icon={<Landmark className="h-5 w-5" aria-hidden="true" />}
          title={t('payment.transfer')}
          sub={t('payment.transferSub')}
        />
      </div>
      {simulation ? null : (
        <p className="m-0 mt-3 text-[13px] text-muted">
          {t('payment.coordinate')} · {t('payment.cardUnavailable')}
        </p>
      )}
    </section>
  );
}
