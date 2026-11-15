'use client';

import { Info, LoaderCircle, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { Address } from '@/lib/data-access/models';
import { addressLine, addressTitle, defaultAddressIdOf } from '../address-format';
import { useAddressLabels } from '../use-address-labels';
import { useAddresses, useDeleteAddress, useMe, useSetDefaultAddress } from '../hooks';
import { MAX_ADDRESSES } from '../validation';
import { AccountSection } from './AccountSection';
import { AddressFormModal, LABEL_ICONS } from './AddressFormModal';
import { CoverageChip } from './CoverageChip';
import { SectionEmpty } from './HubCard';

/** Direcciones guardadas: lista, predeterminada, agregar/editar y eliminar con confirmación. */
export function AddressesPage() {
  const t = useTranslations('addr');
  const locale = useLocale();
  const { notify } = useToast();
  const me = useMe();
  const addresses = useAddresses();
  const remove = useDeleteAddress();
  const makeDefault = useSetDefaultAddress();
  const [form, setForm] = useState<{ editing: Address | null } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = addresses.data ?? [];
  const defaultId = defaultAddressIdOf(addresses.data);
  const labels = useAddressLabels();
  const full = list.length >= MAX_ADDRESSES;
  const query = {
    isPending: addresses.isPending || me.isPending,
    isError: addresses.isError || me.isError,
    refetch: () => {
      void addresses.refetch();
      void me.refetch();
    },
  };

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await action();
      notify(done);
    } catch {
      notify(t('error'));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const addButton = (
    <button
      type="button"
      disabled={full}
      onClick={() => setForm({ editing: null })}
      className="btn btn-primary !min-h-[44px] !px-4 text-[15px]"
    >
      <Plus className="h-5 w-5" aria-hidden="true" /> {t('add')}
    </button>
  );

  return (
    <AccountSection title={t('title')} action={addButton} query={query}>
      {list.length > 0 ? (
        <p className="m-0 mb-2 text-right text-[12px] font-bold text-muted">
          {t('count', { a: list.length, b: MAX_ADDRESSES })}
        </p>
      ) : null}
      {full ? (
        <div className="notice notice-info mb-3" role="status">
          <Info className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>{t('limit', { a: MAX_ADDRESSES })}</div>
        </div>
      ) : null}

      {list.length === 0 ? (
        <SectionEmpty
          icon={<MapPin className="h-6 w-6" aria-hidden="true" />}
          title={t('empty')}
          text={t('emptySub')}
          action={
            <button
              type="button"
              onClick={() => setForm({ editing: null })}
              className="btn btn-primary !min-h-[44px]"
            >
              <Plus className="h-5 w-5" aria-hidden="true" /> {t('add')}
            </button>
          }
        />
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
          {list.map((address) => {
            const Icon = LABEL_ICONS[address.label];
            const isDefault = address.id === defaultId;
            const title = addressTitle(address, labels);
            return (
              <li
                key={address.id}
                className={cn(
                  'flex flex-col rounded-2xl border bg-surface p-4 shadow-card',
                  isDefault ? 'border-secondary/50 ring-1 ring-secondary/30' : 'border-line',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'flex h-10 w-10 flex-none items-center justify-center rounded-xl',
                      isDefault ? 'bg-secondary text-onsecondary' : 'bg-subtle text-secondary',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-2 font-extrabold">
                      {title}
                      {isDefault ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold text-fg">
                          <Star className="h-3 w-3" fill="currentColor" aria-hidden="true" />{' '}
                          {t('isDefault')}
                        </span>
                      ) : null}
                    </p>
                    <p className="m-0 mt-0.5 text-[14px] leading-snug">
                      {addressLine(address, locale)}
                    </p>
                    {address.references ? (
                      <p className="m-0 mt-0.5 text-[13px] text-muted">{address.references}</p>
                    ) : null}
                    <div className="mt-2">
                      <CoverageChip address={address} />
                    </div>
                  </div>
                </div>

                {confirmId === address.id ? (
                  <div
                    className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft p-2.5"
                    role="alert"
                  >
                    <span className="mr-auto text-[14px] font-bold">{t('confirmDelete')}</span>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="btn !min-h-[38px] !px-3 text-sm"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === address.id}
                      onClick={() =>
                        void run(address.id, () => remove.mutateAsync(address.id), t('deleted'))
                      }
                      className="btn !min-h-[38px] !border-transparent !bg-danger !px-3 text-sm !text-white"
                    >
                      {busyId === address.id ? (
                        <LoaderCircle className="anim-spin h-4 w-4" aria-hidden="true" />
                      ) : null}{' '}
                      {t('confirmYes')}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-dashed border-line pt-2">
                    <button
                      type="button"
                      onClick={() => setForm({ editing: address })}
                      aria-label={`${t('edit')}: ${title}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-sm font-extrabold text-secondary hover:bg-subtle"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" /> {t('edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(address.id)}
                      aria-label={`${t('delete')}: ${title}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-sm font-extrabold text-danger hover:bg-danger-soft"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('delete')}
                    </button>
                    {!isDefault ? (
                      <button
                        type="button"
                        disabled={busyId === address.id}
                        onClick={() =>
                          void run(
                            address.id,
                            () => makeDefault.mutateAsync(address.id),
                            t('defaultSet'),
                          )
                        }
                        aria-label={`${t('makeDefault')}: ${title}`}
                        className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-sm font-extrabold text-fg hover:bg-subtle"
                      >
                        <Star className="h-4 w-4" aria-hidden="true" /> {t('makeDefault')}
                      </button>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form ? (
        <AddressFormModal
          editing={form.editing}
          addresses={list}
          defaultAddressId={defaultId}
          onClose={() => setForm(null)}
        />
      ) : null}
    </AccountSection>
  );
}
