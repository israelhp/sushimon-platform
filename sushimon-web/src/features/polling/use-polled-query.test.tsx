import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import {
  MAX_FAILURES,
  backoffMs,
  classifyPollError,
  clampPollMs,
  pollMsFrom,
  usePolledQuery,
} from './use-polled-query';

const err = (status: number, retryAfter?: number) =>
  new ApiError(status, 'x', 'm', undefined, undefined, undefined, undefined, retryAfter);
const net = () => new ApiError(0, 'offline', 'sin conexión');

interface Payload {
  n: number;
  pollAfterSeconds?: number;
}

describe('funciones puras', () => {
  it('clampPollMs / pollMsFrom: [10, 60] s, defecto 15 s; el override de pruebas se acota igual', () => {
    expect(clampPollMs(undefined)).toBe(15_000);
    expect(clampPollMs(Number.NaN)).toBe(15_000);
    expect(clampPollMs(1_000)).toBe(10_000);
    expect(clampPollMs(120_000)).toBe(60_000);
    expect(pollMsFrom(15)).toBe(15_000);
    expect(pollMsFrom(5)).toBe(10_000);
    expect(pollMsFrom(300)).toBe(60_000);
    expect(pollMsFrom(undefined)).toBe(15_000);
    expect(pollMsFrom(15, 2_000)).toBe(10_000);
    expect(pollMsFrom(15, 30_000)).toBe(30_000);
    expect(pollMsFrom(15, null)).toBe(15_000);
  });

  it('classifyPollError: 401/403 auth; 429 rate; red/5xx transitorio; 404 y otros 4xx lost', () => {
    expect(classifyPollError(err(401))).toBe('auth');
    expect(classifyPollError(err(403))).toBe('auth');
    expect(classifyPollError(err(429))).toBe('rate');
    expect(classifyPollError(net())).toBe('transient');
    expect(classifyPollError(err(503))).toBe('transient');
    expect(classifyPollError(new TypeError('x'))).toBe('transient');
    expect(classifyPollError(err(404))).toBe('lost');
    expect(classifyPollError(err(400))).toBe('lost');
  });
});

type Step = Payload | ApiError | (() => Promise<Payload>);

function setup(
  steps: Step[],
  opts: { key?: string; enabled?: boolean; poll?: boolean; pollAfterSeconds?: number } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const signals: AbortSignal[] = [];
  let index = 0;
  const fetcher = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    const step = steps[Math.min(index++, steps.length - 1)]!;
    if (typeof step === 'function') return step();
    if (step instanceof ApiError) throw step;
    return step;
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ id }: { id: string }) =>
      usePolledQuery<Payload>({
        queryKey: ['backoffice', 'adminOrders', 'p1', 'board', id],
        enabled: opts.enabled ?? true,
        poll: opts.poll ?? true,
        fetcher,
        intervalMs: (d) => pollMsFrom(d?.pollAfterSeconds ?? opts.pollAfterSeconds),
        random: () => 0.5,
      }),
    { wrapper, initialProps: { id: opts.key ?? 'a' } },
  );
  return { ...view, client, fetcher, signals };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('usePolledQuery', () => {
  it('consulta y repite cada 15 s por defecto', async () => {
    const h = setup([{ n: 1 }, { n: 2 }]);
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await tick(14_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await tick(1_100);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.result.current.data).toEqual({ n: 2 });
  });

  it('el intervalo sale de pollAfterSeconds del servidor, acotado a [10, 60] s', async () => {
    const low = setup([{ n: 1, pollAfterSeconds: 3 }]);
    await tick(0);
    await tick(9_000);
    expect(low.fetcher).toHaveBeenCalledTimes(1);
    await tick(1_200);
    expect(low.fetcher).toHaveBeenCalledTimes(2);
    low.unmount();

    const high = setup([{ n: 1, pollAfterSeconds: 600 }]);
    await tick(0);
    await tick(59_000);
    expect(high.fetcher).toHaveBeenCalledTimes(1);
    await tick(1_200);
    expect(high.fetcher).toHaveBeenCalledTimes(2);
  });

  it('sin solapamiento: la siguiente consulta se programa al TERMINAR la anterior', async () => {
    let release!: () => void;
    const slow: Step = () => new Promise<Payload>((resolve) => (release = () => resolve({ n: 2 })));
    const h = setup([{ n: 1 }, slow, { n: 3 }]);
    await tick(0);
    await tick(15_100); // arranca la lenta
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(60_000); // mientras está en vuelo no se lanza otra
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    release();
    await tick(0);
    await tick(14_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_200);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });

  it('pestaña oculta: no consulta; al volver, consulta inmediata', async () => {
    const h = setup([{ n: 1 }, { n: 2 }]);
    await tick(0);
    setHidden(true);
    await tick(120_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    setHidden(false);
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it('poll=false solo observa: no programa ningún ciclo', async () => {
    const h = setup([{ n: 1 }, { n: 2 }], { poll: false });
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await tick(120_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('error de red: backoff exponencial, conserva los datos previos de la MISMA clave', async () => {
    const h = setup([{ n: 1 }, net(), net(), { n: 4 }]);
    await tick(0);
    await tick(15_100); // falla 1
    expect(h.result.current.failing).toBe(true);
    expect(h.result.current.data).toEqual({ n: 1 });
    expect(h.result.current.failures).toBe(1);
    await tick(backoffMs(1, 0.5) - 500);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_000); // falla 2
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect(h.result.current.failures).toBe(2);
    await tick(backoffMs(2, 0.5) + 100);
    expect(h.result.current.data).toEqual({ n: 4 });
    expect(h.result.current.failing).toBe(false);
    expect(h.result.current.failures).toBe(0);
  });

  it('tras 8 fallos seguidos se detiene y «Reintentar» lo reanuda', async () => {
    const h = setup([net()]);
    await tick(0);
    for (let i = 0; i < MAX_FAILURES; i++) await tick(130_000);
    expect(h.result.current.gaveUp).toBe(true);
    const calls = h.fetcher.mock.calls.length;
    await tick(600_000);
    expect(h.fetcher.mock.calls.length).toBe(calls);
    act(() => h.result.current.retry());
    await tick(0);
    expect(h.fetcher.mock.calls.length).toBe(calls + 1);
  });

  it('429: espera Retry-After (acotado a [5, 120] s) y continúa', async () => {
    const h = setup([{ n: 1 }, err(429, 40), { n: 3 }]);
    await tick(0);
    await tick(15_100);
    expect(h.result.current.errorKind).toBe('rate');
    expect(h.result.current.rateLimitSec).toBe(40);
    expect(h.result.current.failing).toBe(false);
    await tick(39_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_200);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect(h.result.current.data).toEqual({ n: 3 });
  });

  it.each([401, 403, 404])('%i detiene el polling (no reintenta)', async (status) => {
    const h = setup([{ n: 1 }, err(status)]);
    await tick(0);
    await tick(15_100);
    expect(h.result.current.stoppedByError).toBe(true);
    await tick(600_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it('al cambiar de clave (sucursal) NO se muestra el dato anterior y se cancela lo que iba en vuelo', async () => {
    let release!: () => void;
    const pending: Step = () =>
      new Promise<Payload>((resolve) => (release = () => resolve({ n: 99 })));
    const h = setup([{ n: 1 }, pending]);
    await tick(0);
    expect(h.result.current.data).toEqual({ n: 1 });
    h.rerender({ id: 'b' });
    // Otra clave, otra consulta: sin `keepPreviousData` no hay datos mientras carga.
    expect(h.result.current.data).toBeUndefined();
    expect(h.result.current.isLoading).toBe(true);
    await tick(0);
    h.rerender({ id: 'a' });
    expect(h.signals[1]!.aborted).toBe(true);
    release();
  });

  it('enabled=false (sin sesión) no consulta', async () => {
    const h = setup([{ n: 1 }], { enabled: false });
    await tick(60_000);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});
