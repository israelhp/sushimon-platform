'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface ProductSheetApi {
  /** Id del producto con la ficha abierta (o null). */
  productId: string | null;
  openProduct: (id: string) => void;
  closeProduct: () => void;
}

const ProductSheetContext = createContext<ProductSheetApi | null>(null);

/**
 * Estado de la ficha de producto. La ficha en sí la monta `ProductSheetHost`
 * (`features/catalog/components/product-sheet-host.tsx`), que lee `productId` de este contexto.
 */
export function ProductSheetProvider({ children }: { children: ReactNode }) {
  const [productId, setProductId] = useState<string | null>(null);
  const api = useMemo<ProductSheetApi>(
    () => ({
      productId,
      openProduct: (id) => setProductId(id),
      closeProduct: () => setProductId(null),
    }),
    [productId],
  );
  return <ProductSheetContext.Provider value={api}>{children}</ProductSheetContext.Provider>;
}

/** `openProduct(id)` abre la ficha de producto desde cualquier tarjeta de la tienda. */
export function useProductSheet(): ProductSheetApi {
  const ctx = useContext(ProductSheetContext);
  if (!ctx) throw new Error('useProductSheet debe usarse dentro de <ProductSheetProvider>');
  return ctx;
}
