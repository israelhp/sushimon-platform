'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import type { PolledQueryState } from '@/features/polling/use-polled-query';
import { isApiError } from '@/lib/data-access/errors';

/**
 * Estado de la conexión del sondeo (spec 023 §10.3): sin conexión se conservan los datos de la MISMA clave atenuados y se indica la
 * última actualización; tras 8 fallos se ofrece «Reintentar»; un 429 informa la espera; un 404/4xx o un 401 se explican sin reintentar.
 * Un fallo de red nunca se presenta como un estado del pedido.
 */
export function LiveStatus({
  poll,
  clientNow,
}: {
  poll: Pick<
    PolledQueryState<unknown>,
    'errorKind' | 'failing' | 'gaveUp' | 'rateLimitSec' | 'updatedAt' | 'retry' | 'error'
  >;
  clientNow: number;
}) {
  const t = useTranslations('backoffice.orders.live.conn');
  const tw = useTranslations('backoffice.orders.wait');

  if (poll.errorKind === null) return null;
  if (poll.errorKind === 'rate') {
    return (
      <Banner zone="bo" tone="info" role="status">
        {t('rate', { seconds: poll.rateLimitSec ?? 30 })}
      </Banner>
    );
  }
  if (poll.errorKind === 'auth') {
    // 403 lo explica la pantalla «sin permiso»; aquí solo el 401 (sesión vencida).
    if (isApiError(poll.error) && poll.error.status === 403) return null;
    return (
      <Banner zone="bo" tone="danger" role="status">
        {t('auth')}
      </Banner>
    );
  }
  if (poll.errorKind === 'lost') {
    return (
      <Banner zone="bo" tone="danger" role="alert">
        {t('lost')}{' '}
        <button type="button" className="link-btn" onClick={poll.retry}>
          {t('retry')}
        </button>
      </Banner>
    );
  }
  const minutes = poll.updatedAt
    ? Math.max(0, Math.floor((clientNow - poll.updatedAt) / 60_000))
    : null;
  const wait =
    minutes === null
      ? null
      : minutes < 1
        ? tw('now')
        : minutes < 60
          ? tw('minutes', { minutes })
          : tw('hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  return (
    <Banner zone="bo" tone="warning" role="status">
      {wait ? t('offline', { wait: tw('ago', { wait }) }) : t('offlineNoData')}
      {poll.gaveUp ? ` ${t('gaveUp')}` : ''}{' '}
      {poll.gaveUp ? (
        <button type="button" className="link-btn" onClick={poll.retry}>
          {t('retry')}
        </button>
      ) : null}
    </Banner>
  );
}
