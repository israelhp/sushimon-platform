'use client';

import { Navigation, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import type { StoreConfig } from '@/lib/data-access/models';
import { useStoreConfig } from '@/features/store/hooks';
import { STORE_ROUTES } from '../nav';

const linkClass =
  'flex min-h-[36px] items-center py-1.5 text-[15px] font-medium text-ondeep no-underline hover:text-accent';
const headingClass = 'mb-3.5 text-[13px] font-bold uppercase tracking-[0.14em] text-accent';
const placeClass = (dark: boolean) =>
  cn(
    'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-extrabold no-underline transition',
    dark
      ? 'border-ondeep/40 text-ondeep hover:bg-ondeep hover:text-deep'
      : 'border-line bg-surface text-fg hover:bg-subtle',
  );

/** Enlaces a Google Maps y Waze (se abren en otra pestaña). `dark` = sobre fondo oscuro. */
export function MapLinks({
  config,
  dark = false,
  className,
}: {
  config: Pick<StoreConfig, 'mapsUrl' | 'wazeUrl'>;
  dark?: boolean;
  className?: string;
}) {
  const t = useTranslations('location');
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <a
        className={placeClass(dark)}
        href={config.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('mapsAria')}
      >
        <MapPin className="h-4 w-4" aria-hidden="true" /> Google Maps
      </a>
      <a
        className={placeClass(dark)}
        href={config.wazeUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('wazeAria')}
      >
        <Navigation className="h-4 w-4" aria-hidden="true" /> Waze
      </a>
    </div>
  );
}

/** Horario de la marca (lunes a jueves, viernes y sábado, domingo) desde `StoreConfig.openingHours`. */
export function OpeningHours({
  config,
  className,
  itemClass,
}: {
  config: Pick<StoreConfig, 'openingHours'>;
  className?: string;
  itemClass?: string;
}) {
  const t = useTranslations('hours');
  const locale = useLocale();
  return (
    <ul className={cn('m-0 list-none p-0', className)}>
      {config.openingHours.map((h) => (
        <li key={h.key} className={cn('flex flex-wrap justify-between gap-x-3', itemClass)}>
          <strong>{t(h.key)}</strong>
          <span className="whitespace-nowrap">
            {formatClock(h.open, locale).replace(/ ?[ap]\. ?m\./, '')} –{' '}
            {formatClock(h.close, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FooterSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-5 w-40 bg-ondeep/15" />
      <Skeleton className="h-5 w-32 bg-ondeep/15" />
      <Skeleton className="h-5 w-36 bg-ondeep/15" />
    </div>
  );
}

/** Pie de la tienda: marca, navegación, contacto, ubicación/horario y aviso de privacidad (demostración). */
export function StoreFooter() {
  const t = useTranslations();
  const config = useStoreConfig();
  const data = config.data;
  const year = data ? new Date(data.serverTime).getUTCFullYear() : null;
  const whatsapp = data ? data.whatsappOrdersNumber.replace(/\D/g, '') : '';

  return (
    <footer className="relative mt-auto overflow-hidden bg-deep pb-7 pt-14 text-ondeep">
      <span
        className="pointer-events-none absolute -bottom-10 -right-4 font-jp text-[150px] leading-none text-ondeep/[0.05] sm:text-[240px]"
        aria-hidden="true"
      >
        寿司
      </span>
      <div className="wrap relative">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <div className="mb-4">
              <Logo onDark size="footer" />
            </div>
            <p className="text-[15px] leading-relaxed text-ondeep/75">{t('footer.tagline')}</p>
          </div>

          <nav aria-labelledby="footer-nav">
            <h2 id="footer-nav" className={headingClass}>
              {t('footer.navigate')}
            </h2>
            <Link className={linkClass} href={STORE_ROUTES.home}>
              {t('nav.home')}
            </Link>
            <Link className={linkClass} href={STORE_ROUTES.menu}>
              {t('nav.menu')}
            </Link>
            <Link className={linkClass} href={STORE_ROUTES.promos}>
              {t('nav.promotions')}
            </Link>
            <Link className={linkClass} href={STORE_ROUTES.careers}>
              {t('nav.careers')}
            </Link>
            <Link className={linkClass} href={STORE_ROUTES.track}>
              {t('track.title')}
            </Link>
            <Link className={linkClass} href={STORE_ROUTES.incidents}>
              {t('incidents.title')}
            </Link>
            <Link className={linkClass} href={STORE_ROUTES.account}>
              {t('account.title')}
            </Link>
          </nav>

          <div>
            <h2 className={headingClass}>{t('footer.contact')}</h2>
            {data ? (
              <>
                <a
                  className={linkClass}
                  href={data.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Instagram {data.instagramHandle}
                </a>
                <a className={linkClass} href={data.phoneHref}>
                  {t('footer.phone')} {data.phoneDisplay}
                </a>
                {whatsapp ? (
                  <a
                    className={linkClass}
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp {data.phoneDisplay}
                  </a>
                ) : null}
              </>
            ) : config.isError ? (
              <FooterError onRetry={() => void config.refetch()} />
            ) : (
              <FooterSkeleton />
            )}
          </div>

          <div>
            <h2 className={headingClass}>{t('footer.visit')}</h2>
            <p className="py-1.5 text-[15px] font-bold text-ondeep">{t('location.place')}</p>
            {data ? (
              <>
                <MapLinks config={data} dark className="mb-3 mt-1" />
                <h3 className={cn(headingClass, 'mb-1.5 mt-2')}>{t('hours.title')}</h3>
                <OpeningHours
                  config={data}
                  className="text-[14px] leading-relaxed text-ondeep/75"
                  itemClass="py-0.5 [&>strong]:text-ondeep"
                />
              </>
            ) : config.isError ? null : (
              <FooterSkeleton />
            )}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap justify-between gap-5 border-t border-ondeep/15 pb-[env(safe-area-inset-bottom)] pt-5 text-[13px] text-ondeep/65">
          <details className="max-w-[640px]">
            <summary className="cursor-pointer py-1.5 font-bold text-ondeep">
              {t('footer.privacy')}
            </summary>
            <p className="mt-2 leading-relaxed">{t('footer.privacyText')}</p>
          </details>
          <span>
            © {year ? `${year} ` : ''}MON SUSHI · {t('footer.rights')}
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('ui');
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-[14px] text-ondeep/75">
      <p className="m-0">{t('errorTitle')}</p>
      <Button
        size="sm"
        variant="outline"
        className="border-ondeep/40 text-ondeep"
        onClick={onRetry}
      >
        {t('retry')}
      </Button>
    </div>
  );
}
