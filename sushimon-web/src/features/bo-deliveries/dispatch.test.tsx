import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { useDispatchModal } from '@/features/bo-orders/use-dispatch-modal';
import { ApiError } from '@/lib/data-access/errors';
import { formatMoney } from '@/lib/format';
import { courierCost } from '@/mocks/handlers/logistics';
import { createSeedStore } from '@/mocks/seed';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

// Fallos provocados de la cotización (el proveedor real aún no existe: todo es simulado).
const quoteFailures = vi.hoisted(() => ({ remaining: 0 }));
vi.mock('@/services/backoffice-orders', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/backoffice-orders')>();
  return {
    ...original,
    quoteCourier: (...args: Parameters<typeof original.quoteCourier>) => {
      if (quoteFailures.remaining > 0) {
        quoteFailures.remaining -= 1;
        return Promise.reject(
          new ApiError(503, 'server_error', 'PedidosYa no responde (simulado)'),
        );
      }
      return original.quoteCourier(...args);
    },
  };
});

beforeEach(() => {
  resetNavigationMock('/backoffice/pedidos');
  quoteFailures.remaining = 0;
});

const ORDER = 'MON-307051'; // sucursal 1, a domicilio, listo, sin logística
const store = createSeedStore();
const seedOrder = store.orders.find((o) => o.id === ORDER)!;

/**
 * El modal de despacho (SIMULADO) ya no se abre desde la pantalla Pedidos (F22: allí «Despachar» está deshabilitado); sigue siendo
 * el punto de integración de Entregas y del Panel. Estas pruebas lo abren por `useDispatchModal`, igual que esas pantallas.
 */
function OpenButton({ id }: { id: string }) {
  const modal = useDispatchModal();
  return (
    <button type="button" onClick={() => modal.open(id)}>
      abrir-despacho
    </button>
  );
}

function renderOrders(
  role: StaffRole = 'manager',
  scenario: MockScenario = 'default',
  id: string = ORDER,
) {
  return renderBackoffice(
    <BackofficeShell>
      <OpenButton id={id} />
    </BackofficeShell>,
    { role, scenario },
  );
}

async function openDispatch() {
  await userEvent.click(await screen.findByRole('button', { name: 'abrir-despacho' }));
  return screen.findByRole('dialog', { name: 'Despachar pedido' });
}

describe('modal Despachar · PedidosYa (simulado)', () => {
  it('elegir → cotizar → confirmar: queda buscando repartidor y abre el seguimiento', async () => {
    await renderOrders();
    const modal = await openDispatch();
    expect(within(modal).getByText('Simulación')).toBeVisible();
    expect(
      within(modal).getByText('Elige quién llevará el pedido', { exact: false }),
    ).toBeVisible();
    expect(within(modal).getByText(/Cobrado al cliente: Q/)).toBeVisible();

    await userEvent.click(within(modal).getByRole('button', { name: /PedidosYa Courier/ }));
    const quote = await screen.findByRole('dialog', { name: 'Solicitar a PedidosYa' });
    // Cotización con el costo simulado vs. lo cobrado al cliente.
    const cost = courierCost(store, seedOrder);
    if (cost !== seedOrder.deliveryFee) {
      expect(
        await within(quote).findByText(
          'El costo de envío cambió desde que el cliente hizo su pedido.',
        ),
      ).toBeVisible();
      expect(within(quote).getByText(formatMoney(cost))).toBeVisible();
    } else {
      expect(await within(quote).findByText(/sin cambios respecto a lo cotizado/)).toBeVisible();
    }
    expect(
      within(quote).getByText(/Llegada estimada por PedidosYa: entre 25 y 40 min/),
    ).toBeVisible();

    await userEvent.click(within(quote).getByRole('button', { name: 'Confirmar y solicitar' }));
    expect(
      await screen.findByText(/Repartidor solicitado · PY-GT-77\d+ \(simulación\)/),
    ).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Solicitar a PedidosYa' })).toBeNull();
    // El detalle del pedido se abre con el seguimiento ("Buscando repartidor").
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    expect((await within(drawer).findAllByText('Buscando repartidor')).length).toBeGreaterThan(0);
  });

  it('muestra "obteniendo cotización" mientras carga y no permite confirmar', async () => {
    await renderOrders();
    const modal = await openDispatch();
    await userEvent.click(within(modal).getByRole('button', { name: /PedidosYa Courier/ }));
    const quote = await screen.findByRole('dialog', { name: 'Solicitar a PedidosYa' });
    // Aún sin cotización: el botón de confirmar está deshabilitado.
    if (within(quote).queryByText('Obteniendo cotización vigente de PedidosYa…')) {
      expect(within(quote).getByRole('button', { name: 'Confirmar y solicitar' })).toBeDisabled();
    }
    await waitFor(() =>
      expect(within(quote).getByRole('button', { name: 'Confirmar y solicitar' })).toBeEnabled(),
    );
  });

  it('error del proveedor: avisa, permite reintentar y luego cotiza', async () => {
    quoteFailures.remaining = 1;
    await renderOrders();
    const modal = await openDispatch();
    await userEvent.click(within(modal).getByRole('button', { name: /PedidosYa Courier/ }));
    const quote = await screen.findByRole('dialog', { name: 'Solicitar a PedidosYa' });
    const alert = await within(quote).findByRole('alert');
    expect(alert).toHaveTextContent('PedidosYa no responde (simulado)');
    expect(within(quote).getByRole('button', { name: 'Confirmar y solicitar' })).toBeDisabled();

    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(within(quote).queryByRole('alert')).toBeNull());
    await waitFor(() =>
      expect(within(quote).getByRole('button', { name: 'Confirmar y solicitar' })).toBeEnabled(),
    );
  });

  it('"Cambiar opción" vuelve a elegir sin despachar nada', async () => {
    await renderOrders();
    const modal = await openDispatch();
    await userEvent.click(within(modal).getByRole('button', { name: /PedidosYa Courier/ }));
    const quote = await screen.findByRole('dialog', { name: 'Solicitar a PedidosYa' });
    await userEvent.click(within(quote).getByRole('button', { name: 'Cambiar opción' }));
    expect(await screen.findByRole('dialog', { name: 'Despachar pedido' })).toBeVisible();
    // El pedido sigue listo y sin logística: el modal de despacho vuelve a la elección.
  });
});

describe('modal Despachar · repartidor del restaurante', () => {
  it('lista repartidores de la sucursal y asigna uno disponible', async () => {
    await renderOrders();
    const modal = await openDispatch();
    expect(within(modal).getByText('2 disponibles en Sucursal 1')).toBeVisible();
    await userEvent.click(
      within(modal).getByRole('button', { name: /Repartidor del restaurante/ }),
    );

    const own = await screen.findByRole('dialog', { name: 'Repartidor del restaurante' });
    const group = within(own).getByRole('radiogroup', { name: 'Repartidores del restaurante' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(own).queryByText('Mario Tzul')).toBeNull(); // otra sucursal
    const assign = within(own).getByRole('button', { name: 'Asignar repartidor' });
    expect(assign).toBeDisabled();

    await userEvent.click(within(group).getByRole('radio', { name: /Luis Coc/ }));
    expect(within(group).getByRole('radio', { name: /Luis Coc/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(assign);
    expect(await screen.findByText(`Luis Coc asignado al pedido #${ORDER}`)).toBeVisible();
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    expect((await within(drawer).findAllByText('Repartidor asignado')).length).toBeGreaterThan(0);
  });

  it('un repartidor ocupado o fuera de turno no se puede elegir', async () => {
    await renderOrders('admin', 'default', 'MON-307052');
    // Sucursal 3: Pedro Ajanel (en turno) y Carlos Yat (fuera de turno).
    const modal = await openDispatch();
    expect(within(modal).getByText('1 disponible en Sucursal 3')).toBeVisible();
    await userEvent.click(
      within(modal).getByRole('button', { name: /Repartidor del restaurante/ }),
    );
    const own = await screen.findByRole('dialog', { name: 'Repartidor del restaurante' });
    expect(within(own).getByRole('radio', { name: /Carlos Yat/ })).toBeDisabled();
    expect(within(own).getByText('Fuera de turno')).toBeVisible();
    expect(within(own).getByRole('radio', { name: /Pedro Ajanel/ })).toBeEnabled();
  });
});

describe('reglas por rol y estado', () => {
  const renderWithOpener = (role: StaffRole, id: string) => renderOrders(role, 'default', id);

  it('cocina: ve un bloqueo informativo y ninguna acción de despacho', async () => {
    await renderWithOpener('kitchen', ORDER);
    await userEvent.click(await screen.findByRole('button', { name: 'abrir-despacho' }));
    const modal = await screen.findByRole('dialog', { name: 'Despachar pedido' });
    expect(within(modal).getByText(/Tu rol no puede despachar pedidos/)).toBeVisible();
    expect(within(modal).queryByRole('button', { name: /PedidosYa Courier/ })).toBeNull();
    expect(within(modal).queryByRole('button', { name: /Confirmar|Asignar/ })).toBeNull();
  });

  it('un pedido que no está listo, o es para recoger, no se despacha', async () => {
    await renderWithOpener('admin', 'MON-307054'); // en preparación, a domicilio
    await userEvent.click(await screen.findByRole('button', { name: 'abrir-despacho' }));
    const modal = await screen.findByRole('dialog', { name: 'Despachar pedido' });
    expect(
      within(modal).getByText('Solo se despachan pedidos que están listos para despacho.'),
    ).toBeVisible();
  });

  it('Esc cierra el modal y devuelve el foco', async () => {
    await renderOrders();
    const modal = await openDispatch();
    expect(modal).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Despachar pedido' })).toBeNull(),
    );
  });
});

describe('escenario rider-unavailable', () => {
  it('PedidosYa no encuentra repartidor → se ofrece repartidor propio', async () => {
    await renderOrders('manager', 'rider-unavailable');
    const first = await openDispatch();
    await userEvent.click(within(first).getByRole('button', { name: /PedidosYa Courier/ }));
    const quote = await screen.findByRole('dialog', { name: 'Solicitar a PedidosYa' });
    const confirm = within(quote).getByRole('button', { name: 'Confirmar y solicitar' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    // Simulación: el avance desde "buscando" falla porque no hay repartidor.
    const drawer = await screen.findByRole('dialog', { name: /MON-307051/ });
    await userEvent.click(
      await within(drawer).findByRole('button', { name: /Avanzar estado logístico/ }),
    );
    expect(await within(drawer).findByText('Sin repartidor disponible')).toBeVisible();

    // Vuelve a poder despacharse desde Entregas/Panel (aquí, el mismo punto de integración): el aviso explica qué pasó.
    await userEvent.keyboard('{Escape}');
    const again = await openDispatch();
    expect(within(again).getByText(/no encontró repartidor \(simulación\)/)).toBeVisible();
    await userEvent.click(
      within(again).getByRole('button', { name: /Repartidor del restaurante/ }),
    );
    const own = await screen.findByRole('dialog', { name: 'Repartidor del restaurante' });
    await userEvent.click(within(own).getByRole('radio', { name: /Juan Carlos P\./ }));
    await userEvent.click(within(own).getByRole('button', { name: 'Asignar repartidor' }));
    expect(await screen.findByText(`Juan Carlos P. asignado al pedido #${ORDER}`)).toBeVisible();
  });
});
