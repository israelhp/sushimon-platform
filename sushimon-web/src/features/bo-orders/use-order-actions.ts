'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useAdvanceDelivery, useChangeOrderStatus } from '@/features/backoffice/hooks';
import type { DraftOrder, DraftOrderStatus } from '@/lib/data-access/models';
import { NEXT_ACTION_STATUS, checkTransition, type BackofficeNextAction } from '@/lib/order-status';
import { errorMessage } from './error-message';
import { useDispatchModal } from './use-dispatch-modal';

const TOAST_KEY: Partial<
  Record<DraftOrderStatus, 'accepted' | 'preparing' | 'ready' | 'delivered' | 'rejected'>
> = {
  accepted: 'accepted',
  preparing: 'preparing',
  ready: 'ready',
  delivered: 'delivered',
  rejected: 'rejected',
};

/**
 * Acciones sobre un pedido desde tarjetas, filas y detalle. La UI solo oculta lo que el rol no puede hacer:
 * antes de enviar valida con la máquina de estados (mensaje claro ante una transición inválida) y la validación
 * definitiva la hace el servidor (en mock, el handler responde 403/409).
 */
export function useOrderActions(onDone?: () => void) {
  const t = useTranslations('backoffice.orders.toast');
  const toast = useToast();
  const changeStatus = useChangeOrderStatus();
  const advance = useAdvanceDelivery();
  const dispatchModal = useDispatchModal();

  const setStatus = useCallback(
    (order: DraftOrder, to: DraftOrderStatus, reason?: string) => {
      const check = checkTransition(order, to, 'staff', reason);
      if (!check.ok) {
        toast.notify(t('invalid', { message: check.reason }));
        return;
      }
      changeStatus.mutate(
        { id: order.id, status: to, reason },
        {
          onSuccess: () => {
            const key = TOAST_KEY[to];
            if (key) toast.notify(t(key, { id: order.id }));
            onDone?.();
          },
          onError: (error) => toast.notify(t('error', { message: errorMessage(error) })),
        },
      );
    },
    [changeStatus, toast, t, onDone],
  );

  /** Ejecuta la siguiente acción del flujo. `dispatch` abre el modal de despacho (punto de integración). */
  const run = useCallback(
    (order: DraftOrder, action: BackofficeNextAction) => {
      if (action === 'dispatch') {
        dispatchModal.open(order.id);
        return;
      }
      setStatus(order, NEXT_ACTION_STATUS[action]);
    },
    [setStatus, dispatchModal],
  );

  const reject = useCallback(
    (order: DraftOrder, reason: string) => setStatus(order, 'rejected', reason),
    [setStatus],
  );

  const advanceDelivery = useCallback(
    (order: DraftOrder) =>
      advance.mutate(order.id, {
        onSuccess: () => toast.notify(t('advanced')),
        onError: (error) => toast.notify(t('error', { message: errorMessage(error) })),
      }),
    [advance, toast, t],
  );

  return {
    run,
    reject,
    advanceDelivery,
    pending: changeStatus.isPending || advance.isPending,
  };
}
