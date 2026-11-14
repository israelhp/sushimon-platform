'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BranchAvailability } from '@/lib/data-access/models';
import { statusKind } from '../availability-view';
import { useAvailabilityText } from '../use-availability-text';

/**
 * Mensaje (solo UI; no crea ni bloquea pedidos) cuando la sucursal elegida NO recibe pedidos según el servidor. La
 * validación definitiva ocurre al crear el pedido (F20), aunque este aviso diga que estaba abierta.
 */
export function BranchNotAcceptingNotice({
  name,
  availability,
  className,
}: {
  name: string;
  availability: BranchAvailability | undefined;
  className?: string;
}) {
  const t = useTranslations('branchSchedule');
  const text = useAvailabilityText();
  if (!availability || availability.isAcceptingOrders) return null;
  const kind = statusKind(availability);
  return (
    <div className={`notice notice-warn ${className ?? ''}`} role="status">
      <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <div>
        <strong>{t('notice.notAccepting', { name })}</strong>{' '}
        {kind === 'notConfigured'
          ? t('notice.notConfigured')
          : availability.nextOpensAt
            ? t('notice.opensLater', {
                when: text.when(availability.nextOpensAt, availability.serverTime),
              })
            : null}
      </div>
    </div>
  );
}
