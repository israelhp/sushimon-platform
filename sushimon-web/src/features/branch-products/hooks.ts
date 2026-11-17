'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import {
  listAdminBranchProducts,
  listAdminProductBranches,
  setAdminBranchProductPricing,
  setAdminProductAvailability,
  type BranchProductFilters,
} from '@/services/branch-products';
import { queryKeys } from '../query-keys';
import { invalidateStoreAggregates } from '../store/invalidate';
import { useDemoSession } from '../session/demo-session';

/**
 * F13 — Hooks de precio y disponibilidad por sucursal (backoffice). La lectura pública del menú por sucursal (overlay F13) pasó
 * en F17 a `features/store/hooks.ts` (`useStoreMenu`: tarjetas con precio efectivo, claves por sucursal).
 */

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
 * Tras CADA mutación: matrices (por sucursal y por producto) y los agregados públicos de TODAS las sucursales (menú, búsqueda,
 * bootstrap y fichas: cualquiera pudo cambiar). Se espera el refetch: la UI no ofrece de nuevo la acción sobre datos obsoletos.
 */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.branchProducts.all }),
      invalidateStoreAggregates(qc),
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
