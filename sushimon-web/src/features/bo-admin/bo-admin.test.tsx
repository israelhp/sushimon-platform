import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import type { Order, ReportSummary, StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { BranchesScreen } from './components/BranchesScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { UsersScreen } from './components/UsersScreen';
import { historyTotals } from './reports-view';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/sucursales'));

const renderScreen = (
  screenSlug: 'sucursales' | 'usuarios' | 'reportes',
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
) => {
  const body =
    screenSlug === 'sucursales' ? (
      <BranchesScreen />
    ) : screenSlug === 'usuarios' ? (
      <UsersScreen />
    ) : (
      <ReportsScreen />
    );
  return renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen={screenSlug}>{body}</ScreenGuard>
    </BackofficeShell>,
    { role, scenario },
  );
};

describe('sucursales', () => {
  it('muestra 3 tarjetas, 2 espacios libres y el cupo de 5', async () => {
    await renderScreen('sucursales');
    expect(await screen.findByText('3 de 5 sucursales configuradas')).toBeVisible();
    expect(screen.getByRole('img', { name: '3 de 5 sucursales' })).toBeVisible();
    expect(screen.getAllByRole('switch', { name: /Sucursal abierta/ })).toHaveLength(3);
    expect(screen.getByText('Espacio 4 de 5 disponible')).toBeVisible();
    expect(screen.getByText('Espacio 5 de 5 disponible')).toBeVisible();
    expect(screen.getAllByText('Radio 5 km').length).toBeGreaterThan(0);
  });

  it('al llenar las 5 sucursales el alta queda deshabilitada con explicación', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await screen.findByText('3 de 5 sucursales configuradas');

    await user.click(screen.getAllByRole('button', { name: /Agregar sucursal/ })[0]!);
    expect(await screen.findByText('4 de 5 sucursales configuradas')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Agregar sucursal/ }));
    expect(await screen.findByText('5 de 5 sucursales configuradas')).toBeVisible();

    const full = screen.getByRole('button', { name: /Límite de 5 sucursales alcanzado/ });
    expect(full).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: /^Agregar sucursal/ })).toBeNull();
    expect(screen.getByText(/pendiente de decisión del negocio/)).toBeVisible();
    expect(full).toHaveAccessibleDescription(/pendiente de decisión del negocio/);
  });

  it('el interruptor abre y cierra una sucursal', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    const sw = await screen.findByRole('switch', { name: 'Sucursal abierta: Sucursal 1' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sucursal abierta: Sucursal 1' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(await screen.findByText('Cerrada · no recibe pedidos')).toBeVisible();
    expect(screen.getByText('Sucursal 1 cerrada', { selector: '.toast' })).toBeVisible();
  });

  it('escenario branch-closed: todas las sucursales activas aparecen cerradas', async () => {
    await renderScreen('sucursales', 'admin', 'branch-closed');
    await screen.findByText('3 de 5 sucursales configuradas');
    await waitFor(() => expect(screen.getAllByText('Cerrada · no recibe pedidos')).toHaveLength(3));
  });

  it('editar valida y enfoca el primer campo con error; guarda los cambios', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await user.click(await screen.findByRole('button', { name: 'Editar Sucursal 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar sucursal' });
    const name = within(dialog).getByLabelText('Nombre');
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar sucursal' }));
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Escribe el nombre de la sucursal.')).toBeVisible();

    await user.type(name, 'Sucursal Oakland');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar sucursal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Sucursal Oakland')).toBeVisible();
  });

  it('el encargado no ve la pantalla', async () => {
    await renderScreen('sucursales', 'manager');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    expect(screen.queryByText('Agregar sucursal')).toBeNull();
  });
});

describe('usuarios', () => {
  it('lista los 8 usuarios con su rol y estado', async () => {
    await renderScreen('usuarios');
    expect(await screen.findByText('8 usuarios · 7 activos')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Usuarios internos' });
    expect(within(table).getAllByRole('switch')).toHaveLength(8);
    expect(within(table).getByText('Pedro Xicará')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Usuario activo: Pedro Xicará' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getAllByText('Administrador general').length).toBeGreaterThan(0);
  });

  it('busca por nombre o correo y muestra el estado vacío', async () => {
    const user = userEvent.setup();
    await renderScreen('usuarios');
    await screen.findByText('8 usuarios · 7 activos');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar usuarios' }), 'cocina');
    const table = screen.getByRole('table', { name: 'Usuarios internos' });
    expect(within(table).getAllByRole('switch')).toHaveLength(3);
    await user.clear(screen.getByRole('searchbox', { name: 'Buscar usuarios' }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar usuarios' }), 'zzz');
    expect(await screen.findByText('Ningún usuario coincide con la búsqueda.')).toBeVisible();
  });

  it('el modal valida nombre y correo, enfoca el primer error y no envía', async () => {
    const user = userEvent.setup();
    await renderScreen('usuarios');
    await user.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    const name = within(dialog).getByLabelText('Nombre completo');
    expect(name).toHaveFocus();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Completa el nombre y un correo válido.',
    );
    expect(name).toHaveAccessibleDescription('Completa el nombre y un correo válido.');

    await user.type(name, 'Lucía Prueba');
    const email = within(dialog).getByLabelText('Correo');
    await user.type(email, 'sin-arroba');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(name).not.toHaveAttribute('aria-invalid');
  });

  it('crea un usuario (encargado de una sucursal) y actualiza la lista', async () => {
    const user = userEvent.setup();
    await renderScreen('usuarios');
    await user.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await user.type(within(dialog).getByLabelText('Nombre completo'), 'Lucía Prueba');
    await user.type(within(dialog).getByLabelText('Correo'), 'lucia.prueba@sushimon.gt');
    await user.click(within(dialog).getByRole('button', { name: 'Sucursal 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('9 usuarios · 8 activos')).toBeVisible();
    expect(screen.getByText('Lucía Prueba')).toBeVisible();
    expect(screen.getByText(/invitación por correo simulada/)).toBeVisible();
  });

  it('cambiar el rol a administrador fija la sucursal en "Todas" y deshabilita las demás', async () => {
    const user = userEvent.setup();
    await renderScreen('usuarios');
    await user.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await user.click(within(dialog).getByRole('button', { name: 'Administrador general' }));
    expect(within(dialog).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'Sucursal 1' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Gestionar usuarios' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cocina' }));
    expect(within(dialog).getByRole('button', { name: 'Todas' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Gestionar usuarios' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('el servidor impide desactivarse a uno mismo y la UI lo informa', async () => {
    const user = userEvent.setup();
    await renderScreen('usuarios');
    await user.click(await screen.findByRole('button', { name: 'Editar a Ana Lucía Pérez' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar usuario' });
    expect(within(dialog).getByText(/Es tu propia cuenta/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cocina' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar usuario' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/No puedes desactivarte/);
  });

  it('el encargado no accede a Usuarios', async () => {
    await renderScreen('usuarios', 'manager');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Nuevo usuario/ })).toBeNull();
  });
});

describe('reportes', () => {
  it('muestra KPIs y gráficos accesibles del rango de 7 días', async () => {
    await renderScreen('reportes');
    const chart = await screen.findByRole('img', {
      name: /Pedidos por día y sucursal: \d+ pedidos/,
    });
    expect(chart).toBeVisible();
    expect(screen.getByText('Jue 5 nov – Mié 11 nov · 7 días', { selector: 'span' })).toBeVisible();
    expect(
      screen.getByRole('img', { name: /Ventas por día: Q[\d,]+\.\d{2} en ventas/ }),
    ).toBeVisible();
    // tabla equivalente para lectores de pantalla
    const table = screen.getByRole('table', {
      name: /Pedidos por día y sucursal \(tabla equivalente/,
    });
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(screen.getByRole('heading', { name: 'Productos más vendidos' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Ventas por sucursal' })).toBeVisible();
  });

  it('los KPIs coinciden con el resumen de la API y cambian con el periodo', async () => {
    const user = userEvent.setup();
    const view = await renderScreen('reportes');
    await screen.findByRole('img', { name: /Pedidos por día/ });
    const week = await view.api().client.get<ReportSummary>('/v1/backoffice/reports/summary', {
      query: { from: '2026-11-05', to: '2026-11-11' },
    });
    const kpiOrders = screen
      .getByText('Pedidos', { selector: '.kpi-label' })
      .closest('.kpi') as HTMLElement;
    expect(within(kpiOrders).getByText(week.orders.toLocaleString('en-US'))).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(await screen.findByRole('img', { name: /Pedidos por hora y sucursal/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Pedidos por hora y sucursal' })).toBeVisible();
    const day = await view.api().client.get<ReportSummary>('/v1/backoffice/reports/summary', {
      query: { from: '2026-11-11', to: '2026-11-11' },
    });
    await waitFor(() =>
      expect(
        within(
          screen.getByText('Pedidos', { selector: '.kpi-label' }).closest('.kpi') as HTMLElement,
        ).getByText(day.orders.toLocaleString('en-US')),
      ).toBeVisible(),
    );
  });

  it('un rango personalizado fuera de los días disponibles se recorta y avisa', async () => {
    await renderScreen('reportes');
    await screen.findByRole('img', { name: /Pedidos por día/ });
    const from = screen.getByLabelText('Desde');
    fireEvent.change(from, { target: { value: '2025-01-01' } });
    expect(await screen.findByText(/Los datos disponibles van del/)).toBeVisible();
  });

  it(
    'el historial: los totales coinciden con la suma de las filas del periodo',
    { timeout: 30_000 },
    async () => {
      const user = userEvent.setup();
      const view = await renderScreen('reportes');
      await screen.findByRole('img', { name: /Pedidos por día/ });
      await user.click(screen.getByRole('button', { name: 'Ayer' }));
      await user.click(screen.getByRole('tab', { name: 'Historial de pedidos' }));
      expect(await screen.findByRole('heading', { name: 'Pedidos del periodo' })).toBeVisible();

      const orders = await view.api().client.get<Order[]>('/v1/backoffice/reports/history', {
        query: { from: '2026-11-10', to: '2026-11-10' },
      });
      const totals = historyTotals(orders);
      const kpi = (label: string) =>
        screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi') as HTMLElement;
      await waitFor(() =>
        expect(
          within(kpi('Pedidos')).getByText(totals.count.toLocaleString('en-US')),
        ).toBeVisible(),
      );
      const money = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      expect(within(kpi('Ventas')).getByText(money(totals.sales))).toBeVisible();
      expect(within(kpi('Cancelados')).getByText(String(totals.cancelled))).toBeVisible();

      // La suma de las filas mostradas (todas las páginas) iguala el KPI de ventas.
      const more = async () => {
        const btn = screen.queryByRole('button', { name: /^Mostrar \d+ más$/ });
        if (btn) {
          await user.click(btn);
          await more();
        }
      };
      await more();
      const table = screen.getByRole('table', { name: 'Pedidos del periodo' });
      const rows = within(table)
        .getAllByRole('row')
        .filter((r) => r.classList.contains('trow'));
      expect(rows).toHaveLength(totals.count);
      let sum = 0;
      for (const row of rows) {
        const status = within(row).getByText(
          /^(Nuevo|Aceptado|En preparación|Listo para despacho|En camino|Entregado|Cancelado)$/,
        );
        if (status.textContent === 'Nuevo' || status.textContent === 'Cancelado') continue;
        sum += Number(
          within(row)
            .getByText(/^Q[\d,]+\.\d{2}$/, { selector: '.strong' })
            .textContent!.slice(1)
            .replace(/,/g, ''),
        );
      }
      expect(Math.round(sum * 100) / 100).toBe(totals.sales);
    },
  );

  it('historial: un día, filtros y estado vacío', async () => {
    const user = userEvent.setup();
    await renderScreen('reportes');
    await screen.findByRole('img', { name: /Pedidos por día/ });
    await user.click(screen.getByRole('tab', { name: 'Historial de pedidos' }));
    await screen.findByRole('heading', { name: 'Pedidos del periodo' });

    await user.click(screen.getByRole('button', { name: 'Un día' }));
    expect(await screen.findByLabelText('Día a consultar')).toHaveValue('2026-11-11');
    await user.click(screen.getByRole('button', { name: 'Día anterior' }));
    expect(screen.getByLabelText('Día a consultar')).toHaveValue('2026-11-10');
    expect(screen.getByRole('button', { name: 'Día siguiente' })).toBeEnabled();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar en el historial' }), 'zzzzzz');
    expect(
      await screen.findByText('Ningún pedido coincide con el periodo y los filtros elegidos.'),
    ).toBeVisible();
    expect(screen.getByText('1 activos')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(screen.queryByText(/Ningún pedido coincide/)).toBeNull());
  });

  it('abre el detalle de solo lectura de un pedido del historial', async () => {
    const user = userEvent.setup();
    await renderScreen('reportes');
    await screen.findByRole('img', { name: /Pedidos por día/ });
    await user.click(screen.getByRole('tab', { name: 'Historial de pedidos' }));
    await screen.findByRole('heading', { name: 'Pedidos del periodo' });
    const open = (await screen.findAllByRole('button', { name: /^Ver detalle de #/ }))[0]!;
    await user.click(open);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Detalle del historial (solo lectura)')).toBeVisible();
  });

  it('el encargado ve Reportes de su sucursal', async () => {
    await renderScreen('reportes', 'manager');
    expect(await screen.findByRole('img', { name: /Pedidos por día/ })).toBeVisible();
    expect(screen.getByText('Sucursal 1 · Zona 4 · Cuatro Grados Norte')).toBeVisible();
    const legend = document.querySelector('.legend');
    expect(legend?.textContent).toBe('Sucursal 1');
  });

  it('el rol de cocina no accede a Reportes', async () => {
    await renderScreen('reportes', 'kitchen');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  });

  it('muestra el error del servidor con opción de reintentar', async () => {
    await renderScreen('reportes', 'admin', 'error');
    expect(await screen.findByText(/No pudimos cargar los reportes/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });
});
