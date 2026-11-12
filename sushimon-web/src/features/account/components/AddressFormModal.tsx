'use client';

import { Briefcase, House, LoaderCircle, MapPin, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { Address } from '@/lib/data-access/models';
import { MAX_ZONE, municipalitiesOf, requiresZone } from '@/features/order-mode/draft';
import { useStoreConfig } from '@/features/store/hooks';
import { useCreateAddress, useSetDefaultAddress, useUpdateAddress } from '../hooks';
import {
  EMPTY_ADDRESS,
  MAX_ADDRESSES,
  hasErrors,
  validateAddress,
  type AddressFormValues,
} from '../validation';
import { useAddressLabels } from '../use-address-labels';
import { CoverageChip } from './CoverageChip';
import { Field } from './Field';

export const LABEL_ICONS: Record<Address['label'], LucideIcon> = {
  home: House,
  work: Briefcase,
  other: MapPin,
};

const addressKey = (a: Pick<Address, 'line' | 'municipality' | 'zone'>) =>
  `${a.line.trim().toLowerCase()}|${a.municipality}|${a.zone}`;

/**
 * Formulario (en modal) para crear o editar una dirección: etiqueta casa/trabajo/otra, departamento →
 * municipio → zona, dirección exacta y referencias. Valida en el cliente (ayuda de UX) y enfoca el primer
 * campo con error; el servidor decide siempre (duplicadas, límite, cobertura).
 */
export function AddressFormModal({
  editing,
  addresses,
  defaultAddressId,
  onClose,
}: {
  /** Dirección a editar (null = nueva). */
  editing: Address | null;
  addresses: Address[];
  defaultAddressId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('addr');
  const tv = useTranslations();
  const tCheckout = useTranslations('checkout');
  const tCommon = useTranslations('common');
  const { notify } = useToast();
  const formId = useId();
  const config = useStoreConfig();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const setDefault = useSetDefaultAddress();
  const [values, setValues] = useState<AddressFormValues>(
    editing
      ? {
          label: editing.label,
          customLabel: editing.customLabel,
          department: editing.department,
          municipality: editing.municipality,
          zone: editing.zone,
          line: editing.line,
          references: editing.references,
        }
      : EMPTY_ADDRESS,
  );
  const [makeDefault, setMakeDefault] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');

  const departments = config.data?.departments ?? [];
  const nonexistent = config.data?.nonexistentZones ?? [];
  const municipalities = municipalitiesOf(departments, values.department);
  const zones = Array.from({ length: MAX_ZONE }, (_, i) => i + 1).filter(
    (n) => !nonexistent.includes(n),
  );
  const zoneApplies = requiresZone(values.department, values.municipality);
  const errors = validateAddress(values, nonexistent);
  const visible = submitted ? errors : {};
  const message = (key?: string) => (key ? tv(key as 'validation.name') : undefined);
  const busy = create.isPending || update.isPending || setDefault.isPending;
  const isNewFirst = !editing && addresses.length === 0;
  const isCurrentDefault = !!editing && defaultAddressId === editing.id;
  const set = (patch: Partial<AddressFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const labels = useAddressLabels();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError('');
    if (hasErrors(errors)) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[id="${formId}"] [aria-invalid="true"]`)?.focus(),
      );
      return;
    }
    const input: AddressFormValues = {
      ...values,
      zone: zoneApplies ? values.zone : '',
      customLabel: values.label === 'other' ? values.customLabel.trim() : '',
      line: values.line.trim(),
      references: values.references.trim(),
    };
    if (addresses.some((a) => a.id !== editing?.id && addressKey(a) === addressKey(input))) {
      setServerError(t('duplicate'));
      return;
    }
    if (!editing && addresses.length >= MAX_ADDRESSES) {
      setServerError(t('limit', { a: MAX_ADDRESSES }));
      return;
    }
    try {
      const saved = editing
        ? await update.mutateAsync({ id: editing.id, input })
        : await create.mutateAsync(input);
      if (makeDefault) await setDefault.mutateAsync(saved.id);
      notify(t('saved'));
      onClose();
    } catch (error) {
      const conflict = (error as { status?: number }).status === 409;
      setServerError(
        conflict
          ? addresses.length >= MAX_ADDRESSES && !editing
            ? t('limit', { a: MAX_ADDRESSES })
            : t('duplicate')
          : t('error'),
      );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? t('editTitle') : t('newTitle')}
      footer={
        <button
          type="submit"
          form={formId}
          disabled={busy}
          aria-busy={busy}
          className="btn btn-primary w-full"
        >
          {busy ? <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" /> : null}
          {busy ? t('saving') : t('save')}
        </button>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="flex flex-col gap-4 pb-2"
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="lbl">{t('labelLabel')}</legend>
          <div role="radiogroup" aria-label={t('labelLabel')} className="grid grid-cols-3 gap-2">
            {(['home', 'work', 'other'] as const).map((label) => {
              const Icon = LABEL_ICONS[label];
              const on = values.label === label;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ label })}
                  className={cn(
                    'flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border px-2 text-[14px] font-extrabold',
                    on
                      ? 'border-secondary bg-secondary-soft ring-1 ring-secondary'
                      : 'border-line bg-surface hover:bg-subtle',
                  )}
                >
                  <Icon className="h-4 w-4 flex-none" aria-hidden="true" /> {labels[label]}
                </button>
              );
            })}
          </div>
        </fieldset>

        {values.label === 'other' ? (
          <Field id={`${formId}-custom`} label={`${t('customLabel')} (${tCommon('optional')})`}>
            {(props) => (
              <input
                {...props}
                type="text"
                maxLength={40}
                placeholder={t('customLabelPh')}
                value={values.customLabel}
                onChange={(e) => set({ customLabel: e.target.value })}
              />
            )}
          </Field>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field
            id={`${formId}-dep`}
            label={tCheckout('department')}
            error={message(visible.department)}
          >
            {(props) => (
              <select
                {...props}
                value={values.department}
                onChange={(e) => {
                  const department = e.target.value;
                  set({
                    department,
                    municipality: municipalitiesOf(departments, department)[0]?.name ?? '',
                    zone: '',
                  });
                }}
              >
                <option value="">{tCheckout('select')}</option>
                {departments.map((d) => (
                  <option key={d.department} value={d.department}>
                    {d.department}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${formId}-muni`}
            label={tCheckout('municipality')}
            error={message(visible.municipality)}
          >
            {(props) => (
              <select
                {...props}
                value={values.municipality}
                onChange={(e) => set({ municipality: e.target.value, zone: '' })}
              >
                <option value="">{tCheckout('select')}</option>
                {municipalities.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {zoneApplies ? (
            <Field id={`${formId}-zone`} label={tCheckout('zone')} error={message(visible.zone)}>
              {(props) => (
                <select
                  {...props}
                  value={values.zone}
                  onChange={(e) => set({ zone: e.target.value })}
                >
                  <option value="">{tCheckout('select')}</option>
                  {zones.map((n) => (
                    <option key={n} value={String(n)}>
                      {tCheckout('zone')} {n}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          <Field
            id={`${formId}-line`}
            label={tCheckout('exactAddress')}
            error={message(visible.line)}
            className={zoneApplies ? '' : 'sm:col-span-2'}
          >
            {(props) => (
              <input
                {...props}
                type="text"
                autoComplete="off"
                maxLength={200}
                placeholder={tCheckout('exactAddressPh')}
                value={values.line}
                onChange={(e) => set({ line: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={`${formId}-refs`}
            label={`${tCheckout('references')} (${tCommon('optional')})`}
            className="sm:col-span-2"
          >
            {(props) => (
              <input
                {...props}
                type="text"
                autoComplete="off"
                maxLength={200}
                placeholder={tCheckout('referencesPh')}
                value={values.references}
                onChange={(e) => set({ references: e.target.value })}
              />
            )}
          </Field>
        </div>

        <div>
          <CoverageChip
            address={{
              department: values.department,
              municipality: values.municipality,
              zone: zoneApplies ? values.zone : '',
            }}
          />
        </div>

        {!isNewFirst && !isCurrentDefault ? (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px] font-bold">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[rgb(var(--secondary))]"
              checked={makeDefault}
              onChange={(e) => setMakeDefault(e.target.checked)}
            />
            {t('makeDefault')}
          </label>
        ) : null}

        {serverError ? (
          <div role="alert" className="notice notice-warn">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
