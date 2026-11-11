'use client';

import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { FoodArt, type FoodArtKind } from '@/components/art/FoodArt';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { useProducts } from '@/features/catalog/hooks';
import { productName } from '@/features/catalog/localized';
import { useProductSheet } from '@/features/catalog/product-sheet-context';
import { STORE_ROUTES } from '@/features/store-shell/nav';

/** Segundos entre diapositivas (temporizador de presentación: usa el reloj del navegador, no es dato de dominio). */
export const CAROUSEL_INTERVAL_MS = 6000;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** `true` si el usuario pidió reducir el movimiento (el carrusel entonces no avanza solo). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

type SlideAction = { type: 'link'; href: string } | { type: 'product'; productId: string };

interface Slide {
  id: 'favs' | 'happy' | 'calientito' | 'team';
  bg: string;
  jp: string;
  art: FoodArtKind;
  dark?: boolean;
  action: SlideAction;
}

const SLIDES: readonly Slide[] = [
  {
    id: 'favs',
    bg: 'seigaiha seigaiha-sky',
    jp: '人気',
    art: 'roll',
    dark: true,
    action: { type: 'link', href: `${STORE_ROUTES.menu}?cat=rolls` },
  },
  {
    id: 'happy',
    bg: 'seigaiha seigaiha-coral',
    jp: 'ハッピーアワー',
    art: 'fries',
    action: { type: 'link', href: STORE_ROUTES.promos },
  },
  {
    id: 'calientito',
    bg: 'seigaiha seigaiha-accent',
    jp: '巻き寿司',
    art: 'roll',
    action: { type: 'product', productId: 'calientito-roll' },
  },
  {
    id: 'team',
    bg: 'seigaiha seigaiha-ink',
    jp: '仲間募集',
    art: 'sake',
    dark: true,
    action: { type: 'link', href: STORE_ROUTES.careers },
  },
];

/**
 * Carrusel de promociones del Inicio (4 diapositivas con desplazamiento por *scroll snap*).
 * Avanza cada 6 s, salvo si el usuario lo pausó, pasa el puntero/foco por encima o pidió reducir el
 * movimiento. Puntos y flechas accesibles; solo la diapositiva actual es interactiva (`inert` en las demás).
 */
export function PromoCarousel() {
  const t = useTranslations('home');
  const locale = useLocale();
  const { openProduct } = useProductSheet();
  const products = useProducts();
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /** Destino de un desplazamiento programático en curso (evita que los eventos de scroll intermedios retrocedan el índice). */
  const pendingScroll = useRef<{ left: number; until: number } | null>(null);
  const count = SLIDES.length;

  const goTo = useCallback(
    (target: number) => {
      const next = (target + count) % count;
      setIndex(next);
      const el = scroller.current;
      if (el && el.clientWidth > 0 && typeof el.scrollTo === 'function') {
        pendingScroll.current = { left: next * el.clientWidth, until: performance.now() + 800 };
        el.scrollTo({ left: next * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
      }
    },
    [count, reduced],
  );

  // Avance automático. Depende de `index` para reiniciar la cuenta tras cualquier cambio manual.
  const auto = !reduced && !paused && !hold;
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => goTo(index + 1), CAROUSEL_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [auto, index, goTo]);

  const calientito = products.data?.find((p) => p.id === 'calientito-roll');

  const slideText = (
    id: Slide['id'],
  ): { eyebrow: string; title: ReactNode; text: string; cta: string } => {
    if (id === 'favs') {
      return {
        eyebrow: t('slides.favs.eyebrow'),
        title: t('slides.favs.title'),
        text: t('slides.favs.text'),
        cta: t('slides.favs.cta'),
      };
    }
    if (id === 'happy') {
      return {
        eyebrow: t('slides.happy.eyebrow'),
        title: (
          <>
            Happy <span className="text-outline">Hour</span>
          </>
        ),
        text: t('slides.happy.text'),
        cta: t('slides.happy.cta'),
      };
    }
    if (id === 'calientito') {
      return {
        eyebrow: calientito
          ? `${productName(calientito, locale)} · ${formatMoney(calientito.price, 'es', { decimals: 'auto' })}`
          : 'Calientito Roll',
        title: t('slides.calientito.title'),
        text: t('slides.calientito.text'),
        cta: t('slides.calientito.cta'),
      };
    }
    return {
      eyebrow: t('slides.team.eyebrow'),
      title: t('slides.team.title'),
      text: t('slides.team.text'),
      cta: t('slides.team.cta'),
    };
  };

  const ctaClass = (dark?: boolean) =>
    cn(
      'btn mt-1 !min-h-[40px] self-start !border-transparent !px-4 text-sm sm:mt-1.5 sm:!min-h-[42px]',
      dark
        ? '!bg-[var(--band-amber)] !text-[rgb(var(--on-band-amber))]'
        : '!bg-white !text-[rgb(var(--on-band-amber))]',
    );

  return (
    <section
      aria-roledescription={t('carousel')}
      aria-label={t('promosAria')}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHold(false);
      }}
    >
      <div className="relative">
        <div
          ref={scroller}
          aria-live={auto ? 'off' : 'polite'}
          onScroll={(e) => {
            const el = e.currentTarget;
            const pending = pendingScroll.current;
            if (pending) {
              if (Math.abs(el.scrollLeft - pending.left) < 2 || performance.now() > pending.until) {
                pendingScroll.current = null;
              } else {
                return;
              }
            }
            if (el.clientWidth > 0) {
              setIndex(
                Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))),
              );
            }
          }}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-3xl shadow-card"
        >
          {SLIDES.map((slide, i) => {
            const copy = slideText(slide.id);
            return (
              <article
                key={slide.id}
                aria-roledescription={t('slide')}
                aria-label={t('slideOf', { a: i + 1, b: count })}
                inert={i !== index}
                className={cn(
                  slide.bg,
                  'relative flex h-[176px] w-full flex-none snap-start snap-always items-center overflow-hidden midh:h-[156px] short:h-[132px] sm:h-[220px] lg:h-[240px]',
                )}
              >
                <div className="relative z-10 flex max-w-[62%] flex-col gap-1.5 p-4 sm:max-w-[60%] sm:gap-2 sm:px-8 sm:py-5 md:pl-20 lg:max-w-[56%] lg:py-6">
                  <p className="eyebrow truncate text-[11px] max-[359px]:text-[10px] sm:text-[13px]">
                    {copy.eyebrow}{' '}
                    <span className="ml-1 font-jp tracking-[0.2em]" lang="ja">
                      {slide.jp}
                    </span>
                  </p>
                  <h2 className="disp text-[clamp(24px,5.5vw,52px)] max-[379px]:text-[20px] max-[359px]:text-[16px] sm:line-clamp-2 sm:text-[24px] md:text-[28px] lg:text-[clamp(34px,3vw,42px)]">
                    {copy.title}
                  </h2>
                  <p className="m-0 hidden truncate text-[13px] font-medium leading-snug opacity-90 sm:block sm:text-[15px]">
                    {copy.text}
                  </p>
                  {slide.action.type === 'link' ? (
                    <Link href={slide.action.href} className={ctaClass(slide.dark)}>
                      {copy.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        slide.action.type === 'product' && openProduct(slide.action.productId)
                      }
                      className={ctaClass(slide.dark)}
                    >
                      {copy.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div
                  className="absolute -right-6 bottom-0 top-0 flex w-[48%] items-center justify-center sm:right-8 sm:w-[36%] md:right-20 md:w-[30%]"
                  aria-hidden="true"
                >
                  <div className="flex aspect-square w-full max-w-[150px] items-center justify-center rounded-full bg-white/95 shadow-pop max-[379px]:max-w-[112px] short:max-w-[112px] sm:max-w-[160px] lg:max-w-[184px]">
                    <FoodArt kind={slide.art} className="w-[72%]" />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label={t('prev')}
          className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-card md:inline-flex"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label={t('next')}
          className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-card md:inline-flex"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="relative mt-1.5 flex justify-center gap-1.5 short:hidden">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={t('goSlide', { a: i + 1 })}
            aria-current={i === index ? 'true' : undefined}
            className="flex h-6 items-center justify-center px-0.5"
          >
            <span
              className={cn(
                'block h-2.5 rounded-full transition-all',
                i === index ? 'w-7 bg-primary' : 'w-2.5 bg-line',
              )}
            />
          </button>
        ))}
        {reduced ? null : (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? t('play') : t('pause')}
            aria-pressed={paused}
            className="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-fg"
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </section>
  );
}
