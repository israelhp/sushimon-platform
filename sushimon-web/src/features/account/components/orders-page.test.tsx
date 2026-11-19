import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { MyOrderPage, MyOrderSummary } from '@/lib/data-access/models';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { cartInput } from '@/test/cart';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { OrdersPage } from './OrdersPage';

/** F23 · «Mis pedidos» real: `GET /v1/me/orders` con cursor, pestañas, filtros y todos los estados (matriz #48–#51, #57, #65, #81–#82). */
const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };
const NEW_USER = { email: 'invitado.nuevo@ejemplo.com', name: 'Invitado Nuevo' };

type View = Awaited<ReturnType<typeof renderStore>>;
const signIn = (view: View, who = DEMO) => act(async () => view.api().session.signInCustomer(who));

const summary = (n: number, over: Partial<MyOrderSummary> = {}): MyOrderSummary => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  orderNumber: n,
  displayNumber: `MON-${String(n).padStart(6, '0')}`,
  status: 'delivered',
  publicStatus: 'completed',
  terminal: true,
  branchId: 'sucursal-1',
  branchName: 'Sucursal 1',
  fulfillmentType: 'DELIVERY',
  deliveryProvider: 'OWN',
  itemCount: 3,
  total: '165.00',
  currency: 'GTQ',
  paymentMethodPreference: 'cash',
  placedAt: '2026-11-18T03:30:00.000Z',
  updatedAt: '2026-11-18T04:00:00.000Z',
  ...over,
});

/**
 * Cliente que responde `/v1/me/orders` con `respond(query)` (sin depender del NÚMERO de llamadas: el montaje con la sesión de la
 * prueba anterior y el reingreso pueden consultar más de una vez).
 */
function pagedClient(
  respond: (query: NonNullable<RequestOptions['query']>) => MyOrderPage | ApiError,
) {
  const seen: NonNullable<RequestOptions['query']>[] = [];
  const wrap = (): DataClient =>
    withShortcuts('http', async <T,>(path: string, options: RequestOptions = {}) => {
      if (path !== '/v1/me/orders') throw new ApiError(404, 'not_found', `ruta ${path}`);
      const query = options.query ?? {};
      seen.push(query);
      const next = respond(query);
      if (next instanceof ApiError) throw next;
      return next as T;
    });
  return { wrap, seen };
}
const page = (items: MyOrderSummary[], nextCursor: string | null = null): MyOrderPage => ({
  items,
  nextCursor,
  generatedAt: '2026-11-18T05:00:00.000Z',
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('Mis pedidos (F23) · acceso y llamadas', () => {
  it('sin sesión: invitación a iniciar sesión y NINGUNA llamada a la API de pedidos', async () => {
    const spy = createSpyClient();
    await renderStore(<OrdersPage />, { wrapClient: spy.wrap });
    expect(screen.getByRole('heading', { name: /sesión para usar esta sección/ })).toBeVisible();
    expect(spy.calls.filter((c) => c.path.includes('/orders'))).toHaveLength(0);
  });

  it('con sesión usa `/v1/me/orders` (nunca `/v1/demo/*`) y envía los estados de cada pestaña al servidor', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<OrdersPage />, { wrapClient: spy.wrap });
    await signIn(view);
    await screen.findAllByTestId('history-row');
    const first = spy.calls.find((c) => c.path === '/v1/me/orders');
    expect(first?.query).toMatchObject({
      status: 'pending,accepted,preparing,ready,on_the_way',
      limit: 20,
    });
    await user.click(screen.getByRole('tab', { name: 'Historial' }));
    await waitFor(() =>
      expect(
        spy.calls.some((c) => c.query?.status === 'delivered,picked_up,rejected,cancelled'),
      ).toBe(true),
    );
    expect(spy.calls.some((c) => c.path.startsWith('/v1/demo'))).toBe(false);
  });

  it('sin resumen «pedidos / gastado»: ningún total se calcula en el cliente', async () => {
    const view = await renderStore(<OrdersPage />);
    await signIn(view);
    await screen.findAllByTestId('history-row');
    expect(screen.queryByText('Total en pedidos')).not.toBeInTheDocument();
  });

  it('sin sondeo: ninguna consulta tiene `refetchInterval`', async () => {
    const view = await renderStore(<OrdersPage />);
    await signIn(view);
    await screen.findAllByTestId('history-row');
    const queries = view.queryClient.getQueryCache().findAll({ queryKey: ['customer'] });
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect((q.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
    }
  });

  it('pestañas con teclado: flechas, Inicio y Fin cambian y mueven el foco', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<OrdersPage />);
    await signIn(view);
    await screen.findAllByTestId('history-row');
    const active = screen.getByRole('tab', { name: 'En curso' });
    active.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Historial' })).toHaveFocus());
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'En curso' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Mis pedidos (F23) · filas', () => {
  it('estado con texto e ícono, fecha en America/Guatemala, total con 2 decimales, acciones y nada del motivo interno', async () => {
    const client = pagedClient(() =>
      page([
        summary(1042, { status: 'rejected', publicStatus: 'rejected', terminal: true }),
        summary(1041, {
          status: 'preparing',
          publicStatus: 'preparing',
          terminal: false,
          total: '99.50',
        }),
      ]),
    );
    const view = await renderStore(<OrdersPage />, { wrapClient: client.wrap });
    await signIn(view);
    const rows = await screen.findAllByTestId('history-row');
    expect(rows).toHaveLength(2);
    const [rejected, preparing] = rows as [HTMLElement, HTMLElement];
    expect(within(rejected).getByText('Rechazado por la sucursal')).toBeVisible();
    expect(rejected.querySelector('svg')).not.toBeNull();
    // 2026-11-18T03:30Z = 17 nov 21:30 en Guatemala (UTC−6).
    expect(rejected).toHaveTextContent(/17 nov 2026/);
    expect(rejected).toHaveTextContent('Q165.00');
    expect(preparing).toHaveTextContent('Q99.50');
    // «Seguimiento» solo si no es terminal.
    expect(within(rejected).queryByRole('link', { name: /Seguimiento/ })).not.toBeInTheDocument();
    expect(
      within(preparing).getByRole('link', { name: /Seguimiento: MON-001041/ }),
    ).toHaveAttribute('href', '/pedidos/00000000-0000-4000-8000-000000001041/seguimiento');
    for (const row of rows) {
      expect(within(row).getByRole('link', { name: /Ver recibo/ })).toBeVisible();
      expect(within(row).getByRole('button', { name: /Volver a pedir: MON-/ })).toBeVisible();
      expect(row.textContent).not.toMatch(/motivo|reason/i);
    }
  });
});

describe('Mis pedidos (F23) · estados', () => {
  it('carga: esqueleto accesible mientras la API no responde', async () => {
    const pending = (): DataClient =>
      withShortcuts('http', async <T,>(path: string) =>
        path === '/v1/me/orders'
          ? new Promise<T>(() => {})
          : Promise.reject(new ApiError(404, 'not_found', path)),
      );
    const view = await renderStore(<OrdersPage />, { wrapClient: pending });
    await signIn(view);
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryAllByTestId('history-row')).toHaveLength(0);
    expect(screen.queryByText('No tienes pedidos en curso.')).not.toBeInTheDocument();
  });

  it('vacío de un cliente sin pedidos: «No tienes pedidos en curso», enlace al menú y la nota para invitados', async () => {
    const view = await renderStore(<OrdersPage />);
    await signIn(view, NEW_USER);
    expect(await screen.findByText('No tienes pedidos en curso.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver el menú' })).toHaveAttribute('href', '/menu');
    expect(screen.getByText(/Si pediste como invitado/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Consultar pedido' })).toHaveAttribute(
      'href',
      '/consultar',
    );
  });

  it('vacío con filtros: mensaje propio y «Quitar filtros»', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<OrdersPage />);
    await signIn(view);
    await screen.findAllByTestId('history-row');
    await user.selectOptions(screen.getByLabelText('Sucursal'), 'sucursal-2');
    expect(await screen.findByText('No hay pedidos con estos filtros.')).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Quitar filtros' })[0]!);
    expect(await screen.findAllByTestId('history-row')).toHaveLength(1);
  });

  it('rango de fechas inválido: se explica y NO se envía al servidor', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<OrdersPage />, { wrapClient: spy.wrap });
    await signIn(view);
    await screen.findAllByTestId('history-row');
    const before = spy.calls.filter((c) => c.path === '/v1/me/orders').length;
    await user.type(screen.getByLabelText('Desde'), '2026-11-10');
    await user.type(screen.getByLabelText('Hasta'), '2026-11-01');
    expect(await screen.findByText(/anterior o igual a la final/)).toBeVisible();
    expect(spy.calls.filter((c) => c.path === '/v1/me/orders').length).toBe(before + 1);
  });

  it('error 503: aviso con «Reintentar», no cambia estados de negocio; al reintentar se recupera', async () => {
    const user = userEvent.setup();
    let failing = true;
    const busy = new ApiError(503, 'server_error', 'ocupado', undefined, undefined, 'ORDERS_BUSY');
    const client = pagedClient(() => (failing ? busy : page([summary(7)])));
    const view = await renderStore(<OrdersPage />, { wrapClient: client.wrap });
    await signIn(view);
    expect(await screen.findByRole('alert')).toHaveTextContent('El servicio está ocupado');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findAllByTestId('history-row')).toHaveLength(1);
  });

  it('error 429: espera `Retry-After` antes de permitir reintentar', async () => {
    const limited = new ApiError(
      429,
      'too_many_requests',
      'x',
      undefined,
      undefined,
      'RATE_LIMITED',
      undefined,
      5,
    );
    const client = pagedClient(() => limited);
    const view = await renderStore(<OrdersPage />, { wrapClient: client.wrap });
    await signIn(view);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('demasiadas consultas');
    expect(within(alert).getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    expect(within(alert).getByRole('button')).toHaveTextContent(/Reintentar en 5 s/);
  });

  it('«Cargar más» sigue el cursor, anuncia lo cargado en UNA región aria-live y al final dice que no hay más', async () => {
    const user = userEvent.setup();
    const client = pagedClient((q) =>
      q.cursor === 'c1' ? page([summary(1)]) : page([summary(3), summary(2)], 'c1'),
    );
    const view = await renderStore(<OrdersPage />, { wrapClient: client.wrap });
    await signIn(view);
    expect(await screen.findAllByTestId('history-row')).toHaveLength(2);
    expect(screen.queryByText('Ya no hay más pedidos.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(3));
    expect(client.seen.some((q) => q.cursor === 'c1')).toBe(true);
    expect(screen.getByText('Ya no hay más pedidos.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(screen.getByText('3 pedidos')).toBeInTheDocument();
    const polite = document.querySelectorAll('[aria-live="polite"]');
    expect(polite.length).toBeLessThanOrEqual(2); // la región de esta pantalla + el aviso global de la tienda
  });
});

describe('Mis pedidos (F23) · identidad y cachés privadas', () => {
  it('al cerrar sesión se descarta el historial y el carrito anónimo se conserva; otra cuenta no ve los pedidos de la anterior', async () => {
    const view = await renderStore(<OrdersPage />);
    await signIn(view);
    await screen.findAllByTestId('history-row');
    act(() => {
      view.api().cart.add(cartInput('dumplings', 1));
    });
    expect(
      view.queryClient.getQueryCache().findAll({ queryKey: ['customer'] }).length,
    ).toBeGreaterThan(0);

    await act(async () => view.api().session.signOutCustomer());
    await waitFor(() =>
      expect(
        view.queryClient
          .getQueryCache()
          .findAll({ queryKey: ['customer', 'demo:cliente@ejemplo.com'] }),
      ).toHaveLength(0),
    );
    expect(screen.queryAllByTestId('history-row')).toHaveLength(0);
    expect(view.api().cart.count).toBe(1);

    await signIn(view, NEW_USER);
    expect(await screen.findByText('No tienes pedidos en curso.')).toBeVisible();
    expect(screen.queryByText('MON-490217')).not.toBeInTheDocument();
  });
});
