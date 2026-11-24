'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { IconRider } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import type { AdminDelivery } from '@/lib/data-access/models';
import { isStaleError } from '../delivery-model';
import { useEligibleRiders } from '../hooks';
import { useDeliveryActions } from '../use-delivery-actions';

/**
 * Asignar o REASIGNAR el motorista. El selector ofrece SOLO motoristas elegibles de la sucursal de la entrega (activos, marcados
 * disponibles y sin otra entrega; `GET /v1/admin/riders`, requiere `riders.read`): es una ayuda, el servidor revalida y un 422
 * `RIDER_NOT_ELIGIBLE` explica la razón por motorista. Envía `expectedVersion`. `replayed` (ya estaba asignado) se avisa.
 */
export function AssignRiderModal({
  delivery,
  onClose,
}: {
  delivery: AdminDelivery;
  onClose: (result: 'done' | 'stale' | 'closed', note?: string) => void;
}) {
  const t = useTranslations('backoffice.deliveries.fleet.assignModal');
  const tr = useTranslations('backoffice.riders');
  const actions = useDeliveryActions();
  const reassign = delivery.rider !== null;
  const eligible = useEligibleRiders(delivery.branchId, delivery.rider?.id ?? null);
  const [riderId, setRiderId] = useState('');
  const [fieldError, setFieldError] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const selectId = useId();
  const errId = useId();

  const submit = async () => {
    if (actions.pending) return;
    if (!riderId) {
      setFieldError(true);
      return;
    }
    setServerError(null);
    const result = await actions.run(
      { kind: 'assign', id: delivery.id, riderId, expectedVersion: delivery.version },
      delivery.displayNumber,
    );
    if (result.ok) onClose('done');
    else if (isStaleError(result.error.kind)) onClose('stale', result.text);
    else {
      // 422/404 del motorista: se explica aquí y se vuelve a ofrecer la lista (la invalidación ya la está releyendo).
      if (result.text) setServerError(result.text);
      setRiderId('');
    }
  };

  const label = (r: (typeof eligible.riders)[number]) =>
    [r.fullName, r.vehicleType ? tr(`vehicles.${r.vehicleType}`) : null, r.phoneMasked]
      .filter(Boolean)
      .join(' · ');

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      icon={<IconRider />}
      iconTone="coral"
      title={reassign ? t('titleReassign') : t('title')}
      description={`#${delivery.displayNumber} · ${delivery.branchName}`}
      onClose={() => onClose('closed')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose('closed')}>
            {t('back')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={actions.pending || eligible.isPending || eligible.riders.length === 0}
            aria-busy={actions.pending}
            onClick={() => void submit()}
          >
            {reassign ? t('confirmReassign') : t('confirm')}
          </button>
        </>
      }
    >
      {reassign ? (
        <p className="sm" style={{ fontWeight: 600 }}>
          {t('current', { name: delivery.rider?.fullName ?? '' })}
        </p>
      ) : null}
      {eligible.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('loading')}>
          <Skeleton zone="bo" style={{ height: 44, borderRadius: 10 }} />
        </div>
      ) : eligible.isError ? (
        <Banner zone="bo" tone="warning" role="alert">
          {t('ridersError')}{' '}
          <button type="button" className="link-btn" onClick={() => void eligible.refetch()}>
            {t('retry')}
          </button>
        </Banner>
      ) : eligible.riders.length === 0 ? (
        <Banner zone="bo" tone="info" role="status">
          {t('none', { branch: delivery.branchName })}
        </Banner>
      ) : (
        <div className="field">
          <label className="flabel" htmlFor={selectId}>
            {t('label')}
          </label>
          <select
            id={selectId}
            className="inp"
            value={riderId}
            aria-invalid={fieldError && !riderId ? true : undefined}
            aria-describedby={fieldError && !riderId ? errId : undefined}
            onChange={(e) => {
              setRiderId(e.target.value);
              setFieldError(false);
              setServerError(null);
            }}
          >
            <option value="">{t('pick')}</option>
            {eligible.riders.map((r) => (
              <option key={r.id} value={r.id}>
                {label(r)}
              </option>
            ))}
          </select>
          {fieldError && !riderId ? (
            <span
              id={errId}
              role="alert"
              className="xs"
              style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
            >
              {t('required')}
            </span>
          ) : null}
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {t('hint')}
          </span>
        </div>
      )}
      {serverError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {serverError}
        </Banner>
      ) : null}
    </Modal>
  );
}
