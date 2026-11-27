import { expect, test, type Page } from './support/test';

/**
 * Backoffice, bloque 3 y F28: pantalla Entregas. «Reparto propio» es REAL (contrato `admin-deliveries`, aquí contra el adaptador mock
 * que reproduce las reglas del servidor); PedidosYa está SIMULADO (sin documentación ni credenciales) en su propia pestaña rotulada
 * «Simulación — no es un envío real»: cotización, referencia, repartidor y estados salen del adaptador mock; no hay red externa.
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

const ORDER = '#MON-307051'; // sucursal 1 · a domicilio · listo · sin logística
const card = (page: Page) => page.locator('.kcard', { hasText: ORDER });
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });
const row = (page: Page, code = ORDER) => page.locator('.trow', { hasText: code });

/** F28: Entregas abre en «Reparto propio»; los envíos simulados de PedidosYa viven en su pestaña. */
async function openSimulation(page: Page) {
  await page.getByRole('tab', { name: 'Simulación PedidosYa' }).click();
  await expect(page.getByTestId('simulation-banner')).toContainText('no es un envío real');
}

async function openDispatch(page: Page) {
  // F22: en Pedidos «Despachar» está deshabilitado; el despacho simulado se abre desde el Panel (alertas).
  await page.goto('/backoffice/panel');
  await page
    .locator('.alert', { hasText: ORDER })
    .getByRole('button', { name: 'Despachar' })
    .click();
  const modal = page.getByRole('dialog', { name: 'Despachar pedido' });
  await expect(modal.getByText('Simulación')).toBeVisible();
  return modal;
}

/** Avanza el estado logístico (simulación) desde el detalle hasta que ya no haya más pasos. */
async function advanceToEnd(page: Page, drawerName: RegExp) {
  const drawer = page.getByRole('dialog', { name: drawerName });
  const advance = drawer.getByRole('button', {
    name: /Avanzar estado logístico|Marcar como entregado|Marcar salida/,
  });
  // F22: el detalle real se pide al abrir; hay que esperar a que cargue antes de buscar los botones.
  await expect(drawer.getByText('Productos', { exact: true })).toBeVisible();
  // El mock tarda ~150 ms por solicitud y cada avance hace dos (acción + refetch): el botón tarda
  // ~300 ms en actualizarse. En el último paso el botón desaparece entre `count()` y `click()`; en ese
  // caso el flujo terminó. Si el clic falla y el botón SIGUE ahí, es un fallo real y se relanza.
  for (let i = 0; i < 6 && (await advance.count()) > 0; i += 1) {
    try {
      await advance.first().click({ timeout: 5_000 });
    } catch (error) {
      if ((await advance.count()) === 0) break;
      throw error;
    }
    await page.waitForTimeout(150);
  }
  await expect(advance).toHaveCount(0);
  return drawer;
}

test('encargado: despacha con PedidosYa (cotización → confirmar), lo ve en Entregas y avanza hasta entregado', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  const modal = await openDispatch(page);
  await modal.getByRole('button', { name: /PedidosYa Courier/ }).click();

  const quote = page.getByRole('dialog', { name: 'Solicitar a PedidosYa' });
  await expect(quote.getByText(/Costo vigente|El costo de envío cambió/)).toBeVisible();
  await expect(quote.getByText(/Llegada estimada por PedidosYa/)).toBeVisible();
  await quote.getByRole('button', { name: 'Confirmar y solicitar' }).click();

  await expect(
    page.locator('.toast', { hasText: /Repartidor solicitado · PY-GT-77\d+/ }),
  ).toBeVisible();
  const drawer = page.getByRole('dialog', { name: /MON-307051/ });
  await expect(drawer.getByText('Buscando repartidor').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Pedidos: con PedidosYa el despacho sigue deshabilitado (BLOCKED_EXTERNAL); el pedido queda con su logística simulada.
  await page.goto('/backoffice/pedidos');
  await expect(card(page).getByRole('button', { name: 'Despachar' })).toBeDisabled();

  // Entregas: aparece con referencia simulada PY-GT-… y estado logístico.
  await nav(page)
    .getByRole('link', { name: /Entregas/ })
    .click();
  await expect(page).toHaveURL(/\/backoffice\/entregas$/);
  await expect(page.getByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible();
  await openSimulation(page);
  await expect(row(page).getByText('Buscando repartidor')).toBeVisible();
  await expect(row(page).getByText(/^PY-GT-77\d+$/)).toBeVisible();

  // Avanza (simulación) hasta entregado: el pedido pasa por "en camino" y termina en "Entregado".
  await row(page)
    .getByRole('button', { name: `Ver seguimiento de ${ORDER}` })
    .click();
  const detail = await advanceToEnd(page, /MON-307051/);
  await expect(detail.getByText('Pedido finalizado. No hay acciones pendientes.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row(page).getByText('Entregado', { exact: true })).toBeVisible();
});

test('encargado: asigna un repartidor del restaurante y lo sigue hasta entregado', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  const modal = await openDispatch(page);
  await modal.getByRole('button', { name: /Repartidor del restaurante/ }).click();

  const own = page.getByRole('dialog', { name: 'Repartidor del restaurante' });
  const assign = own.getByRole('button', { name: 'Asignar repartidor' });
  await expect(assign).toBeDisabled();
  await own.getByRole('radio', { name: /Luis Coc/ }).click();
  await assign.click();
  await expect(
    page.locator('.toast', { hasText: `Luis Coc asignado al pedido ${ORDER}` }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await nav(page)
    .getByRole('link', { name: /Entregas/ })
    .click();
  await openSimulation(page);
  await expect(row(page).getByText('Luis Coc')).toBeVisible();
  await expect(row(page).getByText('Repartidor del restaurante', { exact: true })).toBeVisible();
  await expect(row(page).getByText('Sin costo extra')).toBeVisible();

  // Luis Coc ya va en ruta: figura "En ruta" y no se puede volver a elegir.
  await expect(
    page.locator('.own-card', { hasText: 'Luis Coc' }).getByText('En ruta'),
  ).toBeVisible();

  await row(page)
    .getByRole('button', { name: `Ver seguimiento de ${ORDER}` })
    .click();
  await advanceToEnd(page, /MON-307051/);
  await page.keyboard.press('Escape');
  await expect(row(page).getByText('Entregado', { exact: true })).toBeVisible();
});

test('Entregas: filtros, periodo y totales de costo PedidosYa vs. cobrado', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/entregas');
  await expect(page.getByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible();
  await openSimulation(page);
  await expect(
    page.getByText(/Envíos con PedidosYa Courier · Miércoles 11 de noviembre de 2026/),
  ).toBeVisible();
  await expect(page.getByText('Costo PedidosYa', { exact: true })).toBeVisible();
  await expect(page.getByText(/Cobrado al cliente: Q\d/)).toBeVisible();
  await expect(page.getByText(/Las horas de llegada son estimadas/)).toBeVisible();

  await page.getByRole('button', { name: 'Con diferencia' }).click();
  await expect(page.getByText('1 activos')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page.getByText(/activos$/)).toHaveCount(0);

  await page.getByRole('button', { name: '7 días' }).click();
  await expect(page.getByRole('button', { name: '7 días' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(/Mostrando 25 de \d+/).first()).toBeVisible();
  await page.getByRole('button', { name: /Mostrar \d+ más/ }).click();
  expect(await page.getByRole('button', { name: /^Ver seguimiento de/ }).count()).toBeGreaterThan(
    25,
  );
});

test('Entregas: un envío de días anteriores abre su detalle con el día correcto', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/entregas');
  await openSimulation(page);
  await page.getByRole('button', { name: 'Ayer' }).click();
  const first = page.getByRole('button', { name: /^Ver seguimiento de/ }).first();
  await expect(first).toBeVisible();
  await first.click();
  const drawer = page.getByRole('dialog', { name: /MON-/ });
  await expect(drawer.getByText(/Pedido web · Mar 10 nov/)).toBeVisible();
});

test('cocina: sin Entregas en el menú, sin acceso por URL y sin despacho', async ({ page }) => {
  await enterAs(page, /Cocina Zona 4/);
  await expect(nav(page).getByRole('link', { name: /Entregas/ })).toHaveCount(0);
  await page.goto('/backoffice/entregas');
  await expect(page.getByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toHaveCount(0);

  await page.goto('/backoffice/pedidos');
  await expect(page.getByRole('button', { name: /Despachar/ })).toHaveCount(0);
});

// ── F28 · Reparto propio (REAL: contrato admin-deliveries; aquí contra el mock con las reglas del servidor) ──────────────────────

const detail = (page: Page) => page.getByRole('dialog', { name: `#${ORDER.slice(1)}` });
const toast = (page: Page, text: string | RegExp) => page.locator('.toast', { hasText: text });

/** Pedidos → «Despachar» (crea la entrega, idempotente, y abre su detalle en Entregas). */
async function dispatchOwn(page: Page) {
  await page.goto('/backoffice/pedidos');
  await card(page).getByRole('button', { name: 'Despachar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/entregas$/); // el id de la entrega no queda en la URL
  await expect(detail(page)).toBeVisible();
  return detail(page);
}

test('F28 · encargado: crear → asignar → recoger → entregar → retorno (el retorno es un paso aparte y libera al motorista)', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  const drawer = await dispatchOwn(page);
  await expect(drawer.getByText('Sin motorista').first()).toBeVisible();
  // Sin PII en la lista; el contacto del cliente solo está en el detalle abierto.
  await expect(drawer.getByTestId('delivery-contact')).toBeVisible();

  // Asignar: solo motoristas elegibles de la sucursal (Luis Coc está «No disponible»).
  await drawer.getByRole('button', { name: 'Asignar motorista' }).click();
  const assign = page.getByRole('dialog', { name: 'Asignar motorista' });
  const select = assign.getByLabel('Motorista elegible');
  await expect(select.getByRole('option', { name: /Luis Coc/ })).toHaveCount(0);
  // Orden por nombre sin acentos: [placeholder, Ángel Morales, Juan Carlos Pérez].
  await select.selectOption({ index: 1 });
  await assign.getByRole('button', { name: 'Asignar' }).click();
  await expect(toast(page, 'Motorista asignado a #MON-307051.')).toBeVisible();
  await expect(drawer.getByTestId('delivery-rider')).toContainText('Ángel Morales');

  // Reasignar antes de la recogida: el anterior queda libre.
  await drawer.getByRole('button', { name: 'Reasignar motorista' }).click();
  const reassign = page.getByRole('dialog', { name: 'Reasignar motorista' });
  await reassign.getByLabel('Motorista elegible').selectOption({ index: 1 });
  await reassign.getByRole('button', { name: 'Reasignar' }).click();
  await expect(toast(page, 'Motorista reasignado en #MON-307051.')).toBeVisible();

  // Recoger → el pedido sale «En camino»; entregar → «Esperando retorno» (el motorista sigue ocupado).
  await drawer.getByRole('button', { name: 'Marcar recogido' }).click();
  await expect(toast(page, '#MON-307051 recogido: el pedido va en camino.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Marcar entregado' }).click();
  // Entregar no se deshace: pide confirmación antes de enviar.
  const deliver = page.getByRole('alertdialog', { name: 'Marcar como entregado' });
  await expect(deliver.getByText(/no se puede deshacer/)).toBeVisible();
  await deliver.getByRole('button', { name: 'Sí, marcar entregado' }).click();
  await expect(toast(page, '#MON-307051 entregado al cliente.')).toBeVisible();
  await expect(drawer.getByText('Esperando retorno').first()).toBeVisible();
  await expect(drawer.getByText(/Sigue ocupado hasta registrar su retorno/)).toBeVisible();
  // El contacto deja de verse con la entrega cerrada más adelante; aquí sigue abierta.
  await drawer.getByRole('button', { name: 'Registrar retorno' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Registrar retorno' });
  await expect(confirm.getByText(/no cambia el pedido ni su pago/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Registrar retorno' }).click();
  await expect(toast(page, 'Retorno registrado para #MON-307051.')).toBeVisible();
  await expect(drawer.getByText('Esperando retorno')).toHaveCount(0);
  await expect(drawer.getByTestId('delivery-contact-hidden')).toBeVisible();
  const history = drawer.getByTestId('delivery-history');
  await expect(history.getByText('Retorno registrado')).toBeVisible();
  await expect(history.getByText('Pedido entregado')).toBeVisible();
});

test('F28 · encargado: cancelar la entrega exige motivo y NO cancela el pedido; luego se puede volver a despachar (reapertura)', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  const drawer = await dispatchOwn(page);
  await drawer.getByRole('button', { name: 'Cancelar entrega' }).click();
  const modal = page.getByRole('alertdialog', { name: 'Cancelar entrega' });
  await expect(modal.getByText(/no escribas datos personales/i)).toBeVisible();
  await modal.getByRole('button', { name: 'Cancelar entrega' }).click();
  await expect(modal.getByText('Indica el motivo.')).toBeVisible();
  await modal.getByLabel('Motivo (obligatorio)').fill('Cliente ausente');
  await modal.getByRole('button', { name: 'Cancelar entrega' }).click();
  await expect(toast(page, 'Entrega de #MON-307051 cancelada.')).toBeVisible();
  await page.keyboard.press('Escape');
  // El pedido sigue «Listo» y se puede despachar de nuevo: la entrega cancelada se REABRE.
  await page.goto('/backoffice/pedidos');
  await expect(column(page, 'Listo').getByText('#MON-307051')).toBeVisible();
  await card(page).getByRole('button', { name: 'Despachar' }).click();
  await expect(
    detail(page).getByTestId('delivery-history').getByText('Entrega reabierta'),
  ).toBeVisible();
});

test('F28 · Pedidos: cancelar un pedido con entrega abierta ofrece «Cancelar entrega y luego el pedido» en dos pasos', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await dispatchOwn(page);
  await page.keyboard.press('Escape');
  await page.goto('/backoffice/pedidos');
  await card(page).locator('.kcard-main').click();
  const order = page.getByRole('dialog', { name: /MON-307051/ });
  await order.getByRole('button', { name: 'Cancelar pedido' }).click();
  const reason = page.getByRole('dialog', { name: 'Cancelar pedido' });
  await reason.getByRole('textbox', { name: /Motivo/ }).fill('Cliente no contesta');
  await reason.getByRole('button', { name: 'Confirmar cancelación' }).click();
  const blocked = page.getByRole('alertdialog', { name: 'El pedido tiene una entrega abierta' });
  await expect(blocked.getByRole('button', { name: 'Cancelar pedido' })).toBeDisabled();
  await blocked.getByRole('button', { name: 'Cancelar entrega' }).click();
  await expect(blocked.getByText(/Entrega cancelada\./)).toBeVisible();
  await blocked.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(blocked.getByText(/Pedido cancelado\./)).toBeVisible();
});

test('F28 · PedidosYa sigue SIMULADO y separado del reparto propio; nunca confirma entregas reales', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/entregas');
  await expect(page.getByRole('tab', { name: 'Reparto propio', selected: true })).toBeVisible();
  await expect(page.getByTestId('own-deliveries')).toBeVisible();
  await expect(page.getByTestId('simulation-banner')).toHaveCount(0);
  await openSimulation(page);
  await expect(page.getByTestId('own-deliveries')).toHaveCount(0);
  await expect(page.getByText('Simulación', { exact: true }).first()).toBeVisible();
});

test('F28 · empleado (solo lectura, sucursal 1): ve la pantalla sin entregas abiertas y ningún botón de acción', async ({
  page,
}) => {
  await enterAs(page, /Empleado Zona 4/);
  await page.goto('/backoffice/entregas');
  await expect(page.getByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible();
  await expect(page.getByText('No hay entregas abiertas')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Asignar motorista|Cancelar entrega/ }),
  ).toHaveCount(0);
});
