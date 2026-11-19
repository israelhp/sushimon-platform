'use client';

import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useDataClient } from '@/lib/data-access/provider';
import type { ApiError } from '@/lib/data-access/errors';
import type { OrderReceipt } from '@/lib/data-access/models';
import { getOrderReceipt } from '@/services/orders';
import { queryKeys } from '../query-keys';
import { useCustomerScope } from '../session/customer-scope';

const noopSubscribe = () => () => {};

/**
 * F23 (spec 024 §9.3) — Recibo NO fiscal por UUID (`GET /v1/orders/{id}/receipt`). Misma autorización que el detalle: sesión del
 * dueño o credencial de invitado en `X-Order-Token` (cabecera; JAMÁS en la URL ni en la clave). Clave
 * `['orders','receipt', scope|'guest', id]`, `gcTime` 60 s y sin reintentos: un 401/404 es definitivo y un 429/503 se reintenta a mano.
 * Hasta resolver la identidad no se decide el acceso (evita pedir como invitado a quien está entrando).
 */
export function useOrderReceipt(id: string | null | undefined, guestToken: string | null) {
  const client = useDataClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  // La credencial vive en `sessionStorage`: hasta hidratar no se decide el acceso (evita un desajuste servidor/cliente).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const resolved = mounted && identity.state !== 'pending';
  const hasCredentials = !!guestToken || identity.state === 'ready';
  const query = useQuery<OrderReceipt, ApiError>({
    queryKey: queryKeys.orders.receipt(scope, id ?? ''),
    queryFn: ({ signal }) => getOrderReceipt(client, id as string, { guestToken, signal }),
    enabled: !!id && resolved && hasCredentials,
    retry: false,
    gcTime: 60_000,
    staleTime: 0,
  });
  return {
    ...query,
    pending: !resolved,
    /** Sin sesión NI credencial (otra pestaña/dispositivo, token vencido): NO se hizo ninguna solicitud. */
    noCredentials: !!id && resolved && !hasCredentials,
  };
}
