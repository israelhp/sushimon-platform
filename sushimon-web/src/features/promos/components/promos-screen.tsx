'use client';

import { CalendarDays, Clock, Store, Tag, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { EmptyState } from '@/components/ui/EmptyState';
import { Price } from '@/components/ui/Price';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import type { StorePromotion } from '@/lib/data-access/models';
import { formatDate, formatMoney } from '@/lib/format';
import { priceToNumber } from '@/lib/product-rules';
import { useProducts } from '@/features/catalog/hooks';
import { foodArtKind, productName, tileClass } from '@/features/catalog/localized';
import { usePublicBranches } from '@/features/branches/hooks';
import { useOptionalOrderMode } from '@/features/order-mode/order-mode-context';
import { useStorePromotions } from '@/features/promotions/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useStoreConfig } from '@/features/store/hooks';
import { groupByCategory, happyHourPhase, lastIncludedInstant, percentText } from '../happy-hour';
import { useHappyHourLabels } from '../use-happy-hour-labels';

/**
 * Promociones de la tienda (F15) por sucursal: Happy Hour (días, horas y precios indicativos), promociones vigentes, cupones
 * («requiere código», sin código ni descuento) y próximas. SOLO se muestra lo que la API devuelve: la UI no calcula vigencia ni
 * precios. Sin compra en línea desde aquí: el descuento definitivo lo fija el servidor al pedir (F19+) y no aplica a extras.
 */
export function PromosScreen() {
  const t = useTranslations('promos');
  const tu = useTranslations('ui');
  const selectId = useId();
  const branches = usePublicBranches();
  const mode = useOptionalOrderMode()?.mode.branchId ?? null;
  const [chosen, setChosen] = useState<string | null>(null);
  const list = useMemo(() => branches.data ?? [], [branches.data]);
  // Sucursal elegida en la página > la del modo de pedido > la primera activa (visible y cambiable en el selector).
  const branchId =
    [chosen, mode].find((id) => id && list.some((b) => b.id === id)) ?? list[0]?.id ?? null;

  const live = useStorePromotions(branchId, 'live');
  const upcoming = useStorePromotions(branchId, 'upcoming');
  const config = useStoreConfig();

  const liveItems = useMemo(() => live.data?.items ?? [], [live.data]);
  const upcomingItems = useMemo(() => upcoming.data?.items ?? [], [upcoming.data]);
  const happy = [...liveItems, ...upcomingItems].filter((p) => p.isHappyHour);
  const others = liveItems.filter((p) => !p.isHappyHour && !p.requiresCode);
  const coupons = liveItems.filter((p) => p.requiresCode);
  const soon = upcomingItems.filter((p) => !p.isHappyHour);
  const pending =
    branches.isPending || (Boolean(branchId) && (live.isPending || upcoming.isPending));
  const failed = branches.isError || live.isError || upcoming.isError;
  const empty = happy.length + others.length + coupons.length + soon.length === 0;
  const retry = () => {
    void branches.refetch();
    void live.refetch();
    void upcoming.refetch();
  };
  const first = happy[0];
  const firstLabels = useHappyHourLabels(
    first,
    first ? happyHourPhase(first) : null,
    live.data?.generatedAt ?? null,
  );
  const anyDineIn = [...happy, ...others, ...soon].some((p) => p.dineInOnly);
  const anyItems = happy.some((p) => (p.items?.length ?? 0) > 0);

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
              {t('titleA')} <span className="text-outline-dark">{t('titleB')}</span>
            </h1>
            {firstLabels ? (
              <p className="mt-1.5 truncate text-[14px] font-semibold text-neutral-900/85 sm:text-base">
                <span className="sm:hidden">{firstLabels.shortLine}</span>
                <span className="hidden sm:inline">{firstLabels.longLine}</span>
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
        {list.length > 0 ? (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <label htmlFor={selectId} className="text-[15px] font-extrabold">
              {t('branchLabel')}
            </label>
            <select
              id={selectId}
              className="input !w-auto min-w-[220px]"
              value={branchId ?? ''}
              onChange={(e) => setChosen(e.target.value)}
            >
              {list.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {pending ? (
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
        ) : failed ? (
          <ErrorNotice onRetry={retry} />
        ) : empty ? (
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
            <div className="notice">
              <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
              <div>
                {anyItems ? `${t('indicativeNote')} ` : ''}
                {t('extrasNote')}
                {anyDineIn ? ` ${t('disclaimerSuffix')}` : ''}
              </div>
            </div>

            {happy.map((p) => (
              <HappyHourSection
                key={p.id}
                promotion={p}
                generatedAt={live.data?.generatedAt ?? null}
              />
            ))}
            {others.length > 0 ? <PromoList title={t('sectionLive')} promotions={others} /> : null}
            {coupons.length > 0 ? (
              <PromoList title={t('sectionCoupons')} promotions={coupons} />
            ) : null}
            {soon.length > 0 ? <PromoList title={t('sectionUpcoming')} promotions={soon} /> : null}

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

/** Texto del descuento a partir de `kind`/`value` que dio la API (nunca de un cupón). */
function useDiscountText() {
  const t = useTranslations('promos');
  return (p: Pick<StorePromotion, 'kind' | 'value'>): string | null => {
    if (!p.kind || !p.value) return null;
    return p.kind === 'PERCENT'
      ? t('discountPercent', { value: percentText(p.value) })
      : t('discountFixed', { value: formatMoney(priceToNumber(p.value)) });
  };
}

/** Chips de días, horas, condición y estado de una promoción con horario. */
function HappyHourSection({
  promotion,
  generatedAt,
}: {
  promotion: StorePromotion;
  generatedAt: string | null;
}) {
  const t = useTranslations('promos');
  const locale = useLocale();
  const discount = useDiscountText()(promotion);
  const phase = happyHourPhase(promotion);
  const labels = useHappyHourLabels(promotion, phase, generatedAt);
  const catalog = useProducts({ branchId: null });
  const live = promotion.state === 'live';
  const headingId = `hh-${promotion.id}`;
  const products = useMemo(
    () => new Map((catalog.data ?? []).map((p) => [p.id, p])),
    [catalog.data],
  );
  const entries = useMemo(
    () =>
      (promotion.items ?? []).flatMap((item) => {
        const product = products.get(item.productId);
        return product ? [{ item, product }] : [];
      }),
    [promotion.items, products],
  );
  const groups = groupByCategory(entries, (e) => e.product.category.name);
  if (!labels) return null;
  return (
    <section className="mt-9" aria-labelledby={headingId} data-promotion={promotion.id}>
      <h2 id={headingId} className="disp mb-2 text-[34px]">
        {promotion.name}
      </h2>
      {promotion.description ? (
        <p className="mb-4 text-[19px] font-medium sm:text-[21px]">{promotion.description}</p>
      ) : null}
      <ul className="m-0 mb-6 flex list-none flex-wrap gap-2.5 p-0 sm:gap-3">
        {labels.lines.flatMap((line, i) => [
          <Chip key={`d${i}`} icon={<CalendarDays />} label={line.days} />,
          <Chip key={`h${i}`} icon={<Clock />} label={line.hours} />,
        ])}
        {discount ? <Chip icon={<Tag />} label={discount} /> : null}
        {promotion.dineInOnly ? <Chip icon={<Store />} label={t('validDineIn')} /> : null}
        {labels.status ? (
          <li
            data-phase={phase?.kind}
            className={cn(
              'flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-extrabold sm:text-[15px]',
              live ? 'bg-success text-ondeep' : 'bg-accent-soft text-fg',
            )}
          >
            {labels.status}
          </li>
        ) : null}
      </ul>
      {groups.map(({ category, items }) => (
        <section key={category} className="mt-8" aria-labelledby={`${headingId}-${category}`}>
          <h3 id={`${headingId}-${category}`} className="disp mb-[18px] text-[26px]">
            {category}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:gap-[22px] md:grid-cols-3 xl:grid-cols-4">
            {items.map(({ item, product }) => (
              <article key={item.productId} className="card">
                <div
                  className={cn(
                    tileClass(catalog.data ?? [], product.id),
                    'relative flex h-[130px] items-center justify-center sm:h-[190px]',
                  )}
                >
                  <FoodArt kind={foodArtKind(product.illustration)} className="h-[82%] w-auto" />
                  {promotion.dineInOnly ? (
                    <span className="absolute left-2 top-2 rounded-full bg-neutral-900 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white sm:left-3 sm:top-3 sm:px-2.5 sm:text-xs">
                      {t('onlyDineIn')}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-[18px]">
                  <h4 className="m-0 text-[15px] font-extrabold leading-tight sm:text-[19px]">
                    {productName(product, locale)}
                  </h4>
                  <div className="mt-auto pt-2.5">
                    <Price
                      value={priceToNumber(item.promoPrice)}
                      previous={priceToNumber(item.regularPrice)}
                      decimals={2}
                      className="text-primary"
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function Chip({ icon, label }: { icon: React.ReactElement; label: string }) {
  return (
    <li className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[14px] font-extrabold shadow-card sm:text-[15px]">
      <span
        className="h-[18px] w-[18px] text-secondary [&>svg]:h-full [&>svg]:w-full"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </li>
  );
}

/** Tarjetas de promociones sin tabla de precios: automáticas vigentes, cupones («requiere código») o próximas. */
function PromoList({ title, promotions }: { title: string; promotions: StorePromotion[] }) {
  const t = useTranslations('promos');
  const locale = useLocale();
  const discountText = useDiscountText();
  const id = useId();
  return (
    <section className="mt-11" aria-labelledby={id}>
      <h2 id={id} className="disp mb-[18px] text-[34px]">
        {title}
      </h2>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:gap-[22px] md:grid-cols-2 xl:grid-cols-3">
        {promotions.map((p) => {
          const discount = discountText(p);
          const upcomingStart = p.state === 'upcoming' ? (p.nextStartsAt ?? p.validFrom) : null;
          return (
            <li
              key={p.id}
              className="card flex flex-col gap-2 p-4 sm:p-[18px]"
              data-promotion={p.id}
            >
              <h3 className="m-0 text-[19px] font-extrabold leading-tight">{p.name}</h3>
              {p.description ? <p className="m-0 text-[15px]">{p.description}</p> : null}
              <div className="mt-auto flex flex-wrap gap-2 pt-2 text-[13px] font-extrabold">
                {p.requiresCode ? (
                  <span className="rounded-full bg-accent-soft px-3 py-1 text-fg">
                    {t('requiresCode')}
                  </span>
                ) : null}
                {discount ? (
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-fg">{discount}</span>
                ) : null}
                {p.dineInOnly ? (
                  <span className="rounded-full bg-subtle px-3 py-1 text-muted">
                    {t('onlyDineIn')}
                  </span>
                ) : null}
              </div>
              <p className="m-0 text-[13px] text-muted">
                {upcomingStart
                  ? t('startsOn', {
                      date: formatDate(upcomingStart, locale, { day: 'numeric', month: 'long' }),
                    })
                  : t('validUntil', {
                      date: formatDate(lastIncludedInstant(p.validUntil), locale, {
                        day: 'numeric',
                        month: 'long',
                      }),
                    })}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
