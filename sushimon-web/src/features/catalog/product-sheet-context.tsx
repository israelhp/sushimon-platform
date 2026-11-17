'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '@/lib/data-access/models';

export interface ProductSheetApi {
  /** Id del producto con la ficha abierta (o null). */
  productId: string | null;
  /** Slug conocido al abrir (la tarjeta lo trae); `null` = hay que resolverlo (carga perezosa del menú). */
  slug: string | null;
  /** Producto de la tarjeta de origen (nombre, imagen, precio) para pintar la ficha al instante mientras llega el detalle. */
  seed: Product | null;
  /** `slug` es opcional: con él la ficha se pide de inmediato (`getStoreProduct`) sin cargar el menú. `seed` = la tarjeta de origen. */
  openProduct: (id: string, slug?: string | null, seed?: Product | null) => void;
  closeProduct: () => void;
}

const ProductSheetContext = createContext<ProductSheetApi | null>(null);

/**
 * Estado de la ficha de producto. La ficha en sí la monta `ProductSheetHost`
 * (`features/catalog/components/product-sheet-host.tsx`), que lee `productId` de este contexto.
 */
export function ProductSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{
    id: string;
    slug: string | null;
    seed: Product | null;
  } | null>(null);
  const api = useMemo<ProductSheetApi>(
    () => ({
      productId: open?.id ?? null,
      slug: open?.slug ?? null,
      seed: open?.seed ?? null,
      openProduct: (id, slug = null, seed = null) => setOpen({ id, slug, seed }),
      closeProduct: () => setOpen(null),
    }),
    [open],
  );
  return <ProductSheetContext.Provider value={api}>{children}</ProductSheetContext.Provider>;
}

/** `openProduct(id)` abre la ficha de producto desde cualquier tarjeta de la tienda. */
export function useProductSheet(): ProductSheetApi {
  const ctx = useContext(ProductSheetContext);
  if (!ctx) throw new Error('useProductSheet debe usarse dentro de <ProductSheetProvider>');
  return ctx;
}
