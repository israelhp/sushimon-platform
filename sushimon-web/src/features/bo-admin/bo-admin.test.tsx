import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { ApiError } from '@/lib/data-access/errors';
import type { Order, ReportSummary, StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { BranchesScreen } from './components/BranchesScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { historyTotals } from './reports-view';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/sucursales'));

const renderScreen = (
  screenSlug: 'sucursales' | 'reportes',
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
) => {
  const body = screenSlug === 'sucursales' ? <BranchesScreen /> : <ReportsScreen />;
  return renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen={screenSlug}>{body}</ScreenGuard>
    </BackofficeShell>,
    { role, scenario },
  );
};

describe('sucursales', () => {
  const card = (name: string) =>
    screen.getByText(name, { selector: '.cname' }).closest('.bcard') as HTMLElement;

  it('lista las sucursales con su estado administrativo, sin cupo, con la entrega por proveedor y las estadísticas rotuladas como simulación', async () => {
    await renderScreen('sucursales');
    expect(await screen.findByText('5 sucursales')).toBeVisible();
    expect(screen.getAllByRole('switch', { name: /Sucursal activa/ })).toHaveLength(5);
    expect(within(card('Sucursal 1')).getByText('Activa')).toBeVisible();
    expect(within(card('Sucursal 4')).getByText('Inactiva')).toBeVisible();
    expect(within(card('Sucursal 1')).getByText('sucursal-1')).toBeVisible();
    expect(within(card('Sucursal 1')).getByText('Sin coordenadas')).toBeVisible();
    // estadísticas: simuladas. El radio y la cobertura por niveles se retiraron (F09): la entrega son proveedores y zonas.
    expect(within(card('Sucursal 1')).getByText('Simulación')).toBeVisible();
    expect(screen.queryByText(/Radio \d/)).toBeNull();
    expect(await within(card('Sucursal 1')).findByText('Entrega propia: Activa')).toBeVisible();
    expect(
      within(card('Sucursal 1')).getByText('PedidosYa: Habilitado · integración pendiente'),
    ).toBeVisible();
    // sucursal sin fila de configuración = valores por defecto de la API (entrega propia desactivada)
    expect(
      await within(card('Sucursal 4')).findByText('Entrega propia: Desactivada'),
    ).toBeVisible();
    // sin tope de 5 ni cupos
    expect(screen.queryByText(/Espacio \d de/)).toBeNull();
    expect(screen.queryByText(/Límite de/)).toBeNull();
    expect(screen.getByText(/no hay tope de sucursales/i)).toBeVisible();
    // ya no existe el interruptor abierta/cerrada
    expect(screen.queryByRole('switch', { name: /Sucursal abierta/ })).toBeNull();
  });

  it('filtra por estado y busca por nombre o código', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await screen.findByText('5 sucursales');
    await user.click(screen.getByRole('button', { name: 'Inactivas' }));
    expect(await screen.findByText('2 sucursales')).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    await screen.findByText('5 sucursales');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar sucursales' }), 'SUCURSAL-2');
    expect(await screen.findByText('1 sucursal')).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it('sin resultados: estado vacío con opción de limpiar filtros', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await screen.findByText('5 sucursales');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar sucursales' }), 'zzzz');
    expect(await screen.findByText('Sin resultados')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('5 sucursales')).toBeVisible();
  });

  it('cambia el orden', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await screen.findByText('5 sucursales');
    const names = () => [...document.querySelectorAll('.bcard .cname')].map((n) => n.textContent);
    expect(names()[0]).toBe('Sucursal 1');
    await user.click(screen.getByRole('button', { name: /Cambiar el orden/ }));
    await waitFor(() => expect(names()[0]).toBe('Sucursal 5'));
  });

  it('crear valida en cliente y enfoca el primer campo con error', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await user.click(await screen.findByRole('button', { name: /Nueva sucursal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva sucursal' });
    await user.click(within(dialog).getByRole('button', { name: 'Crear sucursal' }));
    const code = within(dialog).getByLabelText('Código');
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Escribe el código de la sucursal.')).toBeVisible();
    expect(within(dialog).getByText('Escribe el nombre de la sucursal.')).toBeVisible();
    expect(within(dialog).getByText('Escribe la dirección de la sucursal.')).toBeVisible();

    await user.type(code, 'zona-11');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Zona 11');
    await user.type(within(dialog).getByLabelText('Dirección'), '3a avenida 12-30');
    await user.type(within(dialog).getByLabelText('Latitud (opcional)'), '14.6');
    await user.click(within(dialog).getByRole('button', { name: 'Crear sucursal' }));
    expect(within(dialog).getByLabelText('Longitud (opcional)')).toHaveFocus();
    expect(
      within(dialog).getByText('Indica latitud y longitud juntas, o deja ambas vacías.'),
    ).toBeVisible();
  });

  it('crea una sucursal y aparece en la lista (sin tope)', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await user.click(await screen.findByRole('button', { name: /Nueva sucursal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva sucursal' });
    await user.type(within(dialog).getByLabelText('Código'), ' Zona-11 ');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Zona 11');
    await user.type(within(dialog).getByLabelText('Dirección'), '3a avenida 12-30, Zona 11');
    await user.click(within(dialog).getByRole('button', { name: 'Crear sucursal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Sucursal creada', { selector: '.toast' })).toBeVisible();
    expect(await screen.findByText('6 sucursales')).toBeVisible();
    expect(within(card('Zona 11')).getByText('zona-11')).toBeVisible();
    expect(within(card('Zona 11')).getByText('Activa')).toBeVisible();
  });

  it('un código duplicado (409) se muestra en el campo y el modal sigue abierto', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await user.click(await screen.findByRole('button', { name: /Nueva sucursal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva sucursal' });
    await user.type(within(dialog).getByLabelText('Código'), 'SUCURSAL-1');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Duplicada');
    await user.type(within(dialog).getByLabelText('Dirección'), 'Calle 1');
    await user.click(within(dialog).getByRole('button', { name: 'Crear sucursal' }));
    expect(
      await within(dialog).findByText(/Ya existe una sucursal con ese código. Elige otro./),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Código')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Código')).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Nueva sucursal' })).toBeVisible();
  });

  it('errores 400 y 403 del servidor se muestran sin cerrar el modal', async () => {
    const user = userEvent.setup();
    const view = await renderScreen('sucursales');
    await user.click(await screen.findByRole('button', { name: /Nueva sucursal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva sucursal' });
    await user.type(within(dialog).getByLabelText('Código'), 'valido');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Valida');
    await user.type(within(dialog).getByLabelText('Dirección'), 'Calle 1');

    const client = view.api().client;
    const post = vi.spyOn(client, 'post');
    post.mockRejectedValueOnce(
      new ApiError(400, 'bad_request', 'Datos inválidos', undefined, ['name: ya está en uso']),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Crear sucursal' }));
    expect(await within(dialog).findByText('ya está en uso')).toBeVisible();
    expect(within(dialog).getByText(/Revisa los datos: name: ya está en uso/)).toBeVisible();
    expect(within(dialog).getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true');

    post.mockRejectedValueOnce(new ApiError(403, 'forbidden', 'No tienes permiso'));
    await user.click(within(dialog).getByRole('button', { name: 'Crear sucursal' }));
    expect(
      await within(dialog).findByText('No tienes permiso para esta acción sobre sucursales.'),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Nueva sucursal' })).toBeVisible();
  });

  it('editar: el código es de solo lectura, valida y guarda; sin cambios no envía', async () => {
    const user = userEvent.setup();
    const view = await renderScreen('sucursales');
    await user.click(await screen.findByRole('button', { name: 'Editar Sucursal 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar sucursal' });
    expect(within(dialog).getByLabelText('Código')).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText('Código')).toHaveValue('sucursal-2');
    const name = within(dialog).getByLabelText('Nombre');
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar sucursal' }));
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Escribe el nombre de la sucursal.')).toBeVisible();

    const patch = vi.spyOn(view.api().client, 'patch');
    await user.type(name, 'Sucursal Oakland');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar sucursal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Sucursal Oakland')).toBeVisible();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![1]).toEqual({ name: 'Sucursal Oakland' });

    await user.click(screen.getByRole('button', { name: 'Editar Sucursal Oakland' }));
    const again = await screen.findByRole('dialog', { name: 'Editar sucursal' });
    await user.click(within(again).getByRole('button', { name: 'Guardar sucursal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No hay cambios que guardar', { selector: '.toast' })).toBeVisible();
  });

  it('desactivar exige confirmación y motivo; la tarjeta pasa a inactiva', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    const sw = await screen.findByRole('switch', { name: 'Sucursal activa: Sucursal 1' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar sucursal' });
    expect(within(dialog).getByText(/No cancela pedidos en curso/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar sucursal' }));
    const reason = within(dialog).getByLabelText('Motivo de la desactivación');
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Escribe el motivo de la desactivación.')).toBeVisible();
    // el estado no cambió
    expect(screen.getByRole('switch', { name: 'Sucursal activa: Sucursal 1' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.type(reason, 'Remodelación del local');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar sucursal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Sucursal 1 desactivada', { selector: '.toast' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sucursal activa: Sucursal 1' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(within(card('Sucursal 1')).getByText('Inactiva')).toBeVisible();
    expect(screen.getAllByText('Inactiva · oculta en la tienda')).toHaveLength(3);
  });

  it('activar una inactiva no exige motivo', async () => {
    const user = userEvent.setup();
    await renderScreen('sucursales');
    await user.click(await screen.findByRole('switch', { name: 'Sucursal activa: Sucursal 4' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activar sucursal' });
    await user.click(within(dialog).getByRole('button', { name: 'Activar sucursal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(card('Sucursal 4')).getByText('Activa')).toBeVisible();
  });

  it('estado administrativo y operativo son distintos: branch-closed sigue «Activa» pero con cierre extraordinario', async () => {
    await renderScreen('sucursales', 'admin', 'branch-closed');
    await screen.findByText('5 sucursales');
    expect(screen.getAllByText('Activa')).toHaveLength(3);
    expect(await screen.findAllByText('Cierre extraordinario')).toHaveLength(3);
    expect(screen.queryByText('Abierta ahora')).toBeNull();
  });

  it('estado de carga, error con reintento y 403 del servidor', async () => {
    const loading = await renderScreen('sucursales', 'admin', 'loading');
    expect(await screen.findByLabelText('Cargando…')).toBeVisible();
    loading.unmount();

    const failing = await renderScreen('sucursales', 'admin', 'error');
    expect(await screen.findByText(/No pudimos cargar las sucursales/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    failing.unmount();

    await renderScreen('sucursales', 'admin', 'forbidden');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  });

  it('el encargado ve solo su sucursal en modo lectura (sin alta ni edición)', async () => {
    await renderScreen('sucursales', 'manager');
    expect(await screen.findByText('1 sucursal')).toBeVisible();
    expect(screen.getByText('Sucursal 1', { selector: '.cname' })).toBeVisible();
    expect(screen.queryByText('Sucursal 2', { selector: '.cname' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Nueva sucursal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar a/ })).toBeNull();
  });

  it('cocina no ve la pantalla', async () => {
    await renderScreen('sucursales', 'kitchen');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    expect(screen.queryByText('Nueva sucursal')).toBeNull();
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
    expect(
      await screen.findByText(/Los datos disponibles van del/, undefined, { timeout: 5000 }),
    ).toBeVisible();
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
