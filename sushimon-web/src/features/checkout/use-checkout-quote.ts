'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutQuote } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  buildQuoteRequest,
  canProceedFor,
  classifyQuoteError,
  quoteFingerprint,
  quoteTtlMs,
  shouldRetryQuote,
  type QuoteErrorKind,
  type QuoteInputs,
} from '@/lib/checkout-quote';
import { quoteCheckout } from '@/services/checkout';
import { queryKeys } from '../query-keys';
import { useCustomerScope } from '../session/customer-scope';

/** Reintento único ante `CHECKOUT_BUSY` / red caída (acotado: `shouldRetryQuote`). */
const BUSY_RETRY_MS = 1500;
/** La respuesta es privada: se descarta pronto de la caché. */
const QUOTE_GC_MS = 60_000;

/** Sesión de una clave de cotización: la cuenta (`['customer', scope, …]`) o el invitado (`['checkout', 'guest', …]`). */
const sessionOf = (key: readonly unknown[]): string =>
  key[0] === 'customer' ? String(key[1]) : 'guest';

export type QuoteStatus =
  /** Sin entradas suficientes para cotizar (carrito vacío, otra sucursal, modalidad sin elegir, dirección sin municipio…). */
  | 'idle'
  /** Esperando la pausa de escritura (cupón/zona) o la respuesta de las entradas ACTUALES. */
  | 'loading'
  /** Cotización del servidor para EXACTAMENTE las entradas actuales y aún vigente. */
  | 'ready'
  /** Venció (`expiresAt`): se recotiza sola; mientras tanto NO habilita nada. */
  | 'expired'
  | 'error';

export interface CheckoutQuoteState {
  status: QuoteStatus;
  /** Solo con `ready`: la cotización vigente y coincidente con las entradas actuales. Jamás una respuesta de otra huella. */
  quote: CheckoutQuote | null;
  /**
   * Lo que se PINTA mientras se recalcula: la cotización vigente o, atenuada y rotulada «Actualizando…», la última respuesta de
   * la MISMA sesión (otra huella o vencida). Nunca habilita nada ni se presenta como vigente (`updating`). `null` sin respuesta previa.
   */
  shown: CheckoutQuote | null;
  /** `shown` existe pero NO es la cotización vigente de las entradas actuales. */
  updating: boolean;
  /** Huella de las entradas actuales (`''` sin entradas). */
  fingerprint: string;
  errorKind: QuoteErrorKind | null;
  /** Segundos pedidos por el servidor en un 429 (`Retry-After`). */
  retryAfterSec: number | undefined;
  /** Hay una solicitud en vuelo (también al refrescar por foco/vencimiento). Mientras sea `true` el estado no es `ready`. */
  fetching: boolean;
  /** `ready` + `canProceed` (con la salvedad del pedido programado simulado) + sin recálculo en curso. */
  canContinue: boolean;
  refetch: () => void;
}

/**
 * F19 — Cotización del checkout: `useQuery` con clave por HUELLA de las entradas (`queryKeys.checkout.quote`, aislada por cuenta).
 *  - Cancela con el `signal` de TanStack al cambiar la clave; una respuesta de OTRA huella nunca se lee (cada clave tiene su
 *    caché y las respuestas de otra huella solo se pintan atenuadas como `shown`, nunca como vigentes).
 *  - No recalcula por render: solo cambia la clave si cambian las entradas. `staleTime: 0`, `gcTime` corto, refetch al volver el foco.
 *  - Vigencia: un temporizador por respuesta marca `expired` y recotiza (la duración sale de `expiresAt − generatedAt`).
 *  - `settling` (el cupón o la zona escritos aún no se aplicaron) cuenta como `loading` y bloquea «Continuar».
 * `inputs = null` ⇒ no hay con qué cotizar (`idle`).
 */
export function useCheckoutQuote(
  inputs: QuoteInputs | null,
  options: {
    settling?: boolean;
    scheduled?: boolean;
    /** Refrescar al volver el foco a la ventana (en Pago/Confirmación no: no debe esconder importes a mitad de pago). */
    refreshOnFocus?: boolean;
    /** El servidor limitó la tasa de una cotización CON cupón (429): el cupón se descarta como error LOCAL del campo. */
    onCouponRateLimited?: () => void;
  } = {},
): CheckoutQuoteState {
  const {
    settling = false,
    scheduled = false,
    refreshOnFocus = true,
    onCouponRateLimited,
  } = options;
  const client = useDataClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  // La sesión aún se resuelve: no se cotiza como invitado para luego repetirlo con la cuenta.
  // Con `settling` (la zona escrita aún no se aplica) tampoco se consulta: no se cotiza por pulsación.
  const enabled = inputs !== null && identity.state !== 'pending' && !settling;
  const fingerprint = inputs ? quoteFingerprint(inputs) : '';

  const query = useQuery({
    queryKey: queryKeys.checkout.quote(scope, fingerprint),
    queryFn: async ({ signal }) => {
      const sent = inputs as QuoteInputs;
      try {
        return await quoteCheckout(client, buildQuoteRequest(sent), signal);
      } catch (error) {
        if (sent.couponCode && classifyQuoteError(error) === 'rate-limited')
          onCouponRateLimited?.();
        throw error;
      }
    },
    // Recalculando: se conserva la última respuesta de la MISMA sesión solo para PINTARLA atenuada (nunca habilita nada).
    placeholderData: (previous, previousQuery) => {
      const sameSession = previousQuery
        ? sessionOf(previousQuery.queryKey) === (scope ?? 'guest')
        : false;
      return sameSession ? previous : undefined;
    },
    enabled,
    staleTime: 0,
    gcTime: QUOTE_GC_MS,
    refetchOnWindowFocus: refreshOnFocus,
    refetchOnReconnect: true,
    retry: shouldRetryQuote,
    retryDelay: BUSY_RETRY_MS,
  });

  const { data, dataUpdatedAt, isPlaceholderData, refetch: refetchQuery } = query;

  // Vigencia: `expired` es un hecho de ESTA respuesta (`dataUpdatedAt`); una respuesta nueva empieza vigente.
  const [expiredAt, setExpiredAt] = useState(0);
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    const ttl = quoteTtlMs(data);
    // Contrato incumplido (fechas ilegibles): se marca vencida SIN recotizar (evita un bucle de solicitudes).
    const remaining = ttl === null ? 0 : Math.max(0, dataUpdatedAt + ttl - Date.now());
    const id = setTimeout(() => {
      setExpiredAt(dataUpdatedAt);
      if (ttl !== null) void refetchQuery();
    }, remaining);
    return () => clearTimeout(id);
  }, [data, dataUpdatedAt, isPlaceholderData, refetchQuery]);
  const expired = !!data && !isPlaceholderData && expiredAt >= dataUpdatedAt;

  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  const fetching = query.isFetching;
  const errorKind = query.isError ? classifyQuoteError(query.error) : null;
  const retryAfterSec = query.error instanceof ApiError ? query.error.retryAfterSec : undefined;

  let status: QuoteStatus;
  if (!inputs) status = 'idle';
  else if (settling || identity.state === 'pending') status = 'loading';
  else if (query.isError && !fetching) status = 'error';
  else if (!data || isPlaceholderData) status = 'loading';
  else if (expired) status = 'expired';
  // Recalculando (foco, entradas en caché, vencimiento): los importes anteriores no se muestran ni habilitan nada.
  else if (fetching) status = 'loading';
  else status = 'ready';

  const quote = status === 'ready' ? (data ?? null) : null;
  const shown = inputs && status !== 'error' ? (data ?? null) : null;
  return {
    status,
    quote,
    shown,
    updating: !!shown && !quote,
    fingerprint,
    errorKind,
    retryAfterSec,
    fetching,
    canContinue: !!quote && canProceedFor(quote, scheduled),
    refetch,
  };
}
