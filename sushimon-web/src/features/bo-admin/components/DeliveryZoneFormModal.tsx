'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconMapPin } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { queryKeys } from '@/features/query-keys';
import {
  useAdminDeliveryZone,
  useCreateDeliveryZone,
  useLocationOptions,
  useUpdateDeliveryZone,
} from '@/features/delivery-coverage/hooks';
import type { AdminBranch, AdminDeliveryZone } from '@/lib/data-access/models';
import { ZONE_LABEL_MAX } from '@/lib/delivery-zone';
import {
  emptyZoneForm,
  firstZoneError,
  toCreateRequest,
  toUpdateRequest,
  validateZoneForm,
  zoneServerError,
  zoneToForm,
  type ZoneField,
  type ZoneFormErrors,
  type ZoneFormValues,
} from '../delivery-view';

/**
 * Alta y edición de una zona propia (F09). Alta: sucursal (si no viene fijada), departamento → municipio (dependientes),
 * etiqueta opcional (vacío = cobertura general del municipio), tarifa en quetzales como TEXTO decimal y estado. Edición:
 * solo etiqueta y tarifa (sucursal y municipio son inmutables) con `expectedVersion`; ante un conflicto de versión se
 * recargan los datos vigentes y se conserva lo escrito. Los errores del servidor (409 duplicado/versión, 422, 400, 403,
 * 404) se muestran sin cerrar el modal.
 */
export function DeliveryZoneFormModal({
  zone,
  branch,
  branches,
  onClose,
}: {
  zone?: AdminDeliveryZone;
  /** Sucursal fijada (modal de una sucursal); sin ella se elige en el formulario. */
  branch?: AdminBranch;
  branches: readonly AdminBranch[];
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branchDelivery.zones.form');
  const toast = useToast();
  const create = useCreateDeliveryZone();
  const update = useUpdateDeliveryZone();
  const queryClient = useQueryClient();
  // Versión VIGENTE de la zona: tras un conflicto se vuelve a pedir y se conserva lo escrito.
  const detail = useAdminDeliveryZone(zone?.id ?? null);
  const current = detail.data ?? zone;
  const editing = !!zone;
  const pending = create.isPending || update.isPending;
  const [values, setValues] = useState<ZoneFormValues>(() =>
    zone ? zoneToForm(zone) : emptyZoneForm(branch?.id ?? ''),
  );
  const [errors, setErrors] = useState<ZoneFormErrors>({});
  const [serverError, setServerError] = useState('');
  const refs = useRef<Partial<Record<ZoneField, HTMLInputElement | HTMLSelectElement | null>>>({});
  const departmentRef = useRef<HTMLSelectElement | null>(null);
  const formId = useId();
  const errId = (f: ZoneField) => `${formId}-${f}-err`;
  const hintId = (f: ZoneField) => `${formId}-${f}-hint`;
  const inputId = (f: ZoneField) => `${formId}-${f}`;

  // Los municipios se piden por NOMBRE de departamento (catálogo público `locations`).
  const departments = useLocationOptions('');
  const selectedDepartment = departments.departments.find((d) => d.id === values.departmentId);
  const municipalities = useLocationOptions(selectedDepartment?.name ?? '');
  const lockedBranch = branch ?? branches.find((b) => b.id === values.branchId);

  /** El municipio está deshabilitado hasta elegir departamento: su error se enfoca en el departamento. */
  const focusField = (field: ZoneField) =>
    (field === 'municipalityId' && !values.departmentId && !editing
      ? departmentRef.current
      : refs.current[field]
    )?.focus();

  const set = (patch: Partial<ZoneFormValues>, field?: ZoneField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const fail = (error: unknown) => {
    const parsed = zoneServerError(error);
    setErrors(parsed.fields);
    setServerError(parsed.message);
    if (parsed.reload) {
      void detail.refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveryZones.adminLists });
    }
    const first = firstZoneError(parsed.fields);
    if (first) focusField(first);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateZoneForm(values, editing ? 'edit' : 'create');
    setErrors(found);
    setServerError('');
    const first = firstZoneError(found);
    if (first) {
      focusField(first);
      return;
    }
    if (zone && current) {
      const patch = toUpdateRequest(values, current);
      if (!patch) {
        toast.notify(t('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: zone.id, input: patch },
        {
          onSuccess: () => {
            toast.notify(t('toastUpdated'));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    create.mutate(toCreateRequest(values), {
      onSuccess: () => {
        toast.notify(t('toastCreated'));
        onClose();
      },
      onError: fail,
    });
  };

  const describedBy = (f: ZoneField, hint = false) =>
    [errors[f] ? errId(f) : null, hint ? hintId(f) : null].filter(Boolean).join(' ') || undefined;
  const fieldError = (f: ZoneField) =>
    errors[f] ? (
      <span
        id={errId(f)}
        className="xs"
        role="alert"
        style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
      >
        {errors[f]}
      </span>
    ) : null;

  return (
    <Modal
      open
      zone="bo"
      title={editing ? t('editTitle') : t('createTitle')}
      description={lockedBranch?.name}
      icon={<IconMapPin />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : editing ? t('save') : t('create')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        {!branch && !editing ? (
          <div className="field span-2">
            <label className="flabel" htmlFor={inputId('branchId')}>
              {t('branch')}
            </label>
            <select
              id={inputId('branchId')}
              ref={(el) => {
                refs.current.branchId = el;
              }}
              className="inp"
              value={values.branchId}
              onChange={(e) => set({ branchId: e.target.value }, 'branchId')}
              aria-invalid={errors.branchId ? true : undefined}
              aria-describedby={describedBy('branchId')}
            >
              <option value="">{t('select')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {fieldError('branchId')}
          </div>
        ) : null}

        <div className="field">
          <label className="flabel" htmlFor={`${formId}-department`}>
            {t('department')}
          </label>
          <select
            id={`${formId}-department`}
            ref={departmentRef}
            className="inp"
            value={values.departmentId}
            disabled={editing}
            onChange={(e) => set({ departmentId: e.target.value, municipalityId: '' })}
          >
            <option value="">{t('select')}</option>
            {departments.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="flabel" htmlFor={inputId('municipalityId')}>
            {t('municipality')}
          </label>
          <select
            id={inputId('municipalityId')}
            ref={(el) => {
              refs.current.municipalityId = el;
            }}
            className="inp"
            value={values.municipalityId}
            disabled={editing || !values.departmentId}
            onChange={(e) => set({ municipalityId: e.target.value }, 'municipalityId')}
            aria-invalid={errors.municipalityId ? true : undefined}
            aria-describedby={describedBy('municipalityId')}
          >
            <option value="">{t('select')}</option>
            {/* En edición el municipio viene de la zona (sus catálogos pueden no estar cargados aún). */}
            {editing && zone ? (
              <option value={zone.municipalityId}>{zone.municipalityName}</option>
            ) : null}
            {municipalities.municipalities
              .filter((m) => !(editing && zone && m.id === zone.municipalityId))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          {fieldError('municipalityId')}
        </div>
        {editing ? (
          <span className="xs muted span-2" style={{ fontWeight: 600 }}>
            {t('locked')}
          </span>
        ) : municipalities.municipalitiesEmpty ? (
          <span className="xs muted span-2" style={{ fontWeight: 600 }} role="status">
            {t('noMunicipalities')} {t('onlyGuatemala')}
          </span>
        ) : null}

        <div className="field">
          <label className="flabel" htmlFor={inputId('zoneLabel')}>
            {t('zone')}
          </label>
          <input
            id={inputId('zoneLabel')}
            ref={(el) => {
              refs.current.zoneLabel = el as HTMLInputElement | null;
            }}
            className="inp"
            type="text"
            autoComplete="off"
            value={values.zoneLabel}
            onChange={(e) => set({ zoneLabel: e.target.value }, 'zoneLabel')}
            aria-invalid={errors.zoneLabel ? true : undefined}
            aria-describedby={describedBy('zoneLabel', true)}
          />
          <span id={hintId('zoneLabel')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('zoneHint', { max: ZONE_LABEL_MAX })}
          </span>
          {fieldError('zoneLabel')}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={inputId('baseFee')}>
            {t('fee')}
          </label>
          <input
            id={inputId('baseFee')}
            ref={(el) => {
              refs.current.baseFee = el as HTMLInputElement | null;
            }}
            className="inp"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={values.baseFee}
            onChange={(e) => set({ baseFee: e.target.value }, 'baseFee')}
            aria-invalid={errors.baseFee ? true : undefined}
            aria-describedby={describedBy('baseFee', true)}
          />
          <span id={hintId('baseFee')} className="xs muted" style={{ fontWeight: 600 }}>
            {t('feeHint')}
          </span>
          {fieldError('baseFee')}
        </div>
        {!editing ? (
          <label className="row gap8 span-2">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            <span className="sm" style={{ fontWeight: 700 }}>
              {t('active')}
            </span>
          </label>
        ) : null}
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
