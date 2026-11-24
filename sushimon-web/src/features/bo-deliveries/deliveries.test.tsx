import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { ApiError } from '@/lib/data-access/errors';
import type { StaffRole } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { localDate } from '@/lib/time';
import { DEMO_BASE_TIME } from '@/mocks/clock';
import type { MockScenario } from '@/mocks/scenarios';
import { listDeliveries } from '@/services/backoffice-orders';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { DeliveriesScreen } from './components/DeliveriesScreen';
import { deliveryStats, toDeliveryRows } from './deliveries-view';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

// Fallo provocado de la lista de envíos (estado de error con reintento).
const listFailures = vi.hoisted(() => ({ remaining: 0 }));
vi.mock('@/services/backoffice-orders', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/backoffice-orders')>();
  return {
    ...original,
    listDeliveries: (...args: Parameters<typeof original.listDeliveries>) => {
      if (listFailures.remaining > 0) {
        listFailures.remaining -= 1;
        return Promise.reject(new ApiError(500, 'server_error', 'Error del servidor'));
      }
      return original.listDeliveries(...args);
    },
  };
});

beforeEach(() => {
  resetNavigationMock('/backoffice/entregas');
  listFailures.remaining = 0;
});

const NOW = new Date(DEMO_BASE_TIME);
const TODAY = localDate(NOW);

/**
 * F28: la pantalla abre en «Reparto propio» (real); estas pruebas cubren la «Simulación PedidosYa» (MOCK_ONLY), que sigue existiendo
 * en su propia pestaña rotulada. Se cambia a ella antes de cada prueba (cambio por diseño; el contenido simulado no cambia).
 */
async function renderDeliveries(
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
  { simulation = true }: { simulation?: boolean } = {},
) {
  const view = renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="entregas">
        <DeliveriesScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, scenario },
  );
  const rendered = await view;
  if (simulation) {
    const tab = await screen.findByRole('tab', { name: 'Simulación PedidosYa' });
    await userEvent.setup().click(tab);
  }
  return rendered;
}

const kpi = (label: string) => {
  const el = screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi');
  if (!el) throw new Error(`Sin indicador ${label}`);
  return within(el as HTMLElement);
};
const rowOf = (code: string) => {
  const el = screen.getByRole('button', { name: code }).closest('.trow');
  if (!el) throw new Error(`Sin fila ${code}`);
  return within(el as HTMLElement);
};

describe('pantalla Entregas', () => {
  it('muestra periodo, indicadores y envíos de hoy (administrador, todas las sucursales)', async () => {
    const { api } = await renderDeliveries();
    expect(
      await screen.findByRole('heading', { name: 'Entregas', level: 1, hidden: true }),
    ).toBeTruthy();
    await screen.findByText('#MON-307049');
    expect(
      screen.getByText(
        /Envíos con PedidosYa Courier · Miércoles 11 de noviembre de 2026 · Todas las sucursales/,
      ),
    ).toBeVisible();
    expect(screen.getAllByText('Simulación').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');

    // Los totales salen de los mismos datos que sirve el adaptador (costo vs. cobrado y diferencia).
    const orders = await listDeliveries(api().client, { from: TODAY, to: TODAY });
    const stats = deliveryStats(toDeliveryRows(orders, TODAY, NOW));
    expect(stats.cost).toBeGreaterThan(0);
    expect(kpi('Envíos').getByText(String(stats.total))).toBeVisible();
    expect(kpi('Costo PedidosYa').getByText(formatMoney(stats.cost))).toBeVisible();
    expect(
      kpi('Costo PedidosYa').getByText(`Cobrado al cliente: ${formatMoney(stats.charged)}`),
    ).toBeVisible();
    const diff = `${stats.difference > 0 ? '+' : ''}${formatMoney(stats.difference)}`;
    expect(kpi('Diferencias').getByText(diff)).toBeVisible();
    expect(
      kpi('Diferencias').getByText(`${stats.withDifference} envíos con diferencia`),
    ).toBeVisible();
  });

  it('cada fila muestra estado logístico, repartidor, referencia simulada y costo vs. cobrado', async () => {
    await renderDeliveries();
    await screen.findByText('#MON-307049');
    const row = rowOf('#MON-307049'); // PedidosYa, en camino
    expect(row.getByText('En camino al cliente')).toBeVisible();
    expect(row.getByText(/^PY-GT-/)).toBeVisible();
    expect(row.getByText(/Q\d+\.\d{2} \/ Q\d+\.\d{2}/)).toBeVisible();
    expect(rowOf('#MON-307051').getByText('Sin repartidor')).toBeVisible();
    expect(rowOf('#MON-307051').getByText('Sin asignar')).toBeVisible();
  });

  it('filtra por tipo de repartidor, estado y búsqueda, y limpia los filtros', async () => {
    await renderDeliveries();
    await screen.findByText('#MON-307049');
    await userEvent.click(screen.getByRole('button', { name: 'Sin repartidor' }));
    expect(screen.getByText('1 activos')).toBeVisible();
    expect(kpi('Envíos').getByText('Con los filtros aplicados')).toBeVisible();
    expect(screen.getByText('#MON-307051')).toBeVisible();
    expect(screen.queryByText('#MON-307049')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(screen.queryByText(/activos$/)).toBeNull();
    expect(await screen.findByText('#MON-307049')).toBeVisible();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar entregas' }), 'valeria');
    expect(screen.getByText('#MON-307048')).toBeVisible();
    expect(screen.queryByText('#MON-307049')).toBeNull();
    const shown = screen.getAllByRole('button', { name: /^Ver seguimiento de/ }).length;
    expect(shown).toBeGreaterThanOrEqual(1);
    expect(kpi('Envíos').getByText(String(shown))).toBeVisible();
    expect(kpi('Envíos').getByText('Con los filtros aplicados')).toBeVisible();
  });

  it('el encargado ve solo los envíos de su sucursal y no puede cambiar la sucursal', async () => {
    await renderDeliveries('manager');
    await screen.findByText('#MON-307051');
    expect(screen.queryByText('#MON-307049')).toBeNull(); // sucursal 2
    expect(screen.getByRole('button', { name: 'Sucursal 1' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Sucursal 2' })).toBeNull(); // no autorizada
  });

  it('cambia de periodo: 7 días trae el historial y respeta la paginación', async () => {
    await renderDeliveries();
    await screen.findByText('#MON-307049');
    await userEvent.click(screen.getByRole('button', { name: '7 días' }));
    expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
    expect((await screen.findAllByText(/Jue 5 nov – Mié 11 nov · 7 días/)).length).toBeGreaterThan(
      0,
    );
    await waitFor(() =>
      expect(screen.getAllByText(/Mostrando 25 de \d+/).length).toBeGreaterThan(0),
    );
    await userEvent.click(screen.getByRole('button', { name: /Mostrar \d+ más/ }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^Ver seguimiento de/ }).length).toBeGreaterThan(
        25,
      ),
    );
  });

  it('abrir un envío muestra el detalle del pedido con el seguimiento', async () => {
    await renderDeliveries();
    await screen.findByText('#MON-307049');
    await userEvent.click(screen.getByRole('button', { name: 'Ver seguimiento de #MON-307049' }));
    const drawer = await screen.findByRole('dialog', { name: /MON-307049/ });
    expect(within(drawer).getByText(/Llegada estimada/)).toBeVisible();
  });

  it('tarjetas de repartidores: del periodo y del restaurante (turno solo lectura)', async () => {
    await renderDeliveries();
    await screen.findByText('#MON-307049');
    expect(screen.getByRole('heading', { name: 'Repartidores del periodo' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Repartidores del restaurante' })).toBeVisible();
    expect(screen.getByText('Juan Carlos P.', { selector: '.own-card .strong' })).toBeVisible();
    expect(screen.getByText('Fuera de turno', { selector: '.pill' })).toBeVisible();
    const shift = screen.getByRole('switch', { name: 'En turno: Carlos Yat' });
    expect(shift).toBeDisabled();
    expect(shift).toHaveAttribute('aria-checked', 'false');
  });

  it('avisa que las horas de llegada son estimadas', async () => {
    await renderDeliveries();
    expect(await screen.findByText(/Las horas de llegada son estimadas/)).toBeVisible();
  });
});

describe('estados', () => {
  it('sin envíos: estado vacío', async () => {
    await renderDeliveries('admin', 'empty');
    expect(await screen.findByText('Sin envíos')).toBeVisible();
    expect(
      screen.getByText('Ningún envío coincide con el periodo y los filtros elegidos.'),
    ).toBeVisible();
  });

  it('error de carga: aviso con reintento', async () => {
    listFailures.remaining = 1;
    await renderDeliveries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudieron cargar las entregas.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('#MON-307049')).toBeVisible();
  });

  it('cocina: sin permiso para Entregas', async () => {
    await renderDeliveries('kitchen', 'default', { simulation: false });
    await waitFor(() => expect(screen.queryByText('#MON-307049')).toBeNull());
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
  });
});
