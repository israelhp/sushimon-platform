'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { LocaleToggle } from '@/i18n/LocaleToggle';
import { cn } from '@/lib/cn';
import { useCart } from '@/features/cart/cart-context';
import {
  isMoreActive,
  isRouteActive,
  MORE_ICON,
  ORDER_ICON,
  PRIMARY_NAV,
  STORE_ROUTES,
} from '../nav';
import { useStoreShell } from '../store-shell-context';
import { AccountButton } from './AccountButton';
import { OrderModeButton } from './OrderModeButton';

const navItemClass = (active: boolean) =>
  cn(
    'relative inline-flex h-full items-center gap-2 px-3.5 text-[15px] font-bold no-underline transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-full after:transition-colors xl:px-4',
    active ? 'text-fg after:bg-primary' : 'text-muted after:bg-transparent hover:text-fg',
  );

/** Encabezado fijo de la tienda: logo, navegación (escritorio), idioma, tema, modo de pedido y cuenta. */
export function StoreHeader() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { count } = useCart();
  const { cartOpen, openCart } = useStoreShell();
  const OrderIcon = ORDER_ICON;
  const MoreIcon = MORE_ICON;
  const moreActive = isMoreActive(pathname) && !cartOpen;

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex h-[64px] w-full max-w-[1440px] items-center gap-2 px-3 max-[339px]:gap-1.5 max-[339px]:px-2 min-[400px]:px-4 sm:gap-3 sm:px-5 md:h-[72px] lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4 lg:px-8">
        <Link
          href={STORE_ROUTES.home}
          aria-label={t('goHome')}
          className="flex flex-none items-center text-fg no-underline"
        >
          <Logo priority />
        </Link>

        <nav aria-label={t('main')} className="hidden h-full items-stretch lg:flex">
          {PRIMARY_NAV.map((item) => {
            const active = isRouteActive(pathname, item) && !cartOpen;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={navItemClass(active)}
              >
                <item.Icon className="h-5 w-5" aria-hidden="true" />
                {t(item.label)}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openCart}
            aria-label={t('viewOrder', { a: count })}
            aria-haspopup="dialog"
            aria-expanded={cartOpen}
            className={navItemClass(cartOpen)}
          >
            <span className="relative inline-flex">
              <OrderIcon className="h-5 w-5" aria-hidden="true" />
              {count > 0 ? (
                <span
                  key={count}
                  aria-hidden="true"
                  className="anim-bump absolute -right-2.5 -top-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold text-onprimary after:content-[attr(data-count)]"
                  data-count={count}
                ></span>
              ) : null}
            </span>
            {t('order')}
          </button>
          <Link
            href={STORE_ROUTES.more}
            aria-current={moreActive ? 'page' : undefined}
            className={navItemClass(moreActive)}
          >
            <MoreIcon className="h-5 w-5" aria-hidden="true" />
            {t('more')}
          </Link>
        </nav>

        <div className="ml-auto flex min-w-0 items-center justify-end gap-1 min-[400px]:gap-1.5 sm:gap-2 lg:ml-0">
          <LocaleToggle />
          <ThemeToggle />
          <OrderModeButton className="max-w-[46vw] sm:max-w-[240px]" />
          <AccountButton className="hidden min-[440px]:inline-flex" />
        </div>
      </div>
    </header>
  );
}
