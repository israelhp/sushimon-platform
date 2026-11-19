'use client';

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import {
  BACKOFF_JITTER,
  MAX_FAILURES,
  RESUME_STALE_MS,
  backoffMs,
  retryAfterMs,
} from '@/features/tracking/use-tracking-poll';
import { isApiError } from '@/lib/data-access/errors';

/**
 * F22 (spec 023 §10.3) — Polling CONTROLADO genérico con TanStack Query, sin WebSockets/SSE. Misma política que el seguimiento de
 * F21 (`use-tracking-poll.ts`, que NO se modifica: se reutilizan sus constantes y funciones puras), pero con el intervalo acotado a
 * [10, 60] s, defecto 15 s, y las paradas propias del backoffice (401/403, 404, 8 fallos). El siguiente ciclo se programa al TERMINAR
 * el anterior (sin solapamiento), con la pestaña visible y UN solo temporizador por observador.
 */

export const ORDERS_POLL_MIN_MS = 10_000;
export const ORDERS_POLL_MAX_MS = 60_000;
export const ORDERS_POLL_DEFAULT_MS = 15_000;
export const POLLED_GC_MS = 60_000;

export { BACKOFF_JITTER, MAX_FAILURES, backoffMs, retryAfterMs };

/** Intervalo acotado a [10, 60] s; sin valor válido, 15 s. */
export function clampPollMs(ms: number | null | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ORDERS_POLL_DEFAULT_MS;
  return Math.min(ORDERS_POLL_MAX_MS, Math.max(ORDERS_POLL_MIN_MS, ms));
}

/** `pollAfterSeconds` del servidor (o `override` en ms, solo pruebas) acotado a [10, 60] s. */
export function pollMsFrom(
  pollAfterSeconds: number | null | undefined,
  overrideMs?: number | null,
): number {
  if (typeof overrideMs === 'number' && Number.isFinite(overrideMs)) return clampPollMs(overrideMs);
  return typeof pollAfterSeconds === 'number'
    ? clampPollMs(pollAfterSeconds * 1000)
    : ORDERS_POLL_DEFAULT_MS;
}

/** `auth` (401/403: se detiene y pide sesión/permiso), `lost` (404/4xx: se detiene), `rate` (429), `transient` (red, 5xx, 503). */
export type PollErrorKind = 'auth' | 'lost' | 'rate' | 'transient';

export function classifyPollError(error: unknown): PollErrorKind {
  if (!isApiError(error)) return 'transient';
  if (error.status === 401 || error.status === 403) return 'auth';
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

export interface PolledQueryState<T> {
  data: T | undefined;
  error: Error | null;
  /** Primera carga en curso (aún sin datos ni error). */
  isLoading: boolean;
  isFetching: boolean;
  /** Clase del ÚLTIMO error (`null` si el último resultado fue correcto). */
  errorKind: PollErrorKind | null;
  /** Red/5xx/503 recientes: los datos anteriores de LA MISMA clave siguen siendo los últimos conocidos. */
  failing: boolean;
  /** Segundos pedidos por el servidor en un 429 reciente (el polling continúa). */
  rateLimitSec: number | null;
  /** 8 fallos seguidos: se detuvo y ofrece «Reintentar». */
  gaveUp: boolean;
  /** 401/403/404: se detuvo. */
  stoppedByError: boolean;
  failures: number;
  /** Marca de tiempo (ms) del último resultado correcto; 0 si ninguno. */
  updatedAt: number;
  /** Reintento manual: reinicia el contador y consulta ya. */
  retry: () => void;
}

export interface PolledQueryOptions<T> {
  queryKey: QueryKey;
  enabled: boolean;
  fetcher: (signal: AbortSignal) => Promise<T>;
  /** Intervalo del siguiente ciclo según los datos recibidos (acotado por quien llama). */
  intervalMs: (data: T | undefined) => number;
  /** `false` = solo observa (no programa ciclos): lo usan quienes comparten la clave con el sondeador. */
  poll?: boolean;
  /** Solo pruebas: fuente de jitter ∈ [0,1). */
  random?: () => number;
}

/** Consulta con polling controlado: pausa en pestaña oculta, refetch al volver, backoff con jitter, `Retry-After`, paradas. */
export function usePolledQuery<T>({
  queryKey,
  enabled,
  fetcher,
  intervalMs,
  poll = true,
  random = Math.random,
}: PolledQueryOptions<T>): PolledQueryState<T> {
  const keyId = JSON.stringify(queryKey);
  const [failureState, dispatch] = useReducer(failuresReducer, { key: keyId, count: 0 });
  const failures = failureState.key === keyId ? failureState.count : 0;
  const fetcherRef = useRef(fetcher);
  const randomRef = useRef(random);
  const intervalRef = useRef(intervalMs);
  useEffect(() => {
    fetcherRef.current = fetcher;
    randomRef.current = random;
    intervalRef.current = intervalMs;
  });

  const query = useQuery<T, Error>({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      try {
        const result = await fetcherRef.current(signal);
        dispatch({ type: 'reset', key: keyId });
        return result;
      } catch (error) {
        if ((error as Error | undefined)?.name === 'AbortError') throw error;
        if (classifyPollError(error) === 'transient') dispatch({ type: 'fail', key: keyId });
        throw error;
      }
    },
    retry: false,
    gcTime: POLLED_GC_MS,
    staleTime: RESUME_STALE_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Sin `placeholderData`: al cambiar de clave (sucursal/filtro) NO se muestra la consulta anterior.
  });

  const { data, error, isFetching, isError, refetch, dataUpdatedAt, errorUpdatedAt } = query;
  const errorKind = isError ? classifyPollError(error) : null;
  const stoppedByError = errorKind === 'auth' || errorKind === 'lost';
  const gaveUp = failures >= MAX_FAILURES && errorKind === 'transient';
  const stopped = !enabled || !poll || stoppedByError || gaveUp;
  const hidden = useSyncExternalStore(subscribeVisibility, isHidden, () => false);
  const settledAt = Math.max(dataUpdatedAt, errorUpdatedAt);

  // Programa el SIGUIENTE ciclo solo cuando el anterior terminó y la pestaña es visible.
  useEffect(() => {
    if (stopped || hidden || isFetching) return;
    let delay: number;
    if (errorKind === 'rate') {
      const seconds = isApiError(error) ? error.retryAfterSec : undefined;
      delay = retryAfterMs(seconds ?? 30);
    } else if (errorKind === 'transient') {
      delay = backoffMs(Math.max(1, failures), randomRef.current());
    } else {
      delay = intervalRef.current(data);
    }
    const id = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(id);
  }, [stopped, hidden, isFetching, errorKind, error, failures, data, refetch, settledAt]);

  // Al volver a la pestaña: consulta inmediata (con `staleTime` de 5 s para no duplicar).
  const wasHidden = useRef(false);
  useEffect(() => {
    const resumed = wasHidden.current && !hidden;
    wasHidden.current = hidden;
    if (!resumed || stopped || isFetching) return;
    if (Date.now() - settledAt >= RESUME_STALE_MS) void refetch();
  }, [hidden, stopped, isFetching, settledAt, refetch]);

  // Al volver la red: reanuda (también tras rendirse) salvo parada por 401/403/404 o sin sondeo.
  const resumeOnline = enabled && poll && !stoppedByError;
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
    errorKind,
    failing: errorKind === 'transient',
    rateLimitSec,
    gaveUp,
    stoppedByError,
    failures,
    updatedAt: dataUpdatedAt,
    retry,
  };
}
