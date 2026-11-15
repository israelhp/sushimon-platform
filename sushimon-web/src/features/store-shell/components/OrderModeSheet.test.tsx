import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchSelectionGuard } from '@/features/order-mode/branch-selection';
import { renderStore } from '@/test/store-providers';
import { OrderModeSheet } from './OrderModeSheet';

const push = vi.fn();
// Cuenta las comprobaciones de cobertura (la lógica real del mock se conserva).
const coverageChecks = vi.hoisted(() => vi.fn());
vi.mock('@/services/delivery-coverage', async (original) => {
  const mod = await original<typeof import('@/services/delivery-coverage')>();
  return {
    ...mod,
    checkDeliveryCoverage: (...args: Parameters<typeof mod.checkDeliveryCoverage>) => {
      coverageChecks(...args);
      return mod.checkDeliveryCoverage(...args);
    },
  };
});
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

beforeEach(() => {
  push.mockClear();
  coverageChecks.mockClear();
});

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

  it('domicilio: valida dirección y zona con mensajes accesibles; las zonas inexistentes no se ofrecen', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(within(dialog).getByText('Escribí la dirección de entrega.')).toBeInTheDocument();
    expect(within(dialog).getByText('Indicá la zona.')).toBeInTheDocument();
    const address = within(dialog).getByLabelText('Dirección exacta');
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(address).toHaveAccessibleDescription('Escribí la dirección de entrega.');

    // La zona es un <select> con la etiqueta «Zona N» (la misma que usa el backoffice); 20, 22 y 23 no existen.
    const zone = within(dialog).getByLabelText('Zona');
    expect(within(zone).getByRole('option', { name: 'Zona 10' })).toBeInTheDocument();
    expect(within(zone).queryByRole('option', { name: 'Zona 22' })).not.toBeInTheDocument();
    await user.selectOptions(zone, '10');
    expect(within(dialog).queryByText('Indicá la zona.')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('domicilio: la cobertura se comprueba UNA vez al completar la selección, no al abrir ni por pulsación', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    // Abrir la hoja (y elegir «Recoger») no consulta nada.
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    expect(coverageChecks).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    // Selección incompleta (falta la zona): solo la ayuda, ninguna comprobación, aunque se escriba la dirección.
    expect(within(dialog).getByText(/Elegí departamento, municipio y zona/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 10-50');
    expect(within(dialog).queryByTestId('coverage-notice')).not.toBeInTheDocument();
    expect(coverageChecks).not.toHaveBeenCalled();
    // Al completar la selección: una comprobación por sucursal activa (3), con la etiqueta «Zona 10» y SIN importes.
    await user.selectOptions(within(dialog).getByLabelText('Zona'), '10');
    expect(await within(dialog).findByTestId('coverage-notice')).toBeInTheDocument();
    await waitFor(() => expect(coverageChecks).toHaveBeenCalledTimes(3));
    for (const [, body] of coverageChecks.mock.calls) {
      expect(body).toEqual({
        branchId: expect.stringMatching(/^sucursal-[123]$/),
        municipalityId: 'mun-guatemala-guatemala',
        zone: 'Zona 10',
      });
    }
    // Seguir escribiendo no vuelve a consultar.
    await user.type(within(dialog).getByLabelText('Dirección exacta'), ' casa 4');
    expect(coverageChecks).toHaveBeenCalledTimes(3);
  });

  it('domicilio: asigna la sucursal por cobertura, muestra la tarifa del servidor y guarda', async () => {
    const user = userEvent.setup();
    const { view, dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.selectOptions(within(dialog).getByLabelText('Zona'), '10');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 10-50');
    expect(
      await within(dialog).findByText('Entregamos en esta dirección desde Sucursal 1.'),
    ).toBeInTheDocument();
    // La tarifa es el `baseFee` de la zona (string decimal del servidor), sin niveles ni tiempos inventados.
    expect(within(dialog).getByTestId('coverage-fee')).toHaveTextContent('Q15.00');
    expect(within(dialog).queryByText(/Tiempo estimado de entrega/)).not.toBeInTheDocument();

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

  it('domicilio: un departamento sin municipios cargados avisa y no permite continuar', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.selectOptions(await within(dialog).findByLabelText('Departamento'), 'Escuintla');
    expect(
      await within(dialog).findByText(
        'Por ahora solo ofrecemos entrega a domicilio en el departamento de Guatemala.',
      ),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calle principal 123');
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('domicilio: PedidosYa no verificable => «no podemos confirmar», no «sin cobertura»; no continúa', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('now');
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.selectOptions(
      within(dialog).getByLabelText('Municipio'),
      await within(dialog).findByRole('option', { name: 'Palencia' }),
    );
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calle principal 123');
    const message = await within(dialog).findByText(/No podemos confirmar el envío a domicilio/);
    expect(message).toBeInTheDocument();
    expect(within(dialog).queryByText(/no tenemos cobertura a domicilio/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).not.toHaveBeenCalled();
    // Recoger NUNCA se bloquea.
    await user.click(within(dialog).getByRole('button', { name: 'Recoger' }));
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).toHaveBeenCalledWith('/menu');
  });

  it('domicilio: sin cobertura propia y PedidosYa deshabilitado => «sin cobertura a domicilio»', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<OrderModeSheet />, {
      prepareStore: (store) => {
        for (const id of ['sucursal-1', 'sucursal-2', 'sucursal-3']) {
          store.deliverySettings[id] = {
            ownDeliveryZonesEnabled: true,
            pedidosyaEnabled: false,
            updatedAt: '2026-02-01T15:00:00.000Z',
          };
        }
      },
    });
    await act(async () => view.api().shell.openOrderSheet('now'));
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'A domicilio' }));
    await user.selectOptions(
      within(dialog).getByLabelText('Municipio'),
      await within(dialog).findByRole('option', { name: 'Palencia' }),
    );
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calle principal 123');
    expect(
      await within(dialog).findByText(/Por ahora no tenemos cobertura a domicilio/),
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
