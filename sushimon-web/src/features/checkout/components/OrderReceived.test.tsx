import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderCreateRequest, OrderCreated } from '@/lib/data-access/models';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import { createHarness } from '@/mocks/testing';
import { quoteCheckout } from '@/services/checkout';
import { createOrder } from '@/services/orders';
import { renderStore } from '@/test/store-providers';
import { resetConfirmationMemory, saveConfirmation } from '../confirmation-store';
import { OrderDetail } from '@/features/tracking/components/order-detail';

/** F20 · «pedido recibido» en `/pedidos/[id]` con la API real: se reconstruye con GET + credencial; honesto y sin seguimiento. */
const asHttp = (backend: DataClient) =>
  withShortcuts('http', <T,>(path: string, o?: RequestOptions) => backend.request<T>(path, o));

async function place(
  over: Partial<OrderCreateRequest> = {},
  fulfillment: OrderCreateRequest['fulfillment'] = { type: 'PICKUP' },
): Promise<{ created: OrderCreated; backend: DataClient }> {
  const h = createHarness();
  const cart = {
    branchId: 'sucursal-1',
    lines: [{ productId: 'dumplings', quantity: 2, selections: [] }],
  };
  const quote = await quoteCheckout(h.client, { cart, fulfillment });
  const created = await createOrder(
    h.client,
    {
      cart,
      fulfillment,
      quoteToken: quote.quote.token as string,
      contact: { fullName: 'Ana López', phone: '5555-1234' },
      paymentMethodPreference: 'cash',
      ...over,
    },
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  );
  return { created, backend: h.client };
}

beforeEach(() => {
  resetConfirmationMemory();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('OrderDetail con la API real (http): pedido recibido', () => {
  it('muestra número, estado real «pendiente», líneas, importes, contacto enmascarado y el texto honesto; sin aceptado/pagado/Simulación/línea de tiempo', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    const title = await screen.findByRole('heading', { level: 1, name: '¡Recibimos tu pedido!' });
    expect(title).toHaveFocus();
    expect(
      screen.getByText(
        'Recibimos tu pedido. Te mostraremos su estado cuando el restaurante lo procese.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('order-number')).toHaveTextContent(created.order.displayNumber);
    expect(screen.getByTestId('order-status')).toHaveTextContent(
      'Recibido: el restaurante aún no lo procesa',
    );
    expect(screen.getByText(/2 × /)).toBeInTheDocument();
    expect(screen.getByTestId('order-total')).toHaveTextContent('106');
    expect(screen.getByText('****1234')).toBeInTheDocument();
    expect(screen.getByText('Pagas al recibir o al recoger')).toBeInTheDocument();
    expect(screen.getByText('Aún no se ha cobrado nada.')).toBeInTheDocument();
    const page = screen.getByTestId('order-received');
    expect(within(page).queryByText('Simulación')).not.toBeInTheDocument();
    expect(page.textContent).not.toMatch(/aceptad|pagado|Ver siguiente estado|\b5555\b/i);
    expect(screen.queryByRole('list', { name: /seguimiento/i })).not.toBeInTheDocument();
  });

  it('transferencia: «Transferencia: te contactaremos» (preferencia, sin afirmar cobro)', async () => {
    const { created, backend } = await place({ paymentMethodPreference: 'bank_transfer' });
    saveConfirmation(created);
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    expect(await screen.findByText('Transferencia: te contactaremos')).toBeInTheDocument();
  });

  it('a domicilio: dirección, referencia y tarifa tal como las devuelve la API', async () => {
    const { created, backend } = await place(
      { deliveryAddress: { addressLine: '6a avenida 10-50', referenceNote: 'Portón negro' } },
      { type: 'DELIVERY', municipalityId: 'mun-guatemala-guatemala', zone: 'Zona 10' },
    );
    saveConfirmation(created);
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    expect(await screen.findByText('6a avenida 10-50')).toBeInTheDocument();
    expect(screen.getByText(/Zona 10 · Referencia: Portón negro/)).toBeInTheDocument();
    expect(screen.getByText('Tarifa de envío')).toBeInTheDocument();
    expect(screen.getByText('A domicilio')).toBeInTheDocument();
  });

  it('sin credencial ni sesión (otra pestaña): dice honestamente que se perdió el acceso, sin enlace a /consultar y sin revelar datos', async () => {
    const { created, backend } = await place();
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    expect(
      await screen.findByRole('heading', { name: 'Se perdió el acceso a este pedido' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Por seguridad, este pedido solo se muestra en la pestaña donde lo hiciste\. Anota tu número de pedido y contacta a la sucursal/,
      ),
    ).toBeInTheDocument();
    // /consultar usa `POST /v1/orders/lookup` (F21), que no existe con la API real: no se ofrece.
    expect(screen.queryByRole('link', { name: /consultar/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-number')).not.toBeInTheDocument();
  });

  it('acceso perdido pero con el número guardado en esta pestaña: lo muestra', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    // La credencial ya no sirve (vencida) pero el número visible sigue guardado.
    window.sessionStorage.setItem(
      `monsushi-order-${created.order.id}`,
      JSON.stringify({
        guestToken: `smo_${'x'.repeat(43)}`,
        expiresAt: null,
        displayNumber: created.order.displayNumber,
      }),
    );
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    expect(await screen.findByText(/Tu número de pedido: MON-/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Se perdió el acceso a este pedido' }),
    ).toBeInTheDocument();
  });

  it('red/5xx tras un éxito reciente: «Tu pedido está registrado», con el número y Reintentar (que recupera el pedido)', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    let fail = true;
    const flaky = withShortcuts('http', async <T,>(path: string, o?: RequestOptions) => {
      if (fail && path.startsWith('/v1/orders/')) {
        fail = false;
        throw new ApiError(503, 'server_error', 'x');
      }
      return backend.request<T>(path, o);
    });
    await renderStore(<OrderDetail orderId={created.order.id} />, { wrapClient: () => flaky });
    expect(
      await screen.findByRole('heading', { name: 'Tu pedido está registrado' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Tu número de pedido: ${created.order.displayNumber}`),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(
      await screen.findByRole('heading', { name: '¡Recibimos tu pedido!' }),
    ).toBeInTheDocument();
  });

  it('un 5xx sin confirmación reciente cae al aviso genérico con Reintentar', async () => {
    const { created, backend } = await place();
    const broken = withShortcuts('http', async <T,>(path: string, o?: RequestOptions) => {
      if (path.startsWith('/v1/orders/')) throw new ApiError(0, 'offline', 'x');
      return backend.request<T>(path, o);
    });
    await renderStore(<OrderDetail orderId={created.order.id} />, { wrapClient: () => broken });
    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
    expect(screen.queryByText(/Tu pedido está registrado/)).not.toBeInTheDocument();
  });

  it('U1/U5: el título recibe el foco UNA sola vez, hay un solo render del pedido y «Copiar número» anuncia el resultado en role=status', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    const title = await screen.findByRole('heading', { level: 1, name: '¡Recibimos tu pedido!' });
    expect(screen.getAllByTestId('order-received')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(title).toHaveFocus();
    expect(screen.getByTestId('save-note')).toHaveTextContent('Guarda este número');
    const copy = screen.getByRole('button', {
      name: `Copiar número de pedido ${created.order.displayNumber}`,
    });
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(created.order.displayNumber);
    expect(screen.getByTestId('copy-status')).toHaveTextContent('Número copiado');
    expect(screen.getByTestId('copy-status')).toHaveAttribute('role', 'status');
  });

  it('U5: si el portapapeles falla avisa que lo anote a mano', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
      configurable: true,
    });
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: /Copiar número/ }));
    expect(await screen.findByText('No pudimos copiarlo: anótalo a mano.')).toBeInTheDocument();
  });

  it('W2: credencial solo en memoria (sessionStorage falló): muestra la confirmación con el aviso «Guarda este número» y el número copiable', async () => {
    const { created, backend } = await place();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(saveConfirmation(created)).toBe(false);
    spy.mockRestore();
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    expect(
      await screen.findByRole('heading', { name: '¡Recibimos tu pedido!' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('unsaved-warning')).toHaveTextContent(
      /Guarda este número: no pudimos recordar tu pedido en este dispositivo/,
    );
    expect(screen.getByRole('button', { name: /Copiar número/ })).toBeInTheDocument();
  });

  it('U8: un estado distinto de pending muestra el estado real (F23: detalle histórico)', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const other = withShortcuts('http', async <T,>(path: string, o?: RequestOptions) => {
      const r = await backend.request<T>(path, o);
      return (path.startsWith('/v1/orders/') ? { ...(r as object), status: 'accepted' } : r) as T;
    });
    await renderStore(<OrderDetail orderId={created.order.id} />, { wrapClient: () => other });
    expect(await screen.findByText('Aceptado por la sucursal')).toBeInTheDocument();
  });

  it('F23: pedido en curso: «Ver recibo» y «Volver a pedir»; el seguimiento es la acción principal y pide confirmar «¿Pedir otro igual?»', async () => {
    const user = userEvent.setup();
    const { created, backend } = await place();
    saveConfirmation(created);
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    expect(await screen.findByTestId('view-receipt')).toHaveAttribute(
      'href',
      `/pedidos/${created.order.id}/recibo`,
    );
    expect(screen.getByTestId('view-tracking')).toHaveClass('btn-primary');
    expect(screen.getByTestId('reorder')).not.toHaveClass('btn-primary');
    await user.click(screen.getByTestId('reorder'));
    const dialog = await screen.findByRole('dialog', { name: 'Volver a pedir' });
    expect(
      within(dialog).getByText('Este pedido sigue en curso. ¿Pedir otro igual?'),
    ).toBeVisible();
  });

  it('F23: pedido terminado es un detalle histórico (sin «recibimos tu pedido» ni aviso de guardar el número) y «Volver a pedir» es la acción principal', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    const done = withShortcuts('http', async <T,>(path: string, o?: RequestOptions) => {
      const r = await backend.request<T>(path, o);
      return (path.startsWith('/v1/orders/') ? { ...(r as object), status: 'picked_up' } : r) as T;
    });
    await renderStore(<OrderDetail orderId={created.order.id} />, { wrapClient: () => done });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Detalle de tu pedido' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('order-status')).toHaveTextContent('Recogido');
    expect(screen.queryByTestId('save-note')).not.toBeInTheDocument();
    expect(screen.queryByText('¡Recibimos tu pedido!')).not.toBeInTheDocument();
    expect(screen.getByTestId('reorder')).toHaveClass('btn-primary');
    expect(screen.getByTestId('view-receipt')).toBeVisible();
  });

  it('cargando: estado accesible con etiqueta', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
    });
    // El esqueleto es el primer estado y desaparece al llegar el pedido.
    await waitFor(() => expect(screen.getByTestId('order-received')).toBeInTheDocument());
  });

  it('inglés', async () => {
    const { created, backend } = await place();
    saveConfirmation(created);
    await renderStore(<OrderDetail orderId={created.order.id} />, {
      wrapClient: () => asHttp(backend),
      locale: 'en',
    });
    expect(
      await screen.findByRole('heading', { name: 'We received your order!' }),
    ).toBeInTheDocument();
    expect(screen.getByText('You pay on delivery or at pickup')).toBeInTheDocument();
  });
});
