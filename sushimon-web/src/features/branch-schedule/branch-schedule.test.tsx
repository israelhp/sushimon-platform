import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartDrawer } from '@/features/store-shell/components/CartDrawer';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { BranchHoursDisclosure, BranchHoursPanel } from './components/BranchHoursPanel';
import { useBranchAvailability } from './hooks';
import { MAX_REFETCH_DELAY_MS } from './refetch';

afterEach(() => vi.useRealTimers());

const panel = (name: string) => screen.findByRole('region', { name: `Horario de ${name}` });

describe('detalle público de horario', () => {
  it('muestra estado, próximo cierre, horario semanal y los días sin atención', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-3" name="Sucursal 3" />);
    const region = await panel('Sucursal 3');
    expect(await within(region).findByText('Abierta')).toBeVisible();
    expect(within(region).getByText('Cierra hoy a las 10:00 p. m.')).toBeVisible();
    // hoy = miércoles (ISO 3), resaltado y anunciado
    expect(within(region).getByText('Miércoles').closest('dt')).toHaveTextContent('(Hoy)');
    expect(within(region).getByText('Sin atención')).toBeVisible(); // lunes cerrado
    expect(within(region).getAllByText('12:00 p. m. – 10:00 p. m.')).toHaveLength(6);
    expect(within(region).getByText('Hora de Guatemala')).toBeVisible();
    expect(within(region).queryByText('Cierres próximos')).toBeNull();
  });

  it('turno que cruza la medianoche se ve dividido en días y 24:00 como fin del día', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-2" name="Sucursal 2" />);
    const region = await panel('Sucursal 2');
    await within(region).findByText('Abierta');
    expect(within(region).getAllByText('12:00 a. m. – 1:00 a. m.')).toHaveLength(2); // sábado y domingo (madrugada)
    expect(within(region).getAllByText('12:00 p. m. – 12:00 a. m.')).toHaveLength(2); // viernes y sábado
  });

  it('cierres próximos sin motivo', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-1" name="Sucursal 1" />);
    const region = await panel('Sucursal 1');
    expect(await within(region).findByText('Cierres próximos')).toBeVisible();
    expect(within(region).getByRole('list')).toHaveTextContent(/18/);
    expect(region).not.toHaveTextContent(/Mantenimiento|campana/);
  });

  it('cierre extraordinario en curso: lo dice y cuándo reabre (escenario branch-closed)', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-1" name="Sucursal 1" />, {
      scenario: 'branch-closed',
    });
    const region = await panel('Sucursal 1');
    expect(await within(region).findByText('Cierre extraordinario')).toBeVisible();
    expect(within(region).getByText('Reabre mañana a las 1:00 p. m.')).toBeVisible();
    expect(region).not.toHaveTextContent(/Escenario de prueba/);
  });

  it('en inglés', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-3" name="Branch 3" />, { locale: 'en' });
    const region = await screen.findByRole('region', { name: 'Hours of Branch 3' });
    expect(await within(region).findByText('Open')).toBeVisible();
    expect(within(region).getByText('Closes today at 10:00 p.m.')).toBeVisible();
    expect(within(region).getByText('Monday')).toBeVisible();
    expect(within(region).getByText('Closed all day')).toBeVisible();
  });

  it('error con reintento', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-1" name="Sucursal 1" />, {
      scenario: 'error',
    });
    expect(await screen.findByText(/No pudimos cargar el horario/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  it('una sucursal inactiva (404 público) cae en el estado de error, sin inventar horario', async () => {
    await renderStore(<BranchHoursPanel branchId="sucursal-4" name="Sucursal 4" />);
    expect(await screen.findByText(/No pudimos cargar el horario/)).toBeVisible();
  });

  it('el botón «Ver horario» despliega el detalle y se consulta solo al abrir', async () => {
    const user = userEvent.setup();
    await renderStore(<BranchHoursDisclosure branchId="sucursal-1" name="Sucursal 1" />);
    const button = screen.getByRole('button', { name: 'Ver horario: Sucursal 1' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
    await user.click(button);
    expect(await screen.findByRole('region', { name: 'Horario de Sucursal 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ocultar horario: Sucursal 1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('disponibilidad: refetch programado (sin polling por segundo)', () => {
  function Probe() {
    const a = useBranchAvailability('sucursal-1');
    return <p data-testid="probe">{a.data ? `${a.data.reason}@${a.dataUpdatedAt}` : 'cargando'}</p>;
  }
  const updated = () => Number(screen.getByTestId('probe').textContent!.split('@')[1]);

  it('refresca al llegar el tope, no cada segundo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await renderStore(<Probe />);
    await screen.findByText(/^OPEN@/);
    const first = updated();
    // la transición está a ~7 h: el temporizador se topa a MAX_REFETCH_DELAY_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(updated()).toBe(first); // un minuto después: sin refetch (ni polling por segundo)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_REFETCH_DELAY_MS);
    });
    expect(updated()).toBeGreaterThan(first);
  });
});

describe('carrito: sucursal que no recibe pedidos (solo UI)', () => {
  async function openCart(scenario: 'default' | 'branch-closed') {
    const view = await renderStore(<CartDrawer />, { scenario });
    await act(async () => {
      view.api().cart.add(cartInput('dumplings', 1));
      view.api().mode.setMode({
        type: 'delivery',
        branchId: 'sucursal-1',
        address: null,
      });
      view.api().shell.openCart();
    });
    return view;
  }

  it('avisa y dice cuándo abre', async () => {
    await openCart('branch-closed');
    const notice = await screen.findByText(/no recibe pedidos en este momento/);
    const box = notice.closest('.notice') as HTMLElement;
    expect(box).toHaveTextContent('Sucursal 1 no recibe pedidos en este momento.');
    expect(box).toHaveTextContent('Abre mañana a las 1:00 p. m.');
  });

  it('no muestra aviso si la sucursal recibe pedidos', async () => {
    await openCart('default');
    await screen.findByText('Dumplings');
    expect(screen.queryByText(/no recibe pedidos/)).toBeNull();
  });
});
