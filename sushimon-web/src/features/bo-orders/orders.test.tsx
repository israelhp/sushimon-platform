import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock, router } from '@/test/next-navigation-mock';
import { OrdersScreen } from './components/OrdersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/pedidos'));
afterEach(() => {
  delete window.__sushimonMockFaults;
});

const renderOrders = (role: StaffRole = 'manager', prepareStore?: (store: MockStore) => void) =>
  renderBackoffice(
    <BackofficeShell>
      <OrdersScreen />
    </BackofficeShell>,
    { role, prepareStore },
  );

const column = (name: string) => screen.getByRole('region', { name });
const card = (code: string) => {
  const el = screen.getByText(code).closest('.kcard');
  if (!el) throw new Error(`Sin tarjeta para ${code}`);
  return within(el as HTMLElement);
};

describe('tablero de pedidos (datos reales por /v1/admin/orders, simulados)', () => {
  it('muestra las 6 columnas con los pedidos y conteos de la sucursal del encargado', async () => {
    await renderOrders();
    expect(await screen.findByText('#MON-307057')).toBeVisible();
    for (const name of ['Nuevo', 'Aceptado', 'Preparación', 'Listo', 'En camino', 'Finalizados']) {
      expect(column(name)).toBeVisible();
    }
    expect(within(column('Nuevo')).getByText('#MON-307057')).toBeVisible();
    expect(within(column('Aceptado')).getByText('#MON-307055')).toBeVisible();
    // Solo la sucursal 1: el pedido de Zona 10 (sucursal 2) no aparece (el alcance lo aplica el servidor).
    expect(screen.queryByText('#MON-307058')).toBeNull();
    expect(screen.getByText(/en curso · \d+ nuevos/)).toBeVisible();
  });

  it('calcula la espera con el reloj del servidor y marca el atraso del pendiente', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    expect(card('#MON-307057').getByText('hace 8 min')).toHaveClass('late');
    expect(card('#MON-307055').getByText('hace 15 min')).toHaveClass('wait');
  });

  it('diferencia recoger, reparto propio y PedidosYa en las tarjetas', async () => {
    await renderOrders('admin', (store) => {
      const order = store.orders.find((o) => o.id === 'MON-307052')!;
      order.delivery = {
        provider: 'pedidosya',
        status: 'searching',
        riderId: null,
        riderName: null,
        reference: null,
        cost: null,
        requestedAt: order.createdAt,
        etaAt: null,
        deliveredAt: null,
        simulated: true,
      };
    });
    await screen.findByText('#MON-307051');
    expect(card('#MON-307057').getByText('Recoger')).toBeVisible();
    expect(card('#MON-307051').getByText('Reparto propio')).toBeVisible();
    expect(card('#MON-307052').getByText('PedidosYa')).toBeVisible();
  });

  it('avanza un pedido con confirmación del servidor: aceptar → preparar → listo → entregar', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(await screen.findByText(/Pedido #MON-307057: Aceptado\./)).toBeVisible();
    await waitFor(() => expect(within(column('Aceptado')).getByText('#MON-307057')).toBeVisible());

    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Iniciar preparación' }));
    await waitFor(() =>
      expect(within(column('Preparación')).getByText('#MON-307057')).toBeVisible(),
    );
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Marcar listo' }));
    await waitFor(() => expect(within(column('Listo')).getByText('#MON-307057')).toBeVisible());
    // Recoger en tienda: la siguiente acción es completar en sucursal (no despachar).
    await userEvent.click(
      card('#MON-307057').getByRole('button', { name: 'Entregar en sucursal' }),
    );
    await waitFor(() =>
      expect(within(column('Finalizados')).getByText('#MON-307057')).toBeVisible(),
    );
  });

  it('el detalle muestra líneas, totales, contacto, pago honesto, entrega e historial con actor', async () => {
    await renderOrders();
    await screen.findByText('#MON-307051');
    await userEvent.click(screen.getByText('#MON-307051')); // botón principal de la tarjeta
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    expect(await within(drawer).findByText('Productos')).toBeVisible();
    expect(within(drawer).getByText('TOTAL')).toBeVisible();
    expect(within(drawer).getByText('Envío cotizado al cliente')).toBeVisible();
    expect(within(drawer).getByText('Historial de estados')).toBeVisible();
    // F24: el panel de pago muestra el efectivo PENDIENTE (con el rol de encargado no hay `payments.confirm`: sin botón).
    const panel = within(drawer).getByTestId('payment-panel');
    expect(within(panel).getByText('Pago en efectivo')).toBeVisible();
    expect(within(panel).getByText('Pago pendiente')).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Registrar pago en efectivo' })).toBeNull();
    expect(
      within(panel).getByText('No tienes permiso para registrar pagos en esta sucursal.'),
    ).toBeVisible();
    expect(within(drawer).getByText('+502 3398-4471')).toBeVisible();
    expect(within(drawer).getByText(/Avenida Reforma 8-60/)).toBeVisible();
  });
});

describe('rechazar y cancelar con motivo', () => {
  it('rechaza con motivo obligatorio (3–280, recortado) desde el detalle y lo deja en el historial', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByText('#MON-307057'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307057/ });
    expect(await within(drawer).findByText('Sin aceptar +5 min')).toBeVisible();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Rechazar' }));

    const modal = await screen.findByRole('dialog', { name: 'Rechazar pedido' });
    expect(within(modal).getByText(/#MON-307057 · José Pablo Ruiz/)).toBeVisible();
    expect(within(modal).getByText(/No escribas datos personales/)).toBeVisible();
    // Sin motivo: error de campo y NADA se envía.
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar rechazo' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Escribe el motivo.');
    await userEvent.type(within(modal).getByRole('textbox', { name: /Motivo/ }), 'ab');
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar rechazo' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('al menos 3 caracteres');
    expect(column('Nuevo')).toHaveTextContent('#MON-307057');

    await userEvent.click(within(modal).getByRole('button', { name: 'Producto agotado' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar rechazo' }));
    expect(await screen.findByText(/Pedido #MON-307057: Rechazado\./)).toBeVisible();
    expect(
      await within(drawer).findByText('Pedido rechazado. Motivo: ab · Producto agotado'),
    ).toBeVisible();
    expect(await within(drawer).findByText(/por Marco Antonio Gómez/)).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Rechazar pedido' })).toBeNull();
    await waitFor(() => expect(within(column('Nuevo')).queryByText('#MON-307057')).toBeNull());
  });

  it('el foco entra al modal y, al cerrar con Esc, vuelve al botón que lo abrió (sin enviar nada)', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByText('#MON-307057'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307057/ });
    const opener = await within(drawer).findByRole('button', { name: 'Rechazar' });
    await userEvent.click(opener);
    const modal = await screen.findByRole('dialog', { name: 'Rechazar pedido' });
    await waitFor(() =>
      expect(within(modal).getByRole('textbox', { name: /Motivo/ })).toHaveFocus(),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Rechazar pedido' })).toBeNull(),
    );
    expect(opener).toHaveFocus();
    expect(within(column('Nuevo')).getByText('#MON-307057')).toBeVisible();
  });

  it('el foco inicial va al campo del motivo; Esc con texto escrito cierra sin enviar y devuelve el foco', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByText('#MON-307057'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307057/ });
    const opener = await within(drawer).findByRole('button', { name: 'Rechazar' });
    await userEvent.click(opener);
    const modal = await screen.findByRole('dialog', { name: 'Rechazar pedido' });
    const field = within(modal).getByRole('textbox', { name: /Motivo/ });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.type(field, 'Sin existencias');
    // Foco atrapado: Tab recorre solo el modal.
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      expect(modal.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Rechazar pedido' })).toBeNull(),
    );
    expect(opener).toHaveFocus();
    expect(within(column('Nuevo')).getByText('#MON-307057')).toBeVisible();
  });

  it('409 desde el modal: cierra, deja el texto visible en el detalle y el foco no se pierde', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByText('#MON-307057'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307057/ });
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Cancelar pedido' }));
    const modal = await screen.findByRole('dialog', { name: 'Cancelar pedido' });
    window.__sushimonMockFaults = { 'POST /v1/admin/orders/MON-307057/cancel': ['other-rejected'] };
    await userEvent.type(
      within(modal).getByRole('textbox', { name: /Motivo/ }),
      'Cliente no contesta',
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar cancelación' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cancelar pedido' })).toBeNull(),
    );
    // Texto visible en el detalle (sin una tercera región live) con el estado actual y qué hacer.
    const banner = await within(drawer).findByText(/cambió: ahora está «Rechazado»/);
    expect(banner).toBeVisible();
    expect(banner.closest('[role="status"],[role="alert"]')).toBeNull();
    expect(within(drawer).getByText(/Revisa el estado actual/)).toBeVisible();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('muestra «Hay N sin aceptar» y las etiquetas de texto (no solo color) del pendiente atrasado', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    expect(screen.getByText(/Hay \d+ pedidos? sin aceptar/)).toBeVisible();
    expect(
      within(card('#MON-307057').getByText('Sin aceptar +5 min').parentElement!).getByText(
        'Sin aceptar +5 min',
      ),
    ).toBeVisible();
  });

  it('cancelar con el efectivo YA cobrado deja un aviso informativo de posible devolución (sin reembolsar)', async () => {
    const view = await renderOrders('admin');
    await screen.findByText('#MON-307056');
    // Otra persona ya registró el cobro (F24): `payment_review` es un HECHO, no una heurística por preferencia.
    await view
      .api()
      .client.post(
        '/v1/admin/orders/MON-307056/payment/cash',
        { tendered: '5000.00', receivedConfirmed: true },
        { headers: { 'Idempotency-Key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } },
      );
    await userEvent.click(screen.getByText('#MON-307056'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307056/ });
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Cancelar pedido' }));
    const modal = await screen.findByRole('dialog', { name: 'Cancelar pedido' });
    expect(within(modal).getByText(/no podrá reactivarse/)).toBeVisible();
    await userEvent.type(
      within(modal).getByRole('textbox', { name: /Motivo/ }),
      '  Cliente no contesta  ',
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar cancelación' }));
    expect(await screen.findByText(/Pedido #MON-307056: Cancelado\./)).toBeVisible();
    // pendingActions: solo informativas.
    expect(
      (await within(drawer).findAllByText(/Posible devolución pendiente/)).length,
    ).toBeGreaterThan(0);
    expect(
      await within(drawer).findByText('Pedido cancelado. Motivo: Cliente no contesta'),
    ).toBeVisible();
  });
});

describe('F28: cancelar el pedido con una entrega abierta (409 ORDER_HAS_ACTIVE_DELIVERY)', () => {
  it('ofrece «Cancelar entrega y luego el pedido» en DOS pasos explícitos; el paso 2 solo se habilita tras el 1', async () => {
    const user = userEvent.setup();
    const view = await renderOrders('manager');
    await screen.findByText('#MON-307051');
    // La entrega abierta existe (la crea otra persona, p. ej. desde Entregas).
    await view.api().client.post('/v1/admin/deliveries', { orderId: 'MON-307051' });
    await user.click(screen.getByText('#MON-307051'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    await user.click(await within(drawer).findByRole('button', { name: 'Cancelar pedido' }));
    const reason = await screen.findByRole('dialog', { name: 'Cancelar pedido' });
    await user.type(within(reason).getByRole('textbox', { name: /Motivo/ }), 'Cliente no contesta');
    await user.click(within(reason).getByRole('button', { name: 'Confirmar cancelación' }));

    const modal = await screen.findByRole('alertdialog', {
      name: 'El pedido tiene una entrega abierta',
    });
    expect(within(modal).getByText(/dos pasos separados/)).toBeVisible();
    // Se reutiliza el motivo escrito; el paso 2 espera al 1.
    expect(within(modal).getByRole('textbox')).toHaveValue('Cliente no contesta');
    expect(await within(modal).findByRole('button', { name: 'Cancelar entrega' })).toBeEnabled();
    expect(within(modal).getByRole('button', { name: 'Cancelar pedido' })).toBeDisabled();

    await user.click(within(modal).getByRole('button', { name: 'Cancelar entrega' }));
    expect(await within(modal).findByText(/Entrega cancelada\./)).toBeVisible();
    // El pedido NO se canceló todavía (no es atómico).
    expect(view.api().store.orders.find((o) => o.id === 'MON-307051')?.status).toBe('ready');
    await user.click(within(modal).getByRole('button', { name: 'Cancelar pedido' }));
    expect(await within(modal).findByText(/Pedido cancelado\./)).toBeVisible();
    expect(view.api().store.orders.find((o) => o.id === 'MON-307051')?.status).toBe('cancelled');
  });

  it('un segundo «Despachar» sobre el mismo pedido es idempotente: avisa «ya estaba así» y abre la misma entrega', async () => {
    const user = userEvent.setup();
    const view = await renderOrders('manager');
    await screen.findByText('#MON-307051');
    const click = () => user.click(card('#MON-307051').getByRole('button', { name: 'Despachar' }));
    await click();
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    await click();
    expect(await screen.findByText(/ya estaba así: no se hizo ningún cambio/)).toBeVisible();
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(2));
    expect(router.push.mock.calls[1]?.[0]).toBe(router.push.mock.calls[0]?.[0]);
    expect(
      view.api().store.adminDeliveries?.filter((d) => d.orderId === 'MON-307051'),
    ).toHaveLength(1);
  });
});

describe('conflictos y errores', () => {
  it('409: si otra persona ya cambió el pedido, avisa el estado actual y refresca sin reintentar', async () => {
    const view = await renderOrders();
    await screen.findByText('#MON-307057');
    // Cambio "del servidor" con la tarjeta ya pintada (la UI aún cree que está Nuevo).
    await view.api().client.post('/v1/admin/orders/MON-307057/reject', {
      expectedStatus: 'pending',
      reason: 'Sin existencias',
    });
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(await screen.findByText(/cambió: ahora está «Rechazado»/)).toBeVisible();
    await waitFor(() => expect(within(column('Nuevo')).queryByText('#MON-307057')).toBeNull());
  });

  it('200 replayed: distingue la repetición propia de la hecha por otra persona', async () => {
    const view = await renderOrders();
    await screen.findByText('#MON-307057');
    window.__sushimonMockFaults = {
      'POST /v1/admin/orders/MON-307057/accept': ['other-applied'],
    };
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(
      await screen.findByText(
        /Otra persona ya lo había hecho: el pedido #MON-307057 está en «Aceptado»/,
      ),
    ).toBeVisible();
    // Repetición propia (doble envío tras un timeout): mismo actor.
    await view
      .api()
      .client.post('/v1/admin/orders/MON-307055/start-preparing', { expectedStatus: 'accepted' });
    await userEvent.click(card('#MON-307055').getByRole('button', { name: 'Iniciar preparación' }));
    expect(await screen.findByText('Este pedido ya estaba en ese estado.')).toBeVisible();
  });

  it('un fallo de red NO se convierte en un estado del pedido', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    window.__sushimonMockFaults = { 'POST /v1/admin/orders/MON-307057/accept': ['offline'] };
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(
      await screen.findByText(/no sabemos si el cambio del pedido #MON-307057 se aplicó/),
    ).toBeVisible();
    expect(within(column('Nuevo')).getByText('#MON-307057')).toBeVisible();
  });

  it('429 y 503 piden esperar con los segundos del servidor', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    window.__sushimonMockFaults = {
      'POST /v1/admin/orders/MON-307057/accept': ['rate-limited', 'busy'],
    };
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(await screen.findByText('Demasiadas solicitudes. Reintenta en 12 s.')).toBeVisible();
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(await screen.findByText('El sistema está ocupado. Reintenta en 2 s.')).toBeVisible();
  });
});

describe('permisos por rol (salen de availableActions del servidor)', () => {
  it('F28: el despacho de reparto propio está HABILITADO con deliveries.assign, crea la entrega (idempotente) y abre Entregas', async () => {
    const user = userEvent.setup();
    const { api } = await renderOrders('manager');
    await screen.findByText('#MON-307051');
    const dispatch = card('#MON-307051').getByRole('button', { name: 'Despachar' });
    expect(dispatch).toBeEnabled();
    expect(
      card('#MON-307051').getByText(/Crea la entrega y abre Entregas para asignar un motorista/),
    ).toBeVisible();
    await user.click(dispatch);
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/backoffice\/entregas\?entrega=delivery-\d+$/),
      ),
    );
    // La entrega nace `pending` y sin PII en la URL.
    expect(api().store.adminDeliveries?.find((d) => d.orderId === 'MON-307051')?.status).toBe(
      'pending',
    );
    const url = String(router.push.mock.calls[0]?.[0]);
    expect(url).not.toMatch(/MON-307051|\+502|Rodrigo/);
  });

  it('F28: sin deliveries.assign (cocina) no hay botón Despachar (NO_PERMISSION se oculta)', async () => {
    await renderOrders('kitchen');
    await screen.findByText('#MON-307051');
    expect(card('#MON-307051').queryByRole('button', { name: 'Despachar' })).toBeNull();
  });

  it('PedidosYa: despacho deshabilitado con «Integración pendiente de documentación del proveedor»', async () => {
    await renderOrders('admin', (store) => {
      const order = store.orders.find((o) => o.id === 'MON-307052')!;
      order.delivery = {
        provider: 'pedidosya',
        status: 'searching',
        riderId: null,
        riderName: null,
        reference: null,
        cost: null,
        requestedAt: order.createdAt,
        etaAt: null,
        deliveredAt: null,
        simulated: true,
      };
    });
    await screen.findByText('#MON-307052');
    expect(card('#MON-307052').getByRole('button', { name: 'Despachar' })).toBeDisabled();
    expect(
      card('#MON-307052').getByText('Integración pendiente de documentación del proveedor.'),
    ).toBeVisible();
  });

  it('cocina avanza la preparación pero NO ve cancelar; staff no ve rechazar', async () => {
    await renderOrders('kitchen');
    await screen.findByText('#MON-307055');
    expect(card('#MON-307055').getByRole('button', { name: 'Iniciar preparación' })).toBeVisible();
    await userEvent.click(screen.getByText('#MON-307055'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307055/ });
    await within(drawer).findByText('Productos');
    expect(within(drawer).queryByRole('button', { name: 'Cancelar pedido' })).toBeNull();
  });

  it('staff puede aceptar pero no rechazar', async () => {
    await renderOrders('staff');
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByText('#MON-307057'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307057/ });
    await within(drawer).findByText('Productos');
    expect(within(drawer).getByRole('button', { name: 'Aceptar pedido' })).toBeVisible();
    expect(within(drawer).queryByRole('button', { name: 'Rechazar' })).toBeNull();
  });

  it('un pedido finalizado no ofrece ninguna acción', async () => {
    await renderOrders('admin');
    await screen.findByText('#MON-307057');
    const done = within(column('Finalizados'));
    const first = done.getAllByRole('button').find((b) => b.classList.contains('kcard-main'))!;
    await userEvent.click(first);
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('Productos');
    expect(
      within(drawer).queryByRole('button', { name: /Aceptar|Rechazar|Cancelar|Marcar|Iniciar/ }),
    ).toBeNull();
  });
});

describe('vista de tabla', () => {
  const openTable = async (role: StaffRole = 'manager') => {
    const view = await renderOrders(role);
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
    await screen.findByText('Todos los pedidos');
    await screen.findByRole('button', { name: 'Ver detalle de #MON-307057' });
    return view;
  };

  it('lista los pedidos de hoy y filtra por estado en el servidor', async () => {
    await openTable();
    const tabs = screen.getByRole('tablist', { name: 'Filtrar por estado' });
    expect(within(tabs).getByRole('tab', { name: /^Todos/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(within(tabs).getByRole('tab', { name: /^Aceptado/ }));
    expect(await screen.findByRole('heading', { name: 'Aceptado' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeVisible();
  });

  it('busca por nombre en el servidor, no ofrece filtro por tipo (ADR-0036) y limpia los filtros', async () => {
    await openTable();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), 'diego');
    expect(await screen.findByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeNull(),
    );
    expect(screen.queryByRole('group', { name: 'Tipo de pedido' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delivery' })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), 'zzz');
    expect(await screen.findByText('Sin resultados')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeVisible();
  });

  it('busca por número (1042 o MON-001042) con igualdad', async () => {
    await openTable();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), 'MON-307057');
    expect(await screen.findByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeNull(),
    );
  });

  it('el encargado tiene su sucursal fija en los chips', async () => {
    await openTable();
    const chips = screen.getByRole('group', { name: 'Filtrar por sucursal' });
    expect(within(chips).getByRole('button', { name: 'Sucursal 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(chips).queryByRole('button', { name: 'Sucursal 2' })).toBeNull();
  });

  it('pagina por cursor: «Cargar más» añade filas sin duplicados', async () => {
    await openTable('admin');
    const rows = () => screen.getAllByRole('button', { name: /^Ver detalle de #MON/ });
    const before = rows().length;
    expect(before).toBe(25);
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(before));
    const names = rows().map((r) => r.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('un solo camino de datos (spec 023 §10.1, #55)', () => {
  it('la pantalla Pedidos solo usa /v1/admin/orders*: nunca /v1/backoffice/orders*, /v1/demo/* ni el despacho', async () => {
    window.__sushimonMockRequests = [];
    try {
      await renderOrders();
      await screen.findByText('#MON-307057');
      await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
      await screen.findByText(/Pedido #MON-307057: Aceptado\./);
      await userEvent.click(screen.getByText('#MON-307055'));
      await screen.findByRole('dialog', { name: /MON-307055/ });
      await userEvent.keyboard('{Escape}');
      await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
      await screen.findByText('Todos los pedidos');
      await screen.findByRole('button', { name: 'Ver detalle de #MON-307057' });

      const requests = window.__sushimonMockRequests ?? [];
      const orderCalls = requests.filter((r) => r.includes('/orders'));
      expect(orderCalls.length).toBeGreaterThan(3);
      for (const r of orderCalls) expect(r).toMatch(/ \/v1\/admin\/orders/);
      // Ninguna ruta de pedidos legada ni de despacho (la sucursal del shell sigue usando su propio endpoint).
      const legacy = requests.filter(
        (r) => /\/orders|dispatch|\/deliveries/.test(r) && !/ \/v1\/admin\/orders/.test(r),
      );
      expect(legacy).toEqual([]);
      expect(requests).toContain('POST /v1/admin/orders/MON-307057/accept');
    } finally {
      delete window.__sushimonMockRequests;
    }
  });
});
