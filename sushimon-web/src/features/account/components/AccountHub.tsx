'use client';

import {
  ClipboardList,
  Heart,
  History,
  LifeBuoy,
  LogOut,
  MapPin,
  PackageSearch,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/session/auth-provider';
import { useIdentity } from '@/features/session/auth-queries';
import { useDemoSession } from '@/features/session/demo-session';
import { Avatar } from '@/features/store-shell/components/Avatar';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import { addressTitle } from '../address-format';
import { useAddressLabels } from '../use-address-labels';
import { useFavoriteIds } from '@/features/favorites/hooks';
import { useAddresses, useMe } from '../hooks';
import { HubCard } from './HubCard';

function Heading() {
  const t = useTranslations('account');
  return (
    <h1 className="disp mb-4 text-[clamp(30px,6vw,48px)]">
      {t('title')}{' '}
      <span
        className="ml-1 align-middle font-jp text-[0.4em] tracking-[0.2em] text-primary"
        lang="ja"
      >
        {t('jp')}
      </span>
    </h1>
  );
}

/** Hub de la cuenta: con sesión (de demostración) muestra el perfil y las secciones; sin sesión invita a entrar. */
export function AccountHub() {
  const auth = useAuth();
  const { customer } = useDemoSession();
  if (auth.mode === 'supabase') return <RealAccountHub />;
  return customer ? <SignedInHub name={customer.name} email={customer.email} /> : <SignedOutHub />;
}

/**
 * Cuenta con Supabase Auth real: perfil de `GET /v1/me` y secciones de datos, direcciones, favoritos (F04–F06) y pedidos (F23).
 * El hub NO consulta pedidos: la sección «Mis pedidos» pide su historial al abrirla (sin llamadas innecesarias al abrir Mi cuenta).
 */
function RealAccountHub() {
  const tAuth = useTranslations('auth');
  const auth = useAuth();
  const me = useIdentity();
  if (auth.status === 'loading' || (auth.status === 'authenticated' && me.isPending)) {
    return (
      <div className="wrap max-w-[720px] pb-10 pt-5 sm:pt-8" role="status">
        <Heading />
        <p className="m-0 text-muted">{tAuth('loadingSession')}</p>
      </div>
    );
  }
  if (auth.status === 'anonymous' || me.isError || !me.data) return <SignedOutHub />;
  const { customer, email } = me.data;
  return <SignedInHub name={customer.fullName} email={email ?? customer.email ?? ''} real />;
}

function SignedOutHub() {
  const t = useTranslations('account');
  const tAuth = useTranslations('auth');
  const tHub = useTranslations('hub');
  const auth = useAuthModal();
  const benefits: { Icon: typeof ClipboardList; text: string }[] = [
    { Icon: ClipboardList, text: tAuth('benefitTrack') },
    { Icon: History, text: tAuth('benefitHistory') },
    { Icon: LifeBuoy, text: tAuth('benefitIncidents') },
  ];
  return (
    <div className="wrap max-w-[720px] pb-10 pt-5 sm:pt-8">
      <Heading />
      <section className="seigaiha seigaiha-sky relative overflow-hidden rounded-3xl p-5 text-white shadow-card sm:p-7">
        <h2 className="disp text-[24px] sm:text-[30px]">{t('signedOutTitle')}</h2>
        <p className="m-0 mt-1.5 max-w-[54ch] text-[15px] text-white/90">{t('signedOutText')}</p>
        <button
          type="button"
          onClick={auth.open}
          className="btn mt-4 !border-transparent !bg-white !text-neutral-900"
        >
          <GoogleLogo /> {tAuth('continueGoogle')}
        </button>
        {useAuth().mode === 'mock' ? <SimulationBadge className="ml-2 align-middle" /> : null}
      </section>
      <ul className="m-0 mt-4 grid list-none gap-2.5 p-0 sm:grid-cols-3">
        {benefits.map(({ Icon, text }) => (
          <li
            key={text}
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-[14px] font-bold shadow-card"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2.5">
        <HubCard
          href="/cuenta/favoritos"
          icon={<Heart className="h-5 w-5" aria-hidden="true" />}
          title={tHub('favorites')}
          sub={tHub('favoritesSub', { a: 0 })}
        />
        <Link
          href={STORE_ROUTES.track}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-fg no-underline hover:bg-subtle"
        >
          <PackageSearch className="h-5 w-5 flex-none text-secondary" aria-hidden="true" />
          <span className="text-[14px] font-bold leading-snug">{t('guestTrack')}</span>
        </Link>
      </div>
    </div>
  );
}

function SignedInHub({
  name,
  email,
  real = false,
}: {
  name: string;
  email: string;
  /** Supabase Auth real: sin insignia de simulación y con cierre de sesión real. */
  real?: boolean;
}) {
  const t = useTranslations('account');
  const tAuth = useTranslations('auth');
  const tHub = useTranslations('hub');
  const tAddr = useTranslations('addr');
  const tTrack = useTranslations('track');
  const tOrders = useTranslations('orders');
  const session = useDemoSession();
  const { notify } = useToast();
  const me = useMe();
  const addresses = useAddresses();
  const favorites = useFavoriteIds();
  const auth = useAuth();

  const profile = me.data;
  const ready = !!profile && !!addresses.data && favorites.isLoaded;
  const labels = useAddressLabels();
  const defaultAddress = addresses.data?.find((a) => a.isDefault);

  const addressesSub = ready
    ? defaultAddress
      ? `${tHub('addressesSub', { a: addresses.data.length })} · ${tAddr('isDefault')}: ${addressTitle(defaultAddress, labels)}`
      : tHub('addressesSub', { a: addresses.data.length })
    : tHub('loading');
  const personalSub = ready
    ? profile.phone && profile.email
      ? `${profile.phone} · ${profile.email}`
      : tHub('personalEmpty')
    : tHub('loading');

  const icon = (Icon: typeof UserRound): ReactNode => (
    <Icon className="h-5 w-5" aria-hidden="true" />
  );

  return (
    <div className="wrap max-w-[760px] pb-10 pt-5 sm:pt-8">
      <Heading />
      <section className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <Avatar name={name} className="h-12 w-12 text-[16px]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate font-extrabold">{profile?.fullName || name}</p>
          <p className="m-0 truncate text-[13px] text-muted">{email}</p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-muted">
            <GoogleLogo className="h-3.5 w-3.5" /> {real ? t('realProfile') : tAuth('viaGoogle')}
            {real ? null : <SimulationBadge />}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (real) {
              void auth.signOut();
              return;
            }
            session.signOutCustomer();
            notify(tAuth('signedOut'));
          }}
          aria-label={tAuth('signOut')}
          className="btn !min-h-[40px] flex-none !px-3 text-sm min-[420px]:!px-4"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />{' '}
          <span className="max-[419px]:hidden">{tAuth('signOut')}</span>
        </button>
      </section>

      {me.isError || addresses.isError || favorites.isError ? (
        <ErrorNotice
          className="mt-4"
          message={tHub('loadError')}
          onRetry={() => {
            void me.refetch();
            void addresses.refetch();
            favorites.refetch();
          }}
        />
      ) : null}

      <nav aria-label={t('title')} className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <HubCard
          href="/cuenta/datos"
          icon={icon(UserRound)}
          title={tHub('personal')}
          sub={personalSub}
        />
        <HubCard
          href="/cuenta/direcciones"
          icon={icon(MapPin)}
          title={tHub('addresses')}
          sub={addressesSub}
        />
        <HubCard
          href="/cuenta/favoritos"
          icon={icon(Heart)}
          title={tHub('favorites')}
          sub={ready ? tHub('favoritesSub', { a: favorites.total }) : tHub('loading')}
        />
        <HubCard
          href="/cuenta/pedidos"
          icon={icon(ClipboardList)}
          title={tHub('orders')}
          sub={tHub('ordersSub')}
        />
      </nav>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <Link href={STORE_ROUTES.track} className="btn w-full no-underline">
          <PackageSearch className="h-4 w-4" aria-hidden="true" /> {tTrack('title')}
        </Link>
        <Link href={STORE_ROUTES.incidents} className="btn w-full no-underline">
          <LifeBuoy className="h-4 w-4" aria-hidden="true" /> {tOrders('report')}
        </Link>
      </div>
    </div>
  );
}
