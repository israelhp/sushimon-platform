'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Order } from '@/lib/data-access/models';
import { cn } from '@/lib/cn';
import { isOrderInProgress, toStoreTrackingStep } from '@/lib/order-status';

/**
 * Etiqueta del paso actual del pedido para el cliente ("En preparación", "Listo para recoger"…):
 * punto pulsante mientras está en curso, palomita verde al finalizar. Se deriva del estado del contrato
 * con `toStoreTrackingStep` (los textos son los `status.*` del prototipo). El significado nunca depende solo del color.
 */
export function OrderStatusChip({
  order,
}: {
  order: Pick<Order, 'status' | 'fulfillment' | 'payment'>;
}) {
  const t = useTranslations('status');
  const step = toStoreTrackingStep(order);
  const labels = t.raw(step.variant === 'delivery' ? 'steps' : 'stepsPickup') as string[];
  const index = Math.min(step.progress, labels.length - 1);
  const label = index === 1 && step.payOnDelivery ? t('payOnDelivery') : (labels[index] ?? '');
  const inProgress = isOrderInProgress(order);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[12px] font-extrabold',
        inProgress ? 'bg-primary-soft text-primary' : 'bg-success-soft text-success',
      )}
    >
      {inProgress ? (
        <span
          className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : (
        <Check className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}
