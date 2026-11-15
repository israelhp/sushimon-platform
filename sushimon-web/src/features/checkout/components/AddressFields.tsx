'use client';

import { useTranslations } from 'next-intl';
import { useLocationOptions } from '@/features/delivery-coverage/hooks';
import { requiresZone, zoneChoices } from '@/features/order-mode/draft';
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
  // F09: departamentos y municipios vienen de `locations` (catálogo público); el borrador conserva los NOMBRES.
  const locations = useLocationOptions(value.department);
  const zones = zoneChoices(config?.nonexistentZones ?? []);
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
            onChange={(e) => onChange({ department: e.target.value, municipality: '', zone: '' })}
          >
            <option value="">{t('checkout.select')}</option>
            {locations.departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
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
            {locations.municipalities.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {locations.isError ? (
        <p className="notice notice-warn sm:col-span-2" role="alert">
          {t('coverage.locationsError')}{' '}
          <button type="button" className="link-btn" onClick={locations.refetch}>
            {t('ui.retry')}
          </button>
        </p>
      ) : null}
      {locations.municipalitiesEmpty ? (
        <p className="notice notice-info sm:col-span-2" role="status">
          {t('coverage.onlyGuatemala')}
        </p>
      ) : null}
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
