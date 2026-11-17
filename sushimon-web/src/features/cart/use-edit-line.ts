'use client';

import { useCallback } from 'react';
import { useProductSheet } from '../catalog/product-sheet-context';
import type { CartRowView } from './use-cart-view';

/**
 * «Editar» una línea: abre la ficha ENCIMA del cajón (pila de diálogos; no se cierra ni se reabre el cajón) precargada con su
 * selección. Nunca modifica la línea por su cuenta: solo al guardar.
 */
export function useEditLine() {
  const { openProduct } = useProductSheet();
  return useCallback(
    (row: CartRowView) => {
      if (!row.product) return;
      openProduct(row.product.id, row.product.slug, row.product, {
        lineId: row.line.lineId,
        quantity: row.line.quantity,
        note: row.line.note,
        chosen: row.line.selections.reduce<Record<string, string[]>>((acc, s) => {
          (acc[s.groupId] ??= []).push(s.optionId);
          return acc;
        }, {}),
      });
    },
    [openProduct],
  );
}
