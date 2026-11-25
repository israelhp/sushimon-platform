'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import type { StoreBanner } from '@/lib/data-access/models';
import { displayMediaSrc } from '@/lib/media-simulated';

/** Alturas fijas por punto de corte (se reservan también en el esqueleto de carga: sin desplazamiento de diseño, CLS). */
export const BANNER_HEIGHT_CLASSES =
  'h-[176px] midh:h-[156px] short:h-[132px] sm:h-[220px] lg:h-[240px]';

export type BannerSlideData = Pick<StoreBanner, 'alt'> & { image: { url: string | null } };

/**
 * F16 (simplificado, ADR-0033) — Pieza de presentación de UN banner (la misma en la tienda y en la previsualización del
 * backoffice): SOLO la imagen a todo el ancho con `object-cover` (recorte centrado, como el 3:1 que se prepara al subirla) y su
 * texto alternativo. Sin textos superpuestos ni enlaces. Imagen por URL pública (un `<img>` normal: ni `next/image` ni optimización de
 * Vercel/Cloudflare; las URLs simuladas `*.invalid` nunca se piden), la primera con prioridad de carga (`fetchpriority=high`, sin
 * `lazy`) y las demás `lazy`. Si la imagen falta o falla (`onError`, sin reintentos) se muestra el fondo de MARCA y el texto
 * alternativo queda como nombre accesible (`role="img"`).
 */
export function BannerSlide({
  banner,
  eager = false,
  imageSrc,
  loadImage = true,
  className,
}: {
  banner: BannerSlideData;
  /** Primera diapositiva: candidata a LCP (prioridad alta, sin carga diferida). */
  eager?: boolean;
  /** Origen ya resuelto (p. ej. vista previa local); si falta se deriva de `banner.image.url`. */
  imageSrc?: string | null;
  /**
   * `false` = todavía no se pide la imagen (diapositivas lejanas del carrusel: solo la actual y la siguiente llevan `src`). El
   * fondo de marca sigue visible; al pasar a `true` el navegador la descarga.
   */
  loadImage?: boolean;
  className?: string;
}) {
  const resolved = imageSrc !== undefined ? imageSrc : displayMediaSrc(banner.image.url);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = Boolean(resolved) && failed !== resolved;

  return (
    <div
      data-banner-image={showImage ? 'image' : 'fallback'}
      role={showImage ? undefined : 'img'}
      aria-label={showImage ? undefined : banner.alt}
      className={cn(
        'relative h-full w-full overflow-hidden',
        !showImage && 'seigaiha seigaiha-ink',
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- F16: URL pública del CDN; sin next/image ni optimización de proveedor
        <img
          src={loadImage ? (resolved as string) : undefined}
          alt={banner.alt}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(resolved)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
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
