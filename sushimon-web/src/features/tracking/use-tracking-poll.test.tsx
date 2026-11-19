import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderTracking } from '@/lib/data-access/models';
import {
  MAX_FAILURES,
  backoffMs,
  classifyTrackingError,
  pollIntervalMs,
  retryAfterMs,
  useTrackingPolling,
} from './use-tracking-poll';

const tracking = (over: Partial<OrderTracking> = {}): OrderTracking => ({
  orderId: '00000000-0000-4000-8000-000000000001',
  displayNumber: 'MON-001001',
  branchId: '00000000-0000-4000-8000-0000000000b1',
  fulfillmentType: 'PICKUP',
  status: 'pending',
  publicStatus: 'received',
  terminal: false,
  placedAt: '2026-11-18T18:00:00.000Z',
  updatedAt: '2026-11-18T18:00:00.000Z',
  generatedAt: '2026-11-18T18:00:05.000Z',
  steps: [],
  events: [],
  eventsTruncated: false,
  delivery: null,
  pollAfterSeconds: 15,
  ...over,
});
const err = (status: number, retryAfter?: number) =>
  new ApiError(status, 'x', 'm', undefined, undefined, undefined, undefined, retryAfter);
const net = () => new ApiError(0, 'offline', 'sin conexión');

describe('funciones puras del polling', () => {
  it('pollIntervalMs: usa pollAfterSeconds acotado a [10, 120] s y 30 s por defecto', () => {
    expect(pollIntervalMs(15)).toBe(15_000);
    expect(pollIntervalMs(5)).toBe(10_000);
    expect(pollIntervalMs(300)).toBe(120_000);
    expect(pollIntervalMs(null)).toBe(30_000);
    expect(pollIntervalMs(undefined)).toBe(30_000);
    expect(pollIntervalMs(Number.NaN)).toBe(30_000);
  });

  it('backoffMs: exponencial 15 s × 2^(n−1) con tope de 120 s y ±20 % de jitter', () => {
    expect(backoffMs(1, 0.5)).toBe(15_000);
    expect(backoffMs(2, 0.5)).toBe(30_000);
    expect(backoffMs(3, 0.5)).toBe(60_000);
    expect(backoffMs(4, 0.5)).toBe(120_000);
    expect(backoffMs(8, 0.5)).toBe(120_000);
    expect(backoffMs(1, 0)).toBe(12_000);
    expect(backoffMs(1, 0.999999)).toBeLessThanOrEqual(18_000);
    expect(backoffMs(8, 0)).toBe(96_000);
    expect(backoffMs(0, 0.5)).toBe(15_000);
  });

  it('retryAfterMs acota a [5, 120] s', () => {
    expect(retryAfterMs(1)).toBe(5_000);
    expect(retryAfterMs(30)).toBe(30_000);
    expect(retryAfterMs(900)).toBe(120_000);
  });

  it('classifyTrackingError: 429 recuperable; red/5xx transitorio; 404/401/403/400 acceso perdido', () => {
    expect(classifyTrackingError(err(429))).toBe('rate');
    expect(classifyTrackingError(net())).toBe('transient');
    expect(classifyTrackingError(err(503))).toBe('transient');
    expect(classifyTrackingError(err(500))).toBe('transient');
    expect(classifyTrackingError(new TypeError('boom'))).toBe('transient');
    for (const s of [400, 401, 403, 404]) expect(classifyTrackingError(err(s))).toBe('lost');
  });
});

type Step = OrderTracking | ApiError | (() => Promise<OrderTracking>);

function setup(
  steps: Step[],
  opts: { key?: string; enabled?: boolean; random?: () => number } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: { signal: AbortSignal }[] = [];
  let index = 0;
  const fetcher = vi.fn(async (signal: AbortSignal) => {
    calls.push({ signal });
    const step = steps[Math.min(index++, steps.length - 1)]!;
    if (typeof step === 'function') return step();
    if (step instanceof ApiError) throw step;
    return step;
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ id, enabled }: { id: string; enabled: boolean }) =>
      useTrackingPolling({
        queryKey: ['orders', 'tracking', 'guest', id],
        enabled,
        fetcher,
        random: opts.random ?? (() => 0.5),
      }),
    { wrapper, initialProps: { id: opts.key ?? 'a', enabled: opts.enabled ?? true } },
  );
  return { ...view, client, fetcher, calls };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('useTrackingPolling', () => {
  it('consulta una vez y vuelve a consultar según pollAfterSeconds del servidor (acotado)', async () => {
    const h = setup([tracking({ pollAfterSeconds: 20 }), tracking({ pollAfterSeconds: 20 })]);
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await tick(19_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await tick(1_100);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.result.current.data?.displayNumber).toBe('MON-001001');
  });

  it('un pollAfterSeconds menor de 10 s se sube a 10 s; sin valor usa 30 s', async () => {
    const low = setup([tracking({ pollAfterSeconds: 5 })]);
    await tick(0);
    await tick(9_000);
    expect(low.fetcher).toHaveBeenCalledTimes(1);
    await tick(1_500);
    expect(low.fetcher).toHaveBeenCalledTimes(2);
    low.unmount();
    const none = setup([tracking({ pollAfterSeconds: undefined as never })]);
    await tick(0);
    await tick(29_000);
    expect(none.fetcher).toHaveBeenCalledTimes(1);
    await tick(1_500);
    expect(none.fetcher).toHaveBeenCalledTimes(2);
  });

  it('sin solapamiento: el siguiente ciclo se programa al TERMINAR el anterior', async () => {
    let release!: (t: OrderTracking) => void;
    const slow = () => new Promise<OrderTracking>((r) => (release = r));
    const h = setup([tracking({ pollAfterSeconds: 10 }), slow, tracking()]);
    await tick(0);
    await tick(10_100); // arranca la 2.ª y queda en vuelo
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(60_000); // mientras está en vuelo no se lanza otra
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await act(async () => release(tracking({ pollAfterSeconds: 10 })));
    await tick(9_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_500);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });

  it('pestaña oculta: pausa; al volver consulta de inmediato; <5 s desde la última no duplica', async () => {
    const h = setup([tracking({ pollAfterSeconds: 15 })]);
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    act(() => setHidden(true));
    await tick(120_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    // Oculta y visible de nuevo antes de 5 s: no se duplica la solicitud.
    act(() => setHidden(true));
    await tick(1_000);
    act(() => setHidden(false));
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it('estado terminal: sin más solicitudes, aunque se enfoque la pestaña o vuelva la red', async () => {
    const h = setup([
      tracking({
        terminal: true,
        status: 'picked_up',
        publicStatus: 'completed',
        pollAfterSeconds: null,
      }),
    ]);
    await tick(0);
    expect(h.result.current.terminal).toBe(true);
    await tick(300_000);
    act(() => setHidden(true));
    act(() => setHidden(false));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await tick(300_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('404/401/403: acceso perdido y se detiene (no hay reintentos)', async () => {
    for (const status of [404, 401, 403]) {
      const h = setup([err(status)]);
      await tick(0);
      expect(h.result.current.lost).toBe(true);
      await tick(600_000);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
      h.unmount();
    }
  });

  it('429: respeta Retry-After, NO es acceso perdido y conserva los datos', async () => {
    const h = setup([
      tracking({ pollAfterSeconds: 10 }),
      err(429, 40),
      tracking({ pollAfterSeconds: 10 }),
    ]);
    await tick(0);
    await tick(10_100);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.result.current.lost).toBe(false);
    expect(h.result.current.rateLimitSec).toBe(40);
    expect(h.result.current.data).toBeDefined();
    await tick(39_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_500);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect(h.result.current.rateLimitSec).toBeNull();
  });

  it('503/red: backoff exponencial con jitter, conserva el último estado y se recupera', async () => {
    const h = setup(
      [tracking({ pollAfterSeconds: 10 }), err(503), net(), tracking({ pollAfterSeconds: 10 })],
      {
        random: () => 0.5,
      },
    );
    await tick(0);
    await tick(10_100); // 2.ª: 503 → espera 15 s
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.result.current.failing).toBe(true);
    expect(h.result.current.data?.displayNumber).toBe('MON-001001');
    await tick(14_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_200); // 3.ª: red caída → espera 30 s
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    await tick(29_000);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    await tick(1_500);
    expect(h.fetcher).toHaveBeenCalledTimes(4);
    expect(h.result.current.failing).toBe(false);
    expect(h.result.current.failures).toBe(0);
  });

  it('el jitter se aplica (random=0 acorta un 20 %)', async () => {
    const h = setup([tracking({ pollAfterSeconds: 10 }), err(503)], { random: () => 0 });
    await tick(0);
    await tick(10_100);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(11_000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await tick(1_500); // 12 s = 15 s × 0,8
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });

  it(`tras ${MAX_FAILURES} fallos seguidos se detiene; «Reintentar» reinicia el contador`, async () => {
    const h = setup([net()], { random: () => 0.5 });
    await tick(0);
    for (let i = 0; i < 20 && !h.result.current.gaveUp; i++) await tick(130_000);
    expect(h.result.current.gaveUp).toBe(true);
    expect(h.fetcher).toHaveBeenCalledTimes(MAX_FAILURES);
    await tick(900_000);
    expect(h.fetcher).toHaveBeenCalledTimes(MAX_FAILURES);
    act(() => h.result.current.retry());
    await tick(0);
    expect(h.fetcher).toHaveBeenCalledTimes(MAX_FAILURES + 1);
    expect(h.result.current.failures).toBe(1);
    expect(h.result.current.gaveUp).toBe(false);
  });

  it('al volver la red (online) reanuda aunque se hubiera rendido', async () => {
    const h = setup([
      net(),
      net(),
      net(),
      net(),
      net(),
      net(),
      net(),
      net(),
      tracking({ pollAfterSeconds: 15 }),
    ]);
    await tick(0);
    for (let i = 0; i < 20 && !h.result.current.gaveUp; i++) await tick(130_000);
    expect(h.result.current.gaveUp).toBe(true);
    act(() => void window.dispatchEvent(new Event('online')));
    await tick(0);
    expect(h.result.current.data?.displayNumber).toBe('MON-001001');
    expect(h.result.current.gaveUp).toBe(false);
  });

  it('cambiar de pedido no mezcla datos y cancela la solicitud en vuelo del anterior', async () => {
    const other = tracking({ displayNumber: 'MON-009999' });
    const h = setup([tracking(), () => new Promise<OrderTracking>(() => {}), other]);
    await tick(0);
    expect(h.result.current.data?.displayNumber).toBe('MON-001001');
    await tick(15_100); // 2.ª solicitud colgada
    const firstSignal = h.calls[1]!.signal;
    h.rerender({ id: 'b', enabled: true });
    await tick(0);
    expect(firstSignal.aborted).toBe(true);
    expect(h.result.current.data?.displayNumber).toBe('MON-009999');
  });

  it('deshabilitado: ninguna solicitud', async () => {
    const h = setup([tracking()], { enabled: false });
    await tick(200_000);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.result.current.isLoading).toBe(false);
  });

  it('desmontar cancela los temporizadores', async () => {
    const h = setup([tracking({ pollAfterSeconds: 10 })]);
    await tick(0);
    h.unmount();
    await tick(300_000);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
});
