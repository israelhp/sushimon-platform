'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { IconRider } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { AdminRiderSummary, Branch } from '@/lib/data-access/models';
import { useUpdateRider } from '../hooks';
import { classifyRiderError } from '../rider-model';
import { useRiderErrorText } from '../use-rider-text';

/**
 * Traslado de sucursal CON confirmación: mueve el mismo registro (no se duplica) y lo deja NO disponible. Solo ofrece
 * sucursales donde la persona puede editar (cosmético: el servidor exige `riders.update` en origen y destino). Envía
 * `expectedVersion`; un 409 de versión pide recargar.
 */
export function RiderTransferModal({
  rider,
  targets,
  onClose,
  onReload,
}: {
  rider: AdminRiderSummary;
  /** Sucursales destino candidatas (activas, con permiso de edición, distintas de la actual). */
  targets: readonly Pick<Branch, 'id' | 'name'>[];
  onClose: () => void;
  /** Refresca los datos del listado tras un conflicto de versión. */
  onReload: () => Promise<unknown>;
}) {
  const t = useTranslations('backoffice.riders.transferModal');
  const tr = useTranslations('backoffice.riders');
  const toast = useToast();
  const errorText = useRiderErrorText();
  const mutation = useUpdateRider();
  const [target, setTarget] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [serverError, setServerError] = useState<unknown>(null);
  const formId = useId();
  const conflict = serverError ? classifyRiderError(serverError).kind === 'versionConflict' : false;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    setServerError(null);
    if (!target) {
      setFieldError(t('targetRequired'));
      return;
    }
    mutation.mutate(
      { id: rider.id, input: { expectedVersion: rider.version, branchId: target } },
      {
        onSuccess: (updated) => {
          toast.notify(
            tr('toastTransferred', { name: updated.fullName, branch: updated.branchName }),
          );
          onClose();
        },
        onError: setServerError,
      },
    );
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      role="alertdialog"
      title={t('title')}
      description={rider.fullName}
      icon={<IconRider />}
      iconTone="coral"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className="btn danger"
            disabled={mutation.isPending || targets.length === 0}
          >
            {mutation.isPending ? t('saving') : t('confirm')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        <p className="span-2 sm" style={{ margin: 0 }}>
          {t('text', { name: rider.fullName })}
        </p>
        <Banner zone="bo" tone="warning" role="note" className="span-2">
          {t('warning')}
        </Banner>
        <p className="span-2 sm muted" style={{ margin: 0, fontWeight: 600 }}>
          {t('current', { branch: rider.branchName })}
        </p>
        {targets.length === 0 ? (
          <Banner zone="bo" tone="info" role="note" className="span-2">
            {t('noTargets')}
          </Banner>
        ) : (
          <div className="field span-2">
            <label className="flabel" htmlFor={`${formId}-target`}>
              {t('target')}
            </label>
            <select
              id={`${formId}-target`}
              className="inp"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setFieldError('');
                setServerError(null);
              }}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${formId}-err` : undefined}
            >
              <option value="">{t('targetPick')}</option>
              {targets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {fieldError ? (
              <span
                id={`${formId}-err`}
                className="xs"
                role="alert"
                style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
              >
                {fieldError}
              </span>
            ) : null}
          </div>
        )}
        {serverError ? (
          <Banner zone="bo" tone="danger" role="alert" className="span-2">
            {errorText(serverError)}{' '}
            {conflict ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => void onReload().then(onClose)}
              >
                {tr('errors.reload')}
              </button>
            ) : null}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
