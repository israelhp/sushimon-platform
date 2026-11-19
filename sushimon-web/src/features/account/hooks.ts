'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddressInput } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAddress,
  deleteAddress,
  getMe,
  listAddresses,
  listMyDraftOrders,
  setDefaultAddress,
  updateAddress,
  updateMe,
  type CustomerUpdate,
} from '@/services/account';
import { useCustomerScope } from '../session/customer-scope';
import { queryKeys } from '../query-keys';

/**
 * Cuenta del cliente (F04/F05). Las consultas se habilitan SOLO con una identidad de cliente resuelta
 * (`useCustomerScope`): id de Supabase Auth con `AUTH_SOURCE=supabase`, o `demo:<correo>` con la sesión simulada.
 * Sin sesión (o con la identidad aún resolviéndose) no se consulta nada: la API respondería 401. Las claves llevan el
 * `scope` en la raíz, así otra cuenta jamás lee la caché ajena; `useCustomerCacheGuard` la descarta al cambiar/salir.
 */
/** Valor del `scope` cuando no hay identidad: la consulta queda deshabilitada y nunca se llena. */
const NO_SCOPE = 'none';

function useAccountScope(): { scope: string; enabled: boolean } {
  const identity = useCustomerScope();
  return identity.state === 'ready'
    ? { scope: identity.scope, enabled: true }
    : { scope: NO_SCOPE, enabled: false };
}

export function useMe() {
  const client = useDataClient();
  const { scope, enabled } = useAccountScope();
  return useQuery({
    queryKey: queryKeys.customer.account.me(scope),
    queryFn: () => getMe(client),
    enabled,
  });
}

export function useUpdateMe() {
  const client = useDataClient();
  const qc = useQueryClient();
  const { scope } = useAccountScope();
  return useMutation({
    mutationFn: (input: CustomerUpdate) => updateMe(client, input),
    onSuccess: (me) => qc.setQueryData(queryKeys.customer.account.me(scope), me),
  });
}

export function useAddresses() {
  const client = useDataClient();
  const { scope, enabled } = useAccountScope();
  return useQuery({
    queryKey: queryKeys.customer.account.addresses(scope),
    queryFn: () => listAddresses(client),
    enabled,
  });
}

function useAddressMutation<T, R>(fn: (args: T) => Promise<R>) {
  const qc = useQueryClient();
  const { scope } = useAccountScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customer.account.addresses(scope) });
      void qc.invalidateQueries({ queryKey: queryKeys.customer.account.me(scope) });
    },
  });
}

export function useCreateAddress() {
  const client = useDataClient();
  return useAddressMutation((input: AddressInput) => createAddress(client, input));
}

export function useUpdateAddress() {
  const client = useDataClient();
  return useAddressMutation(({ id, input }: { id: string; input: Partial<AddressInput> }) =>
    updateAddress(client, id, input),
  );
}

export function useDeleteAddress() {
  const client = useDataClient();
  return useAddressMutation((id: string) => deleteAddress(client, id));
}

/** Marca la predeterminada (PATCH /v1/me/addresses/{id}/default). La API no admite «ninguna». */
export function useSetDefaultAddress() {
  const client = useDataClient();
  return useAddressMutation((id: string) => setDefaultAddress(client, id));
}

/**
 * 🎭 Solo mock: pedidos BORRADOR (`DraftOrder`) del cliente de demostración (Inicio, consulta e incidencias SIMULADAS). El historial
 * REAL es `useMyOrderHistory` (F23, `GET /v1/me/orders`); este hook se retira junto con esos flujos simulados.
 */
export function useMyDraftOrders({ enabled: wanted = true }: { enabled?: boolean } = {}) {
  const client = useDataClient();
  const account = useAccountScope();
  const scope = account.scope;
  const enabled = account.enabled && wanted;
  return useQuery({
    queryKey: queryKeys.customer.orders.mine(scope),
    queryFn: () => listMyDraftOrders(client),
    enabled,
  });
}
