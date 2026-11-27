'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/cn';
import { useHomeBootstrap } from '@/features/store/hooks';
import { BANNER_HEIGHT_CLASSES, BannerSlide, BannerSlideSkeleton } from './banner-slide';

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

/** Foco visible sobre la imagen (flechas blancas): anillo ámbar con separación oscura, visible en claro y oscuro. */
const FOCUS_ON_IMAGE =
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black';
/** Foco visible sobre el fondo de la página (indicadores y pausa). */
const FOCUS_ON_PAGE =
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Carrusel del Inicio (F16 simplificado, ADR-0033): imágenes `{image.url, alt}` de los banners ACTIVOS (dentro de
 * `GET /v1/store/bootstrap`, F17), en orden de creación, sin textos ni enlaces (desplazamiento por *scroll snap*). El servidor decide
 * qué se publica; esta pieza solo lo muestra y vuelve a pedirlo al cambiar de sucursal y al volver a la pestaña.
 * Avanza cada 6 s, salvo si el usuario lo pausó, pasa el puntero/foco por encima o pidió reducir el movimiento. Un solo banner =
 * sin controles ni avance. Sin banners (o si falla) no renderiza nada. Puntos, flechas y teclas ←/→/Inicio/Fin; solo la
 * diapositiva actual es accesible (`inert` en las demás).
 */
export function PromoCarousel() {
  const t = useTranslations('home');
  // F17: los banners llegan en el bootstrap del Inicio (una sola solicitud; NO se pide `/store/banners` aparte).
  const banners = useHomeBootstrap();
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);
  /** Anuncio BREVE para lectores de pantalla: solo tras un cambio manual (nunca al avanzar solo, al enfocar ni al pasar el ratón). */
  const [announcement, setAnnouncement] = useState('');
  /** ¿Se mostró el esqueleto? Entonces, si no hay banners, el hueco reservado se pliega con una transición en vez de desaparecer de golpe. */
  const [showedSkeleton] = useState(banners.isPending);
  const [collapsed, setCollapsed] = useState(false);
  const onCollapsed = useCallback(() => setCollapsed(true), []);
  const scroller = useRef<HTMLDivElement>(null);
  /** Destino de un desplazamiento programático en curso (evita que los eventos de scroll intermedios retrocedan el índice). */
  const pendingScroll = useRef<{ left: number; until: number } | null>(null);
  const items = banners.data?.banners;
  const count = items?.length ?? 0;
  /** La lista puede encogerse al refrescarse: nunca apuntar fuera de ella. */
  const current = count === 0 ? 0 : Math.min(index, count - 1);
  const many = count > 1;

  // Solo la diapositiva actual y la SIGUIENTE piden su imagen; una vez cargada se conserva (volver atrás o deslizar no la parpadea).
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<string>>(new Set());
  const nearIds = items && count > 0 ? [items[current]?.id, items[(current + 1) % count]?.id] : [];
  if (nearIds.some((id) => id && !loadedIds.has(id))) {
    setLoadedIds(new Set([...loadedIds, ...nearIds.filter((id): id is string => Boolean(id))]));
  }

  const goTo = useCallback(
    (target: number, manual = false) => {
      if (count === 0) return;
      const next = (target + count) % count;
      setIndex(next);
      if (manual) {
        setAnnouncement(`${t('slideOf', { a: next + 1, b: count })}: ${items?.[next]?.alt ?? ''}`);
      }
      const el = scroller.current;
      if (el && el.clientWidth > 0 && typeof el.scrollTo === 'function') {
        pendingScroll.current = { left: next * el.clientWidth, until: performance.now() + 800 };
        el.scrollTo({ left: next * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
      }
    },
    [count, items, reduced, t],
  );

  // Avance automático. Depende de `current` para reiniciar la cuenta tras cualquier cambio manual.
  const auto = many && !reduced && !paused && !hold;
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => goTo(current + 1), CAROUSEL_INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [auto, current, goTo]);

  if (banners.isPending) {
    return (
      <section aria-busy="true" aria-label={t('promosAria')}>
        <BannerSlideSkeleton />
      </section>
    );
  }
  // Sin banners (o error 4xx/5xx/red): la sección se colapsa; el resto del Inicio sigue intacto.
  if (!items || count === 0) {
    if (!showedSkeleton || collapsed) return null;
    return (
      <section aria-hidden="true">
        <BannerSlideSkeleton collapse onCollapsed={onCollapsed} />
      </section>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!many || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'ArrowLeft') goTo(current - 1, true);
    else if (e.key === 'ArrowRight') goTo(current + 1, true);
    else if (e.key === 'Home') goTo(0, true);
    else if (e.key === 'End') goTo(count - 1, true);
    else return;
    e.preventDefault();
  };

  return (
    <section
      aria-roledescription={t('carousel')}
      aria-label={t('promosAria')}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHold(false);
      }}
    >
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <div className="relative">
        <div
          ref={scroller}
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
          {items.map((banner, i) => {
            // Solo la diapositiva actual y la siguiente piden su imagen; las lejanas esperan (`src` ausente).
            const near = loadedIds.has(banner.id) || i === current || i === (current + 1) % count;
            return (
              <article
                key={banner.id}
                aria-roledescription={t('slide')}
                aria-label={t('slideOf', { a: i + 1, b: count })}
                inert={i !== current}
                className={cn(
                  'relative w-full flex-none snap-start snap-always overflow-hidden',
                  BANNER_HEIGHT_CLASSES,
                )}
              >
                <BannerSlide banner={banner} eager={i === 0} loadImage={near} />
              </article>
            );
          })}
        </div>
        {many ? (
          <>
            <button
              type="button"
              onClick={() => goTo(current - 1, true)}
              aria-label={t('prev')}
              className={cn(
                'absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-card md:inline-flex',
                FOCUS_ON_IMAGE,
              )}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => goTo(current + 1, true)}
              aria-label={t('next')}
              className={cn(
                'absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-card md:inline-flex',
                FOCUS_ON_IMAGE,
              )}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      {many ? (
        <div className="mt-1.5 flex items-center justify-center short:hidden">
          {reduced ? null : (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? t('play') : t('pause')}
              aria-pressed={paused}
              className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-fg',
                FOCUS_ON_PAGE,
              )}
            >
              {paused ? (
                <Play className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pause className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
          {items.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              onClick={() => goTo(i, true)}
              aria-label={t('goSlide', { a: i + 1 })}
              aria-current={i === current ? 'true' : undefined}
              className={cn(
                'flex h-11 min-w-[44px] items-center justify-center rounded-full',
                FOCUS_ON_PAGE,
              )}
            >
              <span
                className={cn(
                  'block h-2.5 rounded-full transition-all',
                  i === current ? 'w-7 bg-primary' : 'w-2.5 bg-line',
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
