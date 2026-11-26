'use client';

import { Ban, Check, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { MyOrderSummary, OrderReceipt } from '@/lib/data-access/models';
import { phaseTextKey } from '@/features/tracking/tracking-model';

/**
 * F23 — Estado público de un pedido del historial o del recibo. El servidor entrega `publicStatus` (mismo mapeo de F21): aquí solo
 * se presenta con ÍCONO y TEXTO (nunca solo color). Un valor futuro desconocido se muestra «En proceso». No afirma pago.
 */
export function PublicStatusChip({
  publicStatus,
  fulfillmentType,
  terminal,
  className,
}: {
  publicStatus: MyOrderSummary['publicStatus'];
  fulfillmentType: MyOrderSummary['fulfillmentType'] | OrderReceipt['fulfillment']['type'];
  terminal: boolean;
  className?: string;
}) {
  const t = useTranslations('tracking.phase');
  const label = t(phaseTextKey(publicStatus, fulfillmentType));
  const negative = publicStatus === 'rejected' || publicStatus === 'cancelled';
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-extrabold',
        negative
          ? 'bg-danger-soft text-danger'
          : terminal
            ? 'bg-success-soft text-success'
            : 'bg-accent-soft text-fg',
        className,
      )}
      data-testid="public-status"
      data-status={publicStatus}
    >
      {negative ? (
        publicStatus === 'rejected' ? (
          <CircleX className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        ) : (
          <Ban className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        )
      ) : terminal ? (
        <Check className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
      ) : (
        <span
          className="h-2 w-2 flex-none animate-pulse rounded-full bg-brand-red"
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </span>
  );
}
