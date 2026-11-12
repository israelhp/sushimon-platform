'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { PillTone } from '@/components/ui/Pill';
import type { Order } from '@/lib/data-access/models';
import {
  toBackofficeColumn,
  type BackofficeColumn,
  type BackofficeLogisticsKey,
  type BackofficeNextAction,
} from '@/lib/order-status';
import { itemCount, minutesSince, toBackofficeLogistics, waitParts } from './order-view';

/** Tono de la pill de cada estado (ST_CLS del prototipo). */
export const COLUMN_TONE: Record<BackofficeColumn, PillTone> = {
  nuevo: 'alert',
  aceptado: 'confirmed',
  preparacion: 'warning',
  listo: 'info',
  en_camino: 'active',
  entregado: 'success',
  cancelado: 'muted',
};

/** Tono de la pill del estado logístico (LOG_CLS del prototipo). */
export const LOGISTICS_TONE: Record<BackofficeLogisticsKey, PillTone> = {
  none: 'danger',
  buscando: 'warning',
  asignado: 'info',
  a_recoger: 'info',
  recogido: 'active',
  en_camino: 'active',
  entregado: 'success',
  fallido: 'danger',
};

/** Punto de color de cada columna del tablero (ST_DOT). */
export const COLUMN_DOT: Record<Exclude<BackofficeColumn, 'cancelado'>, string> = {
  nuevo: 'k-coral',
  aceptado: 'k-neutral',
  preparacion: 'k-amber',
  listo: 'k-violet',
  en_camino: 'k-blue',
  entregado: 'k-green',
};

/** Estilo del botón de la siguiente acción (`nextCls` del prototipo). */
export const ACTION_CLASS: Record<BackofficeNextAction, string> = {
  accept: 'btn-primary',
  prepare: '',
  ready: '',
  dispatch: 'btn-dark',
  deliver: 'btn-green',
};

/** Textos de presentación de pedidos (tipo, productos, espera, estados y acciones) en un solo hook. */
export function useOrderText() {
  const t = useTranslations('backoffice.orders');

  const statusLabel = useCallback(
    (order: Pick<Order, 'status'>) => t(`status.${toBackofficeColumn(order)}`),
    [t],
  );
  const typeShort = useCallback(
    (order: Pick<Order, 'fulfillment'>) => t(`type.${order.fulfillment}`),
    [t],
  );
  const typeLong = useCallback(
    (order: Pick<Order, 'fulfillment'>) => t(`type.${order.fulfillment}Long`),
    [t],
  );
  const itemsLabel = useCallback(
    (order: Pick<Order, 'lines'>) => t('items', { count: itemCount(order) }),
    [t],
  );
  const waitText = useCallback(
    (order: Pick<Order, 'createdAt'>, now: Date | null) => {
      const parts = waitParts(minutesSince(order, now));
      const wait =
        parts.kind === 'now'
          ? t('wait.now')
          : parts.kind === 'minutes'
            ? t('wait.minutes', { minutes: parts.minutes })
            : t('wait.hours', { hours: parts.hours, minutes: parts.minutes });
      return t('wait.ago', { wait });
    },
    [t],
  );
  const logisticsLabel = useCallback(
    (order: Pick<Order, 'delivery' | 'status'>) =>
      t(`logisticsStatus.${toBackofficeLogistics(order)}`),
    [t],
  );
  const actionLabel = useCallback(
    (action: BackofficeNextAction, short = false) =>
      t(`actions.${action === 'deliver' ? 'deliver' : action}${short ? 'Short' : ''}`),
    [t],
  );

  return useMemo(
    () => ({ statusLabel, typeShort, typeLong, itemsLabel, waitText, logisticsLabel, actionLabel }),
    [statusLabel, typeShort, typeLong, itemsLabel, waitText, logisticsLabel, actionLabel],
  );
}
