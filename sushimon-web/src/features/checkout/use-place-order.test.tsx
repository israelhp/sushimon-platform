import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutQuote, OrderCreated } from '@/lib/data-access/models';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { ORDER_ATTEMPT_STORAGE_KEY, clearAttempt, type OrderIntent } from './order-attempt';
import { orderConfirmationKey, resetConfirmationMemory } from './confirmation-store';
import { usePlaceOrder, type PlaceOrderOptions } from './use-place-order';

/** F20 · máquina de estados de la confirmación con un servidor GUIONADO (sin mock de dominio): una respuesta por llamada. */
const TOKEN = `smo_${'b'.repeat(43)}`;
const created = (
  id = 'ord-1',
  access: OrderCreated['access'] = { guestToken: TOKEN, expiresAt: '2999-01-01T00:00:00.000Z' },
) => ({ order: { id, displayNumber: 'MON-001042', status: 'pending' }, access }) as OrderCreated;
const net = () => new ApiError(0, 'offline', 'sin conexión');
const http = (status: number, code?: string, body?: unknown, retryAfter?: number) =>
  new ApiError(status, 'x', 'm', undefined, undefined, code, undefined, retryAfter, body);
const newQuote = {
  quote: { token: 'tok-2', generatedAt: 'a', expiresAt: 'b' },
  total: '90.00',
  lines: [],
} as unknown as CheckoutQuote;

const intent: OrderIntent = {
  scope: null,
  quote: {
    cart: {
      branchId: 'sucursal-1',
      lines: [{ productId: 'dumplings', quantity: 1, selections: [] }],
    },
    fulfillment: { type: 'PICKUP' },
    couponCode: '',
  },
  contact: { fullName: 'Ana López', phone: '5555-1234', email: '' },
  deliveryAddress: null,
  notes: '',
  preference: 'cash',
};

type Step = (() => OrderCreated | Promise<OrderCreated>) | ApiError | OrderCreated | unknown;
interface Call {
  key: string;
  token: string;
}

function setup(steps: Step[], options: Partial<PlaceOrderOptions> = {}) {
  const calls: Call[] = [];
  let api!: ReturnType<typeof usePlaceOrder>;
  function Harness() {
    api = usePlaceOrder({ clearCart: true, retryDelaysMs: [0, 0], ...options });
    return <p data-testid="status">{api.state.status}</p>;
  }
  const wrapClient = (base: DataClient) =>
    withShortcuts('http', async <T,>(path: string, o: RequestOptions = {}) => {
      if (path !== '/v1/orders' || o.method !== 'POST') return base.request<T>(path, o);
      calls.push({
        key: o.headers?.['Idempotency-Key'] ?? '',
        token: (o.body as { quoteToken: string }).quoteToken,
      });
      const step = steps[Math.min(calls.length, steps.length) - 1];
      if (step instanceof Error) throw step;
      return (typeof step === 'function' ? await (step as () => unknown)() : step) as T;
    });
  return {
    calls,
    wrapClient,
    get api() {
      return api;
    },
    Harness,
  };
}

async function mount(steps: Step[], options?: Partial<PlaceOrderOptions>) {
  const s = setup(steps, options);
  const view = await renderStore(<s.Harness />, { wrapClient: s.wrapClient });
  await act(async () => {
    view.api().cart.add(cartInput('dumplings', 1));
  });
  return {
    calls: s.calls,
    get api() {
      return s.api;
    },
    view,
    lines: () => view.api().cart.lines.length,
  };
}

beforeEach(() => {
  resetConfirmationMemory();
  clearAttempt();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

const run = (fn: () => Promise<void> | void) => act(async () => void (await fn()));

describe('usePlaceOrder (F20)', () => {
  it('éxito del servidor: guarda la credencial de invitado SOLO en sessionStorage, descarta el intento y vacía el carrito (clearAfterOrder)', async () => {
    const t = await mount([created()]);
    expect(t.lines()).toBe(1);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(screen.getByTestId('status')).toHaveTextContent('success');
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.key).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
    expect(window.sessionStorage.getItem(orderConfirmationKey('ord-1'))).toContain(TOKEN);
    expect(window.localStorage.getItem(orderConfirmationKey('ord-1'))).toBeNull();
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(t.lines()).toBe(0);
  });

  it('con clearCart=false (mock con tarjeta simulada) NO vacía el carrito', async () => {
    const t = await mount([created()], { clearCart: false });
    await run(() => t.api.place(intent, 'tok-1'));
    expect(screen.getByTestId('status')).toHaveTextContent('success');
    expect(t.lines()).toBe(1);
  });

  it('doble clic: un solo envío en vuelo (la segunda llamada no emite petición)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = await mount([async () => (await gate, created())]);
    let first!: Promise<void>;
    await run(() => {
      first = t.api.place(intent, 'tok-1');
      void t.api.place(intent, 'tok-1');
      void t.api.place(intent, 'tok-1');
    });
    // El hash de la huella es async: se espera a que la ÚNICA petición llegue al servidor.
    await waitFor(() => expect(t.calls).toHaveLength(1));
    expect(screen.getByTestId('status')).toHaveTextContent('sending');
    expect(t.api.busy).toBe(true);
    await run(async () => {
      release();
      await first;
    });
    expect(t.calls).toHaveLength(1);
    expect(screen.getByTestId('status')).toHaveTextContent('success');
  });

  it('guarda síncrona: tres place() en el MISMO tick (antes de cualquier await) emiten un solo POST', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = await mount([async () => (await gate, created())]);
    let all!: Promise<void[]>;
    await run(() => {
      all = Promise.all([
        t.api.place(intent, 'tok-1'),
        t.api.place(intent, 'tok-1'),
        t.api.place(intent, 'tok-1'),
      ]);
    });
    await waitFor(() => expect(t.calls).toHaveLength(1));
    await run(async () => {
      release();
      await all;
    });
    expect(t.calls).toHaveLength(1);
    expect(screen.getByTestId('status')).toHaveTextContent('success');
  });

  it('red caída y luego éxito: reintenta con la MISMA clave y el carrito solo se vacía al final', async () => {
    const t = await mount([net(), net(), created()]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(t.calls.map((c) => c.key)).toHaveLength(3);
    expect(new Set(t.calls.map((c) => c.key)).size).toBe(1);
    expect(screen.getByTestId('status')).toHaveTextContent('success');
    expect(t.lines()).toBe(0);
  });

  it('ambiguo agotado: falla con «ambiguous», conserva carrito y clave; «Reintentar» usa la misma clave', async () => {
    const t = await mount([net(), net(), net(), created()]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(t.api.state).toEqual({ status: 'failed', failure: { kind: 'ambiguous' } });
    expect(t.lines()).toBe(1);
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).not.toBeNull();
    await run(() => t.api.retry());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
    expect(new Set(t.calls.map((c) => c.key)).size).toBe(1);
    expect(t.calls).toHaveLength(4);
    expect(t.lines()).toBe(0);
  });

  it('503 ORDERS_BUSY e IDEMPOTENCY_IN_PROGRESS se reintentan con la misma clave', async () => {
    const t = await mount([
      http(503, 'ORDERS_BUSY'),
      http(409, 'IDEMPOTENCY_IN_PROGRESS'),
      created(),
    ]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(new Set(t.calls.map((c) => c.key)).size).toBe(1);
    expect(screen.getByTestId('status')).toHaveTextContent('success');
  });

  it('QUOTE_CHANGED: NO reenvía solo, descarta la clave, conserva el carrito y exige re-aceptación con el token nuevo y clave nueva', async () => {
    const conflict = http(409, 'QUOTE_CHANGED', {
      changes: [{ field: 'total', previous: '85.00', current: '90.00' }],
      quote: newQuote,
    });
    const t = await mount([conflict, created()]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(t.calls).toHaveLength(1);
    expect(t.api.state).toMatchObject({ status: 'failed', failure: { kind: 'quoteChanged' } });
    expect(t.lines()).toBe(1);
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).toBeNull();
    await run(() => t.api.acceptChange());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('success'));
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.token).toBe('tok-2');
    expect(t.calls[1]!.key).not.toBe(t.calls[0]!.key);
    expect(t.lines()).toBe(0);
  });

  it('acceptChange sin un QUOTE_CHANGED previo no hace nada', async () => {
    const t = await mount([created()]);
    await run(() => t.api.acceptChange());
    expect(t.calls).toHaveLength(0);
  });

  it.each([
    ['QUOTE_EXPIRED', http(409, 'QUOTE_EXPIRED', { quote: newQuote, changes: [] }), 'quoteExpired'],
    ['IDEMPOTENCY_KEY_REUSED', http(409, 'IDEMPOTENCY_KEY_REUSED'), 'keyReused'],
    ['QUOTE_INVALID', http(422, 'QUOTE_INVALID'), 'quoteInvalid'],
  ])('%s: descarta la clave, no reintenta y conserva el carrito', async (_name, error, kind) => {
    const t = await mount([error]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(t.calls).toHaveLength(1);
    expect(t.api.state).toEqual({ status: 'failed', failure: { kind } });
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(t.lines()).toBe(1);
  });

  it.each([
    [http(429, 'RATE_LIMITED', undefined, 9), { kind: 'rateLimited', retryAfterSec: 9 }],
    [http(503, 'ORDERS_UNAVAILABLE'), { kind: 'unavailable' }],
    [
      http(422, 'CHECKOUT_BLOCKED', { blockers: [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }] }),
      { kind: 'blocked', blockers: [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }] },
    ],
    [http(422, 'CONTACT_INCOMPLETE'), { kind: 'contactIncomplete' }],
  ])(
    '%#: sin reintento automático, carrito intacto, la clave se conserva',
    async (error, failure) => {
      const t = await mount([error]);
      await run(() => t.api.place(intent, 'tok-1'));
      expect(t.calls).toHaveLength(1);
      expect(t.api.state).toEqual({ status: 'failed', failure });
      expect(t.lines()).toBe(1);
      expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).not.toBeNull();
    },
  );

  it('una respuesta 2xx sin pedido válido NO es éxito ni vacía el carrito', async () => {
    const t = await mount([{ order: {}, access: null }]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(t.api.state).toEqual({ status: 'failed', failure: { kind: 'unknown' } });
    expect(t.lines()).toBe(1);
  });

  it('cliente autenticado (access=null): no guarda credencial pero sí vacía el carrito', async () => {
    const t = await mount([created('ord-9', null)]);
    await run(() => t.api.place(intent, 'tok-1'));
    expect(window.sessionStorage.getItem(orderConfirmationKey('ord-9'))).not.toContain('smo_');
    expect(t.lines()).toBe(0);
  });

  it('otra intención (cambia el contacto) usa otra clave', async () => {
    const t = await mount([http(429, 'RATE_LIMITED'), http(429, 'RATE_LIMITED')]);
    await run(() => t.api.place(intent, 'tok-1'));
    await run(() => t.api.place({ ...intent, notes: 'sin picante' }, 'tok-1'));
    expect(t.calls[1]!.key).not.toBe(t.calls[0]!.key);
  });

  it('W2: si sessionStorage falla tras el éxito, el estado lo marca (persisted=false) y el éxito sigue siendo del servidor', async () => {
    const t = await mount([created()]);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await run(() => t.api.place(intent, 'tok-1'));
    spy.mockRestore();
    expect(t.api.state).toMatchObject({ status: 'success', persisted: false });
    expect(t.lines()).toBe(0);
  });

  it('W1: salir del checkout sin pedido en vuelo descarta el intento; con resultado incierto (red) conserva la clave', async () => {
    const a = await mount([http(429, 'RATE_LIMITED')]);
    await run(() => a.api.place(intent, 'tok-1'));
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).not.toBeNull();
    a.view.unmount();
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).toBeNull();

    const b = await mount([net(), net(), net()]);
    await run(() => b.api.place(intent, 'tok-1'));
    expect(b.api.state).toEqual({ status: 'failed', failure: { kind: 'ambiguous' } });
    b.view.unmount();
    expect(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)).not.toBeNull();
  });

  it('W1: el intento guardado durante el envío no contiene datos personales', async () => {
    const t = await mount([http(429, 'RATE_LIMITED')]);
    await run(() => t.api.place({ ...intent, notes: 'nota privada' }, 'tok-1'));
    const stored = window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)!;
    for (const leak of ['Ana', '5555', 'privada', 'dumplings']) expect(stored).not.toContain(leak);
  });
});
