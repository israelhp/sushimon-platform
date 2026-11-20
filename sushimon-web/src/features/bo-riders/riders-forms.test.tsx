import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { RidersScreen } from './components/RidersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/**
 * F27 (spec 028 §12–§13): alta, edición, traslado, activar/desactivar y disponibilidad con el adaptador mock; errores del contrato
 * por `code` (409 teléfono/versión/entrega activa/inactivo, 422, 403, 404, 429, 503) y envío correcto de `expectedVersion`.
 */

beforeEach(() => {
  resetNavigationMock('/backoffice/motoristas');
  window.__sushimonMockRequests = [];
});
afterEach(() => {
  delete window.__sushimonMockFaults;
  delete window.__sushimonMockRequests;
});

const renderRiders = (role: StaffRole = 'admin', prepareStore?: (store: MockStore) => void) =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="motoristas">
        <RidersScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, prepareStore },
  );

const withManagerWrites = (store: MockStore) => {
  store.roles.find((r) => r.code === 'manager')?.permissions.push('riders.create', 'riders.update');
};
const table = () => screen.getByRole('table', { name: 'Motoristas propios' });
const rowOf = async (name: string) =>
  (await within(table()).findByText(name)).closest('[role="row"]') as HTMLElement;
const requests = () => window.__sushimonMockRequests ?? [];
const writes = () => requests().filter((r) => !r.startsWith('GET'));
const fault = (route: string, ...kinds: string[]) => {
  window.__sushimonMockFaults = { ...(window.__sushimonMockFaults ?? {}), [route]: kinds };
};
const notice = (text: string | RegExp) => screen.findByText(text);

describe('Alta', () => {
  it('abre el formulario con foco válido; valida en cliente igual que el servidor y no envía nada', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Nuevo motorista' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo motorista' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Elige una sucursal.')).toBeVisible();
    expect(within(dialog).getByText(/El nombre debe tener entre 2 y 80/)).toBeVisible();
    expect(within(dialog).getByText(/Escribe el teléfono como \+502 y 8 dígitos/)).toBeVisible();
    expect(within(dialog).getByLabelText('Sucursal')).toHaveFocus();
    expect(within(dialog).getByLabelText('Sucursal')).toHaveAttribute('aria-invalid', 'true');
    await user.selectOptions(within(dialog).getByLabelText('Sucursal'), 'Sucursal 2');
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Ana Ruiz');
    await user.type(within(dialog).getByLabelText('Teléfono'), '5550');
    await user.type(within(dialog).getByLabelText('Placa'), 'AB');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Escribe el teléfono/)).toBeVisible();
    expect(within(dialog).getByText(/La placa debe tener de 4 a 10/)).toBeVisible();
    expect(within(dialog).getByLabelText('Teléfono')).toHaveFocus();
    expect(writes()).toEqual([]);
  });

  it('el selector de sucursal se limita a las autorizadas (encargado con riders.create: solo la suya)', async () => {
    const user = userEvent.setup();
    await renderRiders('manager', withManagerWrites);
    await screen.findByText('3 motoristas');
    await user.click(screen.getByRole('button', { name: 'Nuevo motorista' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo motorista' });
    const select = within(dialog).getByLabelText('Sucursal');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Elige una sucursal', 'Sucursal 1']);
    // Una sola sucursal autorizada: ya viene elegida.
    expect(select).toHaveValue('sucursal-1');
  });

  it('alta correcta: POST una sola vez, aviso, nace NO disponible y aparece en el listado', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Nuevo motorista' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo motorista' });
    await user.selectOptions(within(dialog).getByLabelText('Sucursal'), 'Sucursal 2');
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Ana  Ruiz');
    await user.type(within(dialog).getByLabelText('Teléfono'), '+502 5550-9999');
    await user.selectOptions(within(dialog).getByLabelText('Vehículo'), 'Bicicleta');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await notice(/Ana Ruiz quedó registrado/)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = await rowOf('Ana Ruiz');
    expect(within(row).getByText('No disponible')).toBeVisible();
    expect(within(row).getByText('+502****9999')).toBeVisible();
    expect(within(row).getByText('Sucursal 2')).toBeVisible();
    expect(await screen.findByText('8 motoristas')).toBeVisible();
    expect(writes()).toEqual(['POST /v1/admin/riders']);
  });

  it('409 RIDER_PHONE_TAKEN: error en el campo del teléfono, foco y el formulario sigue abierto', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Nuevo motorista' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo motorista' });
    await user.selectOptions(within(dialog).getByLabelText('Sucursal'), 'Sucursal 1');
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Copia Phone');
    await user.type(within(dialog).getByLabelText('Teléfono'), '+50255501002');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Ese teléfono ya está registrado/)).toBeVisible();
    expect(within(dialog).getByLabelText('Teléfono')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(within(dialog).getByLabelText('Teléfono')).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Nuevo motorista' })).toBeVisible();
  });

  it('422 BRANCH_NOT_AVAILABLE y 403 RIDER_ACTION_FORBIDDEN tienen mensaje claro', async () => {
    const user = userEvent.setup();
    const h = await renderRiders();
    await screen.findByText('7 motoristas');
    // La sucursal se desactiva en el servidor mientras se llena el formulario.
    await user.click(screen.getByRole('button', { name: 'Nuevo motorista' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo motorista' });
    await user.selectOptions(within(dialog).getByLabelText('Sucursal'), 'Sucursal 3');
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Pedro Sucursal');
    await user.type(within(dialog).getByLabelText('Teléfono'), '+50255508888');
    const branch = h.api().store.branches.find((b) => b.id === 'sucursal-3');
    if (branch) branch.active = false;
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(
      await within(dialog).findByText(/La sucursal elegida no existe o no está activa/),
    ).toBeVisible();
  });
});

describe('Edición', () => {
  it('carga el detalle (teléfono completo y placa), envía solo lo cambiado con expectedVersion y sube la versión', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Editar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar motorista' });
    expect(await within(dialog).findByLabelText('Teléfono')).toHaveValue('+50255501002');
    expect(within(dialog).getByLabelText('Placa')).toHaveValue('M219PLX');
    expect(within(dialog).getByLabelText('Sucursal')).toHaveAttribute('readonly');
    await user.clear(within(dialog).getByLabelText('Nombre completo'));
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Luis Alberto Coc');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await notice('Datos de Luis Alberto Coc actualizados.')).toBeVisible();
    expect(writes()).toEqual(['PATCH /v1/admin/riders/rider-2']);
    // Un segundo guardado reutiliza la versión nueva (si se hubiera enviado la vieja habría 409).
    await user.click(await screen.findByRole('button', { name: 'Editar a Luis Alberto Coc' }));
    const again = await screen.findByRole('dialog', { name: 'Editar motorista' });
    await user.clear(await within(again).findByLabelText('Placa'));
    await user.click(within(again).getByRole('button', { name: 'Guardar' }));
    expect(await notice('Datos de Luis Alberto Coc actualizados.')).toBeVisible();
    expect(writes()).toHaveLength(2);
  });

  it('sin cambios no envía nada y cierra', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Editar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar motorista' });
    await within(dialog).findByLabelText('Teléfono');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toEqual([]);
  });

  it('409 RIDER_VERSION_CONFLICT: ofrece recargar, conserva lo tecleado y al reaplicar guarda con la versión vigente', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Editar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar motorista' });
    await within(dialog).findByLabelText('Teléfono');
    fault('PATCH /v1/admin/riders/rider-2', 'version-conflict'); // otra persona guardó justo antes
    await user.clear(within(dialog).getByLabelText('Nombre completo'));
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Mi cambio');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Otra persona modificó este motorista/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Recargar datos' }));
    expect(await within(dialog).findByText(/Se conservaron tus cambios/)).toBeVisible();
    expect(within(dialog).getByLabelText('Nombre completo')).toHaveValue('Mi cambio');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await notice('Datos de Mi cambio actualizados.')).toBeVisible();
    expect(await rowOf('Mi cambio')).toBeVisible();
  });

  it('503 RIDERS_BUSY al guardar: mensaje y se puede volver a pulsar Guardar (no reintenta solo un alta/edición)', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Editar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar motorista' });
    await within(dialog).findByLabelText('Teléfono');
    fault('PATCH /v1/admin/riders/rider-2', 'busy');
    await user.clear(within(dialog).getByLabelText('Nombre completo'));
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Reintento Ok');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/El servicio está ocupado/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await notice('Datos de Reintento Ok actualizados.')).toBeVisible();
    expect(writes()).toHaveLength(2);
  });

  it('429: mensaje de espera', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Editar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar motorista' });
    await within(dialog).findByLabelText('Teléfono');
    fault('PATCH /v1/admin/riders/rider-2', 'rate-limited');
    await user.type(within(dialog).getByLabelText('Nombre completo'), ' Jr');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText(/Demasiadas solicitudes/)).toBeVisible();
  });

  it('el detalle de edición que da 404 muestra el mensaje claro y deja cerrar', async () => {
    const user = userEvent.setup();
    const h = await renderRiders();
    await screen.findByText('7 motoristas');
    h.api().store.adminRiders = h.api().store.adminRiders?.filter((r) => r.id !== 'rider-2');
    await user.click(screen.getByRole('button', { name: 'Editar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar motorista' });
    expect(await within(dialog).findByText(/ya no está disponible/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Estado (activar/desactivar) con confirmación', () => {
  it('desactivar: confirma con motivo opcional, queda Inactivo y NO disponible', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Desactivar a Juan Carlos Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar motorista' });
    expect(within(dialog).getByText(/quedará inactivo y no disponible/)).toBeVisible();
    expect(writes()).toEqual([]); // confirmar primero
    await user.type(within(dialog).getByLabelText('Motivo (opcional)'), 'Renuncia');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await notice('Juan Carlos Pérez desactivado.')).toBeVisible();
    const row = await rowOf('Juan Carlos Pérez');
    expect(within(row).getByText('Inactivo', { selector: '.pill' })).toBeVisible();
    expect(within(row).getByText('No disponible')).toBeVisible();
    expect(within(row).getByRole('switch')).toBeDisabled();
    expect(writes()).toEqual(['PATCH /v1/admin/riders/rider-1/status']);
  });

  it('activar: sigue NO disponible hasta que se marque', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Activar a Olga Tuyuc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activar motorista' });
    expect(within(dialog).getByText(/seguirá NO disponible/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Activar' }));
    expect(await notice(/Olga Tuyuc activado/)).toBeVisible();
    const row = await rowOf('Olga Tuyuc');
    expect(within(row).getByText('Activo')).toBeVisible();
    expect(within(row).getByText('No disponible')).toBeVisible();
    expect(within(row).getByRole('switch')).not.toBeChecked();
  });

  it('motivo > 200: error sin enviar', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Desactivar a Luis Coc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar motorista' });
    const reason = within(dialog).getByLabelText('Motivo (opcional)');
    await user.click(reason);
    await user.paste('x'.repeat(220));
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await within(dialog).findByText('Revisa los datos del formulario.')).toBeVisible();
    expect(writes()).toEqual([]);
  });

  it('409 RIDER_HAS_ACTIVE_DELIVERY: mensaje claro, el motorista no cambia', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    fault('PATCH /v1/admin/riders/rider-1/status', 'has-active-delivery');
    await user.click(screen.getByRole('button', { name: 'Desactivar a Juan Carlos Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar motorista' });
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await within(dialog).findByText(/Tiene una entrega activa/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(within(await rowOf('Juan Carlos Pérez')).getByText('Activo')).toBeVisible();
  });

  it('503 RIDERS_BUSY en una acción idempotente: reintenta solo y termina bien', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    fault('PATCH /v1/admin/riders/rider-1/status', 'busy');
    await user.click(screen.getByRole('button', { name: 'Desactivar a Juan Carlos Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar motorista' });
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(
      await screen.findByText('Juan Carlos Pérez desactivado.', {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(writes()).toHaveLength(2);
  });
});

describe('Traslado con confirmación', () => {
  it('ofrece solo otras sucursales, advierte que queda no disponible y envía expectedVersion', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(
      screen.getByRole('button', { name: 'Trasladar a Juan Carlos Pérez a otra sucursal' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Trasladar de sucursal' });
    expect(within(dialog).getByText(/Quedará NO disponible/)).toBeVisible();
    expect(within(dialog).getByText('Sucursal actual: Sucursal 1')).toBeVisible();
    const select = within(dialog).getByLabelText('Sucursal destino');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Elige la sucursal destino', 'Sucursal 2', 'Sucursal 3']);
    await user.click(within(dialog).getByRole('button', { name: 'Trasladar' }));
    expect(await within(dialog).findByText('Elige la sucursal destino.')).toBeVisible();
    expect(writes()).toEqual([]);
    await user.selectOptions(select, 'Sucursal 2');
    await user.click(within(dialog).getByRole('button', { name: 'Trasladar' }));
    expect(
      await notice('Juan Carlos Pérez se trasladó a Sucursal 2 y quedó no disponible.'),
    ).toBeVisible();
    const row = await rowOf('Juan Carlos Pérez');
    expect(within(row).getByText('Sucursal 2')).toBeVisible();
    expect(within(row).getByText('No disponible')).toBeVisible();
    expect(writes()).toEqual(['PATCH /v1/admin/riders/rider-1']);
  });

  it('409 RIDER_HAS_ACTIVE_DELIVERY al trasladar: mensaje claro', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    fault('PATCH /v1/admin/riders/rider-1', 'has-active-delivery');
    await user.click(
      screen.getByRole('button', { name: 'Trasladar a Juan Carlos Pérez a otra sucursal' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Trasladar de sucursal' });
    await user.selectOptions(within(dialog).getByLabelText('Sucursal destino'), 'Sucursal 2');
    await user.click(within(dialog).getByRole('button', { name: 'Trasladar' }));
    expect(await within(dialog).findByText(/Tiene una entrega activa/)).toBeVisible();
  });

  it('conflicto de versión al trasladar: «Recargar datos» refresca y cierra', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    fault('PATCH /v1/admin/riders/rider-1', 'version-conflict');
    await user.click(
      screen.getByRole('button', { name: 'Trasladar a Juan Carlos Pérez a otra sucursal' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Trasladar de sucursal' });
    await user.selectOptions(within(dialog).getByLabelText('Sucursal destino'), 'Sucursal 3');
    await user.click(within(dialog).getByRole('button', { name: 'Trasladar' }));
    expect(await within(dialog).findByText(/Otra persona modificó este motorista/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Recargar datos' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('con riders.update solo en su sucursal no hay destinos y se explica', async () => {
    const user = userEvent.setup();
    await renderRiders('manager', withManagerWrites);
    await screen.findByText('3 motoristas');
    await user.click(screen.getByRole('button', { name: 'Trasladar a Luis Coc a otra sucursal' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Trasladar de sucursal' });
    expect(within(dialog).getByText(/No tienes otras sucursales autorizadas/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Trasladar' })).toBeDisabled();
  });
});

describe('Disponibilidad', () => {
  it('interruptor: actualización optimista, PATCH explícito (nunca BUSY) y aviso', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    const row = await rowOf('Luis Coc');
    const sw = within(row).getByRole('switch', { name: 'Disponible: Luis Coc' });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    expect(await notice('Luis Coc quedó disponible.')).toBeVisible();
    expect(within(await rowOf('Luis Coc')).getByRole('switch')).toBeChecked();
    expect(writes()).toEqual(['PATCH /v1/admin/riders/rider-2/availability']);
    await user.click(within(await rowOf('Luis Coc')).getByRole('switch'));
    expect(await notice('Luis Coc quedó no disponible.')).toBeVisible();
    expect(within(await rowOf('Luis Coc')).getByRole('switch')).not.toBeChecked();
  });

  it('error del servidor: revierte el interruptor y avisa (409 entrega activa)', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    fault('PATCH /v1/admin/riders/rider-1/availability', 'has-active-delivery');
    const sw = within(await rowOf('Juan Carlos Pérez')).getByRole('switch');
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(await notice(/Tiene una entrega activa/)).toBeVisible();
    expect(within(await rowOf('Juan Carlos Pérez')).getByRole('switch')).toBeChecked();
  });

  it('un inactivo no puede marcarse disponible: interruptor bloqueado con explicación', async () => {
    await renderRiders();
    await screen.findByText('7 motoristas');
    const sw = within(await rowOf('Olga Tuyuc')).getByRole('switch');
    expect(sw).toBeDisabled();
    expect(sw.closest('label')).toHaveAttribute(
      'title',
      expect.stringMatching(/inactivo no puede marcarse disponible/),
    );
  });

  it('no existe forma de elegir «Ocupado» (lo deriva el servidor)', async () => {
    await renderRiders();
    await screen.findByText('7 motoristas');
    expect(screen.queryByRole('option', { name: 'Ocupado' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Ocupado/ })).toBeNull();
  });
});

describe('Edición desde el detalle', () => {
  it('Editar, Trasladar y Desactivar abren sus flujos desde el panel', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Ver detalle de Marvin Tzoc' }));
    const drawer = await screen.findByRole('dialog', { name: 'Marvin Tzoc' });
    await within(drawer).findByTestId('rider-detail');
    await user.click(within(drawer).getByRole('button', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar motorista' });
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await notice('Marvin Tzoc desactivado.')).toBeVisible();
    // El panel refleja el cambio (misma clave de detalle, invalidada tras la mutación).
    await waitFor(() =>
      expect(within(drawer).getByText('Inactivo', { selector: '.pill' })).toBeVisible(),
    );
  });
});
