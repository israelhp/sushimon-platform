import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutQuote, CheckoutQuoteRequest } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import type { QuoteInputs } from '@/lib/checkout-quote';
import { renderStore } from '@/test/store-providers';
import { queryKeys } from '../query-keys';
import { useCheckoutQuote } from './use-checkout-quote';

/**
 * Cliente de pruebas para `POST /v1/checkout/quote`: cada llamada se retiene hasta que la prueba la resuelve o la rechaza,
 * así se controla el ORDEN de las respuestas (carreras) y se observa el `signal` de cancelación.
 */
interface Call {
  body: CheckoutQuoteRequest;
  signal: AbortSignal | undefined;
  resolve: (quote: CheckoutQuote) => void;
  reject: (error: ApiError) => void;
}

function makeQuote(
  over: Partial<CheckoutQuote> & { ttlMs?: number; total?: string } = {},
): CheckoutQuote {
  const { ttlMs = 600_000, total = '53.00', ...rest } = over;
  const at = Date.now();
  return {
    quote: {
      generatedAt: new Date(at).toISOString(),
      expiresAt: new Date(at + ttlMs).toISOString(),
      token: null,
    },
    currency: 'GTQ',
    branch: { id: 'b1', isAcceptingOrders: true, reason: 'OPEN', nextOpensAt: null },
    fulfillment: { type: 'PICKUP', delivery: null },
    lines: [],
    subtotal: total,
    extrasTotal: '0.00',
    discountTotal: '0.00',
    deliveryFee: '0.00',
    total,
    coupon: null,
    canProceed: true,
    blockers: [],
    notices: [],
    ...rest,
  } as CheckoutQuote;
}

function setup() {
  const calls: Call[] = [];
  const wrapClient = (base: DataClient): DataClient =>
    withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
      if (path !== paths.checkoutQuote()) return base.request<T>(path, options);
      return new Promise<T>((resolve, reject) => {
        calls.push({
          body: options.body as CheckoutQuoteRequest,
          signal: options.signal,
          resolve: (q) => resolve(q as T),
          reject,
        });
      });
    });
  return { calls, wrapClient };
}

const cartOf = (productId: string, quantity = 1): QuoteInputs['cart'] => ({
  branchId: 'b1',
  lines: [{ productId, quantity, selections: [] }],
});
const inputsOf = (over: Partial<QuoteInputs> = {}): QuoteInputs => ({
  cart: cartOf('a'),
  fulfillment: { type: 'PICKUP' },
  couponCode: '',
  ...over,
});

let renders = 0;
function Probe({ inputs, settling = false }: { inputs: QuoteInputs | null; settling?: boolean }) {
  renders++;
  const q = useCheckoutQuote(inputs, { settling });
  return (
    <div>
      <p data-testid="status">{q.status}</p>
      <p data-testid="total">{q.quote?.total ?? 'none'}</p>
      <p data-testid="shown">{q.shown?.total ?? 'none'}</p>
      <p data-testid="updating">{String(q.updating)}</p>
      <p data-testid="can">{String(q.canContinue)}</p>
      <p data-testid="error">{q.errorKind ?? 'none'}</p>
      <button onClick={q.refetch}>refetch</button>
    </div>
  );
}
const text = (id: string) => screen.getByTestId(id).textContent;
const waitForCalls = (calls: Call[], n: number) =>
  waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(n));

describe('useCheckoutQuote', () => {
  it('sin entradas está `idle` y NO consulta; con entradas pasa de loading a ready y habilita', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={null} />, { wrapClient });
    expect(text('status')).toBe('idle');
    expect(text('can')).toBe('false');
    expect(calls).toHaveLength(0);

    await act(async () => view.rerender(<Probe inputs={inputsOf()} />));
    await waitForCalls(calls, 1);
    expect(text('status')).toBe('loading');
    expect(text('can')).toBe('false');
    await act(async () => calls[0]!.resolve(makeQuote({ total: '53.00' })));
    await waitFor(() => expect(text('status')).toBe('ready'));
    expect(text('total')).toBe('53.00');
    expect(text('can')).toBe('true');
    expect(calls[0]!.body.cart.lines[0]!.productId).toBe('a');
  });

  it('no recalcula por render: re-render con las MISMAS entradas no emite otra solicitud', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote()));
    await waitFor(() => expect(text('status')).toBe('ready'));
    const before = renders;
    // Objeto NUEVO pero con la misma huella (p. ej. `clientView` distinta): misma clave, sin solicitud.
    await act(async () =>
      view.rerender(
        <Probe inputs={inputsOf({ clientView: { lines: [{ index: 0, unitPrice: '53.00' }] } })} />,
      ),
    );
    expect(renders).toBeGreaterThan(before);
    expect(calls).toHaveLength(1);
    expect(text('status')).toBe('ready');
  });

  it('carrera: la respuesta obsoleta (otra huella) se descarta y la última entrada manda', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={inputsOf({ cart: cartOf('a') })} />, {
      wrapClient,
    });
    await waitForCalls(calls, 1);
    await act(async () => view.rerender(<Probe inputs={inputsOf({ cart: cartOf('b') })} />));
    await waitForCalls(calls, 2);
    // Responde primero la NUEVA y después la vieja.
    await act(async () => calls[1]!.resolve(makeQuote({ total: '85.00' })));
    await waitFor(() => expect(text('total')).toBe('85.00'));
    await act(async () => calls[0]!.resolve(makeQuote({ total: '1.00' })));
    expect(text('total')).toBe('85.00');
    expect(text('status')).toBe('ready');
  });

  it('al cambiar las entradas NO queda `ready` con datos de las anteriores y cancela la solicitud vieja con su `signal`', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={inputsOf({ cart: cartOf('a') })} />, {
      wrapClient,
    });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote({ total: '53.00' })));
    await waitFor(() => expect(text('status')).toBe('ready'));

    await act(async () => view.rerender(<Probe inputs={inputsOf({ cart: cartOf('a', 2) })} />));
    expect(text('status')).toBe('loading');
    expect(text('total')).toBe('none');
    expect(text('can')).toBe('false');
    await waitForCalls(calls, 2);

    // Una tercera entrada antes de responder la segunda: la segunda se cancela.
    await act(async () => view.rerender(<Probe inputs={inputsOf({ cart: cartOf('a', 3) })} />));
    await waitForCalls(calls, 3);
    expect(calls[1]!.signal?.aborted).toBe(true);
    expect(calls[2]!.signal?.aborted).toBe(false);
  });

  it('`settling` (zona sin aplicar) NO consulta y mantiene `loading`; al aplicarse cotiza', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={inputsOf()} settling />, { wrapClient });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(0);
    expect(text('status')).toBe('loading');
    expect(text('can')).toBe('false');
    await act(async () => view.rerender(<Probe inputs={inputsOf()} />));
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote()));
    await waitFor(() => expect(text('status')).toBe('ready'));
  });

  it('canProceed=false del servidor no habilita; con bloqueos el estado sigue `ready` (se muestran)', async () => {
    const { calls, wrapClient } = setup();
    await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () =>
      calls[0]!.resolve(
        makeQuote({
          canProceed: false,
          blockers: [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }],
        }),
      ),
    );
    await waitFor(() => expect(text('status')).toBe('ready'));
    expect(text('can')).toBe('false');
  });

  it('vigencia: al vencer pasa a `expired` (no habilita) y recotiza sola', async () => {
    const { calls, wrapClient } = setup();
    await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote({ ttlMs: 60, total: '53.00' })));
    await waitFor(() => expect(text('status')).toBe('ready'));
    await waitForCalls(calls, 2); // recotización automática al vencer
    expect(text('status')).toBe('expired');
    expect(text('can')).toBe('false');
    await act(async () => calls[1]!.resolve(makeQuote({ total: '54.00' })));
    await waitFor(() => expect(text('status')).toBe('ready'));
    expect(text('total')).toBe('54.00');
  });

  it('un contrato con fechas inválidas no provoca un bucle de recotización', async () => {
    const { calls, wrapClient } = setup();
    await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    const bad = makeQuote();
    bad.quote = { generatedAt: 'x', expiresAt: 'y', token: null };
    await act(async () => calls[0]!.resolve(bad));
    await waitFor(() => expect(text('status')).toBe('expired'));
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toHaveLength(1);
  });

  it('refetch manual (foco): mientras recalcula no habilita nada', async () => {
    const { calls, wrapClient } = setup();
    await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote()));
    await waitFor(() => expect(text('can')).toBe('true'));
    await act(async () => screen.getByText('refetch').click());
    await waitForCalls(calls, 2);
    expect(text('status')).toBe('loading');
    expect(text('can')).toBe('false');
    await act(async () => calls[1]!.resolve(makeQuote()));
    await waitFor(() => expect(text('can')).toBe('true'));
  });

  it('errores: 429 sin reintento automático; 422 BRANCH_NOT_AVAILABLE clasificado; «Reintentar» recotiza', async () => {
    const { calls, wrapClient } = setup();
    await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () =>
      calls[0]!.reject(
        new ApiError(
          429,
          'too_many_requests',
          'x',
          undefined,
          undefined,
          'RATE_LIMITED',
          undefined,
          7,
        ),
      ),
    );
    await waitFor(() => expect(text('status')).toBe('error'));
    expect(text('error')).toBe('rate-limited');
    expect(text('can')).toBe('false');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1);

    await act(async () => screen.getByText('refetch').click());
    await waitForCalls(calls, 2);
    await act(async () =>
      calls[1]!.reject(
        new ApiError(422, 'unprocessable', 'x', undefined, undefined, 'BRANCH_NOT_AVAILABLE'),
      ),
    );
    await waitFor(() => expect(text('error')).toBe('branch-unavailable'));
  });

  it('503 CHECKOUT_BUSY: UN reintento automático acotado y luego error', async () => {
    const { calls, wrapClient } = setup();
    await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () =>
      calls[0]!.reject(
        new ApiError(503, 'server_error', 'x', undefined, undefined, 'CHECKOUT_BUSY'),
      ),
    );
    await waitFor(() => expect(calls).toHaveLength(2), { timeout: 4000 });
    expect(text('status')).toBe('loading');
    await act(async () =>
      calls[1]!.reject(
        new ApiError(503, 'server_error', 'x', undefined, undefined, 'CHECKOUT_BUSY'),
      ),
    );
    await waitFor(() => expect(text('status')).toBe('error'));
    expect(text('error')).toBe('busy');
    await new Promise((r) => setTimeout(r, 1700));
    expect(calls).toHaveLength(2);
  });
});

describe('useCheckoutQuote · última respuesta de la misma sesión (A2)', () => {
  it('al cambiar las entradas se PINTA la anterior (updating) pero nunca es la vigente ni habilita; al llegar la nueva se reemplaza', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote({ total: '53.00' })));
    await waitFor(() => expect(text('status')).toBe('ready'));
    expect(text('updating')).toBe('false');
    await act(async () => view.rerender(<Probe inputs={inputsOf({ cart: cartOf('a', 2) })} />));
    await waitForCalls(calls, 2);
    expect(text('shown')).toBe('53.00');
    expect(text('updating')).toBe('true');
    expect(text('total')).toBe('none');
    expect(text('can')).toBe('false');
    await act(async () => calls[1]!.resolve(makeQuote({ total: '106.00' })));
    await waitFor(() => expect(text('total')).toBe('106.00'));
    expect(text('shown')).toBe('106.00');
    expect(text('updating')).toBe('false');
  });

  it('con `inputs = null` o en error no se pinta nada', async () => {
    const { calls, wrapClient } = setup();
    const view = await renderStore(<Probe inputs={inputsOf()} />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.resolve(makeQuote()));
    await waitFor(() => expect(text('status')).toBe('ready'));
    await act(async () => view.rerender(<Probe inputs={null} />));
    expect(text('shown')).toBe('none');
    await act(async () => view.rerender(<Probe inputs={inputsOf({ cart: cartOf('z') })} />));
    await waitForCalls(calls, 2);
    await act(async () =>
      calls[1]!.reject(new ApiError(422, 'x', 'm', undefined, undefined, 'BRANCH_NOT_AVAILABLE')),
    );
    await waitFor(() => expect(text('status')).toBe('error'));
    expect(text('shown')).toBe('none');
  });

  it('un 429 CON cupón avisa (onCouponRateLimited) y SIN cupón no', async () => {
    const { calls, wrapClient } = setup();
    let limited = 0;
    function WithCallback({ coupon }: { coupon: string }) {
      useCheckoutQuote(inputsOf({ couponCode: coupon }), { onCouponRateLimited: () => limited++ });
      return null;
    }
    const view = await renderStore(<WithCallback coupon="" />, { wrapClient });
    await waitForCalls(calls, 1);
    await act(async () => calls[0]!.reject(new ApiError(429, 'x', 'm')));
    await new Promise((r) => setTimeout(r, 20));
    expect(limited).toBe(0);
    await act(async () => view.rerender(<WithCallback coupon="BIENVENIDO10" />));
    await waitForCalls(calls, 2);
    await act(async () => calls[1]!.reject(new ApiError(429, 'x', 'm')));
    await waitFor(() => expect(limited).toBe(1));
  });
});

describe('queryKeys.checkout.quote (aislada por cuenta)', () => {
  it('cuelga de `customer` con la identidad: otra cuenta no comparte clave y el guard la descarta', () => {
    const a = queryKeys.checkout.quote('user-a', 'f');
    const b = queryKeys.checkout.quote('user-b', 'f');
    const guest = queryKeys.checkout.quote(null, 'f');
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(guest);
    for (const key of [a, b]) expect(key[0]).toBe('customer');
    expect(a[1]).toBe('user-a');
    expect(guest.slice(0, 2)).toEqual(['checkout', 'guest']);
    expect(queryKeys.checkout.quote('user-a', 'g')).not.toEqual(a);
  });
});
