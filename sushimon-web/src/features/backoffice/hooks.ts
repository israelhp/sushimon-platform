'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import {
  getReportHistory,
  getReportSummary,
  listBoCategories,
  type ReportFilters,
} from '@/services/backoffice-admin';
import {
  advanceDelivery,
  changeOrderStatus,
  dispatchOrder,
  getDashboard,
  getStaffMe,
  listBackofficeOrders,
  listDeliveries,
  listRiders,
  quoteCourier,
  simulateIncomingOrder,
  type BackofficeOrderFilters,
  type ChangeOrderStatusArgs,
  type DeliveryFilters,
  type DispatchArgs,
} from '@/services/backoffice-orders';
import { invalidateOrders } from '../orders/hooks';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';

/**
 * Hooks del backoffice. Se habilitan solo con sesión de personal (demostración). Ocultar UI por
 * permiso es cosmético: la autorización la decide la API (en mock, el adaptador la reproduce).
 */
function useStaffEnabled() {
  return !!useDemoSession().staff;
}

interface PollOptions {
  /** ms; p. ej. 30_000 para el tablero de pedidos. */
  refetchInterval?: number;
}

export function useStaffMe() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.me,
    queryFn: () => getStaffMe(client),
    enabled,
  });
}

export function useDashboard(branchId?: string, options: PollOptions = {}) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.dashboard(branchId),
    queryFn: () => getDashboard(client, branchId),
    enabled,
    refetchInterval: options.refetchInterval,
  });
}

export function useBackofficeOrders(
  filters: BackofficeOrderFilters = {},
  options: PollOptions = {},
) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.orders(filters),
    queryFn: () => listBackofficeOrders(client, filters),
    enabled,
    refetchInterval: options.refetchInterval,
  });
}

function useOrdersMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidateOrders(qc);
      void qc.invalidateQueries({ queryKey: ['backoffice', 'riders'] });
    },
  });
}

/** Aceptar/rechazar/preparar/listo/entregar/cancelar (body `{ status, reason? }`). */
export function useChangeOrderStatus() {
  const client = useDataClient();
  return useOrdersMutation((args: ChangeOrderStatusArgs) => changeOrderStatus(client, args));
}

/** Despachar con PedidosYa (simulado) o repartidor propio. */
export function useDispatchOrder() {
  const client = useDataClient();
  return useOrdersMutation((args: DispatchArgs) => dispatchOrder(client, args));
}

/** Cotización PedidosYa SIMULADA (no modifica el pedido). */
export function useCourierQuote() {
  const client = useDataClient();
  return useMutation({ mutationFn: (orderId: string) => quoteCourier(client, orderId) });
}

/** Avanza un paso la logística (la UI decide cuándo: temporizador o botón). */
export function useAdvanceDelivery() {
  const client = useDataClient();
  return useOrdersMutation((orderId: string) => advanceDelivery(client, orderId));
}

/** 🎭 Pedido entrante simulado (solo mock). */
export function useSimulateIncomingOrder() {
  const client = useDataClient();
  return useOrdersMutation((branchId?: string) => simulateIncomingOrder(client, branchId));
}

export function useDeliveries(filters: DeliveryFilters = {}, options: PollOptions = {}) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.deliveries(filters),
    queryFn: () => listDeliveries(client, filters),
    enabled,
    refetchInterval: options.refetchInterval,
  });
}

export function useRiders(branchId?: string) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.riders(branchId),
    queryFn: () => listRiders(client, branchId),
    enabled,
  });
}

// ── Catálogo ──────────────────────────────────────────────────────────────────────────────

export function useBoCategories() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.categories,
    queryFn: () => listBoCategories(client),
    enabled,
  });
}

// ── Reportes ────────────────────────────────────────────────────────────────────────

export function useReportSummary(filters: ReportFilters = {}) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.reportSummary(filters),
    queryFn: () => getReportSummary(client, filters),
    enabled,
  });
}

export function useReportHistory(filters: ReportFilters = {}) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.reportHistory(filters),
    queryFn: () => getReportHistory(client, filters),
    enabled,
  });
}
