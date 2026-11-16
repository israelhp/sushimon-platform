'use client';

import { useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { cn } from '@/lib/cn';
import type { Product, PublicProductMedia } from '@/lib/data-access/models';
import { displayMediaSrc } from '@/lib/media-simulated';
import { safeMediaUrl } from '@/lib/product-rules';
import { foodArtKind } from '../localized';

type WithMedia = Product & { media?: readonly PublicProductMedia[] };

/** Primera imagen válida (`https`) del producto, o `null` (se usa el placeholder). Nunca devuelve otro esquema. */
export function firstProductImage(product: {
  media?: readonly PublicProductMedia[];
}): PublicProductMedia | null {
  for (const m of product.media ?? []) {
    if (safeMediaUrl(m.url)) return m;
  }
  return null;
}

/** Atributos de rendimiento de la foto (F14): evitan saltos de diseño y sirven al navegador para elegir cuándo cargarla. */
export interface ProductImageSizing {
  /** Dimensiones de la caja en CSS px (reserva el espacio; la foto llena la caja con `object-cover`). */
  width: number;
  height: number;
  /** `sizes` del `<img>` (no hay `srcset`: sin variantes ni optimizador, por costos). */
  sizes?: string;
  /** Imagen principal de la ficha (probable LCP): carga inmediata y prioridad alta; el resto, `lazy`. */
  priority?: boolean;
}

/**
 * Imagen de un producto: la foto del CDN (F14; `media[0].url`) o, sin foto, con una URL simulada sin bytes, o si falla al
 * cargar (UNA vez: sin bucles de error), la ilustración. `<img>` plano con `unoptimized` de hecho: sin optimizador de Vercel ni
 * `/cdn-cgi/image` (la API ya entrega WebP optimizado). `alt` = el de la API o, si no hay, el nombre del producto cuando la foto
 * es la única referencia visual (`altFallback`); vacío si es decorativa.
 */
export function ProductArt({
  product,
  media,
  className,
  artClassName,
  sizing,
  altFallback,
}: {
  product: WithMedia;
  /** Imagen concreta (galería); por defecto la primera. */
  media?: PublicProductMedia | null;
  /** Clases de la foto (`<img>`). */
  className?: string;
  /** Clases de la ilustración (placeholder). */
  artClassName?: string;
  sizing?: ProductImageSizing;
  /** Texto cuando la API no trae `altText` (p. ej. el nombre del producto en la ficha). */
  altFallback?: string;
}) {
  const image = media === undefined ? firstProductImage(product) : media;
  const src = displayMediaSrc(image?.url);
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- origen del CDN de medios (F14): sin optimizador de Vercel ni remotePatterns
      <img
        src={src}
        alt={image?.altText ?? altFallback ?? ''}
        width={sizing?.width}
        height={sizing?.height}
        sizes={sizing?.sizes}
        loading={sizing?.priority ? 'eager' : 'lazy'}
        fetchPriority={sizing?.priority ? 'high' : undefined}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  return <FoodArt kind={foodArtKind(product.illustration)} className={artClassName} />;
}
