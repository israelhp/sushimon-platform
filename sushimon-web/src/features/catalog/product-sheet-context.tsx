'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '@/lib/data-access/models';

/** Edición de una línea del carrito: la ficha se abre precargada con su selección y, al guardar, la REEMPLAZA. */
export interface SheetEdit {
  lineId: string;
  quantity: number;
  note: string;
  /** Opciones elegidas (`groupId` → ids). Las que ya no existen simplemente no aparecen marcadas. */
  chosen: Readonly<Record<string, readonly string[]>>;
}

export interface ProductSheetApi {
  edit: SheetEdit | null;
  /** Id del producto con la ficha abierta (o null). */
  productId: string | null;
  /** Slug conocido al abrir (la tarjeta lo trae); `null` = hay que resolverlo (carga perezosa del menú). */
  slug: string | null;
  /** Producto de la tarjeta de origen (nombre, imagen, precio) para pintar la ficha al instante mientras llega el detalle. */
  seed: Product | null;
  /** `slug` es opcional: con él la ficha se pide de inmediato (`getStoreProduct`) sin cargar el menú. `seed` = la tarjeta de origen. */
  openProduct: (
    id: string,
    slug?: string | null,
    seed?: Product | null,
    edit?: SheetEdit | null,
  ) => void;
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
    edit: SheetEdit | null;
  } | null>(null);
  const api = useMemo<ProductSheetApi>(
    () => ({
      edit: open?.edit ?? null,
      productId: open?.id ?? null,
      slug: open?.slug ?? null,
      seed: open?.seed ?? null,
      openProduct: (id, slug = null, seed = null, edit = null) => setOpen({ id, slug, seed, edit }),
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
