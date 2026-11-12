import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { DashboardSummary, StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock, router } from '@/test/next-navigation-mock';
import { DashboardScreen } from './components/DashboardScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/panel'));

const renderPanel = (role: StaffRole = 'manager', scenario: MockScenario = 'default') =>
  renderBackoffice(
    <BackofficeShell>
      <DashboardScreen />
    </BackofficeShell>,
    { role, scenario },
  );

/** Valor mostrado en el KPI con esa etiqueta. */
const kpi = (label: string) => {
  const el = screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi');
  if (!el) throw new Error(`Sin KPI ${label}`);
  return within(el as HTMLElement);
};

describe('panel', () => {
  it('muestra los KPIs del día calculados por la API', async () => {
    const view = await renderPanel();
    await screen.findByText('Ventas del día', { selector: '.kpi-label' });
    const summary = await view
      .api()
      .client.get<DashboardSummary>('/v1/backoffice/dashboard', { query: {} });

    await waitFor(() => expect(kpi('Recibidos').getByText(String(summary.received))).toBeVisible());
    expect(kpi('En preparación').getByText(String(summary.inPreparation))).toBeVisible();
    expect(kpi('En camino').getByText(String(summary.onTheWay))).toBeVisible();
    expect(kpi('Entregados').getByText(String(summary.delivered))).toBeVisible();
    expect(kpi('Cancelados').getByText(String(summary.cancelled))).toBeVisible();
    expect(kpi('Ventas del día').getByText(/^Q[\d,]+\.\d{2}$/)).toBeVisible();
    expect(
      kpi('Recibidos').getByText(new RegExp(`${summary.newPending} nuevos? por aceptar`)),
    ).toBeVisible();
  });

  it('saluda según la hora de la demo y muestra la fecha', async () => {
    await renderPanel();
    expect(await screen.findByRole('heading', { name: 'Buenas tardes, Marco' })).toBeVisible();
    expect(screen.getByText(/Miércoles 11 de noviembre de 2026/)).toBeVisible();
  });

  it('lista los últimos pedidos y alerta de los atrasados y sin repartidor', async () => {
    await renderPanel();
    expect(await screen.findByText('#MON-307057 sin aceptar')).toBeVisible();
    expect(screen.getByText('#MON-307051 sin repartidor')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Últimos pedidos' })).toBeVisible();
    expect(screen.getAllByText('#MON-307057').length).toBeGreaterThan(0);
  });

  it('el encargado despacha desde la alerta (abre el modal de despacho)', async () => {
    await renderPanel('manager');
    const alert = (await screen.findByText('#MON-307051 sin repartidor')).closest('.alert');
    await userEvent.click(within(alert as HTMLElement).getByRole('button', { name: 'Despachar' }));
    expect(await screen.findByRole('dialog', { name: 'Despachar pedido' })).toBeVisible();
  });

  it('abrir el tablero y los KPIs navegan a las rutas reales', async () => {
    await renderPanel('admin');
    await screen.findByText('Ventas del día', { selector: '.kpi-label' });
    expect(screen.getByRole('link', { name: /Abrir tablero de pedidos/ })).toHaveAttribute(
      'href',
      '/backoffice/pedidos',
    );
    await userEvent.click(screen.getByText('Ventas del día', { selector: '.kpi-label' }));
    expect(router.push).toHaveBeenCalledWith('/backoffice/reportes');
  });

  it('el administrador ve el resumen de las 3 sucursales abiertas', async () => {
    await renderPanel('admin');
    const card = (await screen.findByRole('heading', { name: 'Por sucursal' })).closest('section');
    expect(within(card as HTMLElement).getAllByText('Abierta')).toHaveLength(3);
  });
});

describe('estados', () => {
  it('muestra el estado de carga mientras llegan los datos', async () => {
    await renderPanel('admin');
    expect(document.querySelector('.kpis')).toHaveAttribute('aria-busy');
  });

  it('error de red: avisa y ofrece reintentar', async () => {
    await renderPanel('admin', 'error');
    expect(await screen.findByText(/No pudimos cargar el panel/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  it('sin pedidos: indica que no hay y "todo en orden"', async () => {
    await renderPanel('admin', 'empty');
    expect(await screen.findByText('Aún no hay pedidos hoy.')).toBeVisible();
    expect(screen.getByText('Todo en orden')).toBeVisible();
  });

  it('escenario forbidden: pantalla de sin permiso', async () => {
    await renderPanel('admin', 'forbidden');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  });
});
