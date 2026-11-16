'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { BannerLocale, StoreBanner } from '@/lib/data-access/models';
import { displayMediaSrc } from '@/lib/media-simulated';

/** Alturas fijas por punto de corte (se reservan también en el esqueleto de carga: sin desplazamiento de diseño, CLS). */
export const BANNER_HEIGHT_CLASSES =
  'h-[176px] midh:h-[156px] short:h-[132px] sm:h-[220px] lg:h-[240px]';

export type BannerSlideData = Pick<
  StoreBanner,
  'title' | 'subtitle' | 'ctaLabel' | 'imageAlt' | 'image' | 'fallbackFields'
>;

/**
 * F16 — Pieza de presentación de UN banner (la misma en la tienda y en la previsualización del backoffice). Imagen por URL
 * pública con `object-cover` (un `<img>` normal: ni `next/image` ni optimización de Vercel/Cloudflare), la primera con prioridad de
 * carga (`fetchpriority=high`, sin `lazy`) y las demás `lazy`; degradado oscuro bajo el texto para el contraste. Si la imagen falta o
 * falla (`onError`, sin reintentos) se muestra el fondo de MARCA conservando texto y CTA. Los textos de respaldo (`fallbackFields`)
 * llevan `lang="es"`. El CTA lo pone quien la usa (`ctaSlot`): enlace real en la tienda, botón inerte en la previsualización.
 * Sin precios ni datos de promoción: el banner es contenido, no motor de descuentos.
 */
export function BannerSlide({
  banner,
  locale,
  eager = false,
  imageSrc,
  loadImage = true,
  ctaSlot,
  markFallback = false,
  className,
}: {
  banner: BannerSlideData;
  locale: BannerLocale;
  /** Primera diapositiva: candidata a LCP (prioridad alta, sin carga diferida). */
  eager?: boolean;
  /** Origen ya resuelto (p. ej. vista previa local); si falta se deriva de `banner.image.url`. */
  imageSrc?: string | null;
  /**
   * `false` = todavía no se pide la imagen (diapositivas lejanas del carrusel: solo la actual y la siguiente llevan `src`). El
   * texto y el fondo de marca siguen visibles; al pasar a `true` el navegador la descarga.
   */
  loadImage?: boolean;
  ctaSlot?: ReactNode;
  /** Previsualización: resalta los textos que salen en español por respaldo. */
  markFallback?: boolean;
  className?: string;
}) {
  const resolved = imageSrc !== undefined ? imageSrc : displayMediaSrc(banner.image.url);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = Boolean(resolved) && failed !== resolved;
  const langOf = (field: (typeof banner.fallbackFields)[number]) =>
    locale === 'en' && banner.fallbackFields.includes(field) ? 'es' : undefined;
  const mark = (field: (typeof banner.fallbackFields)[number]) =>
    markFallback && banner.fallbackFields.includes(field)
      ? 'rounded-sm outline outline-2 outline-dashed outline-offset-2 outline-amber-300'
      : undefined;

  return (
    <div
      data-banner-image={showImage ? 'image' : 'fallback'}
      className={cn(
        'relative flex h-full w-full items-end overflow-hidden sm:items-center',
        !showImage && 'seigaiha seigaiha-ink',
        className,
      )}
    >
      {showImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- F16: URL pública del CDN; sin next/image ni optimización de proveedor */}
          <img
            src={loadImage ? (resolved as string) : undefined}
            alt={banner.imageAlt}
            lang={langOf('imageAlt')}
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : undefined}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(resolved)}
            className="absolute inset-0 h-full w-full object-cover object-[60%_40%]"
          />
          {/* Contraste del texto sobre la imagen: en móvil el texto ocupa todo el ancho, así que el velo es VERTICAL (de abajo arriba); desde `sm` el texto está a la izquierda y el velo es horizontal. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-black/10 sm:bg-gradient-to-r sm:from-black/80 sm:via-black/55 sm:to-black/10"
          />
        </>
      ) : null}
      <div className="relative z-10 flex max-w-[92%] flex-col gap-1.5 p-4 text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.55)] sm:max-w-[60%] sm:gap-2 sm:px-8 sm:py-5 md:pl-20 lg:max-w-[56%] lg:py-6">
        <h2
          lang={langOf('title')}
          className={cn(
            'disp text-[clamp(24px,5.5vw,52px)] max-[379px]:text-[20px] max-[359px]:text-[16px] line-clamp-2 sm:text-[24px] md:text-[28px] lg:text-[clamp(34px,3vw,42px)]',
            mark('title'),
          )}
        >
          {banner.title}
        </h2>
        {banner.subtitle ? (
          <p
            lang={langOf('subtitle')}
            className={cn(
              'm-0 line-clamp-1 text-[13px] font-medium leading-snug opacity-95 short:hidden sm:line-clamp-2 sm:text-[15px]',
              mark('subtitle'),
            )}
          >
            {banner.subtitle}
          </p>
        ) : null}
        {ctaSlot}
      </div>
    </div>
  );
}

const COLLAPSE_MS = 300;

/**
 * Esqueleto con la altura reservada del carrusel (y la fila de indicadores) para no desplazar el Inicio mientras llegan los
 * banners. Si la consulta termina SIN banners (`collapse`), se pliega con una transición breve de altura (sin movimiento con
 * `prefers-reduced-motion`) y avisa con `onCollapsed` para dejar de renderizarlo.
 */
export function BannerSlideSkeleton({
  collapse = false,
  onCollapsed,
}: {
  collapse?: boolean;
  onCollapsed?: () => void;
}) {
  // El pliegue dura 300 ms (CSS); pasado ese tiempo se deja de renderizar (un temporizador, no `animationend`: no depende del navegador).
  useEffect(() => {
    if (!collapse || !onCollapsed) return;
    const id = window.setTimeout(onCollapsed, COLLAPSE_MS + 50);
    return () => window.clearTimeout(id);
  }, [collapse, onCollapsed]);
  return (
    <div aria-hidden="true" className={cn(collapse && 'banner-collapse overflow-hidden')}>
      <div className={cn('w-full animate-pulse rounded-3xl bg-subtle', BANNER_HEIGHT_CLASSES)} />
      <div className="mt-1.5 h-11 short:hidden" />
    </div>
  );
}

/** Texto del CTA: el del banner (en su idioma) o la etiqueta genérica localizada. */
export const bannerCtaText = (banner: Pick<BannerSlideData, 'ctaLabel'>, fallback: string) =>
  banner.ctaLabel ?? fallback;
