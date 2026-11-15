'use client';

import { useTranslations } from 'next-intl';
import { Pill } from '@/components/ui/Pill';
import { useDeliverySettings } from '@/features/delivery-coverage/hooks';

/**
 * Resumen de la entrega de una sucursal en su tarjeta. PedidosYa SIEMPRE se rotula «integración pendiente» (o
 * «simulación» con el adaptador mock): «habilitado» es un indicador administrativo, no una conexión.
 */
export function BranchDeliverySummary({ branchId }: { branchId: string }) {
  const t = useTranslations('backoffice.branchDelivery.summary');
  const settings = useDeliverySettings(branchId);
  if (settings.isPending) return <span className="sm muted">{t('loading')}</span>;
  if (!settings.data) return <span className="sm muted">{t('error')}</span>;
  const s = settings.data;
  return (
    <div className="ptags">
      <Pill zone="bo" tone={s.ownDeliveryZonesEnabled ? 'success' : 'muted'}>
        {t('own')}: {s.ownDeliveryZonesEnabled ? t('ownOn') : t('ownOff')}
      </Pill>
      <Pill zone="bo" tone={s.pedidosyaEnabled ? 'warning' : 'muted'}>
        {t('pedidosya')}:{' '}
        {s.pedidosyaEnabled
          ? s.pedidosyaIntegrationStatus === 'MOCK'
            ? t('pedidosyaOnMock')
            : t('pedidosyaOn')
          : t('pedidosyaOff')}
      </Pill>
    </div>
  );
}
