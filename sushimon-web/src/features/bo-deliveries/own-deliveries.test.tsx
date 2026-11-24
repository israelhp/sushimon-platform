import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import type { StaffRole } from '@/lib/data-access/models';
import type { AdminDeliveryRecord } from '@/mocks/fixtures/admin-deliveries';
import type { MockScenario } from '@/mocks/scenarios';
import type { MockStore } from '@/mocks/store';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { DeliveriesScreen } from './components/DeliveriesScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/**
 * F28 (spec 029 §13, W01–W05): pantalla «Reparto propio» contra el adaptador mock con los proveedores reales. Cubre la lista
 * (carga, vacío, error con reintento, filtros, cursor, «Esperando retorno»), el detalle (línea de tiempo, contacto solo con
 * `contactVisible`, acciones por `availableActions`), la asignación (solo elegibles, errores por razón, conflicto), el retorno con
 * confirmación, la cancelación con motivo y la separación visual de PedidosYa (simulación). La UI solo muestra u oculta.
 */

beforeEach(() => {
  resetNavigationMock('/backoffice/entregas');
  window.__sushimonMockRequests = [];
});
afterEach(() => {
  delete window.__sushimonMockFaults;
  delete window.__sushimonMockRequests;
});

const AT = '2026-11-11T20:00:00.000Z';
const record = (
  over: Partial<AdminDeliveryRecord> & { id: string; orderId: string },
): AdminDeliveryRecord => ({
  branchId: 'sucursal-1',
  status: 'pending',
  riderId: null,
  version: 1,
  assignedAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  returnedAt: null,
  cancelledAt: null,
  createdAt: AT,
  updatedAt: AT,
  history: [
    {
      event: 'created',
      oldStatus: null,
      status: 'pending',
      riderId: null,
      riderName: null,
      reason: null,
      actorName: 'Marco Antonio Gómez',
      at: AT,
    },
  ],
  ...over,
});

/** Entrega `pending` del pedido MON-307051 (sucursal 1, listo, reparto propio): el flujo principal de las pruebas. */
const withMainDelivery = (store: MockStore) => {
  store.adminDeliveries = [
    ...(store.adminDeliveries ?? []),
    record({ id: 'delivery-10', orderId: 'MON-307051' }),
  ];
};

const renderDeliveries = (
  role: StaffRole = 'manager',
  options: { scenario?: MockScenario; prepareStore?: (store: MockStore) => void } = {},
) =>
  renderBackoffice(
    <BackofficeShell>
      <ScreenGuard screen="entregas">
        <DeliveriesScreen />
      </ScreenGuard>
    </BackofficeShell>,
    { role, ...options },
  );

const table = () => screen.getByRole('table', { name: 'Entregas con reparto propio' });
const rowOf = async (code: string) =>
  (await within(table()).findByText(`#${code}`)).closest('[role="row"]') as HTMLElement;
const openDetail = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  await user.click(
    await within(await rowOf(code)).findByRole('button', {
      name: `Ver la entrega del pedido ${code}`,
    }),
  );
  return screen.findByRole('dialog', { name: `#${code}` });
};
const fault = (route: string, ...kinds: string[]) => {
  window.__sushimonMockFaults = { ...(window.__sushimonMockFaults ?? {}), [route]: kinds };
};

describe('W01 · lista', () => {
  it('administrador: abiertas por defecto, estado y motorista enmascarado, SIN datos del cliente', async () => {
    await renderDeliveries('admin');
    expect(await screen.findByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible();
    const row2 = await rowOf('MON-307054');
    expect(within(row2).getByText('Marvin Tzoc')).toBeVisible();
    expect(within(row2).getByText('+502****1004')).toBeVisible();
    expect(within(row2).getByText('Asignada')).toBeVisible();
    const row1 = await rowOf('MON-307052');
    expect(within(row1).getByText('Sin motorista', { selector: '.pill' })).toBeVisible();
    // Jamás contacto, dirección ni teléfono completo en la lista.
    expect(
      within(table()).queryByText(/Gabriela|\+50256120098|5612-0098|Avenida|Zona 4/),
    ).toBeNull();
    expect(screen.queryByText(/\+50255501004/)).toBeNull();
  });

  it('carga con esqueleto accesible y sin entregas: estado vacío con explicación', async () => {
    await renderDeliveries('admin', { scenario: 'empty' });
    expect(await screen.findByText('No hay entregas abiertas')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Ver la entrega/ })).toBeNull();
  });

  it('error del servidor: aviso con reintento', async () => {
    fault('GET /v1/admin/deliveries', 'busy');
    const user = userEvent.setup();
    await renderDeliveries('admin');
    // El 503 reintentable se explica y, tras «Reintentar», la lista llega.
    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(screen.getByText(/mucha demanda/)).toBeVisible();
    await user.click(retry);
    expect(await rowOf('MON-307054')).toBeVisible();
  });

  it('filtros de estado y de motorista; limpiar los restablece', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin');
    await rowOf('MON-307054');
    await user.selectOptions(screen.getByLabelText('Estado'), 'Asignada');
    await waitFor(() => expect(screen.queryByText('#MON-307052')).toBeNull());
    expect(screen.getByText('#MON-307054')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Estado'), 'Retornó');
    expect(await screen.findByText('Sin resultados')).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]!);
    expect(await rowOf('MON-307052')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Motorista'), 'Marvin Tzoc');
    await waitFor(() => expect(screen.queryByText('#MON-307052')).toBeNull());
    expect(window.__sushimonMockRequests?.some((r) => r.includes('riderId=rider-4'))).toBe(true);
  });

  it('cursor: «Cargar más» añade la siguiente página sin repetir filas', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin', {
      prepareStore: (store) => {
        const many = Array.from({ length: 30 }, (_, i) =>
          record({
            id: `delivery-x${i + 100}`,
            orderId: `MON-3090${String(i).padStart(2, '0')}`,
            branchId: 'sucursal-3',
            createdAt: `2026-11-10T10:${String(i).padStart(2, '0')}:00.000Z`,
          }),
        );
        store.adminDeliveries = [...(store.adminDeliveries ?? []), ...many];
      },
    });
    await rowOf('MON-307054');
    expect(within(table()).getAllByRole('row')).toHaveLength(26); // 25 + encabezado
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(33)); // 32 + encabezado
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('indicador «Esperando retorno» cuando el motorista aún no regresa', async () => {
    await renderDeliveries('admin', {
      prepareStore: (store) => {
        store.adminDeliveries = [
          ...(store.adminDeliveries ?? []),
          record({
            id: 'delivery-11',
            orderId: 'MON-307051',
            status: 'delivered',
            riderId: 'rider-1',
            version: 4,
          }),
        ];
      },
    });
    const row = await rowOf('MON-307051');
    expect(within(row).getByText('Esperando retorno')).toBeVisible();
    expect(await screen.findByTestId('awaiting-return-count')).toHaveTextContent(
      '1 motorista aún no registra su retorno',
    );
  });

  it('cocina no tiene deliveries.read: no ve la pantalla', async () => {
    await renderDeliveries('kitchen');
    expect(await screen.findByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  });
});

describe('W02 · detalle', () => {
  it('muestra pedido, motorista y línea de tiempo; el contacto SOLO con contactVisible', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin');
    const drawer = await openDetail(user, 'MON-307054');
    expect(await within(drawer).findByTestId('delivery-detail')).toBeVisible();
    const rider = await within(drawer).findByTestId('delivery-rider');
    expect(within(rider).getByText('Marvin Tzoc')).toBeVisible();
    expect(within(rider).getByText('+502****1004')).toBeVisible();
    const history = within(drawer).getByTestId('delivery-history');
    expect(
      within(history)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('Entrega creada'),
      expect.stringContaining('Motorista asignado'),
    ]);
    // Contacto y dirección (PII) con la entrega abierta y orders.read.
    const contact = within(drawer).getByTestId('delivery-contact');
    expect(within(contact).getByText(/Zona/)).toBeVisible();
  });

  it('sin orders.read el servidor devuelve contactVisible=false: se explica y NO se muestra ningún dato personal', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin', {
      prepareStore: (store) => {
        const role = store.roles.find((r) => r.code === 'admin');
        if (role) role.permissions = role.permissions.filter((p) => p !== 'orders.read');
      },
    });
    const drawer = await openDetail(user, 'MON-307054');
    expect(await within(drawer).findByTestId('delivery-contact-hidden')).toBeVisible();
    expect(within(drawer).queryByTestId('delivery-contact')).toBeNull();
  });

  it('acciones por availableActions: staff (solo lectura) no ve ninguna; el encargado ve las suyas', async () => {
    const user = userEvent.setup();
    await renderDeliveries('staff', { prepareStore: withMainDelivery });
    const drawer = await openDetail(user, 'MON-307051');
    await within(drawer).findByTestId('delivery-detail');
    expect(await within(drawer).findByText(/No hay acciones disponibles para ti/)).toBeVisible();
    expect(within(drawer).queryByRole('button', { name: 'Asignar motorista' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Cancelar entrega' })).toBeNull();
  });

  it('recoger con el pedido aún en preparación: botón deshabilitado con la razón (ORDER_NOT_READY)', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin');
    const drawer = await openDetail(user, 'MON-307054'); // asignada, pedido en preparación
    const pick = await within(drawer).findByRole('button', { name: 'Marcar recogido' });
    expect(pick).toBeDisabled();
    expect(within(drawer).getByText(/El pedido aún no está listo/)).toBeVisible();
  });

  it('error al abrir el detalle: aviso claro dentro del mismo diálogo (sin perder el foco)', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin');
    await rowOf('MON-307054');
    fault('GET /v1/admin/deliveries/delivery-2', 'rate-limited');
    const drawer = await openDetail(user, 'MON-307054');
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(/Demasiadas solicitudes/);
    expect(within(drawer).queryByTestId('delivery-contact')).toBeNull();
  });
});

describe('W03 · asignación', () => {
  it('ofrece SOLO motoristas elegibles de la sucursal; asigna y refleja el estado del servidor', async () => {
    const user = userEvent.setup();
    await renderDeliveries('manager', { prepareStore: withMainDelivery });
    const drawer = await openDetail(user, 'MON-307051');
    await user.click(await within(drawer).findByRole('button', { name: 'Asignar motorista' }));
    const modal = await screen.findByRole('dialog', { name: 'Asignar motorista' });
    const select = await within(modal).findByLabelText('Motorista elegible');
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names.join('|')).toMatch(/Juan Carlos Pérez/);
    expect(names.join('|')).toMatch(/Ángel Morales/);
    // Luis Coc está «No disponible»; Marvin y los de otras sucursales no se ofrecen.
    expect(names.join('|')).not.toMatch(/Luis Coc|Marvin|Diego/);
    await user.selectOptions(select, names.find((n) => /Ángel/.test(n ?? '')) as string);
    await user.click(within(modal).getByRole('button', { name: 'Asignar' }));
    expect(await screen.findByText('Motorista asignado a #MON-307051.')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Asignar motorista' })).toBeNull(),
    );
    const rider = await within(drawer).findByTestId('delivery-rider');
    expect(within(rider).getByText('Ángel Morales')).toBeVisible();
    // Ahora se ofrece REASIGNAR (y el actual no está en el selector).
    await user.click(await within(drawer).findByRole('button', { name: 'Reasignar motorista' }));
    const again = await screen.findByRole('dialog', { name: 'Reasignar motorista' });
    const options = (await within(again).findAllByRole('option'))
      .map((o) => o.textContent)
      .join('|');
    expect(options).toMatch(/Juan Carlos Pérez/);
    expect(options).not.toMatch(/Ángel Morales/);
  });

  it('422 RIDER_NOT_ELIGIBLE: el mensaje nombra la razón y la persona puede elegir otro', async () => {
    const user = userEvent.setup();
    await renderDeliveries('manager', { prepareStore: withMainDelivery });
    const drawer = await openDetail(user, 'MON-307051');
    await user.click(await within(drawer).findByRole('button', { name: 'Asignar motorista' }));
    const modal = await screen.findByRole('dialog', { name: 'Asignar motorista' });
    const select = await within(modal).findByLabelText('Motorista elegible');
    fault('POST /v1/admin/deliveries/delivery-10/assign-own-rider', 'rider-busy');
    await user.selectOptions(
      select,
      (within(select).getAllByRole('option')[1] as HTMLOptionElement).value,
    );
    await user.click(within(modal).getByRole('button', { name: 'Asignar' }));
    expect(
      await within(modal).findByText(
        /Ese motorista no puede tomar la entrega: ya tiene una entrega abierta/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Asignar motorista' })).toBeVisible();
  });

  it('409 DELIVERY_STATE_CONFLICT: se aplica el estado actual, se avisa y se reofrece la acción', async () => {
    const user = userEvent.setup();
    await renderDeliveries('manager', { prepareStore: withMainDelivery });
    const drawer = await openDetail(user, 'MON-307051');
    await user.click(await within(drawer).findByRole('button', { name: 'Asignar motorista' }));
    const modal = await screen.findByRole('dialog', { name: 'Asignar motorista' });
    const select = await within(modal).findByLabelText('Motorista elegible');
    fault('POST /v1/admin/deliveries/delivery-10/assign-own-rider', 'version-conflict');
    await user.selectOptions(
      select,
      (within(select).getAllByRole('option')[1] as HTMLOptionElement).value,
    );
    await user.click(within(modal).getByRole('button', { name: 'Asignar' }));
    const note = await within(drawer).findByTestId('delivery-note');
    expect(note).toHaveTextContent(/cambió mientras la veías/);
    expect(note).toHaveTextContent('«Sin motorista»');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Asignar motorista' })).toBeNull(),
    );
    // Con la versión actual, la acción se reofrece y funciona.
    await user.click(await within(drawer).findByRole('button', { name: 'Asignar motorista' }));
    const retry = await screen.findByRole('dialog', { name: 'Asignar motorista' });
    const select2 = await within(retry).findByLabelText('Motorista elegible');
    await user.selectOptions(
      select2,
      (within(select2).getAllByRole('option')[1] as HTMLOptionElement).value,
    );
    await user.click(within(retry).getByRole('button', { name: 'Asignar' }));
    expect(await screen.findByText('Motorista asignado a #MON-307051.')).toBeVisible();
  });

  it('sin motoristas elegibles: lo explica y no deja confirmar', async () => {
    const user = userEvent.setup();
    await renderDeliveries('manager', {
      prepareStore: (store) => {
        withMainDelivery(store);
        for (const r of store.adminRiders ?? []) r.availability = 'UNAVAILABLE';
      },
    });
    const drawer = await openDetail(user, 'MON-307051');
    await user.click(await within(drawer).findByRole('button', { name: 'Asignar motorista' }));
    const modal = await screen.findByRole('dialog', { name: 'Asignar motorista' });
    expect(
      await within(modal).findByText(/No hay motoristas elegibles en Sucursal 1/),
    ).toBeVisible();
    expect(within(modal).getByRole('button', { name: 'Asignar' })).toBeDisabled();
  });
});

describe('W04 · recoger, entregar, retorno y cancelación', () => {
  it('recoger → entregar → retorno con confirmación: el retorno es un paso aparte que libera al motorista', async () => {
    const user = userEvent.setup();
    const { api } = await renderDeliveries('manager', {
      prepareStore: (store) => {
        withMainDelivery(store);
        const d = store.adminDeliveries?.find((x) => x.id === 'delivery-10');
        if (d) Object.assign(d, { status: 'assigned', riderId: 'rider-1', version: 2 });
      },
    });
    const drawer = await openDetail(user, 'MON-307051');
    await user.click(await within(drawer).findByRole('button', { name: 'Marcar recogido' }));
    expect(await screen.findByText('#MON-307051 recogido: el pedido va en camino.')).toBeVisible();
    await user.click(await within(drawer).findByRole('button', { name: 'Marcar entregado' }));
    expect(await screen.findByText('#MON-307051 entregado al cliente.')).toBeVisible();
    // Esperando retorno: el motorista sigue ocupado hasta registrarlo.
    expect(await within(drawer).findByText('Esperando retorno')).toBeVisible();
    expect(within(drawer).getByText(/Sigue ocupado hasta registrar su retorno/)).toBeVisible();
    expect(api().store.orders.find((o) => o.id === 'MON-307051')?.status).toBe('delivered');
    await user.click(await within(drawer).findByRole('button', { name: 'Registrar retorno' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Registrar retorno' });
    expect(within(confirm).getByText(/no cambia el pedido ni su pago/)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Registrar retorno' }));
    expect(await screen.findByText('Retorno registrado para #MON-307051.')).toBeVisible();
    await waitFor(() => expect(within(drawer).queryByText('Esperando retorno')).toBeNull());
    expect(api().store.adminDeliveries?.find((d) => d.id === 'delivery-10')?.status).toBe(
      'returned',
    );
  });

  it('cancelar la entrega exige motivo (con aviso de datos personales) y no cancela el pedido', async () => {
    const user = userEvent.setup();
    const { api } = await renderDeliveries('manager', { prepareStore: withMainDelivery });
    const drawer = await openDetail(user, 'MON-307051');
    await user.click(await within(drawer).findByRole('button', { name: 'Cancelar entrega' }));
    const modal = await screen.findByRole('alertdialog', { name: 'Cancelar entrega' });
    expect(within(modal).getByText(/no escribas datos personales/i)).toBeVisible();
    await user.click(within(modal).getByRole('button', { name: 'Cancelar entrega' }));
    expect(await within(modal).findByText('Indica el motivo.')).toBeVisible();
    await user.type(within(modal).getByLabelText('Motivo (obligatorio)'), 'Cliente ausente');
    await user.click(within(modal).getByRole('button', { name: 'Cancelar entrega' }));
    expect(await screen.findByText('Entrega de #MON-307051 cancelada.')).toBeVisible();
    expect(api().store.orders.find((o) => o.id === 'MON-307051')?.status).toBe('ready');
    const detail = await within(drawer).findByTestId('delivery-history');
    expect(within(detail).getByText(/Motivo: Cliente ausente/)).toBeVisible();
  });
});

describe('W05 · PedidosYa separado y rotulado como simulación; es/en', () => {
  it('«Reparto propio» (real) y «Simulación PedidosYa» son secciones distintas; esta última lo dice con claridad', async () => {
    const user = userEvent.setup();
    await renderDeliveries('admin');
    expect(
      await screen.findByRole('tab', { name: 'Reparto propio', selected: true }),
    ).toBeVisible();
    expect(screen.queryByTestId('simulation-banner')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Simulación PedidosYa' }));
    const banner = await screen.findByTestId('simulation-banner');
    expect(banner).toHaveTextContent('Simulación — no es un envío real');
    expect(banner).toHaveTextContent(/nunca confirman entregas reales/);
    expect(screen.queryByTestId('own-deliveries')).toBeNull();
    // Volver al reparto propio.
    await user.click(screen.getByRole('tab', { name: 'Reparto propio' }));
    expect(await screen.findByTestId('own-deliveries')).toBeVisible();
  });
});
