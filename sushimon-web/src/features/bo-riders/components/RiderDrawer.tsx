'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Drawer } from '@/components/ui/Drawer';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { AdminRider } from '@/lib/data-access/models';
import { formatDateTime } from '@/lib/format';
import { useAdminRider } from '../hooks';
import { OPERATIONAL_TONE, riderOccupancy, riderStateTextKey } from '../rider-model';
import { useRiderErrorText } from '../use-rider-text';
import { RiderAvailabilityControl } from './RiderAvailabilityControl';

export type RiderDrawerAction = 'edit' | 'transfer' | 'status';

/**
 * Detalle del motorista (panel lateral): teléfono completo, placa, vehículo, sucursal, fechas y versión, disponibilidad real y
 * ocupación «sin dato» mientras no existan entregas (F28). El espacio de «Entregas» está rotulado y NO muestra historial ni métricas
 * ficticias. Las acciones aparecen según el permiso en SU sucursal (cosmético: la API decide).
 */
export function RiderDrawer({
  riderId,
  onClose,
  onAction,
}: {
  riderId: string;
  onClose: () => void;
  onAction: (action: RiderDrawerAction, rider: AdminRider) => void;
}) {
  const t = useTranslations('backoffice.riders');
  const td = useTranslations('backoffice.riders.detail');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const { can } = useShell();
  const errorText = useRiderErrorText();
  const query = useAdminRider(riderId);
  const rider = query.data;
  const canUpdate = rider ? can('riders.update', rider.branchId) : false;
  const occupancy = rider ? riderOccupancy(rider) : 'unknown';

  return (
    <Drawer
      open
      zone="bo"
      title={rider?.fullName ?? td('title')}
      eyebrow={rider?.branchName}
      onClose={onClose}
      headerExtra={
        rider ? (
          <div className="row gap8" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <Pill zone="bo" tone={OPERATIONAL_TONE[rider.operationalState]}>
              {rider.active ? t(riderStateTextKey(rider)) : t('stateInactive')}
            </Pill>
          </div>
        ) : null
      }
    >
      <div data-testid="rider-detail" style={{ display: 'grid', gap: 16 }}>
        {query.isPending ? (
          <div role="status" aria-busy="true" aria-label={td('loading')}>
            <Skeleton zone="bo" style={{ height: 22, borderRadius: 8, marginBottom: 10 }} />
            <Skeleton zone="bo" style={{ height: 22, borderRadius: 8, marginBottom: 10 }} />
            <Skeleton zone="bo" style={{ height: 22, borderRadius: 8 }} />
          </div>
        ) : query.isError || !rider ? (
          <Banner zone="bo" tone="danger" role="alert">
            {errorText(query.error)}{' '}
            <button type="button" className="link-btn" onClick={() => void query.refetch()}>
              {tu('retry')}
            </button>
          </Banner>
        ) : (
          <>
            <dl className="kv kv-wide">
              <dt>{td('name')}</dt>
              <dd>{rider.fullName}</dd>
              <dt>{td('phone')}</dt>
              <dd>{rider.phone}</dd>
              <dt>{td('vehicle')}</dt>
              <dd>{rider.vehicleType ? t(`vehicles.${rider.vehicleType}`) : t('vehicleNone')}</dd>
              <dt>{td('plate')}</dt>
              <dd>{rider.licensePlate ?? td('plateNone')}</dd>
              <dt>{td('branch')}</dt>
              <dd>{rider.branchName}</dd>
              <dt>{td('status')}</dt>
              <dd>{rider.active ? t('statusActive') : t('statusInactive')}</dd>
              <dt>{td('availability')}</dt>
              <dd>
                <RiderAvailabilityControl rider={rider} canEdit={canUpdate} />
              </dd>
              <dt>{td('occupancy')}</dt>
              <dd data-testid="rider-occupancy">
                {td(
                  occupancy === 'unknown'
                    ? 'occupancyUnknown'
                    : occupancy === 'busy'
                      ? 'occupancyBusy'
                      : 'occupancyFree',
                )}
              </dd>
              <dt>{td('createdAt')}</dt>
              <dd>{formatDateTime(rider.createdAt, locale)}</dd>
              <dt>{td('updatedAt')}</dt>
              <dd>{formatDateTime(rider.updatedAt, locale)}</dd>
              <dt>{td('version')}</dt>
              <dd>{rider.version}</dd>
            </dl>
            {occupancy === 'unknown' ? (
              <p className="xs muted" style={{ margin: 0, fontWeight: 600 }}>
                {t('occupancyHint')}
              </p>
            ) : null}
            <section aria-labelledby="rider-deliveries" className="card" style={{ padding: 14 }}>
              <h3 id="rider-deliveries" style={{ margin: '0 0 6px', fontSize: 14 }}>
                {td('deliveriesTitle')}
              </h3>
              <p
                className="sm"
                style={{ margin: 0, fontWeight: 700 }}
                data-testid="rider-deliveries"
              >
                {td('deliveriesText')}
              </p>
              <p className="xs muted" style={{ margin: '4px 0 0', fontWeight: 600 }}>
                {td('deliveriesNote')}
              </p>
            </section>
            {canUpdate ? (
              <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn" onClick={() => onAction('edit', rider)}>
                  {t('edit')}
                </button>
                <button type="button" className="btn" onClick={() => onAction('transfer', rider)}>
                  {t('transfer')}
                </button>
                <button
                  type="button"
                  className={rider.active ? 'btn danger' : 'btn'}
                  onClick={() => onAction('status', rider)}
                >
                  {rider.active ? t('deactivate') : t('activate')}
                </button>
              </div>
            ) : (
              <p className="xs muted" style={{ margin: 0, fontWeight: 600 }}>
                {t('readOnlyHint')}
              </p>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
