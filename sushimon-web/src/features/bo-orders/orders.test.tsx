import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { OrdersScreen } from './components/OrdersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/pedidos'));

const renderOrders = (role: StaffRole = 'manager') =>
  renderBackoffice(
    <BackofficeShell>
      <OrdersScreen />
    </BackofficeShell>,
    { role },
  );

const column = (name: string) => screen.getByRole('region', { name });
const card = (code: string) => {
  const el = screen.getByText(code).closest('.kcard');
  if (!el) throw new Error(`Sin tarjeta para ${code}`);
  return within(el as HTMLElement);
};

describe('tablero de pedidos', () => {
  it('muestra las columnas del prototipo con los pedidos de la sucursal del encargado', async () => {
    await renderOrders();
    expect(await screen.findByText('#MON-307057')).toBeVisible();
    for (const name of ['Nuevo', 'Aceptado', 'Preparación', 'Listo', 'En camino', 'Entregado']) {
      expect(column(name)).toBeVisible();
    }
    expect(within(column('Nuevo')).getByText('#MON-307057')).toBeVisible();
    expect(within(column('Aceptado')).getByText('#MON-307055')).toBeVisible();
    // Solo la sucursal 1: el pedido de Zona 10 (sucursal 2) no aparece.
    expect(screen.queryByText('#MON-307058')).toBeNull();
    expect(screen.getByText(/en curso · \d+ nuevos/)).toBeVisible();
  });

  it('muestra el tiempo transcurrido con el reloj de la demo y marca el atraso', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    const c = card('#MON-307057');
    expect(c.getByText('hace 8 min')).toHaveClass('late');
    expect(card('#MON-307055').getByText('hace 15 min')).toHaveClass('wait');
  });

  it('avanza un pedido: aceptar → preparar → listo, con aviso y cambio de columna', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(await screen.findByText('Pedido #MON-307057 aceptado')).toBeVisible();
    await waitFor(() => expect(within(column('Aceptado')).getByText('#MON-307057')).toBeVisible());

    await userEvent.click(
      card('#MON-307057').getByRole('button', { name: 'Marcar en preparación' }),
    );
    await waitFor(() =>
      expect(within(column('Preparación')).getByText('#MON-307057')).toBeVisible(),
    );
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Marcar listo' }));
    await waitFor(() => expect(within(column('Listo')).getByText('#MON-307057')).toBeVisible());
    // Recoger en tienda: la siguiente acción es entregar al cliente (no despachar).
    expect(card('#MON-307057').getByRole('button', { name: 'Entregado al cliente' })).toBeVisible();
  });

  it('rechaza con motivo desde el detalle y lo deja en el historial', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByText('#MON-307057')); // abre el detalle (botón principal de la tarjeta)
    const drawer = await screen.findByRole('dialog', { name: /MON-307057/ });
    expect(within(drawer).getByText('Sin aceptar +5 min')).toBeVisible();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Rechazar' }));

    const modal = await screen.findByRole('dialog', { name: 'Rechazar pedido' });
    expect(within(modal).getByText('Elige el motivo. Se notificará al cliente.')).toBeVisible();
    await userEvent.click(within(modal).getByRole('button', { name: 'Producto agotado' }));

    expect(await screen.findByText('Pedido #MON-307057 rechazado')).toBeVisible();
    expect(
      await within(drawer).findByText('Pedido rechazado. Motivo: Producto agotado'),
    ).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Rechazar pedido' })).toBeNull();
    await waitFor(() => expect(within(column('Nuevo')).queryByText('#MON-307057')).toBeNull());
  });

  it('el detalle muestra productos, totales, entrega e historial', async () => {
    await renderOrders();
    await screen.findByText('#MON-307051');
    await userEvent.click(screen.getByText('#MON-307051')); // abre el detalle (botón principal de la tarjeta)
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    expect(within(drawer).getByText('Productos')).toBeVisible();
    expect(within(drawer).getByText('TOTAL')).toBeVisible();
    expect(within(drawer).getByText('Envío cotizado al cliente')).toBeVisible();
    expect(within(drawer).getByText('Historial de estados')).toBeVisible();
    expect(within(drawer).getByText(/Aún sin repartidor/)).toBeVisible();
  });

  it('si otro usuario ya cambió el pedido, el servidor responde y la UI avisa del error', async () => {
    const view = await renderOrders();
    await screen.findByText('#MON-307057');
    // Cambio "del servidor" con la tarjeta ya pintada (la UI aún cree que está Nuevo).
    await view
      .api()
      .client.patch('/v1/backoffice/orders/MON-307057/status', { status: 'accepted' });
    await userEvent.click(card('#MON-307057').getByRole('button', { name: 'Aceptar pedido' }));
    expect(await screen.findByText(/No se pudo actualizar el pedido/)).toBeVisible();
  });
});

describe('permisos por rol en Pedidos', () => {
  it('el encargado despacha: abre el modal Despachar (simulación) y no cambia el estado al abrirlo', async () => {
    await renderOrders('manager');
    await screen.findByText('#MON-307051');
    await userEvent.click(card('#MON-307051').getByRole('button', { name: 'Despachar pedido' }));
    const modal = await screen.findByRole('dialog', { name: 'Despachar pedido' });
    expect(within(modal).getByRole('button', { name: /PedidosYa Courier/ })).toBeVisible();
    expect(within(modal).getByText('Simulación')).toBeVisible();
    expect(within(column('Listo')).getByText('#MON-307051')).toBeVisible();
  });

  it('cocina no despacha: ve el bloqueo informativo en el detalle', async () => {
    await renderOrders('kitchen');
    await screen.findByText('#MON-307051');
    expect(screen.queryByRole('button', { name: /Despachar/ })).toBeNull();
    await userEvent.click(screen.getByText('#MON-307051')); // abre el detalle (botón principal de la tarjeta)
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    expect(within(drawer).getByText(/Un encargado de sucursal lo despachará/)).toBeVisible();
    expect(within(drawer).queryByRole('button', { name: /DESPACHAR/ })).toBeNull();
  });

  it('cocina sí avanza la preparación', async () => {
    await renderOrders('kitchen');
    await screen.findByText('#MON-307055');
    expect(
      card('#MON-307055').getByRole('button', { name: 'Marcar en preparación' }),
    ).toBeVisible();
  });
});

describe('vista de tabla', () => {
  const openTable = async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
    await screen.findByText('Todos los pedidos');
  };

  it('lista los pedidos con contadores por estado', async () => {
    await openTable();
    const tabs = screen.getByRole('tablist', { name: 'Filtrar por estado' });
    expect(within(tabs).getByRole('tab', { name: /^Todos/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeVisible();
    await userEvent.click(within(tabs).getByRole('tab', { name: /^Nuevo/ }));
    expect(screen.getByRole('heading', { name: 'Nuevo' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeNull();
  });

  it('filtra por búsqueda y por tipo, y limpia los filtros', async () => {
    await openTable();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), 'diego');
    expect(screen.getByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Delivery' }));
    expect(await screen.findByText('Sin resultados')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(screen.getByRole('button', { name: 'Ver detalle de #MON-307057' })).toBeVisible();
  });

  it('el encargado tiene su sucursal fija en los chips', async () => {
    await openTable();
    const chips = screen.getByRole('group', { name: 'Filtrar por sucursal' });
    expect(within(chips).getByRole('button', { name: 'Sucursal 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(chips).getByRole('button', { name: 'Sucursal 2' })).toBeDisabled();
  });
});
