'use client';

import {
  Briefcase,
  ChevronRight,
  ClipboardList,
  Clock,
  Heart,
  LifeBuoy,
  MapPin,
  MessageCircle,
  PackageSearch,
  Phone,
  ShieldCheck,
  Tag,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Instagram } from '@/components/icons/store/Instagram';
import { useTheme } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Skeleton } from '@/components/ui/Skeleton';
import { LocaleToggle } from '@/i18n/LocaleToggle';
import { useAddresses, useMe } from '@/features/account/hooks';
import { useFavoriteIds } from '@/features/favorites/hooks';
import { PublicBranchesHours } from '@/features/branch-schedule/components/PublicBranchesHours';
import { useStoreConfig } from '@/features/store/hooks';
import { useDemoSession } from '@/features/session/demo-session';
import { Avatar } from '@/features/store-shell/components/Avatar';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { MapLinks, OpeningHours } from '@/features/store-shell/components/StoreFooter';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useAuthModal } from '@/features/store-shell/store-shell-context';

const group = 'mb-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-card';
const rowClass =
  'flex min-h-[64px] items-center gap-3 border-b border-line px-4 py-3 text-fg no-underline last:border-b-0 hover:bg-subtle';

function Row({
  icon,
  title,
  sub,
  href,
  external = false,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  href: string;
  external?: boolean;
}) {
  const content = (
    <>
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold">{title}</span>
        {sub ? <span className="block text-[13px] text-muted">{sub}</span> : null}
      </span>
      <ChevronRight className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
    </>
  );
  return external ? (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel="noopener noreferrer"
      className={rowClass}
    >
      {content}
    </a>
  ) : (
    <Link href={href} className={rowClass}>
      {content}
    </Link>
  );
}

const ic = (Icon: typeof Heart) => <Icon className="h-5 w-5" aria-hidden="true" />;

/** Hub "Más": cuenta, accesos (consultar, reclamos, promociones, empleo), contacto, preferencias y privacidad. */
export function MorePage() {
  const t = useTranslations();
  const { customer } = useDemoSession();
  const auth = useAuthModal();
  const { theme } = useTheme();
  const config = useStoreConfig();
  const me = useMe();
  const addresses = useAddresses();
  const favorites = useFavoriteIds();
  const data = config.data;
  const whatsapp = data ? data.whatsappOrdersNumber.replace(/\D/g, '') : '';
  const profile = me.data;

  return (
    <div className="wrap max-w-[720px] pt-5 sm:pt-8">
      <h1 className="disp mb-4 text-[clamp(32px,6vw,52px)]">
        {t('more.title')}{' '}
        <span
          className="ml-1 align-middle font-jp text-[0.4em] tracking-[0.2em] text-primary"
          lang="ja"
        >
          その他
        </span>
      </h1>

      <h2 className="eyebrow mb-2 text-secondary">{t('auth.account')}</h2>
      <div className={group}>
        {customer ? (
          <Link href={STORE_ROUTES.account} className={rowClass}>
            <Avatar name={customer.name} className="h-11 w-11 text-[14px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-extrabold">{customer.name}</span>
              <span className="block truncate text-[13px] text-muted">{customer.email}</span>
            </span>
            <ChevronRight className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={auth.open}
            className="flex min-h-[64px] w-full items-center gap-3 border-b border-line px-4 py-3 text-left hover:bg-subtle"
          >
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-line bg-white">
              <GoogleLogo />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">{t('auth.signIn')}</span>
              <span className="block text-[13px] text-muted">{t('auth.continueGoogle')}</span>
            </span>
            <ChevronRight className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
          </button>
        )}
        {customer ? (
          <>
            <Row
              icon={ic(UserRound)}
              title={t('hub.personal')}
              sub={profile?.phone ? `${profile.phone} · ${profile.email}` : t('hub.personalEmpty')}
              href="/cuenta/datos"
            />
            <Row
              icon={ic(MapPin)}
              title={t('hub.addresses')}
              sub={t('hub.addressesSub', { a: addresses.data?.length ?? 0 })}
              href="/cuenta/direcciones"
            />
          </>
        ) : null}
        <Row
          icon={ic(Heart)}
          title={t('hub.favorites')}
          sub={t('hub.favoritesSub', { a: customer ? favorites.total : 0 })}
          href="/cuenta/favoritos"
        />
        <Row
          icon={ic(ClipboardList)}
          title={t('account.myOrders')}
          sub={t('auth.benefitHistory')}
          href="/cuenta/pedidos"
        />
        <Row
          icon={ic(PackageSearch)}
          title={t('track.title')}
          sub={t('home.trackSub')}
          href={STORE_ROUTES.track}
        />
        <Row
          icon={ic(LifeBuoy)}
          title={t('incidents.title')}
          sub={t('incidents.homeSub')}
          href={STORE_ROUTES.incidents}
        />
      </div>

      <div className={group}>
        <Row
          icon={ic(Tag)}
          title={t('nav.promotions')}
          sub={t('more.promosSub')}
          href={STORE_ROUTES.promos}
        />
        <Row
          icon={ic(Briefcase)}
          title={t('nav.careers')}
          sub={t('more.careersSub')}
          href={STORE_ROUTES.careers}
        />
      </div>

      <h2 className="eyebrow mb-2 text-secondary">{t('more.preferences')}</h2>
      <div className={group}>
        <div className="flex min-h-[64px] items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="font-extrabold">{t('prefs.language')}</span>
          <LocaleToggle />
        </div>
        <div className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-3">
          <span className="font-extrabold">
            {t('more.themeLabel')}{' '}
            <span className="font-normal text-muted">
              · {theme === 'dark' ? t('more.dark') : t('more.light')}
            </span>
          </span>
          <ThemeToggle />
        </div>
      </div>

      <h2 className="eyebrow mb-2 text-secondary">
        {t('more.contact')}{' '}
        <span className="ml-1 font-jp tracking-[0.2em] text-primary" lang="ja">
          アクセス
        </span>
      </h2>
      <div className={group}>
        <div className="flex gap-3 border-b border-line px-4 py-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block font-extrabold">{t('location.place')}</span>
            <span className="block text-[13px] text-muted">{t('location.openIn')}</span>
            {data ? <MapLinks config={data} className="mt-2" /> : null}
          </div>
        </div>
        <div className="flex gap-3 border-b border-line px-4 py-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block font-extrabold">{t('hours.title')}</span>
            {data ? (
              <OpeningHours
                config={data}
                className="mt-0.5 text-[14px] text-muted"
                itemClass="py-0.5 [&>strong]:text-fg"
              />
            ) : config.isError ? (
              <ErrorNotice className="mt-2" onRetry={() => void config.refetch()} />
            ) : (
              <Skeleton aria-hidden="true" className="mt-1 h-16 w-full" />
            )}
          </div>
        </div>
        {data ? (
          <>
            <Row
              icon={<Instagram className="h-5 w-5" aria-hidden="true" />}
              title={data.instagramHandle}
              sub={t('more.instagram')}
              href={data.instagramUrl}
              external
            />
            <Row
              icon={ic(Phone)}
              title={data.phoneDisplay}
              sub={t('more.call')}
              href={data.phoneHref}
              external
            />
            {whatsapp ? (
              <Row
                icon={ic(MessageCircle)}
                title={`WhatsApp ${data.phoneDisplay}`}
                sub={t('more.whatsappSub')}
                href={`https://wa.me/${whatsapp}`}
                external
              />
            ) : null}
          </>
        ) : null}
      </div>

      <PublicBranchesHours />

      <details className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 font-extrabold [&::-webkit-details-marker]:hidden">
          <ShieldCheck className="h-5 w-5 text-secondary" aria-hidden="true" /> {t('more.privacy')}
        </summary>
        <p className="border-t border-line px-4 py-3 text-sm leading-relaxed text-muted">
          {t('more.privacyText')}
        </p>
      </details>
    </div>
  );
}
