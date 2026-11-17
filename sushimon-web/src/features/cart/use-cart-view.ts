'use client';

import { useEffect, useMemo } from 'react';
import { useLocale } from 'next-intl';
import {
  evaluateContinue,
  evaluateLine,
  lineSubtotalCents,
  lineUnitCents,
  type CartLine,
  type ContinueBlocker,
  type LineEvaluation,
  type RevalidationStatus,
} from '@/lib/cart-rules';
import { productName } from '../catalog/localized';
import type { CatalogProduct } from '../catalog/catalog-product';
import { useOptionalOrderMode } from '../order-mode/order-mode-context';
import { useCart } from './cart-context';
import { useBranchLive } from './use-branch-live';

export interface CartRowView {
  line: CartLine;
  /** Evaluación contra lo vigente (`null` mientras no hay datos). */
  evaluation: LineEvaluation | null;
  /** Producto vigente del menú (para ilustración/foto y nombre en inglés); `null` si no está o aún no carga. */
  product: CatalogProduct | null;
  /** Nombre a mostrar: el vigente en el idioma activo o, sin él, el guardado. */
  name: string;
  /** Subtotal de línea provisional (centavos enteros). */
  subtotalCents: number;
  unitCents: number;
  /** Precio por unidad anterior si cambió y falta el «Entendido». */
  previousUnitCents: number | null;
}

export interface CartView {
  rows: CartRowView[];
  status: RevalidationStatus;
  canContinue: boolean;
  blockers: ContinueBlocker[];
  /** Subtotal ESTIMADO (centavos) con los precios provisionales ya actualizados. */
  subtotalCents: number;
  /** Productos del menú de la sucursal del carrito (para el color estable de las ilustraciones). */
  catalog: readonly CatalogProduct[];
  modeBranchId: string | null;
  retry: () => void;
}

/**
 * F18 — Fuente ÚNICA de lo que ven cajón, resumen del menú y checkout: líneas del carrito + revalidación contra la sucursal DEL
 * CARRITO (`useBranchLive`) + reglas de «Continuar». Escribe en la línea lo vigente (precio, nombre, extras) sin tocar las
 * selecciones del cliente y deja el aviso de cambio hasta el «Entendido». `enabled` = el cajón/página está a la vista: nada se
 * consulta con el carrito cerrado o vacío.
 */
export function useCartView({ enabled }: { enabled: boolean }): CartView {
  const cart = useCart();
  const locale = useLocale();
  const modeBranchId = useOptionalOrderMode()?.mode.branchId ?? null;
  const live = useBranchLive({ branchId: cart.branchId, lines: cart.lines, enabled });
  const mismatch = modeBranchId !== null && cart.branchId !== modeBranchId;

  const evaluations = useMemo(() => {
    const map = new Map<string, LineEvaluation>();
    // Sin consulta activa no se evalúa nada (cajón cerrado, sin líneas o sin sucursal).
    if (!enabled || (live.status === 'idle' && !mismatch)) return map;
    for (const line of cart.lines) {
      if (mismatch) {
        map.set(
          line.lineId,
          evaluateLine(line, { card: null, detail: null, branchMismatch: true }),
        );
      } else if (live.cards) {
        map.set(
          line.lineId,
          evaluateLine(line, {
            card: live.cards.get(line.productId) ?? null,
            detail: live.details.get(line.slug) ?? null,
          }),
        );
      }
    }
    return map;
  }, [enabled, cart.lines, live.cards, live.details, live.status, mismatch]);
  // Un importe no canónico del servidor (precio o extra) no se interpreta: la revalidación queda en ERROR (no se afirma nada).
  const dataError = useMemo(
    () => [...evaluations.values()].some((e) => e.dataError),
    [evaluations],
  );
  const status: RevalidationStatus = dataError && live.status === 'ready' ? 'error' : live.status;

  // Lo vigente se escribe en la línea (idempotente); las selecciones nunca se tocan.
  const patchKey = useMemo(() => {
    if (status !== 'ready' || mismatch) return '';
    const patches = [...evaluations.values()].flatMap((e) => (e.patch ? [e.patch] : []));
    return patches.length ? JSON.stringify(patches) : '';
  }, [evaluations, status, mismatch]);
  const { applyRevalidation } = cart;
  useEffect(() => {
    if (patchKey) applyRevalidation(JSON.parse(patchKey));
  }, [patchKey, applyRevalidation]);

  const rows = useMemo(
    () =>
      cart.lines.map<CartRowView>((line) => {
        const product = live.products?.get(line.productId) ?? null;
        return {
          line,
          evaluation: evaluations.get(line.lineId) ?? null,
          product,
          name: product ? productName(product, locale) : line.display.name,
          subtotalCents: lineSubtotalCents(line),
          unitCents: lineUnitCents(line),
          previousUnitCents: line.display.priceChange?.fromCents ?? null,
        };
      }),
    [cart.lines, evaluations, live.products, locale],
  );
  const catalog = useMemo(
    () => (live.products ? [...live.products.values()] : []),
    [live.products],
  );

  const { canContinue, blockers } = evaluateContinue({
    lineCount: cart.lines.length,
    statuses: [...evaluations.values()].map((e) => e.status),
    revalidation: status,
    modeBranchId,
    cartBranchId: cart.branchId,
  });
  return {
    rows,
    status,
    canContinue,
    blockers,
    subtotalCents: cart.subtotalCents,
    catalog,
    modeBranchId,
    retry: live.retry,
  };
}
