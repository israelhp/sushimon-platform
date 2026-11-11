'use client';

import { Briefcase, House, MapPin, Plus, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { cn } from '@/lib/cn';
import type { Address, StoreConfig } from '@/lib/data-access/models';
import { useDemoSession } from '@/features/session/demo-session';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import { formatAddress, hasAnyError, type AddressForm } from '../checkout-model';
import { useCheckoutDraft } from '../checkout-context';
import { coveringBranch } from '../coverage';
import type { CheckoutData } from '../use-checkout-data';
import { AddressFields } from './AddressFields';
import { OrderTypeFields } from './OrderTypeFields';
import { ChangeButton, ChoiceCard, Field, useCheckoutSteps } from './parts';

/** Opciones del paso Entrega que no forman parte del pedido (se aplican tras confirmarlo). */
export interface CheckoutExtras {
  saveAddress: boolean;
  addressLabel: 'home' | 'work' | 'other';
  updateProfile: boolean;
  remember: boolean;
}

const LABEL_ICON: Record<Address['label'], LucideIcon> = {
  home: House,
  work: Briefcase,
  other: MapPin,
};

function toForm(a: Address): AddressForm {
  return {
    department: a.department,
    municipality: a.municipality,
    zone: a.zone,
    line: a.line,
    references: a.references,
  };
}

/**
 * Paso 2 · Entrega: forma (recoger/domicilio), cuándo (ahora/programado), inicio de sesión opcional,
 * datos de contacto y, a domicilio, dirección (guardadas si hay sesión). Los errores se asocian a cada
 * campo con `aria-describedby`; el flujo enfoca el primero.
 */
export function DeliveryStep({
  data,
  extras,
  setExtras,
  profileChanged,
}: {
  data: CheckoutData;
  extras: CheckoutExtras;
  setExtras: Dispatch<SetStateAction<CheckoutExtras>>;
  /** Con sesión: nombre/teléfono/correo difieren de los de la cuenta. */
  profileChanged: boolean;
}) {
  const t = useTranslations();
  const steps = useCheckoutSteps();
  const { draft, dispatch } = useCheckoutDraft();
  const { customer } = useDemoSession();
  const authModal = useAuthModal();
  const { type, config, contactErrors, addressErrors, addresses } = data;
  const show = draft.showErrors;

  const [editContact, setEditContact] = useState(() => hasAnyError(contactErrors));
  const [editAddress, setEditAddress] = useState(
    () => type === 'delivery' && hasAnyError(addressErrors),
  );
  const contactOpen = editContact || (show && hasAnyError(contactErrors));
  const addressOpen = editAddress || (show && hasAnyError(addressErrors));
  const err = (key?: Parameters<typeof t>[0]) => (key ? t(key) : undefined);
  const contactErr = show ? contactErrors : {};
  const addressErr = show ? addressErrors : {};
  const zoneWord = t('checkoutFlow.zoneInline');
  const saved = addresses.length > 0;
  const other = draft.addressId === 'other';
  const alreadySaved = addresses.some(
    (a) =>
      a.line.trim().toLowerCase() === draft.address.line.trim().toLowerCase() &&
      a.municipality === draft.address.municipality &&
      a.zone === draft.address.zone,
  );
  const showSaveAddress = type === 'delivery' && !!customer && (!saved || other) && !alreadySaved;
  const labelOf = (a: Address) =>
    (a.label === 'other' && a.customLabel.trim()) || t(`addr.labels.${a.label}`);

  const pickAddress = (id: string) => {
    const found = addresses.find((a) => a.id === id);
    if (found) {
      dispatch({ type: 'fill-address', address: toForm(found), addressId: id });
    } else {
      dispatch({
        type: 'fill-address',
        address: { ...draft.address, zone: '', line: '', references: '' },
        addressId: 'other',
      });
      setEditAddress(true);
    }
  };

  return (
    <section aria-label={steps[1]} className="flex flex-col gap-6">
      <OrderTypeFields
        data={data}
        typeError={show && !type ? t('validation.type') : undefined}
        whenError={data.scheduleValid ? undefined : t('mode.whenInvalid')}
      />
      {data.allClosed ? (
        <p className="notice notice-warn" role="status">
          {t('mode.allClosed')}
        </p>
      ) : null}

      {customer ? (
        <p className="m-0 -mb-2 flex items-center gap-2 rounded-xl bg-subtle px-3.5 py-2.5 text-[13px] font-bold">
          <UserRound className="h-4 w-4 flex-none" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {t('checkout.signedInAs', { a: customer.email })}
          </span>
        </p>
      ) : (
        <div className="-mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-line px-3.5 py-2.5">
          <p className="m-0 min-w-[180px] flex-1 text-[13px] leading-snug text-muted">
            {t('checkout.signInPrompt')}
          </p>
          <button
            type="button"
            onClick={authModal.open}
            className="inline-flex min-h-[38px] flex-none items-center gap-2 rounded-full border border-line bg-white px-3.5 text-[13px] font-extrabold text-neutral-900"
          >
            <GoogleLogo className="h-4 w-4" /> {t('checkout.signInCta')}
          </button>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="disp text-[20px]">{t('checkout.contact')}</h2>
          {!contactOpen ? (
            <ChangeButton onClick={() => setEditContact(true)} label={t('common.change')} />
          ) : null}
        </div>
        {!contactOpen ? (
          <div className="rounded-2xl border border-line bg-surface p-4 text-[15px] shadow-card">
            <p className="m-0 font-extrabold">
              {draft.contact.name} · {draft.contact.phone}
            </p>
            <p className="m-0 mt-1 break-all text-[14px] text-muted">{draft.contact.email}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Field
              id="d-name"
              label={t('checkout.name')}
              error={err(contactErr.name)}
              className="sm:col-span-2"
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  autoComplete="name"
                  placeholder={t('checkout.namePh')}
                  value={draft.contact.name}
                  onChange={(e) => dispatch({ type: 'contact', patch: { name: e.target.value } })}
                />
              )}
            </Field>
            <Field id="d-phone" label={t('checkout.phone')} error={err(contactErr.phone)}>
              {(p) => (
                <input
                  {...p}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder={t('checkout.phonePh')}
                  value={draft.contact.phone}
                  onChange={(e) => dispatch({ type: 'contact', patch: { phone: e.target.value } })}
                />
              )}
            </Field>
            <Field id="d-email" label={t('checkout.email')} error={err(contactErr.email)}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="cliente@ejemplo.com"
                  value={draft.contact.email}
                  onChange={(e) => dispatch({ type: 'contact', patch: { email: e.target.value } })}
                />
              )}
            </Field>
          </div>
        )}
        {profileChanged ? (
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px] font-bold">
            <input
              type="checkbox"
              className="h-5 w-5 flex-none accent-[rgb(var(--secondary))]"
              checked={extras.updateProfile}
              onChange={(e) => setExtras((x) => ({ ...x, updateProfile: e.target.checked }))}
            />
            {t('checkout.updateProfile')}
          </label>
        ) : null}
      </div>

      {type === 'delivery' ? (
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="disp text-[20px]">
              {saved ? t('checkout.savedAddresses') : t('checkout.address')}
            </h2>
            {!saved && !addressOpen ? (
              <ChangeButton onClick={() => setEditAddress(true)} label={t('common.change')} />
            ) : null}
          </div>
          {saved ? (
            <div
              className="mb-3 flex flex-col gap-2.5"
              role="radiogroup"
              aria-label={t('checkout.savedAddresses')}
            >
              {addresses.map((a) => {
                const Icon = LABEL_ICON[a.label];
                const branch = coveringBranch(data.branches, a);
                return (
                  <ChoiceCard
                    key={a.id}
                    on={draft.addressId === a.id}
                    onClick={() => pickAddress(a.id)}
                    icon={<Icon className="h-5 w-5" aria-hidden="true" />}
                    title={labelOf(a)}
                    sub={formatAddress(toForm(a), zoneWord)}
                    badge={
                      <>
                        {data.defaultAddressId === a.id ? (
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold text-fg">
                            {t('addr.isDefault')}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-extrabold',
                            branch ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                          )}
                        >
                          {branch ? t('addr.covered', { a: branch.name }) : t('addr.notCovered')}
                        </span>
                      </>
                    }
                  />
                );
              })}
              <ChoiceCard
                on={other}
                onClick={() => pickAddress('other')}
                icon={<Plus className="h-5 w-5" aria-hidden="true" />}
                title={t('checkout.otherAddress')}
                sub={t('checkout.otherAddressSub')}
              />
            </div>
          ) : null}
          {!saved || other ? (
            !saved && !addressOpen ? (
              <div className="rounded-2xl border border-line bg-surface p-4 text-[14px] shadow-card">
                <p className="m-0 flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-4 w-4 flex-none text-secondary" aria-hidden="true" />{' '}
                  {formatAddress(draft.address, zoneWord)}
                </p>
                {draft.address.references ? (
                  <p className="m-0 mt-1 pl-[22px] text-muted">{draft.address.references}</p>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <AddressFields
                  value={draft.address}
                  onChange={(patch) => dispatch({ type: 'address', patch })}
                  errors={addressErr}
                  config={config as StoreConfig | undefined}
                />
              </div>
            )
          ) : null}
          {showSaveAddress ? (
            <div className="mt-3 rounded-xl bg-subtle px-3.5 py-2.5">
              <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-[14px] font-bold">
                <input
                  type="checkbox"
                  className="h-5 w-5 flex-none accent-[rgb(var(--secondary))]"
                  checked={extras.saveAddress}
                  onChange={(e) => setExtras((x) => ({ ...x, saveAddress: e.target.checked }))}
                />
                {t('checkout.saveThisAddress')}
              </label>
              {extras.saveAddress ? (
                <div
                  role="radiogroup"
                  aria-label={t('addr.labelLabel')}
                  className="mt-1 flex flex-wrap gap-2 pl-8"
                >
                  {(['home', 'work', 'other'] as const).map((label) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={extras.addressLabel === label}
                      onClick={() => setExtras((x) => ({ ...x, addressLabel: label }))}
                      className={cn(
                        'min-h-[34px] rounded-full border px-3 text-[13px] font-extrabold',
                        extras.addressLabel === label
                          ? 'border-secondary bg-secondary text-onsecondary'
                          : 'border-line bg-surface',
                      )}
                    >
                      {t(`addr.labels.${label}`)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!customer ? (
        <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
          <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-[14px] font-bold">
            <input
              type="checkbox"
              className="h-5 w-5 flex-none accent-[rgb(var(--secondary))]"
              checked={extras.remember}
              onChange={(e) => setExtras((x) => ({ ...x, remember: e.target.checked }))}
            />
            {t('checkout.rememberDevice')}
          </label>
          <p className="m-0 pl-8 text-[12px] leading-snug text-muted">
            {t('checkout.rememberHelp')}
          </p>
        </div>
      ) : null}
    </section>
  );
}
