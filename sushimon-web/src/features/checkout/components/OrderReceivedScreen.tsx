'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import { isApiError } from '@/lib/data-access/errors';
import { useIsSimulation, useOrderDetail } from '@/features/orders/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { isConfirmationPersisted, readGuestToken, readOrderNumber } from '../confirmation-store';
import { OrderReceived } from './OrderReceived';

/**
 * F20 — `/pedidos/[id]` con la API real (`http`): reconstruye el pedido con `GET /v1/orders/{id}` usando la sesión del dueño o la
 * credencial de invitado guardada (`X-Order-Token`). Es el ÚNICO dueño de la pantalla «pedido recibido» (el checkout solo navega
 * aquí). Sin sesión ni credencial (otra pestaña/dispositivo) o con 401/403/404 dice honestamente que se perdió el acceso: el
 * lookup por número + teléfono es F21 y aún no existe con la API real, así que NO se ofrece enlace a `/consultar`.
 * Un fallo de red/5xx tras un éxito reciente conserva el número y ofrece reintentar.
 */
export function OrderReceivedScreen({ orderId }: { orderId: string }) {
  const t = useTranslations('orders.received');
  const token = readGuestToken(orderId);
  const query = useOrderDetail(orderId, token);
  const knownNumber = readOrderNumber(orderId);
  const simulation = useIsSimulation();

  if (query.data) {
    // Invitado cuya credencial solo está en memoria: avisa que guarde el número.
    const unsaved = token !== null && !isConfirmationPersisted(orderId);
    return <OrderReceived order={query.data} unsaved={unsaved} simulated={simulation} />;
  }
  if (query.isError) {
    const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);
    return (
      <div className="wrap max-w-[760px] pb-12 pt-6 sm:pt-10">
        {denied ? (
          <div role="alert" className="notice notice-warn">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h1 className="disp text-[24px]">{t('lostTitle')}</h1>
              <p className="m-0 mb-2">{t('lostBody')}</p>
              {knownNumber ? (
                <p className="m-0 font-bold" data-testid="order-number">
                  {t('lostNumber', { a: knownNumber })}
                </p>
              ) : null}
            </div>
          </div>
        ) : knownNumber ? (
          <div className="flex flex-col gap-3">
            <h1 className="disp text-[24px]">{t('registeredTitle')}</h1>
            <p className="m-0 font-bold" data-testid="order-number">
              {t('lostNumber', { a: knownNumber })}
            </p>
            <ErrorNotice message={t('registeredBody')} onRetry={() => void query.refetch()} />
          </div>
        ) : (
          <ErrorNotice onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className="wrap max-w-[760px] pb-12 pt-6 sm:pt-10"
    >
      <Skeleton className="mx-auto h-10 w-64" />
      <Skeleton className="mt-5 h-64 w-full rounded-2xl" />
      <Skeleton className="mt-5 h-48 w-full rounded-2xl" />
    </div>
  );
}
