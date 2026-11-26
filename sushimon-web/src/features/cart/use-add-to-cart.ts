'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { CartRejection } from '@/lib/cart-rules';
import { useDataClient } from '@/lib/data-access/provider';
import type { PublicModifierGroup } from '@/lib/data-access/models';
import type { ModifierSelection } from '@/lib/modifier-rules';
import { STORE_AGGREGATE_STALE_MS } from '@/lib/store-rules';
import { getStoreProduct } from '@/services/products';
import { productSlug, type CatalogProduct } from '../catalog/catalog-product';
import { productName } from '../catalog/localized';
import { useProductSheet } from '../catalog/product-sheet-context';
import { useOptionalOrderMode } from '../order-mode/order-mode-context';
import { queryKeys } from '../query-keys';
import { useOrderSheet } from '../store-shell/store-shell-context';
import { buildAddInput } from './add-input';
import { useCartActions } from './cart-context';

/** Resultado de agregar/editar: la línea resultante y si se unificó con otra existente. */
export interface AddOutcome {
  lineId: string | null;
  merged: boolean;
}

export interface AddProductArgs {
  product: CatalogProduct;
  quantity: number;
  note?: string;
  groups?: readonly PublicModifierGroup[];
  selections?: readonly ModifierSelection[];
  /** Edición: reemplaza esta línea (se restaura si el reemplazo se rechaza). */
  replaceLineId?: string;
}

export const REJECTION_KEY = {
  INVALID_INPUT: 'cart.limit.invalid',
  INVALID_QUANTITY: 'cart.limit.invalid',
  LIMIT_QUANTITY: 'cart.limit.quantity',
  LIMIT_LINES: 'cart.limit.lines',
  LIMIT_UNITS: 'cart.limit.units',
  LIMIT_SELECTIONS: 'cart.limit.selections',
  BRANCH_MISMATCH: 'cart.limit.branch',
  NOT_FOUND: 'cart.limit.invalid',
} as const satisfies Record<CartRejection, string>;

/**
 * F18 — Único camino para agregar al carrito desde la UI (tarjetas, ficha, repetir pedido). Exige sucursal elegida (si no, abre la
 * hoja de modo de pedido), construye la línea con los extras REALES de F12, unifica configuraciones idénticas, avisa por
 * `aria-live` y explica con un mensaje cualquier tope o sucursal distinta (nunca recorta ni vacía en silencio).
 */
export function useAddToCart() {
  const cart = useCartActions();
  const t = useTranslations();
  const locale = useLocale();
  const { notify } = useToast();
  const mode = useOptionalOrderMode();
  const orderSheet = useOrderSheet();
  const sheet = useProductSheet();
  const client = useDataClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const branchId = mode?.mode.branchId ?? null;

  const addProduct = useCallback(
    ({
      product,
      quantity,
      note,
      groups,
      selections,
      replaceLineId,
    }: AddProductArgs): AddOutcome | null => {
      if (!branchId) {
        orderSheet.open();
        notify(t('cart.needBranch'), { tone: 'warn' });
        return null;
      }
      const input = buildAddInput({ product, branchId, quantity, note, groups, selections });
      if (!input) {
        notify(t('cart.limit.invalid'), { tone: 'warn' });
        return null;
      }
      // Editar es UNA operación atómica (misma posición y sucursal del carrito): nunca fija otra sucursal por su cuenta.
      const result = replaceLineId ? cart.replaceLine(replaceLineId, input) : cart.add(input);
      if (!result.ok) {
        notify(t(REJECTION_KEY[result.reason]), { tone: 'warn' });
        return null;
      }
      if (replaceLineId) {
        notify(t(result.merged ? 'cart.savedMerged' : 'cart.saved'));
      } else {
        notify(t('product.addedQty', { a: quantity, b: productName(product, locale) }));
      }
      return { lineId: result.lineId, merged: result.merged };
    },
    [branchId, cart, locale, notify, orderSheet, t],
  );

  /**
   * «Agregar» de una tarjeta: las tarjetas del menú no dicen si el producto tiene extras, así que se consulta su ficha (misma clave
   * y `staleTime` que la ficha; casi siempre ya está en caché). Con grupos de modificadores abre la ficha para elegirlos (hay
   * obligatorios que validar); sin ellos agrega 1 directo.
   */
  const quickAdd = useCallback(
    async (product: CatalogProduct) => {
      if (!branchId) {
        orderSheet.open();
        notify(t('cart.needBranch'), { tone: 'warn' });
        return;
      }
      const slug = productSlug(product);
      if (!slug) {
        sheet.openProduct(product.id, null, product);
        return;
      }
      setBusy(true);
      try {
        const detail = await queryClient.fetchQuery({
          queryKey: queryKeys.products.storeDetail(slug, branchId),
          queryFn: ({ signal }) => getStoreProduct(client, slug, branchId, signal),
          staleTime: STORE_AGGREGATE_STALE_MS,
        });
        if ((detail.modifierGroups ?? []).length > 0) {
          sheet.openProduct(product.id, slug, product);
          return;
        }
        addProduct({ product, quantity: 1 });
      } catch {
        // Sin ficha no se sabe si hay extras obligatorios: la ficha muestra el error o el 404 con «Reintentar».
        sheet.openProduct(product.id, slug, product);
      } finally {
        setBusy(false);
      }
    },
    [addProduct, branchId, client, notify, orderSheet, queryClient, sheet, t],
  );

  return { addProduct, quickAdd, busy, hasBranch: branchId !== null };
}
