'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import { isApiError } from '@/lib/data-access/errors';
import {
  getStoreBranchMenu,
  listAdminBranchProducts,
  listAdminProductBranches,
  setAdminBranchProductPricing,
  setAdminProductAvailability,
  type BranchProductFilters,
} from '@/services/branch-products';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';

/**
 * F13 — Hooks de precio y disponibilidad por sucursal. La caché del overlay público tiene la misma ventana que el servidor
 * (`max-age=15`): `staleTime` ≤ 15 s, refetch al volver al foco y al cambiar de sucursal (clave por `branchId`).
 */

/** Ventana de obsolescencia del overlay público (spec 014 D5: ≤ 15 s). */
export const STORE_MENU_STALE_MS = 15_000;

/** Overlay de la sucursal elegida (`null` = ninguna: no consulta). 4xx no se reintenta. */
export function useStoreBranchMenu(branchId: string | null) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.storeMenu.branch(branchId ?? ''),
    queryFn: () => getStoreBranchMenu(client, branchId as string),
    enabled: Boolean(branchId),
    staleTime: STORE_MENU_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
  });
}

/** Matriz de una sucursal (solo con sesión de personal y sucursal elegida; la API decide 401/403/404). */
export function useAdminBranchProducts(
  branchId: string | null,
  filters: BranchProductFilters = {},
) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.branchProducts.byBranch(branchId ?? '', filters),
    queryFn: () => listAdminBranchProducts(client, branchId as string, filters),
    enabled: Boolean(staff) && Boolean(branchId),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** Matriz de un producto: una fila por sucursal dentro del alcance del empleado. */
export function useAdminProductBranches(productId: string | null) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.branchProducts.byProduct(productId ?? ''),
    queryFn: () => listAdminProductBranches(client, productId as string),
    enabled: Boolean(staff) && Boolean(productId),
    staleTime: 0,
  });
}

/**
 * Tras CADA mutación: matrices (por sucursal y por producto), overlay público de TODAS las sucursales (cualquiera pudo cambiar)
 * y fichas públicas. Se espera el refetch: la UI no ofrece de nuevo la acción sobre datos obsoletos.
 */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.branchProducts.all }),
      qc.invalidateQueries({ queryKey: queryKeys.storeMenu.all }),
      qc.invalidateQueries({ queryKey: queryKeys.products.storeDetails }),
    ]);
}

export function useSetBranchProductPricing() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      branchId,
      productId,
      priceOverride,
    }: {
      branchId: string;
      productId: string;
      priceOverride: string | null;
    }) => setAdminBranchProductPricing(client, branchId, productId, priceOverride),
    onSuccess: invalidate,
  });
}

export function useSetProductAvailability() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      productId,
      branchId,
      available,
    }: {
      productId: string;
      branchId: string;
      available: boolean;
    }) => setAdminProductAvailability(client, productId, { branchId, available }),
    onSuccess: invalidate,
  });
}
