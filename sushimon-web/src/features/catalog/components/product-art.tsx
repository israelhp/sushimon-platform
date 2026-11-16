'use client';

import { useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { cn } from '@/lib/cn';
import type { Product, PublicProductMedia } from '@/lib/data-access/models';
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

/**
 * Imagen de un producto: la foto referenciada (F11) o, sin foto o si falla al cargar, la ilustración PLACEHOLDER (la subida
 * de imágenes es F14). Decorativa: el nombre del producto va en el texto contiguo; el `alt` es el de la API o vacío.
 */
export function ProductArt({
  product,
  media,
  className,
  artClassName,
}: {
  product: WithMedia;
  /** Imagen concreta (galería); por defecto la primera. */
  media?: PublicProductMedia | null;
  /** Clases de la foto (`<img>`). */
  className?: string;
  /** Clases de la ilustración (placeholder). */
  artClassName?: string;
}) {
  const image = media === undefined ? firstProductImage(product) : media;
  const src = safeMediaUrl(image?.url);
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- origen arbitrario (URL https del catálogo, F14 aportará R2)
      <img
        src={src}
        alt={image?.altText ?? ''}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  return <FoodArt kind={foodArtKind(product.illustration)} className={artClassName} />;
}
