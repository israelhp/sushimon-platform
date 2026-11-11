'use client';

import { ChevronRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useHappyHour } from '@/features/promos/use-happy-hour';
import { useHappyHourLabels } from '@/features/promos/use-happy-hour-labels';
import { STORE_ROUTES } from '@/features/store-shell/nav';

/**
 * Acceso al Happy Hour (solo en "Todo"). Muestra los días y horas de la promoción; una insignia indica
 * si está en curso ahora o ya finalizó según el reloj de la demo. Sin promoción cargada no se muestra.
 */
export function MenuHappyBanner() {
  const t = useTranslations('menu');
  const { promotion, phase } = useHappyHour();
  const labels = useHappyHourLabels(promotion, phase);
  if (!promotion || !labels) return null;
  const live = phase?.kind === 'live';
  const over = phase?.kind === 'expired' || phase?.kind === 'inactive';
  return (
    <Link
      href={STORE_ROUTES.promos}
      className={cn(
        'mb-5 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-fg no-underline shadow-card transition hover:-translate-y-0.5 hover:shadow-lift',
        over && 'opacity-70',
      )}
    >
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-onprimary">
        <Clock className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="flex items-center gap-2 font-display text-base uppercase">
          Happy Hour
          {live ? (
            <span className="rounded-full bg-success px-2 py-0.5 font-sans text-[11px] font-extrabold normal-case tracking-wide text-ondeep">
              {t('happyLive')}
            </span>
          ) : over ? (
            <span className="rounded-full bg-subtle px-2 py-0.5 font-sans text-[11px] font-extrabold normal-case tracking-wide text-muted">
              {t('happyOver')}
            </span>
          ) : null}
        </strong>
        <span className="block text-[13px] font-semibold leading-snug">{labels.longLine}</span>
      </span>
      <ChevronRight className="h-5 w-5 flex-none" aria-hidden="true" />
    </Link>
  );
}
