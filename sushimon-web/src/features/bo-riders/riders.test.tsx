import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import type { StaffRole } from '@/lib/data-access/models';
import type { ADMIN_RIDER_SEEDS } from '@/mocks/fixtures/admin-riders';
import type { MockScenario } from '@/mocks/scenarios';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { RidersScreen } from './components/RidersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/**
 * F27 (spec 028 §12–§13 W01–W04): pantalla Motoristas contra el adaptador mock con los proveedores reales. Cubre listado, filtros,
 * búsqueda con retardo, paginación, estados de carga/error/vacío, detalle, alta/edición/traslado/estado/disponibilidad, errores por
 * `code` y permisos de UI (cosmética: la API decide).
 */

beforeEach(() => {
  resetNavigationMock('/backoffice/motoristas');
  window.__sushimonMockRequests = [];
});
afterEach(() => {
  delete window.__sushimonMockFaults;
  delete window.__sushimonMockRequests;
});

type Seed = (typeof ADMIN_RIDER_SEEDS)[number];

const renderRiders = (
  role: StaffRole = 'admin',
  options: { scenario?: MockScenario; prepareStore?: (store: MockStore) => void } = {},
) =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="motoristas">
        <RidersScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, ...options },
  );

/** Concede escritura de motoristas al encargado (solo su sucursal): hoy solo el admin la tiene (P93). */
const withManagerWrites = (store: MockStore) => {
  store.roles.find((r) => r.code === 'manager')?.permissions.push('riders.create', 'riders.update');
};

const table = () => screen.getByRole('table', { name: 'Motoristas propios' });
const rowOf = async (name: string) =>
  (await within(table()).findByText(name)).closest('[role="row"]') as HTMLElement;
const requests = () => window.__sushimonMockRequests ?? [];
const fault = (route: string, ...kinds: string[]) => {
  window.__sushimonMockFaults = { ...(window.__sushimonMockFaults ?? {}), [route]: kinds };
};
const MANY = (n: number): Seed[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `rider-x${i + 100}`,
    branchId: 'sucursal-1',
    fullName: `Motorista ${String(i + 100)}`,
    phone: `+5025551${String(i).padStart(4, '0')}`,
    vehicleType: 'MOTORCYCLE' as const,
    licensePlate: null,
    active: true,
    availability: 'UNAVAILABLE' as const,
    version: 1,
    createdAt: '2026-10-02T15:00:00.000Z',
    updatedAt: '2026-10-02T15:00:00.000Z',
  }));

describe('Motoristas · listado', () => {
  it('muestra nombre, teléfono ENMASCARADO, sucursal, estado y disponibilidad; ocupación derivada de las entregas (F28)', async () => {
    await renderRiders();
    expect(await screen.findByText('7 motoristas')).toBeVisible();
    // 7 filas + encabezado
    expect(within(table()).getAllByRole('row')).toHaveLength(8);
    const luis = await rowOf('Luis Coc');
    expect(within(luis).getByText('+502****1002')).toBeVisible();
    expect(within(luis).getByText('Sucursal 1')).toBeVisible();
    expect(within(luis).getByText('Activo')).toBeVisible();
    expect(within(luis).getByText('No disponible')).toBeVisible();
    expect(within(luis).getByText('Ocupación: sin entrega activa')).toBeVisible();
    // Ningún teléfono completo ni placa en el listado; la ocupación sale de las entregas (Marvin Tzoc tiene una abierta).
    expect(screen.queryByText(/\+50255501002/)).toBeNull();
    expect(screen.queryByText(/M219PLX/)).toBeNull();
    expect(
      within(await rowOf('Marvin Tzoc')).getByText('Ocupación: con entrega activa'),
    ).toBeVisible();
    const olga = await rowOf('Olga Tuyuc');
    expect(within(olga).getByText('Inactivo', { selector: '.pill' })).toBeVisible();
  });

  it('muestra el aviso de que no hay cuenta de acceso y que las entregas llegan con F28', async () => {
    await renderRiders();
    expect(
      await screen.findByText(/Las entregas con motorista propio llegan con F28/),
    ).toBeVisible();
  });

  it('estado de carga: esqueleto y tabla ocupada', async () => {
    await renderRiders('admin', { scenario: 'loading' });
    await waitFor(() => expect(table()).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByText(/motoristas$/)).toBeNull();
  });

  it('estado vacío (escenario empty): título y texto, sin filas', async () => {
    await renderRiders('admin', { scenario: 'empty' });
    expect(await screen.findByText('Sin motoristas')).toBeVisible();
    expect(within(table()).getAllByRole('row')).toHaveLength(1);
  });

  it('estado de error: aviso con reintento que vuelve a pedir', async () => {
    const user = userEvent.setup();
    await renderRiders('admin', { scenario: 'error' });
    expect(await screen.findByText(/No pudimos cargar los motoristas/)).toBeVisible();
    const before = requests().filter((r) => r.startsWith('GET /v1/admin/riders')).length;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(requests().filter((r) => r.startsWith('GET /v1/admin/riders')).length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('403 del servidor: pantalla «sin permiso», sin datos', async () => {
    await renderRiders('admin', { scenario: 'forbidden' });
    expect(await screen.findByRole('heading', { name: /permiso|acceso/i })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Motoristas propios' })).toBeNull();
  });

  it('503 RIDERS_BUSY: reintenta solo, de forma acotada, y termina cargando', async () => {
    fault('GET /v1/admin/riders', 'busy');
    await renderRiders();
    expect(await screen.findByText('7 motoristas', {}, { timeout: 4000 })).toBeVisible();
    expect(requests().filter((r) => r.startsWith('GET /v1/admin/riders'))).toHaveLength(2);
  });

  it('paginación contra la API: 20 por página', async () => {
    const user = userEvent.setup();
    await renderRiders('admin', {
      prepareStore: (s) => s.adminRiders?.push(...MANY(18)),
    });
    expect(await screen.findByText('25 motoristas')).toBeVisible();
    expect(within(table()).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByText('Página 1 de 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2')).toBeVisible();
    expect(within(table()).getAllByRole('row')).toHaveLength(6);
    expect(requests().some((r) => r.includes('page=2') && r.includes('pageSize=20'))).toBe(true);
  });
});

describe('Motoristas · filtros', () => {
  it('búsqueda por nombre con retardo (una sola petición) y sin acentos', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    const before = requests().length;
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar motoristas por nombre' }),
      'angel',
    );
    await waitFor(() => expect(screen.getByText('1 motorista')).toBeVisible());
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    expect(within(table()).getByText('Ángel Morales')).toBeVisible();
    // El retardo evita una petición por tecla (5 teclas → una consulta nueva con q=angel).
    const queries = requests()
      .slice(before)
      .filter((r) => r.includes('q='));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('q=angel');
  });

  it('filtra por sucursal, estado y disponibilidad; «Ocupado» se ofrece porque el servidor conoce la ocupación (F28)', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.selectOptions(screen.getByLabelText('Sucursal'), 'Sucursal 3');
    expect(await screen.findByText('2 motoristas')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Estado'), 'Inactivos');
    expect(await screen.findByText('1 motorista')).toBeVisible();
    expect(within(table()).getByText('Olga Tuyuc')).toBeVisible();
    const availability = screen.getByLabelText('Disponibilidad');
    expect(within(availability).getByRole('option', { name: 'Ocupado' })).toBeInTheDocument();
    await user.selectOptions(availability, 'Disponible');
    expect(await screen.findByText('Sin resultados')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('7 motoristas')).toBeVisible();
  });

  it('orden: cambia el sentido y lo envía a la API', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: /Cambiar el orden/ }));
    await waitFor(() => expect(requests().some((r) => r.includes('order=desc'))).toBe(true));
    const first = within(table()).getAllByRole('row')[1] as HTMLElement;
    expect(within(first).getByText('Rosa Elena Xicay')).toBeVisible();
  });
});

describe('Motoristas · permisos de UI (cosmética; la API decide)', () => {
  it('el encargado solo LEE: su sucursal, sin «Nuevo», sin editar/trasladar/desactivar ni interruptor', async () => {
    await renderRiders('manager');
    expect(await screen.findByText('3 motoristas')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Nuevo motorista' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar a/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Trasladar a/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(within(table()).getAllByText('Solo lectura')).toHaveLength(3);
    // El texto de disponibilidad sigue visible (solo lectura).
    expect(within(await rowOf('Ángel Morales')).getByText('Disponible')).toBeVisible();
  });

  it('con riders.create/update acotados el encargado ve acciones solo en su sucursal', async () => {
    await renderRiders('manager', { prepareStore: withManagerWrites });
    expect(await screen.findByText('3 motoristas')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nuevo motorista' })).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  it('cocina (sin riders.read) no ve la pantalla', async () => {
    await renderRiders('kitchen');
    expect(await screen.findByRole('heading', { name: /permiso/i })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Motoristas propios' })).toBeNull();
    expect(requests().some((r) => r.startsWith('GET /v1/admin/riders'))).toBe(false);
  });
});

describe('Motoristas · detalle', () => {
  it('muestra los datos completos, la ocupación derivada de las entregas y remite a Entregas SIN historial', async () => {
    const user = userEvent.setup();
    await renderRiders();
    await screen.findByText('7 motoristas');
    await user.click(screen.getByRole('button', { name: 'Ver detalle de Juan Carlos Pérez' }));
    const drawer = await screen.findByRole('dialog', { name: 'Juan Carlos Pérez' });
    const detail = await within(drawer).findByTestId('rider-detail');
    expect(within(detail).getByText('+50255501001')).toBeVisible();
    expect(within(detail).getByText('M482HJK')).toBeVisible();
    expect(within(detail).getByText('Moto')).toBeVisible();
    expect(within(detail).getAllByText('Sucursal 1').length).toBeGreaterThan(0);
    expect(within(detail).getByText('Versión')).toBeVisible();
    expect(within(detail).getByTestId('rider-occupancy')).toHaveTextContent('Sin entrega activa');
    expect(within(detail).getByTestId('rider-deliveries')).toHaveTextContent(
      'Consulta la pantalla Entregas',
    );
    expect(within(detail).queryByText(/historial de entregas|entregas realizadas/i)).toBeNull();
    expect(
      within(detail).getByRole('switch', { name: 'Disponible: Juan Carlos Pérez' }),
    ).toBeChecked();
  });

  it('sin permiso de escritura el detalle no ofrece acciones', async () => {
    const user = userEvent.setup();
    await renderRiders('manager');
    await screen.findByText('3 motoristas');
    await user.click(screen.getByRole('button', { name: 'Ver detalle de Luis Coc' }));
    const drawer = await screen.findByRole('dialog', { name: 'Luis Coc' });
    await within(drawer).findByTestId('rider-detail');
    expect(within(drawer).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(drawer).getByText(/No tienes permiso para modificar motoristas/)).toBeVisible();
  });

  it('un motorista que ya no está disponible (404) muestra el mensaje claro', async () => {
    const user = userEvent.setup();
    const h = await renderRiders();
    await screen.findByText('7 motoristas');
    // El registro desaparece del servidor entre el listado y el detalle (o queda fuera del alcance).
    h.api().store.adminRiders = h.api().store.adminRiders?.filter((r) => r.id !== 'rider-6');
    await user.click(screen.getByRole('button', { name: 'Ver detalle de Diego Batz' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText(/ya no está disponible/)).toBeVisible();
  });
});
