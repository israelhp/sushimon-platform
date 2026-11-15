'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddressInput } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAddress,
  deleteAddress,
  getMe,
  listAddresses,
  listMyOrders,
  setDefaultAddress,
  updateAddress,
  updateMe,
  type CustomerUpdate,
} from '@/services/account';
import { useDemoSession } from '../session/demo-session';
import { queryKeys } from '../query-keys';

/**
 * Cuenta del cliente. Las consultas se habilitan solo con sesión de cliente (simulada en la
 * Etapa 1); sin sesión, la API respondería 401.
 */
function useSignedIn() {
  return !!useDemoSession().customer;
}

export function useMe() {
  const client = useDataClient();
  const enabled = useSignedIn();
  return useQuery({ queryKey: queryKeys.account.me, queryFn: () => getMe(client), enabled });
}

export function useUpdateMe() {
  const client = useDataClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerUpdate) => updateMe(client, input),
    onSuccess: (me) => qc.setQueryData(queryKeys.account.me, me),
  });
}

export function useAddresses() {
  const client = useDataClient();
  const enabled = useSignedIn();
  return useQuery({
    queryKey: queryKeys.account.addresses,
    queryFn: () => listAddresses(client),
    enabled,
  });
}

function useAddressMutation<T, R>(fn: (args: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.account.addresses });
      void qc.invalidateQueries({ queryKey: queryKeys.account.me });
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

/** Pedidos del cliente con sesión. */
export function useMyOrders() {
  const client = useDataClient();
  const enabled = useSignedIn();
  return useQuery({
    queryKey: queryKeys.orders.mine,
    queryFn: () => listMyOrders(client),
    enabled,
  });
}
