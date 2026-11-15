import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import type { StaffRole } from '@/lib/data-access/models';
import * as zonesSvc from '@/services/delivery-zones';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { BranchesScreen } from './components/BranchesScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/sucursales'));

const renderScreen = (role: StaffRole = 'admin') =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="sucursales">
        <BranchesScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role },
  );

async function openDelivery(role: StaffRole = 'admin', name = 'Sucursal 1') {
  const user = userEvent.setup();
  const view = await renderScreen(role);
  await screen.findByText(/sucursal/i, { selector: '.page-sub' });
  await user.click(await screen.findByRole('button', { name: `Entrega y zonas de ${name}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Entrega y zonas' });
  return { user, view, dialog };
}

async function openZones(role: StaffRole = 'admin', name = 'Sucursal 1') {
  const ctx = await openDelivery(role, name);
  await ctx.user.click(within(ctx.dialog).getByRole('tab', { name: 'Zonas propias' }));
  await within(ctx.dialog).findByRole('table', { name: 'Zonas de entrega propias' });
  return ctx;
}

const rowOf = (dialog: HTMLElement, text: string) =>
  within(dialog)
    .getAllByRole('row')
    .find((r) => within(r).queryByText(text, { exact: true }) !== null) as HTMLElement;

describe('proveedores de entrega por sucursal', () => {
  it('muestra los interruptores y PedidosYa como «integración pendiente», sin indicador de conexión', async () => {
    const { dialog } = await openDelivery();
    expect(
      await within(dialog).findByRole('switch', { name: 'Entrega propia en Sucursal 1' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      within(dialog).getByRole('switch', { name: 'PedidosYa habilitado en Sucursal 1' }),
    ).toHaveAttribute('aria-checked', 'true');
    const status = within(dialog).getByTestId('pedidosya-integration');
    expect(status).toHaveTextContent('Integración pendiente de documentación y credenciales');
    expect(status.textContent).not.toMatch(/conectad|operativ/i);
    // nunca se rotula con tono de éxito
    expect(status.querySelector('.st-ok')).toBeNull();
  });

  it('desactivar la entrega propia pide confirmación, guarda y refleja el resumen de la tarjeta', async () => {
    const { user, view, dialog } = await openDelivery();
    const patch = vi.spyOn(view.api().client, 'patch');
    await user.click(
      await within(dialog).findByRole('switch', { name: 'Entrega propia en Sucursal 1' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Desactivar la entrega propia' });
    expect(
      within(confirm).getByText(/No se borran zonas, motoristas ni pedidos en curso/),
    ).toBeVisible();
    // cancelar no escribe
    await user.click(within(confirm).getByRole('button', { name: 'Volver' }));
    expect(patch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('switch', { name: 'Entrega propia en Sucursal 1' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Desactivar la entrega propia' })).getByRole(
        'button',
        { name: 'Confirmar' },
      ),
    );
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]).toEqual([
      '/v1/admin/branches/sucursal-1/delivery-settings',
      { ownDeliveryZonesEnabled: false },
    ]);
    expect(
      await screen.findByText('Entrega propia desactivada en Sucursal 1', { selector: '.toast' }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('switch', { name: 'Entrega propia en Sucursal 1' }),
      ).toHaveAttribute('aria-checked', 'false'),
    );
    expect(view.api().store.deliverySettings['sucursal-1']?.ownDeliveryZonesEnabled).toBe(false);
  });

  it('deshabilitar PedidosYa también pide confirmación y aclara que es un indicador administrativo', async () => {
    const { user, dialog } = await openDelivery();
    await user.click(
      await within(dialog).findByRole('switch', { name: 'PedidosYa habilitado en Sucursal 1' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Deshabilitar PedidosYa' });
    expect(
      within(confirm).getByText(/quedará sin cobertura en lugar de «por confirmar»/),
    ).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    expect(
      await screen.findByText('PedidosYa deshabilitado en Sucursal 1', { selector: '.toast' }),
    ).toBeVisible();
    expect(await within(dialog).findByText('Deshabilitado')).toBeVisible();
  });

  it('una sucursal sin fila muestra los valores por defecto', async () => {
    const { dialog } = await openDelivery('admin', 'Sucursal 4');
    expect(await within(dialog).findByText(/aún no tiene configuración guardada/)).toBeVisible();
    expect(
      within(dialog).getByRole('switch', { name: 'Entrega propia en Sucursal 4' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('solo mock: el selector de simulación está rotulado «Simulación» y no cambia el estado a «conectado»', async () => {
    const { user, dialog } = await openDelivery();
    const select = await within(dialog).findByLabelText('Escenario simulado');
    await user.selectOptions(select, 'available');
    await waitFor(() =>
      expect(within(dialog).getByTestId('pedidosya-integration')).toHaveTextContent('Simulación'),
    );
    expect(within(dialog).getByTestId('pedidosya-integration').textContent).not.toMatch(
      /conectad/i,
    );
  });

  it('un encargado ve la configuración en solo lectura (los interruptores quedan deshabilitados)', async () => {
    const { dialog } = await openDelivery('manager');
    expect(
      await within(dialog).findByText(/Solo lectura: no tienes permiso para modificar la entrega/),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('switch', { name: 'Entrega propia en Sucursal 1' }),
    ).toBeDisabled();
    expect(within(dialog).queryByLabelText('Escenario simulado')).toBeNull();
  });

  it('403 del servidor al guardar se muestra en el diálogo sin cerrarlo', async () => {
    const { user, view, dialog } = await openDelivery();
    await user.click(
      await within(dialog).findByRole('switch', { name: 'Entrega propia en Sucursal 1' }),
    );
    // el servidor revoca el permiso entre la carga y el guardado
    view.api().store.roles.find((r) => r.code === 'admin')!.permissions = ['branches.read'];
    const confirm = await screen.findByRole('dialog', { name: 'Desactivar la entrega propia' });
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    expect(await within(confirm).findByText(/No tienes permiso/)).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Desactivar la entrega propia' })).toBeVisible();
  });
});

describe('zonas propias', () => {
  it('lista municipio, zona, tarifa en GTQ y estado con paginación del servidor', async () => {
    const { user, dialog } = await openZones();
    const table = within(dialog).getByRole('table', { name: 'Zonas de entrega propias' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Municipio', 'Zona', 'Tarifa (GTQ)', 'Estado', 'Editar']);
    expect(await within(dialog).findByText('25 zonas')).toBeVisible();
    expect(within(table).getAllByText('Q15.00').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Página 1 de 2')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    expect(await within(dialog).findByText('Página 2 de 2')).toBeVisible();
    expect(within(dialog).getAllByText('Todo el municipio').length).toBeGreaterThan(0);
  });

  it('filtra por departamento → municipio y por estado; sin resultados ofrece limpiar', async () => {
    const { user, dialog } = await openZones();
    await user.selectOptions(await within(dialog).findByLabelText('Departamento'), 'Guatemala');
    await user.selectOptions(
      within(dialog).getByLabelText('Municipio'),
      await within(dialog).findByRole('option', { name: 'Mixco' }),
    );
    expect(await within(dialog).findByText('1 zona')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Inactivas' }));
    expect(await within(dialog).findByText('Sin resultados')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Limpiar filtros' }));
    expect(await within(dialog).findByText('25 zonas')).toBeVisible();
  });

  it('busca por etiqueta sin distinguir mayúsculas', async () => {
    const { user, dialog } = await openZones();
    await user.type(within(dialog).getByLabelText('Buscar zona'), 'ZONA 10');
    expect(await within(dialog).findByText('1 zona', {}, { timeout: 2000 })).toBeVisible();
  });

  it('crea una zona con etiqueta normalizada y tarifa decimal, y la lista se actualiza', async () => {
    const { user, view, dialog } = await openZones();
    const post = vi.spyOn(view.api().client, 'post');
    await user.click(within(dialog).getByRole('button', { name: 'Nueva zona' }));
    const form = await screen.findByRole('dialog', { name: 'Nueva zona de entrega' });
    // validación local: nada se envía
    await user.click(within(form).getByRole('button', { name: 'Crear zona' }));
    expect(within(form).getByText('Elige el municipio.')).toBeVisible();
    expect(within(form).getByText('Indica la tarifa de envío.')).toBeVisible();
    // el municipio está deshabilitado hasta elegir departamento: el foco va al departamento
    expect(within(form).getByLabelText('Departamento')).toHaveFocus();
    expect(post).not.toHaveBeenCalled();

    await user.selectOptions(within(form).getByLabelText('Departamento'), 'Guatemala');
    await user.selectOptions(
      within(form).getByLabelText('Municipio'),
      await within(form).findByRole('option', { name: 'Palencia' }),
    );
    await user.type(within(form).getByLabelText('Zona (opcional)'), '  Colonia   Norte ');
    await user.type(within(form).getByLabelText(/^Tarifa de envío/), '12.5');
    await user.click(within(form).getByRole('button', { name: 'Crear zona' }));
    expect(await screen.findByText('Zona creada', { selector: '.toast' })).toBeVisible();
    expect(post.mock.calls[0]![1]).toEqual({
      branchId: 'sucursal-1',
      municipalityId: 'mun-guatemala-palencia',
      zoneLabel: 'Colonia Norte',
      baseFee: '12.50',
      active: true,
    });
    expect(await within(dialog).findByText('26 zonas')).toBeVisible();
  });

  it('tarifa inválida (3 decimales) se rechaza en el formulario con el error enlazado al campo', async () => {
    const { user, dialog } = await openZones();
    await user.click(within(dialog).getByRole('button', { name: 'Nueva zona' }));
    const form = await screen.findByRole('dialog', { name: 'Nueva zona de entrega' });
    const fee = within(form).getByLabelText(/^Tarifa de envío/);
    await user.type(fee, '15.001');
    await user.click(within(form).getByRole('button', { name: 'Crear zona' }));
    expect(fee).toHaveAttribute('aria-invalid', 'true');
    const error = within(form).getByText(/Escribe un monto en quetzales/);
    expect(error.getAttribute('style')).toContain('var(--bo-red-text)');
    expect(fee.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('un duplicado (activa o inactiva) responde 409 y se explica sin cerrar el formulario', async () => {
    const { user, dialog } = await openZones();
    await user.click(within(dialog).getByRole('button', { name: 'Nueva zona' }));
    const form = await screen.findByRole('dialog', { name: 'Nueva zona de entrega' });
    await user.selectOptions(within(form).getByLabelText('Departamento'), 'Guatemala');
    await user.selectOptions(
      within(form).getByLabelText('Municipio'),
      await within(within(form).getByLabelText('Municipio')).findByRole('option', {
        name: 'Guatemala',
      }),
    );
    await user.type(within(form).getByLabelText('Zona (opcional)'), 'zona   10');
    await user.type(within(form).getByLabelText(/^Tarifa de envío/), '10');
    await user.click(within(form).getByRole('button', { name: 'Crear zona' }));
    expect(await within(form).findByText(/Ya existe una zona con esa etiqueta/)).toBeVisible();
    expect(within(form).getByText('Ya existe esta zona en el municipio.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Nueva zona de entrega' })).toBeVisible();
  });

  it('edita la tarifa enviando solo lo que cambió con expectedVersion', async () => {
    const { user, view, dialog } = await openZones();
    const patch = vi.spyOn(view.api().client, 'patch');
    await user.click(
      await within(dialog).findByRole('button', { name: 'Editar Zona 1 de Guatemala' }),
    );
    const form = await screen.findByRole('dialog', { name: 'Editar zona de entrega' });
    expect(within(form).getByLabelText('Departamento')).toBeDisabled();
    expect(within(form).getByLabelText('Municipio')).toBeDisabled();
    const fee = within(form).getByLabelText(/^Tarifa de envío/);
    await user.clear(fee);
    await user.type(fee, '18');
    await user.click(within(form).getByRole('button', { name: 'Guardar zona' }));
    expect(await screen.findByText('Zona actualizada', { selector: '.toast' })).toBeVisible();
    expect(patch.mock.calls[0]![1]).toEqual({ expectedVersion: 1, baseFee: '18.00' });
  });

  it('conflicto de versión: avisa, recarga la versión vigente y deja reintentar sin perder lo escrito', async () => {
    const { user, view, dialog } = await openZones();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Editar Zona 1 de Guatemala' }),
    );
    const form = await screen.findByRole('dialog', { name: 'Editar zona de entrega' });
    // otra persona cambia la zona mientras tanto
    const zone = view
      .api()
      .store.deliveryZones.find((z) => z.zoneLabel === 'Zona 1' && z.branchId === 'sucursal-1')!;
    await zonesSvc.updateAdminDeliveryZone(view.api().client, zone.id, {
      expectedVersion: 1,
      baseFee: '40',
    });
    const fee = within(form).getByLabelText(/^Tarifa de envío/);
    await user.clear(fee);
    await user.type(fee, '19');
    await user.click(within(form).getByRole('button', { name: 'Guardar zona' }));
    expect(await within(form).findByText(/Otra persona modificó esta zona/)).toBeVisible();
    expect(fee).toHaveValue('19'); // conserva lo escrito
    // la segunda vez usa la versión recargada
    await waitFor(async () => {
      await user.click(within(form).getByRole('button', { name: 'Guardar zona' }));
      expect(await screen.findByText('Zona actualizada', { selector: '.toast' })).toBeVisible();
    });
    expect(zone.baseFee).toBe('19.00');
    expect(zone.version).toBe(3);
  });

  it('desactivar pide confirmación y la zona pasa a Inactiva; activar la devuelve', async () => {
    const { user, dialog } = await openZones();
    await user.click(
      await within(dialog).findByRole('button', { name: 'Desactivar Zona 1 de Guatemala' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Desactivar zona' });
    expect(within(confirm).getByText(/caerán en la cobertura general del municipio/)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Zona desactivada', { selector: '.toast' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Inactivas' }));
    const row = await waitFor(() => {
      const r = rowOf(dialog, 'Zona 1');
      expect(r).toBeTruthy();
      return r;
    });
    expect(within(row).getByText('Inactiva')).toBeVisible();
    await user.click(within(row).getByRole('button', { name: 'Activar Zona 1 de Guatemala' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Activar zona' })).getByRole('button', {
        name: 'Confirmar',
      }),
    );
    expect(await screen.findByText('Zona activada', { selector: '.toast' })).toBeVisible();
  });

  it('un encargado solo lee: sin «Nueva zona» ni acciones de fila', async () => {
    const { dialog } = await openZones('manager');
    expect(
      await within(dialog).findByText(/Solo lectura: no tienes permiso para modificar zonas/),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Nueva zona' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Editar Zona/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Desactivar Zona/ })).toBeNull();
  });

  it('la vista de todas las sucursales muestra la columna Sucursal y su filtro', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await screen.findByText(/sucursal/i, { selector: '.page-sub' });
    await user.click(screen.getByRole('button', { name: 'Zonas de entrega' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zonas de entrega' });
    const table = await within(dialog).findByRole('table', { name: 'Zonas de entrega propias' });
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Sucursal');
    expect(await within(dialog).findByText('65 zonas')).toBeVisible();
    await user.selectOptions(await within(dialog).findByLabelText('Sucursal'), 'Sucursal 2');
    expect(await within(dialog).findByText('20 zonas')).toBeVisible();
  });
});
