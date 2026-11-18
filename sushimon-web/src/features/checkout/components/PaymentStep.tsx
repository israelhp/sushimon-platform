'use client';

import { Banknote, CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useCheckoutDraft } from '../checkout-context';
import { ChoiceCard, useCheckoutSteps } from './parts';

/** Paso 4 · Pago: tarjeta (pasarela NeoNet SIMULADA) o efectivo al recibir/recoger. */
export function PaymentStep() {
  const t = useTranslations();
  const steps = useCheckoutSteps();
  const { draft, dispatch } = useCheckoutDraft();
  return (
    <section aria-label={steps[3]}>
      <h2 className="lbl flex flex-wrap items-center gap-2">
        {t('payment.title')} <SimulationBadge kind="simulation" />
      </h2>
      <div
        className="flex flex-col gap-2.5"
        role="radiogroup"
        aria-label={t('payment.methodsAria')}
      >
        <ChoiceCard
          on={draft.payment === 'card'}
          onClick={() => dispatch({ type: 'payment', payment: 'card' })}
          icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
          title={t('payment.card')}
          sub={`${t('payment.cardSub')} · ${t('payment.cardLabel')}`}
          badge={<SimulationBadge kind="simulation">{t('common.simulation')}</SimulationBadge>}
        />
        <ChoiceCard
          on={draft.payment === 'cash'}
          onClick={() => dispatch({ type: 'payment', payment: 'cash' })}
          icon={<Banknote className="h-5 w-5" aria-hidden="true" />}
          title={t('payment.cash')}
          sub={t('payment.cashSub')}
        />
      </div>
    </section>
  );
}
