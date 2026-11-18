'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DraftOrder } from '@/lib/data-access/models';
import { cn } from '@/lib/cn';
import { toStoreTrackingStep } from '@/lib/order-status';

/** Etiquetas de los pasos: 6 a domicilio, 5 para recoger; el 2.º dice "Pago al recibir" si aún no se pagó. */
export function useTrackingStepLabels(
  order: Pick<DraftOrder, 'status' | 'fulfillment' | 'payment'>,
): string[] {
  const t = useTranslations('status');
  const step = toStoreTrackingStep(order);
  const labels = [...(t.raw(step.variant === 'delivery' ? 'steps' : 'stepsPickup') as string[])];
  if (step.payOnDelivery) labels[1] = t('payOnDelivery');
  return labels;
}

/**
 * Progreso del pedido: lista ordenada de 6 (domicilio) o 5 (recoger) pasos. Los pasos con índice menor
 * al progreso están completos; el actual lleva `aria-current="step"`. El estado no depende solo del
 * color: hay ícono de palomita y texto oculto "completado" / "paso actual" para lectores de pantalla.
 */
export function TrackingProgress({
  order,
}: {
  order: Pick<DraftOrder, 'status' | 'fulfillment' | 'payment'>;
}) {
  const t = useTranslations('tracking');
  const { progress } = toStoreTrackingStep(order);
  const labels = useTrackingStepLabels(order);
  return (
    <ol className="m-0 grid list-none gap-0 p-0" aria-label={t('stepsAria')}>
      {labels.map((label, index) => {
        const done = index < progress;
        const current = index === progress;
        return (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {index < labels.length - 1 ? (
              <span
                className={cn(
                  'absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5',
                  done ? 'bg-success' : 'bg-line',
                )}
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn(
                'relative z-10 flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-extrabold',
                done
                  ? 'bg-success text-ondeep'
                  : current
                    ? 'bg-primary text-onprimary ring-4 ring-primary/20'
                    : 'border border-line bg-surface text-muted',
              )}
              aria-hidden="true"
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={cn(
                'pt-1 text-[15px]',
                done || current ? 'font-extrabold text-fg' : 'text-muted',
              )}
            >
              {label}
              <span className="sr-only">
                {done ? ` — ${t('stepDone')}` : current ? ` — ${t('stepCurrent')}` : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
