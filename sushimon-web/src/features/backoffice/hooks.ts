'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BranchAvailability, PromotionInput, StaffUserInput } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createCategory,
  createProduct,
  createPromotion,
  createUser,
  getReportHistory,
  getReportSummary,
  listBoBranches,
  listBoCategories,
  listBoProducts,
  listBoPromotions,
  listUsers,
  setProductAvailability,
  updateBranch,
  updateCategory,
  updateProduct,
  updatePromotion,
  updateUser,
  type BranchUpdate,
  type CategoryInput,
  type ProductInput,
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

function useInvalidatingMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  keys: QueryKey[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Se espera el refetch: mientras tanto la mutación sigue «pendiente» y la UI no ofrece de nuevo la
    // misma acción sobre datos obsoletos (p. ej. «Agregar sucursal» sobre el mismo hueco).
    onSuccess: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export function useBoProducts() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.products,
    queryFn: () => listBoProducts(client),
    enabled,
  });
}

/** Crear (sin `id`) o editar (con `id`) un producto — admin. */
export function useSaveProduct() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, input }: { id?: string; input: ProductInput }) =>
      id ? updateProduct(client, id, input) : createProduct(client, input),
    [queryKeys.catalog.all],
  );
}

/** Disponibilidad por sucursal — encargado (su sucursal) o admin. */
export function useSetProductAvailability() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, availability }: { id: string; availability: BranchAvailability[] }) =>
      setProductAvailability(client, id, availability),
    [queryKeys.catalog.all],
  );
}

export function useBoCategories() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.categories,
    queryFn: () => listBoCategories(client),
    enabled,
  });
}

export function useSaveCategory() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, input }: { id?: string; input: Partial<CategoryInput> }) =>
      id ? updateCategory(client, id, input) : createCategory(client, input as CategoryInput),
    [queryKeys.catalog.all],
  );
}

export function useBoPromotions() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.promotions,
    queryFn: () => listBoPromotions(client),
    enabled,
  });
}

/** Crear (sin `id`) o editar/activar (con `id`, campos parciales) una promoción. */
export function useSavePromotion() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, input }: { id?: string; input: Partial<PromotionInput> }) =>
      id ? updatePromotion(client, id, input) : createPromotion(client, input as PromotionInput),
    [queryKeys.catalog.all],
  );
}

// ── Administración ────────────────────────────────────────────────────────────────────────

export function useBoBranches() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.branches,
    queryFn: () => listBoBranches(client),
    enabled,
  });
}

export function useUpdateBranch() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: BranchUpdate }) => updateBranch(client, id, input),
    [queryKeys.backoffice.branches, queryKeys.store.branches, ['backoffice', 'dashboard']],
  );
}

export function useUsers() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.users,
    queryFn: () => listUsers(client),
    enabled,
  });
}

/** Crear (sin `id`) o editar (con `id`) un usuario interno — admin. */
export function useSaveUser() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, input }: { id?: string; input: Partial<StaffUserInput> }) =>
      id ? updateUser(client, id, input) : createUser(client, input as StaffUserInput),
    [queryKeys.backoffice.users],
  );
}

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
