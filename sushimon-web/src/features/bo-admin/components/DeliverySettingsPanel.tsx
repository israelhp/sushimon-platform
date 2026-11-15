'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconBike } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Pill } from '@/components/ui/Pill';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import {
  usePedidosyaScenario,
  useSetPedidosyaScenario,
  useDeliverySettings,
  useUpdateDeliverySettings,
} from '@/features/delivery-coverage/hooks';
import { isForbidden, errorMessage } from '@/features/bo-orders/error-message';
import type { AdminBranch } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import type { PedidosyaCoverageScenario } from '@/services/delivery-zones';
import { pedidosyaIntegrationView, zoneServerError } from '../delivery-view';
import { ConfirmModal } from './ConfirmModal';

type Flag = 'ownDeliveryZonesEnabled' | 'pedidosyaEnabled';

/**
 * Proveedores de entrega de UNA sucursal (F09): interruptores `ownDeliveryZonesEnabled` y `pedidosyaEnabled`, cada cambio
 * con confirmación. `pedidosyaEnabled` es un indicador ADMINISTRATIVO: el estado de la integración se muestra aparte como
 * «Integración pendiente de documentación y credenciales» (o «Simulación» con el adaptador mock) y NUNCA como conectado.
 * Los permisos solo muestran u ocultan: el servidor decide (403/404).
 */
export function DeliverySettingsPanel({
  branch,
  canManage,
}: {
  branch: AdminBranch;
  canManage: boolean;
}) {
  const t = useTranslations('backoffice.branchDelivery.settings');
  const toast = useToast();
  const client = useDataClient();
  const settings = useDeliverySettings(branch.id);
  const update = useUpdateDeliverySettings();
  const scenario = usePedidosyaScenario();
  const setScenario = useSetPedidosyaScenario();
  const [pending, setPending] = useState<{ flag: Flag; next: boolean } | null>(null);
  const [error, setError] = useState('');

  if (isForbidden(settings.error)) {
    return (
      <Banner zone="bo" tone="warning" role="alert">
        {t('forbidden')}
      </Banner>
    );
  }
  if (settings.isError) {
    return (
      <Banner zone="bo" tone="danger" role="alert">
        {t('loadError')}{' '}
        <button type="button" className="link-btn" onClick={() => void settings.refetch()}>
          {t('retry')}
        </button>
      </Banner>
    );
  }
  if (!settings.data) {
    return (
      <div aria-busy="true" aria-label={t('loading')} className="hrs">
        <Skeleton zone="bo" style={{ height: 88, borderRadius: 12 }} />
        <Skeleton zone="bo" style={{ height: 120, borderRadius: 12 }} />
      </div>
    );
  }

  const data = settings.data;
  const integration = pedidosyaIntegrationView(data.pedidosyaIntegrationStatus);
  const close = () => {
    setPending(null);
    setError('');
  };
  const confirm = () => {
    if (!pending) return;
    update.mutate(
      { branchId: branch.id, input: { [pending.flag]: pending.next } },
      {
        onSuccess: () => {
          const key =
            pending.flag === 'ownDeliveryZonesEnabled'
              ? pending.next
                ? 'toastOwnOn'
                : 'toastOwnOff'
              : pending.next
                ? 'toastPyOn'
                : 'toastPyOff';
          toast.notify(t(key, { name: branch.name }));
          close();
        },
        onError: (e) => setError(zoneServerError(e).message),
      },
    );
  };
  const confirmKey = (flag: Flag, next: boolean) =>
    flag === 'ownDeliveryZonesEnabled' ? (next ? 'ownOn' : 'ownOff') : next ? 'pyOn' : 'pyOff';

  return (
    <div className="hrs">
      {!canManage ? (
        <Banner zone="bo" tone="info">
          {t('readOnly', { permission: 'branches.manage_delivery_zones' })}
        </Banner>
      ) : null}
      {data.isDefault ? (
        <Banner zone="bo" tone="info">
          {t('defaultsNote')}
        </Banner>
      ) : null}

      <section className="clo-item" aria-labelledby={`own-${branch.id}`}>
        <div className="clo-main">
          <div className="row gap8" style={{ flexWrap: 'wrap' }}>
            <IconBike size="sm" />
            <h3 id={`own-${branch.id}`} className="strong" style={{ margin: 0, fontSize: 14 }}>
              {t('ownTitle')}
            </h3>
            <Pill zone="bo" tone={data.ownDeliveryZonesEnabled ? 'success' : 'muted'}>
              {data.ownDeliveryZonesEnabled ? t('on') : t('off')}
            </Pill>
          </div>
          <div className="sm muted" style={{ fontWeight: 600 }}>
            {t('ownHelp')}
          </div>
        </div>
        <Switch
          zone="bo"
          checked={data.ownDeliveryZonesEnabled}
          label={t('ownSwitch', { name: branch.name })}
          disabled={!canManage || update.isPending}
          onCheckedChange={(next) => setPending({ flag: 'ownDeliveryZonesEnabled', next })}
        />
      </section>

      <section className="clo-item" aria-labelledby={`py-${branch.id}`}>
        <div className="clo-main">
          <div className="row gap8" style={{ flexWrap: 'wrap' }}>
            <h3 id={`py-${branch.id}`} className="strong" style={{ margin: 0, fontSize: 14 }}>
              {t('pyTitle')}
            </h3>
            <Pill zone="bo" tone={data.pedidosyaEnabled ? 'info' : 'muted'}>
              {data.pedidosyaEnabled ? t('enabled') : t('disabled')}
            </Pill>
          </div>
          <div className="sm muted" style={{ fontWeight: 600 }}>
            {t('pyHelp')}
          </div>
          <div
            className="row gap8"
            style={{ flexWrap: 'wrap', marginTop: 6 }}
            data-testid="pedidosya-integration"
          >
            <span className="sm" style={{ fontWeight: 700 }}>
              {t('pyStatus')}:
            </span>
            <Pill zone="bo" tone="warning">
              {integration.label}
            </Pill>
            {integration.simulated ? <SimulationBadge zone="bo" /> : null}
          </div>
          <div className="xs muted" style={{ fontWeight: 600 }}>
            {integration.detail}
          </div>
        </div>
        <Switch
          zone="bo"
          checked={data.pedidosyaEnabled}
          label={t('pySwitch', { name: branch.name })}
          disabled={!canManage || update.isPending}
          onCheckedChange={(next) => setPending({ flag: 'pedidosyaEnabled', next })}
        />
      </section>

      {client.kind === 'mock' && canManage ? (
        <section className="clo-item" aria-labelledby={`sim-${branch.id}`}>
          <div className="clo-main">
            <div className="row gap8" style={{ flexWrap: 'wrap' }}>
              <h3 id={`sim-${branch.id}`} className="strong" style={{ margin: 0, fontSize: 14 }}>
                {t('simTitle')}
              </h3>
              <SimulationBadge zone="bo" />
            </div>
            <div className="sm muted" style={{ fontWeight: 600 }}>
              {t('simHelp')}
            </div>
          </div>
          <label className="row gap8">
            <span className="sm muted" style={{ fontWeight: 700 }}>
              {t('simLabel')}
            </span>
            <select
              className="inp"
              style={{ width: 'auto' }}
              value={scenario.data?.scenario ?? 'unknown'}
              disabled={setScenario.isPending}
              onChange={(e) => setScenario.mutate(e.target.value as PedidosyaCoverageScenario)}
            >
              <option value="unknown">{t('simUnknown')}</option>
              <option value="available">{t('simAvailable')}</option>
              <option value="unavailable">{t('simUnavailable')}</option>
            </select>
          </label>
          {setScenario.isError ? (
            <Banner zone="bo" tone="danger" role="alert" className="span-2">
              {errorMessage(setScenario.error)}
            </Banner>
          ) : null}
        </section>
      ) : null}

      {pending ? (
        <ConfirmModal
          title={t(`confirm.${confirmKey(pending.flag, pending.next)}Title`)}
          description={branch.name}
          icon={<IconBike />}
          danger={!pending.next}
          confirmLabel={t('confirm.action')}
          cancelLabel={t('confirm.back')}
          pendingLabel={t('confirm.working')}
          pending={update.isPending}
          error={error}
          onConfirm={confirm}
          onClose={close}
        >
          {t(`confirm.${confirmKey(pending.flag, pending.next)}Text`, { name: branch.name })}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
