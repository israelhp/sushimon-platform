'use client';

import { LoaderCircle, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { Address, Customer } from '@/lib/data-access/models';
import { addressLine, addressTitle, defaultAddressIdOf } from '../address-format';
import { useAddressLabels } from '../use-address-labels';
import { useAddresses, useMe, useSetDefaultAddress, useUpdateMe } from '../hooks';
import { hasErrors, validateProfile } from '../validation';
import { AccountSection } from './AccountSection';
import { Field } from './Field';

/** Datos personales del cliente (nombre, teléfono, correo y dirección predeterminada). */
export function ProfileForm() {
  const t = useTranslations('personal');
  const me = useMe();
  const addresses = useAddresses();
  const query = {
    isPending: me.isPending || addresses.isPending,
    isError: me.isError || addresses.isError,
    refetch: () => {
      void me.refetch();
      void addresses.refetch();
    },
  };
  return (
    <AccountSection title={t('title')} intro={t('intro')} query={query}>
      {me.data && addresses.data ? (
        // Al guardar, los datos del servidor cambian y el formulario se reinicia con ellos.
        <ProfileFields
          key={`${me.data.fullName}|${me.data.phone}|${defaultAddressIdOf(addresses.data) ?? ''}`}
          profile={me.data}
          addresses={addresses.data}
          defaultAddressId={defaultAddressIdOf(addresses.data)}
        />
      ) : null}
    </AccountSection>
  );
}

function ProfileFields({
  profile,
  addresses,
  defaultAddressId,
}: {
  profile: Customer;
  addresses: Address[];
  /** Predeterminada según el listado (F05); la API no la devuelve en /v1/me. */
  defaultAddressId: string | null;
}) {
  const t = useTranslations('personal');
  const tv = useTranslations();
  const tCheckout = useTranslations('checkout');
  const locale = useLocale();
  const { notify } = useToast();
  const update = useUpdateMe();
  const setDefault = useSetDefaultAddress();
  const [values, setValues] = useState({
    fullName: profile.fullName,
    phone: profile.phone,
    defaultAddressId: defaultAddressId ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);

  const labels = useAddressLabels();
  const errors = validateProfile(values);
  const visible = submitted ? errors : {};
  const message = (key?: string) => (key ? tv(key as 'validation.name') : undefined);
  const dirty =
    values.fullName.trim() !== profile.fullName ||
    values.phone.trim() !== profile.phone ||
    values.defaultAddressId !== (defaultAddressId ?? '');
  const selected = addresses.find((a) => a.id === values.defaultAddressId);
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFailed(false);
    if (hasErrors(errors)) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('#datos [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    // F04: nombre y teléfono van a /v1/me. La predeterminada es de F05 (PATCH …/addresses/{id}/default).
    const defaultChanged = values.defaultAddressId !== (defaultAddressId ?? '');
    update.mutate(
      { fullName: values.fullName.trim(), phone: values.phone.trim() },
      {
        onSuccess: () => {
          if (!defaultChanged) {
            setSubmitted(false);
            notify(t('saved'));
            return;
          }
          setDefault.mutate(values.defaultAddressId, {
            onSuccess: () => {
              setSubmitted(false);
              notify(t('saved'));
            },
            onError: () => setFailed(true),
          });
        },
        onError: () => setFailed(true),
      },
    );
  };

  return (
    <form
      id="datos"
      onSubmit={onSubmit}
      noValidate
      className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field
          id="p-name"
          label={t('fullName')}
          error={message(visible.fullName)}
          className="sm:col-span-2"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="name"
              maxLength={120}
              value={values.fullName}
              onChange={(e) => set({ fullName: e.target.value })}
            />
          )}
        </Field>
        <Field id="p-phone" label={t('phone')} error={message(visible.phone)}>
          {(props) => (
            <input
              {...props}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              placeholder={tCheckout('phonePh')}
              value={values.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <span className="lbl" id="p-email-label">
            {t('email')}
          </span>
          <p
            aria-labelledby="p-email-label"
            className="m-0 mt-1 break-all text-[15px] font-bold text-fg"
          >
            {profile.email}
          </p>
        </div>
        <p className="m-0 -mt-2 text-[12px] text-muted sm:col-span-2">{t('emailHelp')}</p>

        <div className="sm:col-span-2">
          <label className="lbl" htmlFor="p-default">
            {t('defaultAddress')}
          </label>
          {addresses.length > 0 ? (
            <>
              <select
                id="p-default"
                className="input"
                value={values.defaultAddressId}
                onChange={(e) => set({ defaultAddressId: e.target.value })}
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {addressTitle(a, labels)} · {a.line}
                  </option>
                ))}
              </select>
              {selected ? (
                <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[13px] text-muted">
                  <MapPin className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />{' '}
                  {addressLine(selected, locale)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-[14px] text-muted">{tv('hub.addressesSub', { a: 0 })}</p>
          )}
          <Link
            href="/cuenta/direcciones"
            className="mt-1.5 inline-flex min-h-[36px] items-center text-sm font-extrabold text-secondary no-underline"
          >
            {t('manageAddresses')}
          </Link>
        </div>
      </div>

      {failed ? (
        <div role="alert" className="notice notice-warn mt-4">
          {t('error')}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={update.isPending || setDefault.isPending || !dirty}
        aria-busy={update.isPending || setDefault.isPending}
        className="btn btn-primary mt-4 w-full sm:w-auto"
      >
        {update.isPending || setDefault.isPending ? (
          <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" />
        ) : null}
        {update.isPending || setDefault.isPending ? t('saving') : t('save')}
      </button>
    </form>
  );
}
