'use client';

import { CalendarDays, Clock, Store, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { FoodArt } from '@/components/art/FoodArt';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import type { HappyHourItem } from '@/lib/data-access/models';
import { foodArtKind, tileClass } from '@/features/catalog/localized';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useStoreConfig } from '@/features/store/hooks';
import { groupHappyHourItems } from '../happy-hour';
import { useHappyHour } from '../use-happy-hour';
import { useHappyHourLabels } from '../use-happy-hour-labels';

/**
 * Promociones: Happy Hour (lunes a jueves, solo en restaurante). Muestra días, horas y condiciones de la
 * promoción, su estado según el reloj de la demo (en curso / próxima / finalizada) y los precios por grupo.
 * No hay compra en línea de estos precios: es una promoción de consumo en el restaurante.
 */
export function PromosScreen() {
  const t = useTranslations('promos');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const { promotion, phase, isPending, isError, refetch } = useHappyHour();
  const labels = useHappyHourLabels(promotion, phase);
  const config = useStoreConfig();

  const groupLabel = (group: string) =>
    group === 'Entradas' || group === 'Rolls' || group === 'Cervezas'
      ? t(`groups.${group}`)
      : group;
  const ended = phase?.kind === 'expired' || phase?.kind === 'inactive';
  const live = phase?.kind === 'live';
  const subtitle = promotion?.subtitle?.[locale === 'en' ? 'en' : 'es'];
  const conditions = promotion?.conditions?.[locale === 'en' ? 'en' : 'es'];

  return (
    <>
      <section className="seigaiha seigaiha-accent relative flex h-[136px] items-center overflow-hidden sm:h-[160px] lg:h-[184px]">
        <div className="wrap flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p
              className="font-jp text-[12px] tracking-[0.3em] text-neutral-900/75 sm:text-[13px]"
              lang="ja"
            >
              {t('jp')}
            </p>
            <h1 className="disp mt-1 text-[clamp(30px,6.5vw,56px)]">
              Happy <span className="text-outline-dark">Hour</span>
            </h1>
            {labels ? (
              <p className="mt-1.5 truncate text-[14px] font-semibold text-neutral-900/85 sm:text-base">
                <span className="sm:hidden">{`${labels.shortLine}`}</span>
                <span className="hidden sm:inline">{labels.longLine}</span>
              </p>
            ) : null}
          </div>
          <span
            className="hanko h-16 w-16 flex-none rotate-[6deg] text-[20px] sm:h-24 sm:w-24 sm:text-[30px]"
            aria-hidden="true"
          >
            <span className="flex flex-col items-center leading-[1.05]">
              <span>お</span>
              <span>得</span>
            </span>
          </span>
        </div>
      </section>

      <div className="wrap pb-24 pt-8">
        {isPending ? (
          <div aria-busy="true" aria-label={tu('loading')}>
            <Skeleton className="mb-4 h-7 w-2/3" />
            <div className="mb-6 flex flex-wrap gap-3">
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-10 w-44 rounded-full" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-[22px] md:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-[260px] rounded-2xl" />
              ))}
            </div>
          </div>
        ) : isError ? (
          <ErrorNotice onRetry={refetch} />
        ) : !promotion || !labels ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptySub')}
            action={
              <Link href={STORE_ROUTES.menu} className="btn btn-primary !min-h-[44px]">
                {t('regularMenu')}
              </Link>
            }
          />
        ) : (
          <>
            {subtitle ? (
              <p className="mb-4 text-[19px] font-medium sm:text-[21px]">{subtitle}</p>
            ) : null}
            <ul className="m-0 mb-6 flex list-none flex-wrap gap-2.5 p-0 sm:gap-3">
              {[
                { Icon: CalendarDays, label: labels.days, key: 'days' },
                { Icon: Clock, label: labels.hours, key: 'hours' },
                { Icon: Store, label: t('validDineIn'), key: 'condition' },
              ].map(({ Icon, label, key }) => (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[14px] font-extrabold shadow-card sm:text-[15px]"
                >
                  <Icon className="h-[18px] w-[18px] text-secondary" aria-hidden="true" />
                  {label}
                </li>
              ))}
              {labels.status ? (
                <li
                  data-phase={phase?.kind}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-extrabold sm:text-[15px]',
                    live
                      ? 'bg-success text-ondeep'
                      : ended
                        ? 'bg-danger-soft text-danger'
                        : 'bg-accent-soft text-fg',
                  )}
                >
                  {labels.status}
                </li>
              ) : null}
            </ul>
            <div className="notice">
              <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
              <div>
                {conditions ? `${conditions} ` : ''}
                {t('disclaimerSuffix')}
              </div>
            </div>
            {ended ? (
              <p role="status" className="notice notice-warn mt-3">
                {t('expiredNotice')}
              </p>
            ) : null}

            {groupHappyHourItems(promotion.items).map(({ group, items }) => (
              <section key={group} className="mt-11" aria-labelledby={`promo-${group}`}>
                <h2 id={`promo-${group}`} className="disp mb-[18px] text-[34px]">
                  {groupLabel(group)}
                </h2>
                <div
                  className={cn(
                    'grid grid-cols-2 gap-3 sm:gap-[22px] md:grid-cols-3 xl:grid-cols-4',
                    ended && 'opacity-60',
                  )}
                >
                  {items.map((item) => (
                    <PromoCard
                      key={item.id}
                      item={item}
                      catalog={promotion.items}
                      schedule={labels.shortLine}
                      condition={t('validDineIn')}
                    />
                  ))}
                </div>
              </section>
            ))}

            <div className="mt-12 flex flex-wrap gap-3.5">
              {config.data ? (
                <>
                  <a
                    className="btn btn-primary"
                    href={config.data.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('directionsMaps')}
                  </a>
                  <a
                    className="btn"
                    href={config.data.wazeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('directionsWaze')}
                  </a>
                </>
              ) : null}
              <Link className="btn" href={STORE_ROUTES.menu}>
                {t('regularMenu')}
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Tarjeta de un ítem del Happy Hour: ilustración, insignia "Solo en restaurante", horario y precio. */
function PromoCard({
  item,
  catalog,
  schedule,
  condition,
}: {
  item: HappyHourItem;
  catalog: readonly HappyHourItem[];
  schedule: string;
  condition: string;
}) {
  const t = useTranslations('promos');
  const locale = useLocale();
  const name = locale === 'en' && item.nameEn ? item.nameEn : item.name;
  return (
    <article className="card">
      <div
        className={cn(
          tileClass(catalog, item.id),
          'relative flex h-[130px] items-center justify-center sm:h-[190px]',
        )}
      >
        <FoodArt kind={foodArtKind(item.illustration)} className="h-[82%] w-auto" />
        <span className="absolute left-2 top-2 rounded-full bg-neutral-900 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white sm:left-3 sm:top-3 sm:px-2.5 sm:text-xs">
          {t('onlyDineIn')}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-[18px]">
        <h3 className="m-0 text-[15px] font-extrabold leading-tight sm:text-[19px]">{name}</h3>
        <div className="flex flex-col gap-1 text-xs text-muted sm:text-[13px]">
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 flex-none" aria-hidden="true" />
            {schedule}
          </span>
          <span className="flex items-center gap-1.5">
            <Store className="h-4 w-4 flex-none" aria-hidden="true" />
            {condition}
          </span>
        </div>
        <div className="mt-auto flex flex-col gap-2 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="price text-primary">{item.priceLabel}</span>
        </div>
      </div>
    </article>
  );
}
