'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useCart } from '@/features/cart/cart-context';
import { useDemoSession } from '@/features/session/demo-session';
import {
  isMoreActive,
  isRouteActive,
  MORE_ICON,
  ORDER_ICON,
  PRIMARY_NAV,
  STORE_ROUTES,
} from '../nav';
import { useStoreShell } from '../store-shell-context';
import { Avatar } from './Avatar';

const itemClass = (active: boolean) =>
  cn(
    'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold no-underline',
    active ? 'text-primary' : 'text-muted',
  );
const pillClass = (active: boolean) =>
  cn(
    'relative inline-flex h-8 w-12 items-center justify-center rounded-full',
    active ? 'bg-primary text-onprimary' : 'bg-transparent',
  );

/** Barra de navegación inferior (móvil y tablet, hasta `lg`). */
export function MobileNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { count } = useCart();
  const { cartOpen, openCart } = useStoreShell();
  const { customer } = useDemoSession();
  const OrderIcon = ORDER_ICON;
  const MoreIcon = MORE_ICON;
  const moreActive = isMoreActive(pathname) && !cartOpen;

  return (
    <nav
      aria-label={t('mainNav')}
      className="fixed inset-x-0 bottom-0 z-[65] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-[560px] items-stretch">
        {PRIMARY_NAV.map((item) => {
          const active = isRouteActive(pathname, item) && !cartOpen;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={itemClass(active)}
            >
              <span className={pillClass(active)}>
                <item.Icon className="h-[22px] w-[22px]" aria-hidden="true" />
              </span>
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
          className={itemClass(cartOpen)}
        >
          <span className={pillClass(cartOpen)}>
            <OrderIcon className="h-[22px] w-[22px]" aria-hidden="true" />
            {count > 0 ? (
              <span
                key={count}
                className="anim-bump absolute -right-0.5 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface bg-primary px-1 text-[10px] text-onprimary"
              >
                {count}
              </span>
            ) : null}
          </span>
          {t('order')}
        </button>
        <Link
          href={STORE_ROUTES.more}
          aria-current={moreActive ? 'page' : undefined}
          className={itemClass(moreActive)}
        >
          <span className={pillClass(moreActive)}>
            {customer ? (
              <Avatar name={customer.name} className="h-[26px] w-[26px] text-[10px]" />
            ) : (
              <MoreIcon className="h-[22px] w-[22px]" aria-hidden="true" />
            )}
          </span>
          {t('more')}
        </Link>
      </div>
    </nav>
  );
}
