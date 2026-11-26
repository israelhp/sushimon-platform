import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderCreateRequest, OrderCreated, OrderTracking } from '@/lib/data-access/models';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { createHarness } from '@/mocks/testing';
import { quoteCheckout } from '@/services/checkout';
import { createOrder } from '@/services/orders';
import { renderStore } from '@/test/store-providers';
import { makeTracking } from '@/test/tracking';
import { resetConfirmationMemory, saveConfirmation } from '@/features/checkout/confirmation-store';
import { OrderReceivedScreen } from '@/features/checkout/components/OrderReceivedScreen';
import { OrderDetail } from './order-detail';
import { OrderTrackingScreen } from './order-tracking-screen';
import { DEMO_BASE_TIME } from '@/mocks/clock';

/**
 * F21 · pantalla de seguimiento con el HOOK REAL contra un servidor GUIONADO con forma http: credencial en cabecera, parada en
 * 404/terminal, último estado atenuado ante error, resumen UNA vez y sin ninguna ruta del seguimiento simulado.
 */
type Reply = OrderTracking | ApiError;

async function place(over: Partial<OrderCreateRequest> = {}) {
  const h = createHarness();
  const cart = {
    branchId: 'sucursal-1',
    lines: [{ productId: 'dumplings', quantity: 2, selections: [] }],
  };
  const fulfillment = {
    type: 'DELIVERY' as const,
    municipalityId: 'mun-guatemala-guatemala',
    zone: 'Zona 10',
  };
  const quote = await quoteCheckout(h.client, { cart, fulfillment });
  const created: OrderCreated = await createOrder(
    h.client,
    {
      cart,
      fulfillment,
      deliveryAddress: { addressLine: '6a avenida 10-50', referenceNote: '' },
      quoteToken: quote.quote.token as string,
      contact: { fullName: 'Ana López', phone: '5555-1234' },
      paymentMethodPreference: 'cash',
      ...over,
    },
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  );
  return { created, backend: h.client };
}

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string> | undefined;
  public?: boolean;
}

function server(backend: DataClient, created: OrderCreated, script: Reply[]) {
  const seen: Seen[] = [];
  // La respuesta vigente la fija la prueba (`set`): no depende de cuántas solicitudes haya hecho el arranque de los proveedores.
  let current: Reply = script[0]!;
  const client = withShortcuts('http', async <T,>(path: string, o: RequestOptions = {}) => {
    seen.push({ method: o.method ?? 'GET', path, headers: o.headers, public: o.public });
    if (path === `/v1/orders/${created.order.id}/tracking`) {
      const reply = current;
      if (reply instanceof ApiError) throw reply;
      return {
        ...reply,
        orderId: created.order.id,
        displayNumber: created.order.displayNumber,
      } as T;
    }
    return backend.request<T>(path, o);
  });
  const tracking = () => seen.filter((s) => s.path.endsWith('/tracking'));
  return { client, seen, tracking, set: (reply: Reply) => void (current = reply) };
}

const online = () => act(async () => void window.dispatchEvent(new Event('online')));

// El mock emite la credencial con el reloj fijo de la demo (`DEMO_BASE_TIME` + 14 días); la app la compara con
// `Date.now()`. Sin fijar solo `Date`, estas pruebas dejan de pasar cuando el calendario real supera esa vigencia.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(DEMO_BASE_TIME));

  resetConfirmationMemory();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OrderTrackingScreen (hook real, forma http)', () => {
  it('invitado con credencial: GET /tracking con X-Order-Token en cabecera (nunca en la URL ni público), sucursal y resumen UNA vez', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(await screen.findByTestId('status-label')).toHaveTextContent('Pedido recibido');
    const call = s.tracking()[0]!;
    expect(call.method).toBe('GET');
    expect(call.headers).toEqual({ 'X-Order-Token': created.access?.guestToken });
    expect(call.public).toBeUndefined();
    expect(s.seen.every((x) => !x.path.includes('smo_'))).toBe(true);
    // Sucursal resuelta con datos públicos y resumen de getOrder (una sola vez).
    expect(await screen.findByTestId('branch-name')).toBeInTheDocument();
    expect(await screen.findByText(/2 × /)).toBeInTheDocument();
    await online();
    await online();
    const details = s.seen.filter((x) => x.path === `/v1/orders/${created.order.id}`);
    expect(details).toHaveLength(1);
    expect(s.tracking().length).toBeGreaterThanOrEqual(3);
    // Nada del seguimiento simulado con la API real.
    expect(s.seen.some((x) => x.path.startsWith('/v1/demo/'))).toBe(false);
    expect(s.seen.some((x) => /\/v1\/orders\/MON-/.test(x.path))).toBe(false);
  });

  it('F24: muestra el pago en efectivo REAL (pendiente → pagado) fuera de las fases y del historial; nunca al empleado', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    const pending = await screen.findByTestId('payment-status');
    expect(pending).toHaveAttribute('data-payment-status', 'PENDING');
    expect(screen.getByTestId('payment-line')).toHaveTextContent('Pago en efectivo: Pendiente');
    expect(screen.getByTestId('payment-hint')).toHaveTextContent(
      'Realiza el pago en efectivo cuando recojas tu pedido en la sucursal.',
    );
    expect(screen.queryByTestId('payment-paid-at')).not.toBeInTheDocument();
    // El pago NO se mezcla con el seguimiento operativo.
    const phases = document.getElementById('trk-phases')!;
    expect(phases.textContent).not.toMatch(/pago|efectivo|pagado/i);

    s.set(
      makeTracking({
        payment: { method: 'CASH', status: 'PAID', paidAt: '2026-11-18T19:05:12.000Z' },
      }),
    );
    await online();
    await waitFor(() =>
      expect(screen.getByTestId('payment-status')).toHaveAttribute('data-payment-status', 'PAID'),
    );
    expect(screen.getByTestId('payment-line')).toHaveTextContent('Pago en efectivo: Pagado');
    expect(screen.getByTestId('payment-paid-at')).toHaveTextContent('Pagado el');
    expect(screen.queryByTestId('payment-hint')).not.toBeInTheDocument();
    // El pago pagado NO cambia el estado operativo mostrado.
    expect(screen.getByTestId('status-label')).toHaveTextContent('Pedido recibido');
    expect(phases.textContent).not.toMatch(/pagado/i);
    expect(screen.getByTestId('order-tracking').textContent).not.toMatch(
      /empleado|recibido por|transferencia|tarjeta/i,
    );
  });

  it('F24: pedido cancelado con pago pendiente NO pide pagar («No se cobra»)', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [
      makeTracking({ status: 'cancelled', publicStatus: 'cancelled', terminal: true }),
    ]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(await screen.findByTestId('payment-closed')).toHaveTextContent('No se cobra');
    expect(screen.queryByTestId('payment-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-tracking').textContent).not.toMatch(/Realiza el pago/);
  });

  it('invitado SIN credencial ni sesión: acceso perdido y NO se hace la solicitud', async () => {
    const { created, backend } = await place();
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(
      await screen.findByRole('heading', { name: 'Se perdió el acceso a este pedido' }),
    ).toBeInTheDocument();
    await online();
    expect(s.tracking()).toHaveLength(0);
  });

  it('con sesión y sin credencial: consulta con la sesión (sin X-Order-Token); el 404 del servidor => acceso perdido y se detiene', async () => {
    const { created, backend } = await place();
    const s = server(backend, created, [makeTracking()]);
    const view = await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(await screen.findByTestId('tracking-lost')).toBeInTheDocument();
    expect(s.tracking()).toHaveLength(0);
    act(() => view.api().session.signInCustomer({ email: 'ana@ejemplo.com', name: 'Ana' }));
    expect(await screen.findByTestId('status-label')).toHaveTextContent('Pedido recibido');
    expect(s.tracking()[0]!.headers).toBeUndefined();
    s.set(new ApiError(404, 'not_found', 'Pedido no encontrado'));
    await online();
    expect(await screen.findByTestId('tracking-lost')).toBeInTheDocument();
    const count = s.tracking().length;
    await online();
    expect(s.tracking()).toHaveLength(count);
  });

  it('avanza sin recargar: anuncia el cambio, conserva el foco y, al llegar a terminal, no vuelve a consultar', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(await screen.findByTestId('status-label')).toHaveTextContent('Pedido recibido');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    s.set(makeTracking({ status: 'accepted', publicStatus: 'accepted' }));
    await online();
    await waitFor(() =>
      expect(screen.getByTestId('status-label')).toHaveTextContent('Aceptado por la sucursal'),
    );
    expect(screen.getByTestId('live')).toHaveTextContent(
      'El estado de tu pedido cambió: Aceptado por la sucursal.',
    );
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
    s.set(
      makeTracking({
        status: 'picked_up',
        publicStatus: 'completed',
        terminal: true,
        pollAfterSeconds: null,
      }),
    );
    await online();
    await waitFor(() => expect(screen.getByTestId('status-label')).toHaveTextContent('Recogido'));
    const count = s.tracking().length;
    await online();
    await online();
    expect(s.tracking()).toHaveLength(count);
    expect(screen.queryByRole('button', { name: /siguiente estado/i })).not.toBeInTheDocument();
  });

  it('un fallo de red conserva el último estado atenuado con aviso y NUNCA marca cancelado; se recupera al volver', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [
      makeTracking({ status: 'preparing', publicStatus: 'preparing' }),
    ]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(await screen.findByTestId('status-label')).toHaveTextContent('En preparación');
    s.set(new ApiError(0, 'offline', 'sin conexión'));
    await online();
    expect(await screen.findByTestId('conn-message')).toBeInTheDocument();
    expect(screen.getByTestId('status-label')).toHaveTextContent('En preparación');
    expect(screen.getByTestId('status-label').closest('section')).toHaveAttribute(
      'data-stale',
      'true',
    );
    expect(screen.getByTestId('order-tracking').textContent).not.toMatch(/cancelado/i);
    s.set(makeTracking({ status: 'ready', publicStatus: 'ready' }));
    await online();
    await waitFor(() =>
      expect(screen.getByTestId('status-label')).toHaveTextContent('Listo para recoger'),
    );
    expect(screen.queryByText(/Sin conexión/)).not.toBeInTheDocument();
  });

  it('429 NO es acceso perdido: aviso de espera y datos visibles', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    const limited = new ApiError(
      429,
      'too_many_requests',
      'x',
      undefined,
      undefined,
      'RATE_LIMITED',
      undefined,
      30,
    );
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    await screen.findByTestId('status-label');
    s.set(limited);
    await online();
    expect(await screen.findByText(/Reintentamos en unos segundos/)).toBeInTheDocument();
    expect(screen.getByTestId('status-label')).toHaveTextContent('Pedido recibido');
    expect(screen.queryByTestId('tracking-lost')).not.toBeInTheDocument();
  });

  it('el token vencido en sessionStorage cuenta como sin credencial (acceso perdido, sin solicitud)', async () => {
    const { created, backend } = await place();
    window.sessionStorage.setItem(
      `monsushi-order-${created.order.id}`,
      JSON.stringify({
        guestToken: created.access?.guestToken,
        expiresAt: '2000-01-01T00:00:00.000Z',
        displayNumber: created.order.displayNumber,
      }),
    );
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    expect(await screen.findByTestId('tracking-lost')).toBeInTheDocument();
    expect(s.tracking()).toHaveLength(0);
  });

  it('http: la caché del seguimiento no lleva el token ni se persiste en el almacenamiento', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    const view = await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    await screen.findByTestId('status-label');
    const keys = view.queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(keys).toContain(JSON.stringify(['orders', 'tracking', 'guest', created.order.id]));
    expect(keys.some((k) => k.includes('smo_'))).toBe(false);
    const stored =
      JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(stored).not.toContain('preparing');
    expect(stored).not.toContain('generatedAt');
  });
});

describe('navegación desde la confirmación (F20 → F21)', () => {
  it('«Ver estado de mi pedido» enlaza a /pedidos/[id]/seguimiento sin token en la URL y la confirmación NO sondea', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderReceivedScreen orderId={created.order.id} />, {
      wrapClient: () => s.client,
    });
    const link = await screen.findByRole('link', { name: 'Ver estado de mi pedido' });
    expect(link).toHaveAttribute('href', `/pedidos/${created.order.id}/seguimiento`);
    expect(link.getAttribute('href')).not.toContain('smo_');
    await online();
    expect(s.tracking()).toHaveLength(0);
  });

  it('con la API real, /pedidos/[id] no usa el seguimiento simulado (ni borradores ni avance de demostración)', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const s = server(backend, created, [makeTracking()]);
    await renderStore(<OrderDetail orderId={created.order.id} />, { wrapClient: () => s.client });
    await screen.findByTestId('order-received');
    expect(s.seen.some((x) => x.path.startsWith('/v1/demo/'))).toBe(false);
    expect(s.seen.map((x) => x.path)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/\/v1\/orders\/MON-/)]),
    );
    expect(screen.queryByRole('button', { name: /siguiente estado/i })).not.toBeInTheDocument();
  });
});

describe('OrderTrackingScreen en mock (simulación rotulada con la forma real)', () => {
  it('«Ver siguiente estado (simulación)» alimenta el historial real: el seguimiento avanza sin recargar hasta el estado terminal', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => backend,
    });
    expect(await screen.findByTestId('status-label')).toHaveTextContent('Pedido recibido');
    expect(screen.getAllByText('Simulación').length).toBeGreaterThan(0);
    expect(screen.getByText(/Seguimiento de demostración/)).toBeInTheDocument();
    const user = userEvent.setup();
    const advance = () => screen.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
    await user.click(advance());
    await waitFor(() =>
      expect(screen.getByTestId('status-label')).toHaveTextContent('Aceptado por la sucursal'),
    );
    expect(screen.getAllByTestId('timeline-event')).toHaveLength(2);
    for (const text of ['En preparación', 'Listo para recoger']) {
      await user.click(advance());
      await waitFor(() => expect(screen.getByTestId('status-label')).toHaveTextContent(text));
    }
    await user.click(advance());
    await waitFor(() => expect(screen.getByTestId('status-label')).toHaveTextContent('Recogido'));
    expect(screen.queryByRole('button', { name: /siguiente estado/i })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-event')).toHaveLength(5);
  });

  it('sin la credencial (otra pestaña) en mock: el mismo «acceso perdido»', async () => {
    const { created, backend } = await place();
    await renderStore(<OrderTrackingScreen orderId={created.order.id} />, {
      wrapClient: () => backend,
    });
    expect(await screen.findByTestId('tracking-lost')).toBeInTheDocument();
  });
});
