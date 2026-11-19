'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { PillTone } from '@/components/ui/Pill';
import type {
  AdminOrderActionState,
  AdminOrderSummary,
  OrderLifecycleStatus,
} from '@/lib/data-access/models';
import { minutesSincePlaced } from './admin-orders-model';

/** Tono de la pill de cada estado real (equivale a `ST_CLS` del prototipo). */
export const STATUS_TONE: Record<OrderLifecycleStatus, PillTone> = {
  pending: 'alert',
  accepted: 'confirmed',
  preparing: 'warning',
  ready: 'info',
  on_the_way: 'active',
  delivered: 'success',
  picked_up: 'success',
  rejected: 'muted',
  cancelled: 'muted',
};

/** Estilo del botón de cada acción de avance (`nextCls` del prototipo). */
export const ACTION_CLASS: Partial<Record<AdminOrderActionState['action'], string>> = {
  accept: 'btn-primary',
  start_preparing: '',
  mark_ready: '',
  complete: 'btn-green',
};

/** Textos de presentación de los pedidos reales (estado, modalidad, proveedor, espera, acciones). */
export function useAdminOrderText() {
  const t = useTranslations('backoffice.orders.live');
  const tw = useTranslations('backoffice.orders');

  const statusLabel = useCallback((status: OrderLifecycleStatus) => t(`status.${status}`), [t]);
  const typeLabel = useCallback(
    (order: Pick<AdminOrderSummary, 'fulfillmentType' | 'deliveryProvider'>, long = false) => {
      if (order.fulfillmentType === 'PICKUP') return t(long ? 'type.pickupLong' : 'type.pickup');
      return t(order.deliveryProvider === 'PEDIDOSYA' ? 'type.pedidosya' : 'type.own');
    },
    [t],
  );
  const itemsLabel = useCallback((count: number) => tw('items', { count }), [tw]);
  const waitText = useCallback(
    (placedAt: string, serverNow: number | null) => {
      if (serverNow === null) return '';
      const minutes = minutesSincePlaced(placedAt, serverNow);
      const wait =
        minutes < 1
          ? tw('wait.now')
          : minutes < 60
            ? tw('wait.minutes', { minutes })
            : tw('wait.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
      return tw('wait.ago', { wait });
    },
    [tw],
  );
  const actionLabel = useCallback(
    (action: AdminOrderActionState['action'], short = false) =>
      t(`actions.${action}${short ? 'Short' : ''}`),
    [t],
  );
  const dispatchNote = useCallback(
    (reason: 'DISPATCH_NOT_AVAILABLE' | 'PROVIDER_BLOCKED_EXTERNAL') =>
      t(reason === 'PROVIDER_BLOCKED_EXTERNAL' ? 'dispatch.pedidosya' : 'dispatch.own'),
    [t],
  );

  return useMemo(
    () => ({ statusLabel, typeLabel, itemsLabel, waitText, actionLabel, dispatchNote }),
    [statusLabel, typeLabel, itemsLabel, waitText, actionLabel, dispatchNote],
  );
}
