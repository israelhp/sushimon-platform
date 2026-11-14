import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchSelectionGuard } from '@/features/order-mode/branch-selection';
import { renderStore } from '@/test/store-providers';
import { OrderModeSheet } from './OrderModeSheet';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push }),
}));

async function openSheet(variant: 'now' | 'schedule', scenario?: 'branch-closed' | 'error') {
  const view = await renderStore(<OrderModeSheet />, { scenario });
  await act(async () => view.api().shell.openOrderSheet(variant));
  const dialog = await screen.findByRole('dialog', {
    name: variant === 'now' ? 'Pedir ahora' : 'Programar pedido',
  });
  // Espera a que lleguen configuración y sucursales (el botón se habilita).
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeEnabled(),
  );
  return { view, dialog };
}

beforeEach(() => push.mockClear());

describe('OrderModeSheet', () => {
  it('exige elegir recoger o domicilio', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(within(dialog).getByText('Elegí si lo recogés o te lo llevamos.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('recoger: guarda el modo con la sucursal y lleva al menú', async () => {
    const user = userEvent.setup();
    const { view, dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    expect(within(dialog).getByRole('radiogroup')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(view.api().mode.mode).toMatchObject({
      type: 'pickup',
      when: { kind: 'now' },
      branchId: 'sucursal-1',
      address: null,
    });
    expect(push).toHaveBeenCalledWith('/menu');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cambiar de modo muestra los campos de domicilio y oculta las sucursales', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    expect(within(dialog).queryByLabelText('Dirección exacta')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    expect(within(dialog).getByLabelText('Dirección exacta')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Zona')).toBeInTheDocument();
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('domicilio: valida dirección y zona con mensajes accesibles', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(within(dialog).getByText('Escribí la dirección de entrega.')).toBeInTheDocument();
    expect(within(dialog).getByText('Indicá la zona.')).toBeInTheDocument();
    const address = within(dialog).getByLabelText('Dirección exacta');
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(address).toHaveAccessibleDescription('Escribí la dirección de entrega.');

    await user.type(within(dialog).getByLabelText('Zona'), '22');
    await user.type(address, '6a avenida 10-50');
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(within(dialog).getByText(/La zona debe ser un número del 1 al 25/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('domicilio: asigna la sucursal por cobertura, muestra la estimación simulada y guarda', async () => {
    const user = userEvent.setup();
    const { view, dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.type(within(dialog).getByLabelText('Zona'), '10');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 10-50');
    expect(
      await within(dialog).findByText('Sucursal 1', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Q15.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Tiempo estimado de entrega: 30–40 min')).toBeInTheDocument();
    expect(within(dialog).getByText('Simulación')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(view.api().mode.mode).toMatchObject({
      type: 'delivery',
      branchId: 'sucursal-1',
      address: {
        department: 'Guatemala',
        municipality: 'Guatemala',
        zone: '10',
        line: '6a avenida 10-50',
      },
    });
    expect(push).toHaveBeenCalledWith('/menu');
  });

  it('domicilio: sin cobertura no permite continuar', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.selectOptions(within(dialog).getByLabelText('Departamento'), 'Escuintla');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calle principal 123');
    expect(
      await within(dialog).findByText(
        'Por el momento no contamos con una estimación de envío para esta dirección.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('programar: ofrece días y horas según el horario y guarda la selección', async () => {
    const user = userEvent.setup();
    const { view, dialog } = await openSheet('schedule');
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    // Miércoles 11/11 14:25 + 45 min de anticipación → primer horario 3:30 p. m.
    const today = within(dialog).getByRole('button', { name: /Hoy/ });
    expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: /Mañana/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '3:30 p. m.' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).queryByRole('button', { name: '3:00 p. m.' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Mañana/ }));
    expect(within(dialog).getByRole('button', { name: '12:00 p. m.' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: '7:00 p. m.' }));
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(view.api().mode.mode.when).toEqual({
      kind: 'scheduled',
      date: '2026-11-12',
      time: '19:00',
    });
  });

  it('sucursal cerrada ahora: avisa y ofrece programar', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now', 'branch-closed');
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    const notice = await within(dialog).findByRole('status');
    expect(notice).toHaveTextContent('Programá tu pedido para más tarde.');
    await user.click(within(notice).getByRole('button', { name: 'Programar' }));
    expect(await screen.findByRole('dialog', { name: 'Programar pedido' })).toBeInTheDocument();
  });

  it('error de carga: muestra el aviso con reintento', async () => {
    const view = await renderStore(<OrderModeSheet />, { scenario: 'error' });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeDisabled();
  });

  it('recoger: el selector muestra solo las sucursales activas del listado público (con su dirección)', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    const radios = within(within(dialog).getByRole('radiogroup')).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(within(dialog).queryByText('Sucursal 4')).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('Diagonal 6, Zona 10, Ciudad de Guatemala'),
    ).toBeInTheDocument();
  });

  it('recoger: una sucursal desactivada por el administrador no se ofrece', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<OrderModeSheet />, {
      prepareStore: (store) => {
        store.branches.find((b) => b.id === 'sucursal-2')!.active = false;
      },
    });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    expect(within(dialog).queryByText('Sucursal 2')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2);
  });

  it('recoger: sin sucursales activas muestra el estado vacío y no permite continuar', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<OrderModeSheet />, {
      prepareStore: (store) => store.branches.forEach((b) => (b.active = false)),
    });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    expect(
      within(dialog).getByText(/no hay sucursales disponibles para recoger/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).not.toHaveBeenCalled();
    expect(view.api().mode.mode.branchId).toBeNull();
  });

  it('carga: muestra esqueletos y deshabilita continuar', async () => {
    const view = await renderStore(<OrderModeSheet />, { scenario: 'loading' });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeDisabled();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error al cargar las sucursales: aviso específico con reintento', async () => {
    const view = await renderStore(<OrderModeSheet />, { scenario: 'error' });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar las sucursales.');
  });

  it('en inglés el selector usa los textos de i18n', async () => {
    const view = await renderStore(<OrderModeSheet />, {
      locale: 'en',
      prepareStore: (store) => store.branches.forEach((b) => (b.active = false)),
    });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();
    await user.click(await within(dialog).findByRole('button', { name: 'Pickup' }));
    expect(await within(dialog).findByText(/no branches available for pickup/)).toBeInTheDocument();
  });

  it('la sucursal persistida que ya no está activa se limpia y se pide elegir otra', async () => {
    const view = await renderStore(
      <>
        <BranchSelectionGuard />
        <OrderModeSheet />
      </>,
      {
        prepareStore: (store) => {
          store.branches.find((b) => b.id === 'sucursal-2')!.active = false;
        },
      },
    );
    await act(async () =>
      view.api().mode.setMode({
        type: 'pickup',
        when: { kind: 'now' },
        branchId: 'sucursal-2',
        address: null,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    expect(within(dialog).getByText(/ya no está disponible/)).toBeInTheDocument();
    expect(view.api().mode.mode).toMatchObject({ type: null, branchId: null });
  });

  it('una sucursal persistida que sigue activa no se toca', async () => {
    const view = await renderStore(<BranchSelectionGuard />);
    await act(async () =>
      view.api().mode.setMode({
        type: 'pickup',
        when: { kind: 'now' },
        branchId: 'sucursal-3',
        address: null,
      }),
    );
    await act(async () => {});
    expect(view.api().mode.mode.branchId).toBe('sucursal-3');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
