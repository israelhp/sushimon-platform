'use client';

import { useTranslations } from 'next-intl';
import { FoodArt } from '@/components/art/FoodArt';
import { cn } from '@/lib/cn';
import { useDemoSession } from '@/features/session/demo-session';
import { firstNameOf } from '@/features/store-shell/components/Avatar';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { useAuthModal } from '@/features/store-shell/store-shell-context';

/** Banda de bienvenida (seigaiha coral, sello hanko y rollo). Saluda por el nombre con sesión; en móvil ofrece iniciar sesión. */
export function HomeHero() {
  const t = useTranslations('home');
  const ta = useTranslations('auth');
  const { customer } = useDemoSession();
  const auth = useAuthModal();
  const signedIn = !!customer;

  return (
    <section className="seigaiha seigaiha-coral relative flex h-[136px] items-center overflow-hidden sm:h-[160px] lg:h-[184px]">
      <div className="wrap flex items-center justify-between gap-3">
        <div className="relative z-10 min-w-0">
          <p
            className="font-jp text-[12px] tracking-[0.3em] text-white/85 sm:text-[13px]"
            lang="ja"
          >
            いらっしゃいませ
          </p>
          <h1
            className={cn(
              'disp mt-1',
              signedIn
                ? 'truncate text-[clamp(19px,5.4vw,56px)]'
                : 'text-[clamp(22px,6.5vw,56px)] leading-[1.02]',
            )}
          >
            {customer ? t('helloName', { a: firstNameOf(customer.name) }) : t('hello')}
          </h1>
          <p
            className={cn(
              'mt-1.5 truncate text-[13px] font-semibold text-white/90 sm:text-base',
              !signedIn && 'max-[439px]:hidden',
            )}
          >
            {t('welcome')}
            <span className="hidden sm:inline">{t('welcomeMore')}</span>
          </p>
          {!signedIn ? (
            <button
              type="button"
              onClick={auth.open}
              className="mt-2 inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-white px-3 text-[12.5px] font-extrabold text-neutral-900 shadow-card min-[440px]:hidden"
            >
              <GoogleLogo className="h-4 w-4" /> {ta('signIn')}
            </button>
          ) : null}
        </div>
        <span
          className="relative h-[104px] w-[104px] flex-none max-[379px]:h-[84px] max-[379px]:w-[84px] sm:h-[136px] sm:w-[136px] lg:h-[152px] lg:w-[152px]"
          aria-hidden="true"
        >
          <span className="absolute bottom-0 right-0 flex h-[82px] w-[82px] items-center justify-center rounded-full bg-white shadow-pop max-[379px]:h-[66px] max-[379px]:w-[66px] sm:h-[108px] sm:w-[108px] lg:h-[120px] lg:w-[120px]">
            <FoodArt kind="roll" className="w-[78%]" />
          </span>
          <span className="hanko absolute left-0 top-0 h-12 w-12 rotate-[-8deg] text-[15px] sm:h-16 sm:w-16 sm:text-[20px]">
            <span className="flex flex-col items-center leading-[1.05]">
              <span>寿</span>
              <span>司</span>
            </span>
          </span>
        </span>
      </div>
    </section>
  );
}
