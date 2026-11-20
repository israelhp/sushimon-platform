'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { IconRider } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { AdminRider } from '@/lib/data-access/models';
import { RIDER_NAME_MAX } from '@/lib/rider-rules';
import { useAdminRider, useCreateRider, useUpdateRider } from '../hooks';
import {
  VEHICLE_OPTIONS,
  branchesWhere,
  classifyRiderError,
  emptyRiderForm,
  firstRiderErrorField,
  hasRiderErrors,
  riderToForm,
  toCreateRiderRequest,
  toUpdateRiderRequest,
  validateRiderForm,
  type RiderFormErrors,
  type RiderFormField,
  type RiderFormValues,
} from '../rider-model';
import { useRiderErrorText } from '../use-rider-text';

/**
 * Alta y edición de un motorista. La validación de cliente replica la del servidor (nombre 2–80, teléfono `+502` + 8 dígitos,
 * vehículo de un conjunto cerrado, placa 4–10 alfanuméricos) solo para orientar: el servidor decide permisos, alcance,
 * unicidad del teléfono y versión. La edición carga el DETALLE (teléfono completo y placa) y envía `expectedVersion`; el
 * traslado NO se hace aquí (tiene su propio flujo con confirmación). Sin datos personales en `localStorage` ni en la URL.
 */
export function RiderFormModal({ riderId, onClose }: { riderId?: string; onClose: () => void }) {
  const t = useTranslations('backoffice.riders.form');
  const detail = useAdminRider(riderId ?? null, Boolean(riderId));
  const errorText = useRiderErrorText();

  if (!riderId) return <RiderForm onClose={onClose} />;
  if (detail.data) {
    return (
      <RiderForm
        key={detail.data.id}
        rider={detail.data}
        reload={async () => (await detail.refetch()).data}
        onClose={onClose}
      />
    );
  }
  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t('titleEdit')}
      icon={<IconRider />}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('cancel')}
        </button>
      }
    >
      {detail.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {detail.error ? errorText(detail.error) : t('loadError')}
        </Banner>
      ) : (
        <div aria-busy="true" aria-label={t('loading')} role="status">
          <Skeleton zone="bo" style={{ height: 42, borderRadius: 10, marginBottom: 12 }} />
          <Skeleton zone="bo" style={{ height: 42, borderRadius: 10 }} />
        </div>
      )}
    </Modal>
  );
}

function RiderForm({
  rider,
  reload,
  onClose,
}: {
  rider?: AdminRider;
  reload?: () => Promise<AdminRider | undefined>;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.riders.form');
  const tr = useTranslations('backoffice.riders');
  const toast = useToast();
  const { branches, can } = useShell();
  const errorText = useRiderErrorText();
  const create = useCreateRider();
  const update = useUpdateRider();
  const editing = Boolean(rider);
  // Línea base de la edición: la versión que se está editando. «Recargar» la sustituye por la vigente y conserva lo tecleado.
  const [baseline, setBaseline] = useState<AdminRider | undefined>(rider);
  const offered = branchesWhere(branches, (id) => can('riders.create', id));
  const [values, setValues] = useState<RiderFormValues>(() =>
    rider ? riderToForm(rider) : emptyRiderForm(offered.length === 1 ? (offered[0]?.id ?? '') : ''),
  );
  const [errors, setErrors] = useState<RiderFormErrors>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [reloaded, setReloaded] = useState(false);
  const formId = useId();
  const focusField = (field: RiderFormField) =>
    document.getElementById(`${formId}-${field}`)?.focus();
  const pending = create.isPending || update.isPending;
  const serverKind = serverError ? classifyRiderError(serverError) : null;

  const patch = (next: Partial<RiderFormValues>) => {
    setValues((v) => ({ ...v, ...next }));
    setErrors({});
    setServerError(null);
    setReloaded(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateRiderForm(values, editing ? 'edit' : 'create');
    setErrors(found);
    setServerError(null);
    if (hasRiderErrors(found)) {
      const first = firstRiderErrorField(found);
      if (first) focusField(first);
      return;
    }
    const onError = (error: unknown) => {
      setServerError(error);
      const kind = classifyRiderError(error);
      if (kind.field && kind.kind !== 'invalid') focusField(kind.field);
    };
    if (baseline) {
      const input = toUpdateRiderRequest(values, baseline);
      if (!input) {
        onClose();
        return;
      }
      update.mutate(
        { id: baseline.id, input },
        {
          onSuccess: (updated) => {
            toast.notify(tr('toastUpdated', { name: updated.fullName }));
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(toCreateRiderRequest(values), {
        onSuccess: (created) => {
          toast.notify(tr('toastCreated', { name: created.fullName }));
          onClose();
        },
        onError,
      });
    }
  };

  const reloadNow = async () => {
    const fresh = await reload?.();
    if (fresh) {
      setBaseline(fresh);
      setServerError(null);
      setReloaded(true);
    }
  };

  const fieldError = (field: RiderFormField) => {
    if (errors[field]) return t(`errors.${errors[field]}` as 'errors.phoneFormat');
    if (serverKind && serverKind.field === field && serverKind.kind !== 'invalid') {
      return errorText(serverError);
    }
    return '';
  };
  const describe = (field: RiderFormField, hint?: boolean) =>
    [hint ? `${formId}-${field}-hint` : '', fieldError(field) ? `${formId}-${field}-err` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const fieldErrorNode = (field: RiderFormField) =>
    fieldError(field) ? (
      <span
        id={`${formId}-${field}-err`}
        className="xs"
        role="alert"
        style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
      >
        {fieldError(field)}
      </span>
    ) : null;
  const invalid = (field: RiderFormField) => (fieldError(field) ? true : undefined);

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t(editing ? 'titleEdit' : 'titleNew')}
      description={editing ? rider?.branchName : t('descriptionNew')}
      icon={<IconRider />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        <div className="field">
          <label className="flabel" htmlFor={`${formId}-branchId`}>
            {t('branch')}
          </label>
          {editing ? (
            <>
              <input
                id={`${formId}-branchId`}
                className="inp"
                value={baseline?.branchName ?? ''}
                readOnly
                aria-describedby={`${formId}-branchId-hint`}
              />
              <span id={`${formId}-branchId-hint`} className="xs muted" style={{ fontWeight: 600 }}>
                {t('branchLockedHint')}
              </span>
            </>
          ) : (
            <>
              <select
                id={`${formId}-branchId`}
                className="inp"
                value={values.branchId}
                onChange={(e) => patch({ branchId: e.target.value })}
                aria-invalid={invalid('branchId')}
                aria-describedby={describe('branchId')}
              >
                <option value="">{t('branchPick')}</option>
                {offered.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {fieldErrorNode('branchId')}
            </>
          )}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={`${formId}-fullName`}>
            {t('name')}
          </label>
          <input
            id={`${formId}-fullName`}
            className="inp"
            value={values.fullName}
            maxLength={RIDER_NAME_MAX + 20}
            autoComplete="off"
            onChange={(e) => patch({ fullName: e.target.value })}
            aria-invalid={invalid('fullName')}
            aria-describedby={describe('fullName')}
          />
          {fieldErrorNode('fullName')}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={`${formId}-phone`}>
            {t('phone')}
          </label>
          <input
            id={`${formId}-phone`}
            className="inp"
            type="tel"
            inputMode="tel"
            value={values.phone}
            autoComplete="off"
            placeholder="+50255501234"
            onChange={(e) => patch({ phone: e.target.value })}
            aria-invalid={invalid('phone')}
            aria-describedby={describe('phone', true)}
          />
          <span id={`${formId}-phone-hint`} className="xs muted" style={{ fontWeight: 600 }}>
            {t('phoneHint')}
          </span>
          {fieldErrorNode('phone')}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={`${formId}-vehicleType`}>
            {t('vehicle')}
          </label>
          <select
            id={`${formId}-vehicleType`}
            className="inp"
            value={values.vehicleType}
            onChange={(e) =>
              patch({ vehicleType: e.target.value as RiderFormValues['vehicleType'] })
            }
            aria-invalid={invalid('vehicleType')}
            aria-describedby={describe('vehicleType')}
          >
            <option value="">{t('vehicleNone')}</option>
            {VEHICLE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {tr(`vehicles.${v}`)}
              </option>
            ))}
          </select>
          {fieldErrorNode('vehicleType')}
        </div>
        <div className="field span-2">
          <label className="flabel" htmlFor={`${formId}-licensePlate`}>
            {t('plate')}
          </label>
          <input
            id={`${formId}-licensePlate`}
            className="inp"
            value={values.licensePlate}
            maxLength={20}
            autoComplete="off"
            onChange={(e) => patch({ licensePlate: e.target.value })}
            aria-invalid={invalid('licensePlate')}
            aria-describedby={describe('licensePlate', true)}
          />
          <span id={`${formId}-licensePlate-hint`} className="xs muted" style={{ fontWeight: 600 }}>
            {t('plateHint')}
          </span>
          {fieldErrorNode('licensePlate')}
        </div>
        {reloaded ? (
          <Banner zone="bo" tone="info" role="status" className="span-2">
            {t('reloaded')}
          </Banner>
        ) : null}
        {serverError && !(serverKind?.field && serverKind.kind !== 'invalid') ? (
          <Banner zone="bo" tone="danger" role="alert" className="span-2">
            {errorText(serverError)}{' '}
            {serverKind?.kind === 'versionConflict' && reload ? (
              <button type="button" className="link-btn" onClick={() => void reloadNow()}>
                {tr('errors.reload')}
              </button>
            ) : null}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
