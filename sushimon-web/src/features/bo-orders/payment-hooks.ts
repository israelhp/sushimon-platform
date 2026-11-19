'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/features/query-keys';
import type {
  AdminCashPaymentResult,
  AdminOrderPayment,
  AdminPaymentHistory,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  getAdminOrderPayment,
  listAdminOrderPaymentHistory,
  registerAdminOrderCashPayment,
  type RegisterCashPaymentArgs,
} from '@/services/admin-orders';
import { classifyPaymentError } from './cash-payment-model';
import { useStaffKey } from './hooks';

/**
 * F24 (spec 025 §12.2): consultas y comando del pago en efectivo. Las claves llevan a la PERSONA (`staffKey`) y el pedido, igual
 * que el detalle de F22 (nunca se muestra el pago de otra persona/sesión). Sin actualización optimista: el éxito es el que
 * devuelve el servidor. Sin persistencia de importes en `localStorage`/`sessionStorage`.
 */

/** Pago del pedido (`payments.read`). `enabled=false` cuando la persona no tiene el permiso: la API decidiría 403 de todos modos. */
export function useAdminOrderPayment(id: string | null, enabled = true) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return useQuery<AdminOrderPayment, Error>({
    queryKey: queryKeys.backoffice.adminOrders.payment(staffKey, id ?? ''),
    queryFn: ({ signal }) => getAdminOrderPayment(client, id ?? '', signal),
    enabled: staffKey !== null && id !== null && enabled,
    retry: false,
    gcTime: 60_000,
    // Unos segundos de frescura evitan releer al reabrir; la invalidación tras cobrar lo refresca igual.
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}

/** Historial solo-añadir del pago (`payments.read`). */
export function useAdminOrderPaymentHistory(id: string | null, enabled = true) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return useQuery<AdminPaymentHistory, Error>({
    queryKey: queryKeys.backoffice.adminOrders.paymentHistory(staffKey, id ?? ''),
    queryFn: ({ signal }) => listAdminOrderPaymentHistory(client, id ?? '', signal),
    enabled: staffKey !== null && id !== null && enabled,
    retry: false,
    gcTime: 60_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });
}

/**
 * Registra el efectivo recibido. Tras CADA resultado (éxito, 409, 422…) se invalidan detalle, tablero, listado, pago e historial
 * (y las vistas del cliente): ante un 409 el estado real cambió. En un éxito se siembra el pago CONFIRMADO por el servidor.
 */
export function useRegisterCashPayment() {
  const client = useDataClient();
  const qc = useQueryClient();
  const staffKey = useStaffKey();
  return useMutation<AdminCashPaymentResult, Error, RegisterCashPaymentArgs>({
    mutationFn: (args) => registerAdminOrderCashPayment(client, args),
    onSuccess: (result, args) => {
      qc.setQueryData<AdminOrderPayment>(
        queryKeys.backoffice.adminOrders.payment(staffKey, args.id),
        result.payment,
      );
    },
    onError: (error, args) => {
      // 409 con el pago ACTUAL (otra persona cobró o el pedido se cerró): se siembra para refrescar sin otra consulta.
      const current = classifyPaymentError(error).current;
      if (current) {
        qc.setQueryData<AdminOrderPayment>(
          queryKeys.backoffice.adminOrders.payment(staffKey, args.id),
          current,
        );
      }
    },
    onSettled: () => {
      // Solo lo necesario: pedidos del backoffice (detalle, tablero, listado, pago, historial) y el panel. Las vistas del
      // cliente se refrescan solas en su propia sesión (otra persona, otro dispositivo).
      void qc.invalidateQueries({ queryKey: queryKeys.backoffice.adminOrders.all });
      void qc.invalidateQueries({ queryKey: ['backoffice', 'dashboard'] });
    },
  });
}
