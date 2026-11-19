'use client';

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { isApiError } from '@/lib/data-access/errors';
import type { OrderTracking } from '@/lib/data-access/models';

/**
 * F21 (spec 022 §9.3, ADR-0027 D7) — Polling CONTROLADO del seguimiento con TanStack Query, sin WebSockets/SSE. El intervalo lo
 * programa este hook (no `refetchInterval`) para que el siguiente ciclo empiece al TERMINAR el anterior (sin solapamiento) y para
 * aplicar backoff, `Retry-After`, pausa en pestaña oculta y paradas (terminal, acceso perdido, 8 fallos).
 */

export const POLL_MIN_MS = 10_000;
export const POLL_MAX_MS = 120_000;
export const POLL_DEFAULT_MS = 30_000;
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_MAX_MS = 120_000;
export const BACKOFF_JITTER = 0.2;
export const MAX_FAILURES = 8;
export const RETRY_AFTER_MIN_MS = 5_000;
export const RETRY_AFTER_MAX_MS = 120_000;
/** Ventana en la que un refetch al volver a la pestaña se considera duplicado. */
export const RESUME_STALE_MS = 5_000;
export const TRACKING_GC_MS = 60_000;

/** `pollAfterSeconds` del servidor acotado a [10, 120] s; si falta o no es un número, 30 s. */
export function pollIntervalMs(pollAfterSeconds: number | null | undefined): number {
  if (typeof pollAfterSeconds !== 'number' || !Number.isFinite(pollAfterSeconds)) {
    return POLL_DEFAULT_MS;
  }
  return Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, pollAfterSeconds * 1000));
}

/** Espera tras el fallo n-ésimo consecutivo (n ≥ 1): `min(120 s, 15 s × 2^(n−1))` ±20 % (`random` ∈ [0,1)). */
export function backoffMs(failures: number, random: number): number {
  const n = Math.max(1, Math.floor(failures));
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
  return Math.round(base * (1 + (random * 2 - 1) * BACKOFF_JITTER));
}

/** `Retry-After` (segundos) acotado a [5, 120] s. */
export function retryAfterMs(seconds: number): number {
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, seconds * 1000));
}

export type TrackingErrorKind = 'lost' | 'rate' | 'transient';

/**
 * 429 = recuperable (espera `Retry-After`; NO es acceso perdido). Red caída, 5xx y 503 = transitorio (backoff). Cualquier otro
 * 4xx (404/401/403 y el 400 de un id imposible) = acceso perdido: el mismo mensaje, sin revelar nada.
 */
export function classifyTrackingError(error: unknown): TrackingErrorKind {
  if (!isApiError(error)) return 'transient';
  if (error.status === 429) return 'rate';
  if (error.status === 0 || error.status >= 500) return 'transient';
  return 'lost';
}

interface Failures {
  key: string;
  count: number;
}
type FailureAction = { type: 'fail' | 'reset'; key: string };

function failuresReducer(state: Failures, action: FailureAction): Failures {
  const base = state.key === action.key ? state.count : 0;
  return { key: action.key, count: action.type === 'fail' ? base + 1 : 0 };
}

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const isHidden = () => document.visibilityState === 'hidden';

export interface TrackingPollState {
  data: OrderTracking | undefined;
  error: Error | null;
  /** Primera carga en curso (aún sin datos ni error). */
  isLoading: boolean;
  isFetching: boolean;
  /** Acceso perdido: 404/401/403 (o 4xx). El polling se detiene. */
  lost: boolean;
  /** Estado terminal: el polling se detiene. */
  terminal: boolean;
  /** Último resultado fallido por red/5xx/503 (los datos anteriores, si hay, siguen siendo los últimos conocidos). */
  failing: boolean;
  /** Segundos de espera pedidos por el servidor en un 429 reciente (el polling continúa). */
  rateLimitSec: number | null;
  /** 8 fallos seguidos: se detuvo y ofrece «Reintentar». */
  gaveUp: boolean;
  failures: number;
  /** Marca de tiempo (ms) del último resultado recibido con éxito; 0 si ninguno. */
  updatedAt: number;
  /** Reintento manual: reinicia el contador y consulta ya. */
  retry: () => void;
}

export interface TrackingPollOptions {
  queryKey: QueryKey;
  enabled: boolean;
  fetcher: (signal: AbortSignal) => Promise<OrderTracking>;
  /** Solo pruebas: fuente de jitter ∈ [0,1). */
  random?: () => number;
}

/** Consulta de seguimiento con el polling descrito arriba. El token de invitado NUNCA entra en `queryKey`. */
export function useTrackingPolling({
  queryKey,
  enabled,
  fetcher,
  random = Math.random,
}: TrackingPollOptions): TrackingPollState {
  const keyId = JSON.stringify(queryKey);
  const [failureState, dispatch] = useReducer(failuresReducer, { key: keyId, count: 0 });
  const failures = failureState.key === keyId ? failureState.count : 0;
  const fetcherRef = useRef(fetcher);
  const randomRef = useRef(random);
  useEffect(() => {
    fetcherRef.current = fetcher;
    randomRef.current = random;
  });

  const query = useQuery<OrderTracking, Error>({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      try {
        const result = await fetcherRef.current(signal);
        dispatch({ type: 'reset', key: keyId });
        return result;
      } catch (error) {
        if ((error as Error | undefined)?.name === 'AbortError') throw error;
        // Solo los fallos transitorios cuentan para el tope de 8; un 429 es recuperable y un 404 detiene por otra vía.
        if (classifyTrackingError(error) === 'transient') dispatch({ type: 'fail', key: keyId });
        throw error;
      }
    },
    retry: false,
    gcTime: TRACKING_GC_MS,
    staleTime: RESUME_STALE_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Un pedido ya terminado no se vuelve a consultar al montar de nuevo la pantalla.
    refetchOnMount: (q) => !q.state.data?.terminal,
  });

  const { data, error, isFetching, isError, refetch, dataUpdatedAt, errorUpdatedAt } = query;
  const errorKind = isError ? classifyTrackingError(error) : null;
  const lost = errorKind === 'lost';
  const terminal = !!data && (data.terminal || data.pollAfterSeconds === null);
  const gaveUp = failures >= MAX_FAILURES && errorKind === 'transient';
  const stopped = !enabled || lost || terminal || gaveUp;
  const hidden = useSyncExternalStore(subscribeVisibility, isHidden, () => false);
  const settledAt = Math.max(dataUpdatedAt, errorUpdatedAt);

  // Programa el SIGUIENTE ciclo solo cuando el anterior terminó (sin solapamiento) y la pestaña es visible.
  useEffect(() => {
    if (stopped || hidden || isFetching) return;
    let delay: number;
    if (errorKind === 'rate') {
      const seconds = isApiError(error) ? error.retryAfterSec : undefined;
      delay = retryAfterMs(seconds ?? POLL_DEFAULT_MS / 1000);
    } else if (errorKind === 'transient') {
      delay = backoffMs(Math.max(1, failures), randomRef.current());
    } else {
      delay = pollIntervalMs(data?.pollAfterSeconds);
    }
    const id = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(id);
    // `settledAt` re-programa tras cada resultado; los demás son las condiciones de parada.
  }, [
    stopped,
    hidden,
    isFetching,
    errorKind,
    error,
    failures,
    data?.pollAfterSeconds,
    refetch,
    settledAt,
  ]);

  // Al volver a la pestaña: consulta inmediata (con `staleTime` de 5 s para no duplicar).
  const wasHidden = useRef(false);
  useEffect(() => {
    const resumed = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    if (!resumed || stopped || isFetching) return;
    if (Date.now() - settledAt >= RESUME_STALE_MS) void refetch();
  }, [hidden, stopped, isFetching, settledAt, refetch]);

  // Al volver la red: reanuda (también tras rendirse) salvo acceso perdido o estado terminal.
  const resumeOnline = enabled && !lost && !terminal;
  useEffect(() => {
    if (!resumeOnline) return;
    const onOnline = () => {
      if (document.visibilityState === 'hidden') return;
      dispatch({ type: 'reset', key: keyId });
      void refetch();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [resumeOnline, keyId, refetch]);

  const retry = useCallback(() => {
    dispatch({ type: 'reset', key: keyId });
    void refetch();
  }, [keyId, refetch]);

  const rateLimitSec =
    errorKind === 'rate' && isApiError(error)
      ? Math.round(retryAfterMs(error.retryAfterSec ?? 30) / 1000)
      : null;

  return {
    data,
    error: error ?? null,
    isLoading: enabled && data === undefined && !isError,
    isFetching,
    lost,
    terminal,
    failing: errorKind === 'transient',
    rateLimitSec,
    gaveUp,
    failures,
    updatedAt: dataUpdatedAt,
    retry,
  };
}
