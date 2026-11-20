import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { OrdersScreen } from './components/OrdersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/** F24 (spec 025 §13 #54–#57, #49–#51): panel de pago y modal «Registrar pago en efectivo» del detalle del pedido (F22). */

beforeEach(() => {
  resetNavigationMock('/backoffice/pedidos');
  window.__sushimonMockRequests = [];
});
afterEach(() => {
  delete window.__sushimonMockFaults;
  delete window.__sushimonMockRequests;
});

const ORDER = 'MON-307057'; // PICKUP · sucursal 1 · «Nuevo» · total Q197.00 (2 × dumplings + …)

const renderOrders = (role: StaffRole = 'admin', prepareStore?: (store: MockStore) => void) =>
  renderBackoffice(
    <BackofficeShell>
      <OrdersScreen />
    </BackofficeShell>,
    { role, prepareStore },
  );

async function openDrawer(code = ORDER) {
  await screen.findByText(`#${code}`);
  await userEvent.click(screen.getByText(`#${code}`));
  const drawer = await screen.findByRole('dialog', { name: new RegExp(code) });
  const panel = await within(drawer).findByTestId('payment-panel');
  return { drawer, panel };
}

const registerButton = (panel: HTMLElement) =>
  within(panel).queryByRole('button', { name: 'Registrar pago en efectivo' });

async function openModal() {
  const { panel } = await openDrawer();
  await userEvent.click(
    await within(panel).findByRole('button', { name: 'Registrar pago en efectivo' }),
  );
  return screen.findByRole('dialog', { name: 'Registrar pago en efectivo' });
}

const posts = () =>
  (window.__sushimonMockRequests ?? []).filter((r) => r.includes('/payment/cash'));

describe('panel de pago (detalle del pedido)', () => {
  it('muestra el efectivo PENDIENTE: total, pendiente, insignia con texto, historial y el botón solo con payments.confirm', async () => {
    await renderOrders('admin');
    const { panel } = await openDrawer();
    expect(within(panel).getByText('Pago en efectivo')).toBeVisible();
    expect(within(panel).getByText('Pago pendiente')).toBeVisible();
    expect(within(panel).getByTestId('payment-due')).toHaveTextContent('Q197.00');
    expect(within(panel).getByTestId('payment-outstanding')).toHaveTextContent('Q197.00');
    expect(within(panel).getByText('Simulación')).toBeVisible();
    expect(registerButton(panel)).toBeVisible();
    expect(within(panel).queryByTestId('payment-tendered')).toBeNull();
  });

  it('sin payments.confirm (encargado) no hay botón y se explica el motivo', async () => {
    await renderOrders('manager');
    const { panel } = await openDrawer();
    expect(registerButton(panel)).toBeNull();
    expect(
      within(panel).getByText('No tienes permiso para registrar pagos en esta sucursal.'),
    ).toBeVisible();
    // Sin payments.read tampoco se pide el historial ni el detalle del pago.
    expect(window.__sushimonMockRequests?.some((r) => r.includes('/payment'))).toBe(false);
  });

  it('tablero: insignia de pago pendiente en la tarjeta del pedido', async () => {
    await renderOrders('admin');
    await screen.findByText(`#${ORDER}`);
    const card = screen.getByText(`#${ORDER}`).closest('.kcard') as HTMLElement;
    expect(within(card).getByText('Pago pendiente')).toBeVisible();
  });

  it('pedido de PedidosYa: el cobro está bloqueado y se dice por qué', async () => {
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
    await userEvent.click(screen.getByText('#MON-307052'));
    const drawer = await screen.findByRole('dialog', { name: /MON-307052/ });
    const panel = await within(drawer).findByTestId('payment-panel');
    await within(panel).findByText(/cobro del proveedor está pendiente de integración/);
    expect(registerButton(panel)).toBeNull();
  });
});

describe('modal «Registrar pago en efectivo»', () => {
  it('es un diálogo accesible: foco en el campo, total pendiente, casilla etiquetada y «Registrar» deshabilitado', async () => {
    await renderOrders();
    const modal = await openModal();
    expect(modal).toHaveAttribute('aria-modal', 'true');
    const field = within(modal).getByLabelText('Efectivo recibido');
    await waitFor(() => expect(field).toHaveFocus());
    expect(within(modal).getByTestId('cash-due')).toHaveTextContent('Q197.00');
    expect(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    ).not.toBeChecked();
    expect(within(modal).getByRole('button', { name: 'Registrar pago' })).toBeDisabled();
    expect(within(modal).getByText('Simulación')).toBeVisible();
  });

  it('Esc cierra y devuelve el foco; sin peticiones al escribir (cambio solo local e informativo)', async () => {
    await renderOrders();
    const modal = await openModal();
    const field = within(modal).getByLabelText('Efectivo recibido');
    await userEvent.type(field, '200');
    expect(within(modal).getByTestId('cash-change')).toHaveTextContent('Q3.00');
    expect(posts()).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Registrar pago en efectivo' })).toBeNull(),
    );
    expect(posts()).toHaveLength(0);
  });

  it('valida localmente: insuficiente, 3 decimales y formato; solo con importe válido y casilla se habilita', async () => {
    await renderOrders();
    const modal = await openModal();
    const field = within(modal).getByLabelText('Efectivo recibido');
    const submit = within(modal).getByRole('button', { name: 'Registrar pago' });
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.type(field, '100');
    expect(
      (await within(modal).findAllByText('Faltan Q97.00 para cubrir el total.'))[0],
    ).toBeVisible();
    expect(submit).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '200.001');
    expect(await within(modal).findByText('Usa como máximo 2 decimales.')).toBeVisible();
    expect(submit).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '1e2');
    expect(await within(modal).findByText(/solo números/)).toBeVisible();
    await userEvent.clear(field);
    await userEvent.type(field, '5000.01');
    expect(await within(modal).findByText(/no puede superar Q5,000.00/)).toBeVisible();
    await userEvent.clear(field);
    await userEvent.type(field, '197');
    expect(within(modal).getByTestId('cash-change')).toHaveTextContent('Q0.00');
    expect(submit).toBeEnabled();
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    expect(submit).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });

  it('éxito SOLO tras la respuesta persistida: avisa con el cambio del servidor, cierra y el panel queda en solo lectura', async () => {
    const view = await renderOrders();
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    expect(
      await screen.findByText(/Pago del pedido MON-307057 registrado\. Cambio entregado: Q3\.00\./),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Registrar pago en efectivo' })).toBeNull(),
    );
    const panel = screen.getByTestId('payment-panel');
    await waitFor(() => expect(within(panel).getByText('Pagado')).toBeVisible());
    expect(within(panel).getByTestId('payment-tendered')).toHaveTextContent('Q200.00');
    expect(within(panel).getByTestId('payment-change')).toHaveTextContent('Q3.00');
    expect(within(panel).getByTestId('payment-outstanding')).toHaveTextContent('Q0.00');
    expect(registerButton(panel)).toBeNull();
    expect(within(panel).getByText(/Solo lectura/)).toBeVisible();
    // Un solo POST, con el cobro persistido una sola vez; el estado del pedido NO cambió.
    expect(posts()).toHaveLength(1);
    expect(view.api().store.cashPayments?.[ORDER]?.change).toBe('3.00');
    expect(view.api().store.orders.find((o) => o.id === ORDER)?.status).toBe('received');
    // Insignia del tablero actualizada por la invalidación.
    const card = screen.getByText(`#${ORDER}`, { selector: 'b' }).closest('.kcard') as HTMLElement;
    await waitFor(() => expect(within(card).getByText('Pagado')).toBeVisible());
  });

  it('doble clic: el botón se deshabilita mientras vuela y solo sale UN POST', async () => {
    await renderOrders();
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    const submit = within(modal).getByRole('button', { name: 'Registrar pago' });
    await act(async () => {
      submit.click();
      submit.click();
      submit.click();
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Registrar pago en efectivo' })).toBeNull(),
    );
    expect(posts()).toHaveLength(1);
  });

  it('409 PAYMENT_ALREADY_REGISTERED: «Otra persona ya registró este pago», muestra los datos actuales y NO ofrece cobrar de nuevo', async () => {
    await renderOrders();
    window.__sushimonMockFaults = {
      [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['payment-already-registered'],
    };
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    const alert = await within(modal).findByRole('alert');
    expect(alert).toHaveTextContent('Otra persona ya registró este pago');
    expect(alert).toHaveTextContent('por Otra persona');
    expect(within(modal).queryByRole('button', { name: 'Registrar pago' })).toBeNull();
    await userEvent.click(within(modal).getAllByRole('button', { name: 'Cerrar' }).at(-1)!);
    const panel = screen.getByTestId('payment-panel');
    await waitFor(() => expect(within(panel).getByText('Pagado')).toBeVisible());
    expect(registerButton(panel)).toBeNull();
  });

  it('503 / respuesta perdida: no declara éxito, permite reintentar y el reintento usa la MISMA clave (responde «ya registrado por ti», sin cobrar dos veces)', async () => {
    const view = await renderOrders();
    window.__sushimonMockFaults = {
      [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['lost-response'],
    };
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    const alert = await within(modal).findByTestId('cash-error');
    expect(alert).toHaveTextContent(/no sabemos si el cobro se registró/);
    expect(alert).toHaveTextContent(/no se duplicará/);
    expect(screen.queryByText(/registrado\. Cambio/)).toBeNull();
    // El modal sigue abierto: reintento con la misma clave.
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    expect(
      await screen.findByText(
        /ya estaba registrado por ti \(pedido MON-307057\)\. No se cobró otra vez\./,
      ),
    ).toBeVisible();
    expect(Object.keys(view.api().store.cashPayments ?? {})).toEqual([ORDER]);
    expect(posts()).toHaveLength(2);
  });

  it('503 ORDERS_BUSY: «Reintenta en N s con el mismo importe» y luego cobra al reintentar', async () => {
    await renderOrders();
    window.__sushimonMockFaults = {
      [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['payment-busy'],
    };
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    expect(await within(modal).findByTestId('cash-error')).toHaveTextContent(
      'El sistema está ocupado. Reintenta en 2 s con el mismo importe.',
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText(/Pago del pedido MON-307057 registrado/)).toBeVisible();
  });

  it('pedido cancelado SIN cobro: no se ofrece cobrar y se explica; tras cobrar y cancelar se avisa «posible devolución pendiente» sin acciones de reembolso', async () => {
    const view = await renderOrders();
    const { panel } = await openDrawer();
    expect(registerButton(panel)).not.toBeNull();
    await act(async () => {
      await view
        .api()
        .client.post(
          `/v1/admin/orders/${ORDER}/payment/cash`,
          { tendered: '200.00', receivedConfirmed: true },
          { headers: { 'Idempotency-Key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } },
        );
      await view.api().client.post(`/v1/admin/orders/${ORDER}/cancel`, {
        expectedStatus: 'pending',
        reason: 'Cliente no contesta',
      });
    });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByText(`#${ORDER}`));
    const drawer = await screen.findByRole('dialog', { name: new RegExp(ORDER) });
    const next = await within(drawer).findByTestId('payment-panel');
    await waitFor(() =>
      expect(within(next).getByText(/Posible devolución pendiente/)).toBeVisible(),
    );
    expect(within(next).queryByRole('button', { name: /reembols/i })).toBeNull();
    expect(registerButton(next)).toBeNull();
  });

  it('pedido entregado con pago pendiente: solo avisa (no bloquea)', async () => {
    await renderOrders('admin', (store) => {
      const order = store.orders.find((o) => o.id === 'MON-307057')!;
      order.status = 'delivered';
    });
    const { panel } = await openDrawer();
    expect(within(panel).getByText(/entregado con pago pendiente/)).toBeVisible();
    expect(registerButton(panel)).not.toBeNull();
  });
});

describe('modal: foco, mensajes y accesibilidad (UX)', () => {
  it('el motivo y «Faltan Q X» aparecen al escribir (sin salir del campo), en una región polite, y el bloque de cambio también lo dice', async () => {
    await renderOrders();
    const modal = await openModal();
    const field = within(modal).getByLabelText('Efectivo recibido');
    await userEvent.type(field, '100');
    expect(field).toHaveFocus();
    expect(await within(modal).findAllByText('Faltan Q97.00 para cubrir el total.')).toHaveLength(
      2,
    );
    expect(within(modal).getByTestId('cash-change')).toHaveTextContent('Faltan Q97.00');
    expect(field.getAttribute('aria-describedby')).toContain(
      within(modal).getByText('Faltan Q97.00 para cubrir el total.', { selector: 'div.xs' })
        .parentElement!.id,
    );
    expect(field.closest('.field')!.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('al activarse un conflicto el foco pasa al aviso (no cae al body) y «Cerrar» devuelve el foco al panel', async () => {
    await renderOrders();
    window.__sushimonMockFaults = {
      [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['payment-already-registered'],
    };
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    const alert = await within(modal).findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    await userEvent.click(within(modal).getAllByRole('button', { name: 'Cerrar' }).at(-1)!);
    await waitFor(() => expect(screen.getByTestId('payment-panel')).toHaveFocus());
  });

  it('tras un fallo de red el foco vuelve a «Registrar pago»', async () => {
    await renderOrders();
    window.__sushimonMockFaults = {
      [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['lost-response'],
    };
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    await within(modal).findByTestId('cash-error');
    await waitFor(() =>
      expect(within(modal).getByRole('button', { name: 'Registrar pago' })).toHaveFocus(),
    );
  });

  it('tras cobrar, el foco queda en el panel (el botón disparador ya no existe)', async () => {
    await renderOrders();
    const modal = await openModal();
    await userEvent.type(within(modal).getByLabelText('Efectivo recibido'), '200');
    await userEvent.click(
      within(modal).getByLabelText('Confirmo que recibí físicamente el dinero'),
    );
    await userEvent.click(within(modal).getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Registrar pago en efectivo' })).toBeNull(),
    );
    await waitFor(() => expect(screen.getByTestId('payment-panel')).toHaveFocus());
  });

  it('el historial solo se pide si el pago está cobrado o se expande la sección', async () => {
    await renderOrders();
    const { panel } = await openDrawer();
    await within(panel).findByText('Pago pendiente');
    expect(window.__sushimonMockRequests?.some((r) => r.endsWith('/payment/history'))).toBe(false);
    await userEvent.click(within(panel).getByText('Historial del pago'));
    await waitFor(() =>
      expect(window.__sushimonMockRequests?.some((r) => r.endsWith('/payment/history'))).toBe(true),
    );
  });
});
