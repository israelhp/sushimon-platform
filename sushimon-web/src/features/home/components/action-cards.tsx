'use client';

import {
  ArrowRight,
  ChevronRight,
  LifeBuoy,
  PackageSearch,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useOrderSheet } from '@/features/store-shell/store-shell-context';

const CARD =
  'relative flex min-h-[100px] min-w-0 flex-col items-start justify-between gap-2 rounded-3xl p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0.5 max-[359px]:min-h-[92px] min-[400px]:p-3.5 sm:min-h-[96px] sm:flex-row sm:items-center sm:justify-start sm:gap-4 sm:p-5';
const OUTLINE = 'border-[1.5px] border-secondary/70 bg-surface text-fg no-underline';
const ICON_BOX =
  'flex h-9 w-9 flex-none items-center justify-center rounded-xl min-[400px]:h-10 min-[400px]:w-10 sm:h-14 sm:w-14 sm:rounded-2xl';
const TITLE =
  'disp block text-[clamp(14px,4.6vw,20px)] leading-[1.05] sm:text-[22px] sm:leading-none lg:text-[28px]';
const SUB =
  'mt-1 block text-[11.5px] font-semibold leading-tight max-[359px]:text-[10px] min-[400px]:text-[12.5px] sm:text-sm';
const ARROW = 'absolute right-3 top-3 h-5 w-5 flex-none sm:static sm:h-6 sm:w-6';

function CardBody({
  icon,
  iconClass,
  title,
  sub,
  subClass,
  nowrap,
}: {
  icon: ReactNode;
  iconClass: string;
  title: string;
  sub: string;
  subClass?: string;
  nowrap?: boolean;
}) {
  return (
    <>
      <span className={cn(ICON_BOX, iconClass)}>{icon}</span>
      <span className="min-w-0 sm:flex-1">
        <strong className={cn(TITLE, nowrap && 'whitespace-nowrap')}>{title}</strong>
        <span className={cn(SUB, subClass ?? 'text-muted')}>{sub}</span>
      </span>
      <ArrowRight className={ARROW} aria-hidden="true" />
    </>
  );
}

/** "¿Tenés hambre?": Pedir ahora, Consultá tu orden y Reclamo (+ el modo de pedido actual si ya se eligió). */
export function ActionCards() {
  const t = useTranslations();
  const orderSheet = useOrderSheet();
  const { mode, isSet } = useOrderMode();

  return (
    <section aria-labelledby="hambre" className="grid grid-cols-2 gap-3 sm:gap-4">
      <div className="col-span-2 -mb-1 flex items-baseline gap-2">
        <h2 id="hambre" className="disp text-[22px] sm:text-[28px]">
          {t('home.hungry')}
        </h2>
        <p className="text-[14px] text-muted max-[379px]:hidden">{t('home.chooseOption')}</p>
      </div>
      <div className="col-span-2 grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => orderSheet.open()}
          className={cn(CARD, 'col-span-2 bg-primary text-onprimary')}
        >
          <CardBody
            nowrap
            icon={<ShoppingBag className="h-5 w-5 sm:h-7 sm:w-7" aria-hidden="true" />}
            iconClass="bg-white/20"
            title={t('home.orderNow')}
            sub={t('home.orderNowSub')}
            subClass="text-white dark:text-[rgb(var(--on-band-amber))]"
          />
        </button>
        <Link href={STORE_ROUTES.track} className={cn(CARD, OUTLINE)}>
          <CardBody
            icon={<PackageSearch className="h-5 w-5 sm:h-7 sm:w-7" aria-hidden="true" />}
            iconClass="bg-primary text-onprimary"
            title={t('home.trackTitle')}
            sub={t('home.trackSub')}
          />
        </Link>
        <Link href={STORE_ROUTES.incidents} className={cn(CARD, OUTLINE)}>
          <CardBody
            icon={<LifeBuoy className="h-5 w-5 sm:h-7 sm:w-7" aria-hidden="true" />}
            iconClass="bg-secondary text-onsecondary"
            title={t('home.helpTitle')}
            sub={t('home.helpSub')}
          />
        </Link>
      </div>
      {isSet ? (
        <Link
          href={STORE_ROUTES.menu}
          className="col-span-2 flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-fg no-underline shadow-card transition hover:shadow-lift"
        >
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 text-[14px] leading-snug">
            <span className="block">
              {t('home.current')} <strong>{t('mode.delivery')}</strong>
            </span>
            <span className="block text-[13px] text-muted">
              {mode.address
                ? [mode.address.line, mode.address.municipality].filter(Boolean).join(', ')
                : ''}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
          <span className="sr-only">{t('common.goMenu')}</span>
        </Link>
      ) : null}
    </section>
  );
}
