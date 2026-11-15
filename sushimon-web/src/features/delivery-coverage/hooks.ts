'use client';

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  AdminDeliveryZone,
  CreateDeliveryZoneRequest,
  UpdateBranchDeliverySettingsRequest,
  UpdateDeliveryZoneRequest,
  UpdateDeliveryZoneStatusRequest,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { coverageZoneOf } from '@/lib/delivery-zone';
import { checkDeliveryCoverage } from '@/services/delivery-coverage';
import {
  createAdminDeliveryZone,
  getAdminBranchDeliverySettings,
  getAdminDeliveryZone,
  getPedidosyaCoverageScenario,
  listAdminDeliveryZones,
  setPedidosyaCoverageScenario,
  type PedidosyaCoverageScenario,
  updateAdminBranchDeliverySettings,
  updateAdminDeliveryZone,
  updateAdminDeliveryZoneStatus,
  type DeliveryZoneFilters,
} from '@/services/delivery-zones';
import { listDepartments, listMunicipalities } from '@/services/locations';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { bestOutcome, outcomeOf, type CoverageOutcome } from './summary';

/**
 * F09 — Hooks de geografía, zonas propias, configuración de entrega y cobertura. Los catálogos casi no cambian
 * (`staleTime` largo, nunca se invalidan). La cobertura es de vida corta (30 s), sin refetch por foco y con `gcTime` bajo:
 * es orientativa, el servidor la vuelve a validar al crear el pedido. Los hooks admin solo corren con sesión de personal
 * (la API decide: 403/404).
 */

const CATALOG_STALE_MS = 60 * 60_000;
// 5 min: evita repetir N direcciones × S sucursales; la API revalida la cobertura al confirmar (F20) y las
// mutaciones de zonas/ajustes invalidan la de la sucursal en este cliente.
const COVERAGE_STALE_MS = 5 * 60_000;
const COVERAGE_GC_MS = 10 * 60_000;

export function useDepartments(enabled = true) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.locations.departments(),
    queryFn: () => listDepartments(client),
    staleTime: CATALOG_STALE_MS,
    enabled,
  });
}

export function useMunicipalities(departmentId: string | null) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.locations.municipalities(departmentId ?? ''),
    queryFn: () => listMunicipalities(client, departmentId as string),
    staleTime: CATALOG_STALE_MS,
    enabled: !!departmentId,
  });
}

/**
 * Departamento y municipios elegidos por NOMBRE (el borrador de dirección guarda nombres). El departamento por defecto
 * sin municipios cargados (pendiente de fuente oficial, D9) queda con `municipalities = []`.
 */
export function useLocationOptions(departmentName: string, enabled = true) {
  const departments = useDepartments(enabled);
  const department = departments.data?.find((d) => d.name === departmentName) ?? null;
  const municipalities = useMunicipalities(enabled ? (department?.id ?? null) : null);
  return {
    departments: departments.data ?? [],
    department,
    municipalities: municipalities.data ?? [],
    isPending: departments.isPending || (!!department && municipalities.isPending),
    isError: departments.isError || municipalities.isError,
    /** Hay departamento válido y su lista está cargada pero vacía. */
    municipalitiesEmpty:
      !!department && municipalities.isSuccess && (municipalities.data?.length ?? 0) === 0,
    refetch: () => {
      void departments.refetch();
      void municipalities.refetch();
    },
  };
}

// ── Cobertura (tienda) ───────────────────────────────────────────────────────────────────

export interface AddressSelection {
  department: string;
  municipality: string;
  /** Zona numérica del borrador (`'10'`) o '' si no aplica; se envía como `Zona 10`. */
  zone: string;
}

export type AddressCoverageState = 'idle' | 'loading' | 'error' | 'ready';

/**
 * Cobertura de una selección COMPLETA (departamento → municipio → zona) en cada sucursal indicada. Solo consulta cuando
 * `enabled` (la selección está completa): nunca por pulsación ni al abrir Home/Menú. Una consulta por sucursal; el
 * resultado por proveedor y la elegibilidad vienen del servidor.
 */
export function useAddressCoverage(
  selection: AddressSelection,
  branchIds: readonly string[],
  enabled: boolean,
) {
  const client = useDataClient();
  const options = useLocationOptions(selection.department, enabled);
  const municipality =
    options.municipalities.find((m) => m.name === selection.municipality) ?? null;
  const zone = coverageZoneOf(selection.zone);
  const ids = useMemo(() => [...new Set(branchIds)], [branchIds]);
  const active = enabled && !!municipality && ids.length > 0;

  const checks = useQueries({
    queries: ids.map((branchId) => ({
      queryKey: queryKeys.deliveryCoverage.check(branchId, municipality?.id ?? '', zone),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        checkDeliveryCoverage(
          client,
          { branchId, municipalityId: municipality?.id as string, zone },
          signal,
        ),
      enabled: active,
      staleTime: COVERAGE_STALE_MS,
      gcTime: COVERAGE_GC_MS,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });

  const outcomes = ids.flatMap((id, i) => {
    const data = checks[i]?.data;
    return data ? [outcomeOf(data)] : [];
  });
  const state: AddressCoverageState = !enabled
    ? 'idle'
    : options.isError || (active && checks.some((c) => c.isError))
      ? 'error'
      : options.isPending || (active && checks.some((c) => c.isPending))
        ? 'loading'
        : !municipality
          ? 'idle'
          : 'ready';
  const best: CoverageOutcome | null = state === 'ready' ? bestOutcome(outcomes) : null;
  const byBranch = Object.fromEntries(outcomes.map((o) => [o.branchId, o]));
  return {
    state,
    best,
    byBranch: byBranch as Record<string, CoverageOutcome | undefined>,
    /** La selección está completa pero el departamento no tiene municipios cargados (D9). */
    municipalityUnavailable: enabled && options.municipalitiesEmpty,
    refetch: () => {
      options.refetch();
      checks.forEach((c) => void c.refetch());
    },
  };
}

// ── Admin: zonas ───────────────────────────────────────────────────────────────────────────

export function useAdminDeliveryZones(filters: DeliveryZoneFilters = {}, enabled = true) {
  const client = useDataClient();
  const staff = !!useDemoSession().staff;
  return useQuery({
    queryKey: queryKeys.deliveryZones.admin(filters),
    queryFn: () => listAdminDeliveryZones(client, filters),
    enabled: staff && enabled,
    // Mantiene la página anterior mientras llega la nueva (sin parpadeo al filtrar/paginar).
    placeholderData: (previous) => previous,
  });
}

export function useAdminDeliveryZone(id: string | null) {
  const client = useDataClient();
  const staff = !!useDemoSession().staff;
  return useQuery({
    queryKey: queryKeys.deliveryZones.detail(id ?? ''),
    queryFn: () => getAdminDeliveryZone(client, id as string),
    enabled: staff && !!id,
  });
}

export function useDeliverySettings(branchId: string | null) {
  const client = useDataClient();
  const staff = !!useDemoSession().staff;
  return useQuery({
    queryKey: queryKeys.deliverySettings.branch(branchId ?? ''),
    queryFn: () => getAdminBranchDeliverySettings(client, branchId as string),
    enabled: staff && !!branchId,
  });
}

/**
 * Invalidación QUIRÚRGICA tras guardar una zona: listas admin, detalle de esa zona y las comprobaciones de cobertura de
 * ESA sucursal. Nunca los catálogos geográficos ni la cobertura de otras sucursales. Se espera el refetch.
 */
export function invalidateAfterZone(queryClient: QueryClient, zone: AdminDeliveryZone) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.deliveryZones.adminLists }),
    queryClient.invalidateQueries({ queryKey: queryKeys.deliveryZones.detail(zone.id) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCoverage.branch(zone.branchId) }),
  ]);
}

/** Tras cambiar la configuración: la de esa sucursal y su cobertura (el flag cambia qué proveedores aplican). */
export function invalidateAfterSettings(queryClient: QueryClient, branchId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.deliverySettings.branch(branchId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCoverage.branch(branchId) }),
  ]);
}

export function useCreateDeliveryZone() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeliveryZoneRequest) => createAdminDeliveryZone(client, input),
    onSuccess: (zone) => invalidateAfterZone(queryClient, zone),
  });
}

export function useUpdateDeliveryZone() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeliveryZoneRequest }) =>
      updateAdminDeliveryZone(client, id, input),
    onSuccess: (zone) => invalidateAfterZone(queryClient, zone),
  });
}

export function useSetDeliveryZoneStatus() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeliveryZoneStatusRequest }) =>
      updateAdminDeliveryZoneStatus(client, id, input),
    onSuccess: (zone) => invalidateAfterZone(queryClient, zone),
  });
}

export function useUpdateDeliverySettings() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      branchId,
      input,
    }: {
      branchId: string;
      input: UpdateBranchDeliverySettingsRequest;
    }) => updateAdminBranchDeliverySettings(client, branchId, input),
    onSuccess: (_settings, { branchId }) => invalidateAfterSettings(queryClient, branchId),
  });
}

// ── 🎭 Solo simulación (mock) ─────────────────────────────────────────────────────────────

/** Escenario simulado de PedidosYa. Solo corre con el adaptador mock: en http la ruta no existe. */
export function usePedidosyaScenario() {
  const client = useDataClient();
  const staff = !!useDemoSession().staff;
  return useQuery({
    queryKey: ['deliveryCoverage', 'demo', 'pedidosya-scenario'] as const,
    queryFn: () => getPedidosyaCoverageScenario(client),
    enabled: staff && client.kind === 'mock',
  });
}

export function useSetPedidosyaScenario() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scenario: PedidosyaCoverageScenario) =>
      setPedidosyaCoverageScenario(client, scenario),
    // Cambia `integrationStatus` y la cobertura de TODAS las sucursales (y los resúmenes de configuración).
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCoverage.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.deliverySettings.all }),
      ]),
  });
}
