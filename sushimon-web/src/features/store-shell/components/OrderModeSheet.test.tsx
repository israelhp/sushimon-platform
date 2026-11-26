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

async function openSheet(scenario?: 'branch-closed' | 'error') {
  const view = await renderStore(<OrderModeSheet />, { scenario });
  await act(async () => view.api().shell.openOrderSheet());
  const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
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

describe('OrderModeSheet (solo a domicilio e inmediato, ADR-0036)', () => {
  it('no ofrece recoger ni programar: solo dirección de entrega y «Ver el menú»', async () => {
    const { dialog } = await openSheet();
    expect(within(dialog).queryByRole('button', { name: 'Recoger' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Programar' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Cuándo/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Dirección exacta')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Zona')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeInTheDocument();
  });

  it('valida dirección y zona con mensajes accesibles; las zonas inexistentes no se ofrecen', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet();
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

  it('la cobertura se comprueba UNA vez al completar la selección, no al abrir ni por pulsación', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet();
    // Abrir la hoja no consulta nada.
    expect(coverageChecks).not.toHaveBeenCalled();
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

  it('asigna la sucursal por cobertura, muestra la tarifa del servidor y guarda el modo a domicilio', async () => {
    const user = userEvent.setup();
    const { view, dialog } = await openSheet();
    await user.selectOptions(within(dialog).getByLabelText('Zona'), '10');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 10-50');
    expect(
      await within(dialog).findByText('Entregamos en esta dirección desde Sucursal 1.'),
    ).toBeInTheDocument();
    // La tarifa es el `baseFee` de la zona (string decimal del servidor), sin niveles ni tiempos inventados.
    expect(within(dialog).getByTestId('coverage-fee')).toHaveTextContent('Q15.00');
    expect(within(dialog).queryByText(/Tiempo estimado de entrega/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(view.api().mode.mode).toEqual({
      type: 'delivery',
      branchId: 'sucursal-1',
      address: {
        department: 'Guatemala',
        municipality: 'Guatemala',
        zone: '10',
        line: '6a avenida 10-50',
        references: '',
      },
    });
    expect(push).toHaveBeenCalledWith('/menu');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('un departamento sin municipios cargados avisa y no permite continuar', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet();
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

  it('PedidosYa no verificable => «no pudimos confirmar», sin ofrecer recoger; no continúa', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet();
    await user.selectOptions(
      within(dialog).getByLabelText('Municipio'),
      await within(dialog).findByRole('option', { name: 'Palencia' }),
    );
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calle principal 123');
    expect(
      await within(dialog).findByText(/No pudimos confirmar si llegamos a esa dirección/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/recoger|recogés|Podés recoger/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('sin cobertura propia y PedidosYa deshabilitado => «por ahora no llegamos a esa dirección», sin alternativas', async () => {
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
    await act(async () => view.api().shell.openOrderSheet());
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeEnabled(),
    );
    await user.selectOptions(
      within(dialog).getByLabelText('Municipio'),
      await within(dialog).findByRole('option', { name: 'Palencia' }),
    );
    await user.type(within(dialog).getByLabelText('Dirección exacta'), 'Calle principal 123');
    expect(
      await within(dialog).findByText('Por ahora no llegamos a esa dirección.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/recoger|WhatsApp|programar/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ver el menú' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('sucursal cerrada: avisa que no recibe pedidos con la próxima apertura, sin ofrecer programar', async () => {
    const user = userEvent.setup();
    const { dialog } = await openSheet('branch-closed');
    // Aún sin dirección: ninguna sucursal abierta.
    expect(
      await within(dialog).findByText(/No hay sucursales abiertas en este momento\./),
    ).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Zona'), '10');
    await user.type(within(dialog).getByLabelText('Dirección exacta'), '6a avenida 10-50');
    expect(
      await within(dialog).findByText(/Sucursal 1 no recibe pedidos en este momento\./),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Programar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Programar pedido' })).not.toBeInTheDocument();
  });

  it('error de carga: muestra el aviso con reintento', async () => {
    const view = await renderStore(<OrderModeSheet />, { scenario: 'error' });
    await act(async () => view.api().shell.openOrderSheet());
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeDisabled();
  });

  it('carga: muestra esqueletos y deshabilita continuar', async () => {
    const view = await renderStore(<OrderModeSheet />, { scenario: 'loading' });
    await act(async () => view.api().shell.openOrderSheet());
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    expect(within(dialog).getByRole('button', { name: 'Ver el menú' })).toBeDisabled();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error al cargar las sucursales: aviso específico con reintento', async () => {
    const view = await renderStore(<OrderModeSheet />, { scenario: 'error' });
    await act(async () => view.api().shell.openOrderSheet());
    const dialog = await screen.findByRole('dialog', { name: 'Pedir ahora' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar las sucursales.');
  });

  it('en inglés usa los textos de i18n', async () => {
    const view = await renderStore(<OrderModeSheet />, { locale: 'en' });
    await act(async () => view.api().shell.openOrderSheet());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Where should we deliver?')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Pickup' })).not.toBeInTheDocument();
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
        type: 'delivery',
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
        type: 'delivery',
        branchId: 'sucursal-3',
        address: null,
      }),
    );
    await act(async () => {});
    expect(view.api().mode.mode.branchId).toBe('sucursal-3');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
