import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderTracking } from '@/lib/data-access/models';
import { renderStore } from '@/test/store-providers';
import {
  DELIVERY_FLOW,
  PICKUP_FLOW,
  TRACKING_ORDER_ID,
  at,
  makeTracking,
  stepsFor,
} from '@/test/tracking';
import type { OrderTrackingResult } from '@/features/orders/hooks';
import { resetConfirmationMemory } from '@/features/checkout/confirmation-store';
import { OrderTrackingScreen } from './order-tracking-screen';
import { DEMO_BASE_TIME } from '@/mocks/clock';

/** F21 · pantalla de seguimiento por ESTADO (el hook se sustituye por un resultado guionado; el polling se prueba aparte). */
let result: OrderTrackingResult;
vi.mock('@/features/orders/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/orders/hooks')>()),
  useOrderTracking: () => result,
}));

const base = (over: Partial<OrderTrackingResult> = {}): OrderTrackingResult => ({
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  lost: false,
  terminal: false,
  failing: false,
  rateLimitSec: null,
  gaveUp: false,
  failures: 0,
  updatedAt: 0,
  retry: vi.fn(),
  pending: false,
  noCredentials: false,
  ...over,
});
const withData = (data: OrderTracking, over: Partial<OrderTrackingResult> = {}) =>
  base({ data, terminal: data.terminal, updatedAt: 1, ...over });

const show = (locale: 'es' | 'en' = 'es') =>
  renderStore(<OrderTrackingScreen orderId={TRACKING_ORDER_ID} />, { locale });

const label = () => screen.getByTestId('status-label').textContent;
const hint = () => screen.getByTestId('status-hint').textContent ?? '';

// El mock emite la credencial con el reloj fijo de la demo (`DEMO_BASE_TIME` + 14 días); la app la compara con
// `Date.now()`. Sin fijar solo `Date`, estas pruebas dejan de pasar cuando el calendario real supera esa vigencia.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(DEMO_BASE_TIME));

  resetConfirmationMemory();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OrderTrackingScreen · mensajes honestos por publicStatus', () => {
  const pickup: [OrderTracking['status'], OrderTracking['publicStatus'], string][] = [
    ['pending', 'received', 'Pedido recibido'],
    ['accepted', 'accepted', 'Aceptado por la sucursal'],
    ['preparing', 'preparing', 'En preparación'],
    ['ready', 'ready', 'Listo para recoger'],
    ['picked_up', 'completed', 'Recogido'],
    ['rejected', 'rejected', 'Rechazado por la sucursal'],
    ['cancelled', 'cancelled', 'Cancelado'],
  ];
  for (const [status, publicStatus, text] of pickup) {
    it(`PICKUP ${status}/${publicStatus} → «${text}»`, async () => {
      result = withData(
        makeTracking({
          status,
          publicStatus,
          terminal: ['picked_up', 'rejected', 'cancelled'].includes(status),
          pollAfterSeconds: null,
        }),
      );
      await show();
      expect(label()).toBe(text);
      expect(hint()).not.toMatch(/en camino|entregado/i);
    });
  }

  const delivery: [OrderTracking['status'], OrderTracking['publicStatus'], string][] = [
    ['ready', 'ready', 'Listo, esperando entrega'],
    ['on_the_way', 'on_the_way', 'En camino'],
    ['delivered', 'completed', 'Entregado'],
  ];
  for (const [status, publicStatus, text] of delivery) {
    it(`DELIVERY ${status} → «${text}» (nunca «recoger»)`, async () => {
      result = withData(
        makeTracking({
          fulfillmentType: 'DELIVERY',
          delivery: { provider: 'OWN', status: null },
          status,
          publicStatus,
          terminal: status === 'delivered',
          steps: stepsFor(DELIVERY_FLOW, 4),
        }),
      );
      await show();
      expect(label()).toBe(text);
      expect(`${label()} ${hint()}`).not.toMatch(/recog|recoger/i);
    });
  }

  it('pendiente: no dice aceptado ni pagado y aclara que la sucursal aún no lo procesa', async () => {
    result = withData(makeTracking());
    await show();
    expect(hint()).toBe('Recibimos tu pedido; la sucursal aún no lo procesa.');
    expect(screen.getByTestId('order-tracking').textContent).not.toMatch(/pagado|cobrado/i);
    const phases = screen.getByTestId('phases');
    expect(within(phases).getAllByRole('listitem')).toHaveLength(5);
    // «Aceptado» solo aparece como fase FUTURA pendiente, nunca como estado alcanzado.
    const accepted = within(phases).getByText('Aceptado por la sucursal').closest('li')!;
    expect(accepted).toHaveAttribute('data-state', 'pending');
    expect(within(accepted).queryByTestId('phase-time')).toBeNull();
  });

  it('código futuro desconocido: etiqueta neutra «En proceso» sin romper', async () => {
    result = withData(makeTracking({ publicStatus: 'refunded' as never }));
    await show();
    expect(label()).toBe('En proceso');
  });

  it('en inglés', async () => {
    result = withData(makeTracking({ status: 'ready', publicStatus: 'ready' }));
    await show('en');
    expect(label()).toBe('Ready for pickup');
    expect(screen.getByText('Order progress')).toBeInTheDocument();
  });
});

describe('OrderTrackingScreen · fases e historial', () => {
  it('fases del servidor: alcanzadas con hora real en America/Guatemala, actual destacada, futuras sin hora', async () => {
    result = withData(
      makeTracking({
        status: 'preparing',
        publicStatus: 'preparing',
        steps: [
          { phase: 'received', reachedAt: '2026-11-18T03:30:00.000Z' }, // 17 nov 21:30 en Guatemala
          { phase: 'accepted', reachedAt: '2026-11-18T03:35:00.000Z' },
          { phase: 'preparing', reachedAt: '2026-11-18T03:40:00.000Z' },
          { phase: 'ready', reachedAt: null },
          { phase: 'completed', reachedAt: null },
        ],
        events: [],
      }),
    );
    await show();
    const items = within(screen.getByTestId('phases')).getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'current',
      'pending',
      'pending',
    ]);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(within(items[0]!).getByTestId('phase-time').textContent).toBe('17 nov 2026, 9:30 p. m.');
    expect(within(items[3]!).queryByTestId('phase-time')).toBeNull();
    expect(items[2]).toHaveTextContent('fase actual');
  });

  it('salto de estados: la fase omitida se muestra superada sin hora', async () => {
    result = withData(
      makeTracking({
        status: 'preparing',
        publicStatus: 'preparing',
        steps: [
          { phase: 'received', reachedAt: at(18, 0) },
          { phase: 'accepted', reachedAt: null },
          { phase: 'preparing', reachedAt: at(18, 10) },
          { phase: 'ready', reachedAt: null },
          { phase: 'completed', reachedAt: null },
        ],
      }),
    );
    await show();
    const accepted = within(screen.getByTestId('phases')).getAllByRole('listitem')[1]!;
    expect(accepted).toHaveAttribute('data-state', 'skipped');
    expect(accepted).toHaveTextContent('superada, sin hora registrada');
    expect(within(accepted).queryByTestId('phase-time')).toBeNull();
  });

  for (const phase of ['rejected', 'cancelled'] as const) {
    it(`${phase}: recorrido cortado, sin etapas futuras y con enlace para contactar la sucursal`, async () => {
      result = withData(
        makeTracking({
          status: phase,
          publicStatus: phase,
          terminal: true,
          pollAfterSeconds: null,
          steps: [
            { phase: 'received', reachedAt: at(18, 0) },
            { phase, reachedAt: at(18, 5) },
          ],
          events: [
            { seq: 1, status: 'pending', publicStatus: 'received', occurredAt: at(18, 0) },
            { seq: 2, status: phase, publicStatus: phase, occurredAt: at(18, 5) },
          ],
        }),
      );
      await show();
      const items = within(screen.getByTestId('phases')).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items.some((i) => i.getAttribute('data-state') === 'pending')).toBe(false);
      expect(hint()).toMatch(/cont[aá]ct/i);
      expect(screen.queryByText(/Cargando/)).toBeNull();
    });
  }

  it('línea de tiempo: eventos reales en el ORDEN del servidor, sin reordenar ni deduplicar', async () => {
    result = withData(
      makeTracking({
        status: 'preparing',
        publicStatus: 'preparing',
        events: [
          { seq: 1, status: 'pending', publicStatus: 'received', occurredAt: at(18, 0) },
          { seq: 2, status: 'preparing', publicStatus: 'preparing', occurredAt: at(18, 10) },
          { seq: 3, status: 'preparing', publicStatus: 'preparing', occurredAt: at(18, 5) }, // duplicado y fuera de hora
        ],
      }),
    );
    await show();
    const events = screen.getAllByTestId('timeline-event');
    expect(events.map((e) => e.querySelector('span')?.textContent)).toEqual([
      'Pedido recibido',
      'En preparación',
      'En preparación',
    ]);
    expect(events).toHaveLength(3);
  });

  it('sin eventos: mensaje, sin error', async () => {
    result = withData(makeTracking({ events: [] }));
    await show();
    expect(screen.getByTestId('timeline-empty')).toHaveTextContent(
      'Sin eventos registrados todavía.',
    );
  });

  it('eventsTruncated avisa que se muestran los eventos MÁS RECIENTES (sin cifra fija)', async () => {
    result = withData(makeTracking({ eventsTruncated: true }));
    await show();
    expect(
      screen.getByText('Mostramos los eventos más recientes; los anteriores no aparecen aquí.'),
    ).toBeInTheDocument();
  });

  it('datos incompletos (steps vacío): muestra estado y eventos, sin fases', async () => {
    result = withData(makeTracking({ steps: [] }));
    await show();
    expect(screen.queryByTestId('phases')).toBeNull();
    expect(screen.getByText(/No recibimos todas las fases/)).toBeInTheDocument();
    expect(label()).toBe('Pedido recibido');
    expect(screen.getAllByTestId('timeline-event')).toHaveLength(1);
  });
});

describe('OrderTrackingScreen · entrega y retiro', () => {
  it('PICKUP: retiro en la sucursal, sin bloque de entrega', async () => {
    result = withData(makeTracking());
    await show();
    expect(screen.getByRole('heading', { name: 'Retiro' })).toBeInTheDocument();
    expect(screen.getByTestId('fulfillment-note')).toHaveTextContent(/Retira tu pedido/);
    expect(await screen.findByTestId('branch-name')).toBeInTheDocument();
  });

  it('DELIVERY OWN: solo el proveedor; sin repartidor, GPS, ETA ni mapa', async () => {
    result = withData(
      makeTracking({
        fulfillmentType: 'DELIVERY',
        status: 'on_the_way',
        publicStatus: 'on_the_way',
        steps: stepsFor(DELIVERY_FLOW, 5),
        delivery: { provider: 'OWN', status: null },
      }),
    );
    await show();
    expect(screen.getByTestId('fulfillment-note')).toHaveTextContent(
      'Entrega a domicilio por la sucursal',
    );
    const text = screen.getByTestId('order-tracking').textContent ?? '';
    expect(text).not.toMatch(/llega en|minutos|aprox|repartidor:|placa/i);
    expect(
      screen.getByText(/no mostramos el repartidor, la ubicación ni una hora estimada/i),
    ).toBeInTheDocument();
    expect(document.querySelector('iframe, [data-map]')).toBeNull();
  });

  it('DELIVERY PedidosYa: aviso de proveedor externo y SOLO el estado interno', async () => {
    result = withData(
      makeTracking({
        fulfillmentType: 'DELIVERY',
        status: 'ready',
        publicStatus: 'ready',
        steps: stepsFor(DELIVERY_FLOW, 4),
        delivery: { provider: 'PEDIDOSYA', status: null },
      }),
    );
    await show();
    expect(screen.getByTestId('fulfillment-note')).toHaveTextContent(
      'Entrega por proveedor externo',
    );
    expect(
      screen.getByText(/el seguimiento del proveedor no está disponible/i),
    ).toBeInTheDocument();
    expect(label()).toBe('Listo, esperando entrega');
  });

  it('DELIVERY con delivery null (datos incompletos): texto neutro', async () => {
    result = withData(
      makeTracking({
        fulfillmentType: 'DELIVERY',
        delivery: null,
        steps: stepsFor(DELIVERY_FLOW, 1),
      }),
    );
    await show();
    expect(screen.getByTestId('fulfillment-note')).toHaveTextContent('Entrega a domicilio');
  });
});

describe('OrderTrackingScreen · errores y acceso', () => {
  it('acceso perdido (404/401/403): un único mensaje, el número guardado y sin datos', async () => {
    window.sessionStorage.setItem(
      `monsushi-order-${TRACKING_ORDER_ID}`,
      JSON.stringify({ guestToken: null, expiresAt: null, displayNumber: 'MON-001042' }),
    );
    result = base({ lost: true, error: new ApiError(404, 'not_found', 'x') });
    await show();
    expect(
      screen.getByRole('heading', { name: 'Se perdió el acceso a este pedido' }),
    ).toHaveFocus();
    expect(screen.getByTestId('order-number')).toHaveTextContent('Tu número de pedido: MON-001042');
    expect(screen.queryByTestId('status-label')).toBeNull();
  });

  it('invitado sin credencial ni sesión: acceso perdido (sin solicitud: lo decide el hook)', async () => {
    result = base({ noCredentials: true });
    await show();
    expect(screen.getByTestId('tracking-lost')).toBeInTheDocument();
  });

  it('primera carga y resolución de identidad: esqueleto accesible', async () => {
    result = base({ isLoading: true });
    await show();
    expect(
      screen.getByRole('status', { name: 'Cargando el estado de tu pedido…' }),
    ).toHaveAttribute('aria-busy', 'true');
    result = base({ pending: true });
    await show();
  });

  it('error SIN datos: h1 «Estado de tu pedido» con foco, «Reintentar» siempre visible y UNA sola región aria-live', async () => {
    const retry = vi.fn();
    result = base({ failing: true, retry, error: new ApiError(0, 'offline', 'x') });
    await show();
    expect(screen.getByTestId('conn-message')).toHaveTextContent(
      /No pudimos consultar el estado de tu pedido/,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Estado de tu pedido' })).toHaveFocus();
    const root = screen.getByTestId('order-tracking');
    expect(root.querySelectorAll('[aria-live],[role="status"],[role="alert"]')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('503 y 429 sin datos también ofrecen «Reintentar»', async () => {
    result = base({ failing: true, error: new ApiError(503, 'server_error', 'x') });
    await show();
    expect(screen.getByTestId('conn-message')).toHaveTextContent(/El servicio está ocupado/);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('sin conexión con datos previos: conserva el ÚLTIMO estado atenuado con su antigüedad y NUNCA dice cancelado', async () => {
    result = withData(makeTracking({ status: 'preparing', publicStatus: 'preparing' }), {
      failing: true,
      error: new ApiError(0, 'offline', 'x'),
      failures: 1,
    });
    await show();
    expect(label()).toBe('En preparación');
    const card = screen.getByTestId('status-label').closest('section')!;
    expect(card).toHaveAttribute('data-stale', 'true');
    expect(card.className).toMatch(/border-dashed/);
    expect(screen.getByTestId('conn-message')).toHaveTextContent(
      /Sin conexión: mostrando la última información \(de las 18 nov 2026, 12:01 p\. m\.\)/,
    );
    expect(screen.getByTestId('order-tracking').textContent).not.toMatch(/cancelado/i);
  });

  it('503 con datos: aviso de servicio ocupado y datos atenuados', async () => {
    result = withData(makeTracking(), {
      failing: true,
      error: new ApiError(503, 'server_error', 'x'),
    });
    await show();
    expect(
      within(screen.getByTestId('conn-notice')).getByText(
        'El servicio está ocupado. Reintentaremos automáticamente.',
      ),
    ).toBeInTheDocument();
    expect(label()).toBe('Pedido recibido');
  });

  it('429: aviso de espera con los segundos, datos visibles y sin atenuar', async () => {
    result = withData(makeTracking(), {
      rateLimitSec: 40,
      error: new ApiError(429, 'too_many_requests', 'x'),
    });
    await show();
    expect(screen.getByText(/Reintentamos en unos segundos/)).toBeInTheDocument();
    expect(screen.getByTestId('status-label').closest('section')).not.toHaveAttribute('data-stale');
  });

  it('tras 8 fallos se detiene y ofrece «Reintentar»', async () => {
    const retry = vi.fn();
    result = withData(makeTracking(), {
      failing: true,
      gaveUp: true,
      failures: 8,
      retry,
      error: new ApiError(0, 'offline', 'x'),
    });
    await show();
    expect(
      within(screen.getByTestId('conn-notice')).getByText(
        'Dejamos de actualizar el estado porque no pudimos conectarnos.',
      ),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('estado terminal: lo indica y no ofrece avance', async () => {
    result = withData(
      makeTracking({
        status: 'picked_up',
        publicStatus: 'completed',
        terminal: true,
        pollAfterSeconds: null,
      }),
    );
    await show();
    expect(screen.getByText(/dejamos de actualizar el estado/)).toBeInTheDocument();
  });
});

describe('OrderTrackingScreen · accesibilidad y simulación', () => {
  it('una sola región aria-live educada; anuncia solo CAMBIOS de estado y no roba el foco', async () => {
    result = withData(makeTracking());
    const view = await show();
    const root = screen.getByTestId('order-tracking');
    expect(root.querySelectorAll('[aria-live],[role="status"],[role="alert"]')).toHaveLength(1);
    const live = screen.getByTestId('live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus(); // foco inicial una sola vez
    (document.activeElement as HTMLElement).blur();

    result = withData(makeTracking({ status: 'accepted', publicStatus: 'accepted' }));
    view.rerender(<OrderTrackingScreen orderId={TRACKING_ORDER_ID} />);
    expect(screen.getByTestId('live')).toHaveTextContent(
      'El estado de tu pedido cambió: Aceptado por la sucursal.',
    );
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  });

  it('M1: la región única anuncia UNA vez por transición de conexión (sin conexión → recuperada), nunca por cada consulta; el aviso es estable', async () => {
    result = withData(makeTracking());
    const view = await show();
    const notice = screen.getByTestId('conn-notice');
    expect(notice).toHaveAttribute('hidden');
    const offline = withData(makeTracking(), {
      failing: true,
      failures: 1,
      error: new ApiError(0, 'offline', 'x'),
    });
    result = offline;
    view.rerender(<OrderTrackingScreen orderId={TRACKING_ORDER_ID} />);
    expect(screen.getByTestId('live')).toHaveTextContent(
      /^Sin conexión: mostrando la última información/,
    );
    expect(screen.getByTestId('conn-notice')).toBe(notice); // mismo nodo: no se montó/desmontó
    expect(notice).not.toHaveAttribute('hidden');
    // Otro fallo igual (misma transición): no se vuelve a anunciar.
    const live = screen.getByTestId('live');
    live.textContent = '';
    result = { ...offline, failures: 2 };
    view.rerender(<OrderTrackingScreen orderId={TRACKING_ORDER_ID} />);
    expect(screen.getByTestId('live')).toHaveTextContent('');
    // Rendición y recuperación.
    result = { ...offline, gaveUp: true, failures: 8 };
    view.rerender(<OrderTrackingScreen orderId={TRACKING_ORDER_ID} />);
    expect(screen.getByTestId('live')).toHaveTextContent('Dejamos de actualizar el estado');
    result = withData(makeTracking());
    view.rerender(<OrderTrackingScreen orderId={TRACKING_ORDER_ID} />);
    expect(screen.getByTestId('live')).toHaveTextContent('Se restableció la conexión');
    expect(screen.getByTestId('conn-notice')).toBe(notice);
    expect(notice).toHaveAttribute('hidden');
  });

  it('M1: un 429 es silencioso (aviso visible, sin anuncio) y el atenuado conserva el contraste (sin opacity-60)', async () => {
    result = withData(makeTracking(), {
      rateLimitSec: 5,
      error: new ApiError(429, 'too_many_requests', 'x'),
    });
    await show();
    expect(screen.getByTestId('live')).toHaveTextContent('');
    result = withData(makeTracking(), {
      failing: true,
      error: new ApiError(503, 'server_error', 'x'),
    });
    await show();
    const card = screen.getAllByTestId('status-label').at(-1)!.closest('section')!;
    expect(card.className).not.toMatch(/\bopacity-/);
    expect(card.className).toContain('border-dashed');
  });

  it('B1: el h1 se anuncia como «Número de pedido: MON-…» (prefijo solo para lectores)', async () => {
    result = withData(makeTracking());
    await show();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.querySelector('.sr-only')).toHaveTextContent('Número de pedido');
    expect(h1).toHaveTextContent(/Número de pedido:\s*MON-001042/);
  });

  it('B2: el error del botón de simulación se anuncia en la región única', async () => {
    result = withData(makeTracking());
    await show();
    // El mock por defecto no tiene el pedido borrador: avanzar falla (404) y se anuncia.
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Ver siguiente estado (simulación)' }));
    await waitFor(() =>
      expect(screen.getByTestId('live')).toHaveTextContent(/No se pudo avanzar el estado/),
    );
    expect(
      screen.getByText(/No se pudo avanzar el estado/, { selector: 'p.font-bold' }),
    ).toBeInTheDocument();
  });

  it('en mock: insignia «Simulación» y botón de avance rotulado', async () => {
    result = withData(makeTracking());
    await show();
    expect(
      screen.getByRole('button', { name: 'Ver siguiente estado (simulación)' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Simulación').length).toBeGreaterThan(0);
  });

  it('terminal en mock: sin botón de avance', async () => {
    result = withData(
      makeTracking({
        status: 'picked_up',
        publicStatus: 'completed',
        terminal: true,
        pollAfterSeconds: null,
      }),
    );
    await show();
    expect(screen.queryByRole('button', { name: /siguiente estado/i })).toBeNull();
  });

  it('el resumen conserva el enlace al detalle del pedido (F20)', async () => {
    result = withData(makeTracking());
    await show();
    expect(screen.getByRole('link', { name: 'Ver detalle del pedido' })).toHaveAttribute(
      'href',
      `/pedidos/${TRACKING_ORDER_ID}`,
    );
  });
});

void PICKUP_FLOW;
