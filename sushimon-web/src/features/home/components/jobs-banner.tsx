import { ArrowRight, Briefcase, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { STORE_ROUTES } from '@/features/store-shell/nav';

/** Banda "Trabaja con nosotros" (seigaiha azul, sello hanko). Componente de servidor: solo texto y un enlace. */
export function JobsBanner() {
  const t = useTranslations('home');
  return (
    <section aria-labelledby="jobs-title">
      <Link
        href={STORE_ROUTES.careers}
        className="seigaiha seigaiha-sky group relative flex items-center gap-4 overflow-hidden rounded-3xl p-5 text-white no-underline shadow-card transition hover:-translate-y-0.5 hover:shadow-lift sm:gap-6 sm:p-7"
      >
        <span
          className="pointer-events-none absolute -right-3 -top-6 font-jp text-[110px] leading-none text-white/[0.08] sm:text-[150px]"
          aria-hidden="true"
        >
          仲間
        </span>
        <span className="hanko relative h-14 w-14 flex-none sm:h-16 sm:w-16" aria-hidden="true">
          <Briefcase className="h-7 w-7" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block font-jp text-[11px] tracking-[0.15em] text-accent" lang="ja">
            {t('jobsEyebrow')}
          </span>
          <span
            id="jobs-title"
            className="mt-1 block font-display text-[22px] uppercase leading-tight sm:text-[30px]"
          >
            {t('jobsTitle')}
          </span>
          <span className="mt-1 block text-[14px] leading-snug text-white/85 sm:text-[15px]">
            {t('jobsText')}
          </span>
        </span>
        <span className="relative hidden flex-none items-center gap-2 rounded-full bg-primary px-5 py-3 font-extrabold text-onprimary dark:text-[rgb(var(--on-band-amber))] sm:inline-flex">
          {t('apply')}{' '}
          <ArrowRight
            className="h-5 w-5 transition group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
        <ChevronRight className="relative h-6 w-6 flex-none sm:hidden" aria-hidden="true" />
      </Link>
    </section>
  );
}
