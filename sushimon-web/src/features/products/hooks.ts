'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import type { ProductBranchAvailability, UpdateProductRequest } from '@/lib/data-access/models';
import {
  createAdminProduct,
  listAdminProducts,
  listSimulatedProductExtras,
  setSimulatedProductAvailability,
  updateAdminProduct,
  type AdminProductFilters,
  type CreateProductInput,
} from '@/services/products';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';

/**
 * F11 — Hooks de productos del backoffice. La lista solo corre con sesión de personal (la API decide: 401/403) y conserva la
 * página anterior mientras llega la siguiente. Toda mutación invalida `products` y el catálogo unido de la tienda (`catalog`).
 */
export function useAdminProducts(filters: AdminProductFilters = {}) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.products.admin(filters),
    queryFn: () => listAdminProducts(client, filters),
    enabled: Boolean(staff),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.products.all }),
      qc.invalidateQueries({ queryKey: queryKeys.catalog.all }),
    ]);
}

export function useCreateProduct() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateProductInput) => createAdminProduct(client, input),
    onSuccess: invalidate,
  });
}

export function useUpdateProduct() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductRequest }) =>
      updateAdminProduct(client, id, input),
    onSuccess: invalidate,
  });
}

/**
 * SIMULADO (solo mock): disponibilidad por sucursal de cada producto (F13 pendiente). Con la API real no existe: el mapa llega
 * vacío (`enabled=false`) y la pantalla oculta esos controles.
 */
export function useSimulatedProductExtras() {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.products.extras,
    queryFn: () => listSimulatedProductExtras(client),
    enabled: Boolean(staff) && client.kind === 'mock',
    select: (r) => new Map(r.items.map((e) => [e.productId, e])),
  });
}

/** SIMULADO (F13): disponibilidad por sucursal — encargado (su sucursal) o admin. Solo existe en el mock. */
export function useSetProductAvailability() {
  const client = useDataClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, availability }: { id: string; availability: ProductBranchAvailability[] }) =>
      setSimulatedProductAvailability(client, id, availability),
    // Se espera el refetch: la UI no ofrece de nuevo la acción sobre datos obsoletos.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.products.extras }),
        qc.invalidateQueries({ queryKey: queryKeys.catalog.all }),
      ]),
  });
}
