'use client';

import { useTranslations } from 'next-intl';
import { municipalitiesOf, requiresZone, MAX_ZONE } from '@/features/order-mode/draft';
import type { StoreConfig } from '@/lib/data-access/models';
import type { AddressErrors, AddressForm } from '../checkout-model';
import { Field } from './parts';

/**
 * Departamento, municipio, zona (solo Ciudad de Guatemala), dirección exacta y referencias.
 * Cambiar el departamento reinicia municipio y zona (como el prototipo).
 */
export function AddressFields({
  idPrefix = 'd',
  value,
  onChange,
  errors,
  config,
}: {
  idPrefix?: string;
  value: AddressForm;
  onChange: (patch: Partial<AddressForm>) => void;
  errors: AddressErrors;
  config: StoreConfig | undefined;
}) {
  const t = useTranslations();
  const departments = config?.departments ?? [];
  const municipalities = municipalitiesOf(departments, value.department);
  const zones = Array.from({ length: MAX_ZONE }, (_, i) => i + 1).filter(
    (z) => !(config?.nonexistentZones ?? []).includes(z),
  );
  const zoned = requiresZone(value.department, value.municipality);
  const err = (key?: Parameters<typeof t>[0]) => (key ? t(key) : undefined);

  return (
    <>
      <Field id={`${idPrefix}-dep`} label={t('checkout.department')} error={err(errors.department)}>
        {(p) => (
          <select
            {...p}
            autoComplete="address-level1"
            value={value.department}
            onChange={(e) => {
              const department = e.target.value;
              const first = municipalitiesOf(departments, department)[0];
              onChange({ department, municipality: first?.name ?? '', zone: '' });
            }}
          >
            <option value="">{t('checkout.select')}</option>
            {departments.map((d) => (
              <option key={d.department} value={d.department}>
                {d.department}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id={`${idPrefix}-muni`}
        label={t('checkout.municipality')}
        error={err(errors.municipality)}
      >
        {(p) => (
          <select
            {...p}
            autoComplete="address-level2"
            value={value.municipality}
            onChange={(e) => onChange({ municipality: e.target.value, zone: '' })}
          >
            <option value="">{t('checkout.select')}</option>
            {municipalities.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {zoned ? (
        <Field id={`${idPrefix}-zone`} label={t('checkout.zone')} error={err(errors.zone)}>
          {(p) => (
            <select {...p} value={value.zone} onChange={(e) => onChange({ zone: e.target.value })}>
              <option value="">{t('checkout.select')}</option>
              {zones.map((z) => (
                <option key={z} value={String(z)}>
                  {t('checkout.zone')} {z}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <Field
        id={`${idPrefix}-addr`}
        label={t('checkout.exactAddress')}
        error={err(errors.address)}
        className={zoned ? '' : 'sm:col-span-2'}
      >
        {(p) => (
          <input
            {...p}
            type="text"
            autoComplete="street-address"
            maxLength={200}
            placeholder={t('checkout.exactAddressPh')}
            value={value.line}
            onChange={(e) => onChange({ line: e.target.value })}
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-refs`}
        label={`${t('checkout.references')} (${t('common.optional')})`}
        className="sm:col-span-2"
      >
        {(p) => (
          <input
            {...p}
            type="text"
            autoComplete="off"
            maxLength={200}
            placeholder={t('checkout.referencesPh')}
            value={value.references}
            onChange={(e) => onChange({ references: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}
