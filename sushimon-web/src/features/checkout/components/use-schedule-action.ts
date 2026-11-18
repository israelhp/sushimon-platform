'use client';

import { useLocale } from 'next-intl';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { dateOptions, firstSlot } from '@/features/order-mode/when';
import type { CheckoutStep } from '../checkout-model';
import type { CheckoutData } from '../use-checkout-data';

/**
 * «Programar» cuando la sucursal está cerrada: pasa al primer horario disponible y vuelve a Entrega. SOLO existe con datos
 * simulados (`scheduledSupported`): con la API real no hay contrato de pedidos programados (P42).
 */
export function useScheduleAction(data: CheckoutData, goTo: (step: CheckoutStep) => void) {
  const locale = useLocale();
  const { update } = useOrderMode();
  const { config, now } = data;
  return () => {
    if (config && now) {
      const first = dateOptions(
        config.schedule,
        data.hours,
        now,
        locale,
        { asap: '', today: '', tomorrow: '' },
        data.closures,
      )[0];
      const time = first
        ? firstSlot(config.schedule, data.hours, first.date, now, data.closures)
        : null;
      if (first && time) update({ when: { kind: 'scheduled', date: first.date, time } });
    }
    goTo(2);
  };
}
