import { expect, test, type Page } from '@playwright/test';

/**
 * Backoffice, bloque 3: modal Despachar y pantalla Entregas. PedidosYa está SIMULADO (sin documentación ni
 * credenciales): cotización, referencia, repartidor y estados salen del adaptador mock; no hay red externa.
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

const ORDER = '#MON-307051'; // sucursal 1 · a domicilio · listo · sin logística
const card = (page: Page) => page.locator('.kcard', { hasText: ORDER });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });
const row = (page: Page, code = ORDER) => page.locator('.trow', { hasText: code });

async function openDispatch(page: Page) {
  await page.goto('/backoffice/pedidos');
  await card(page).getByRole('button', { name: 'Despachar pedido' }).click();
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

  // Pedidos: el pedido queda con logística, ya sin botón de despacho.
  await expect(card(page).getByRole('button', { name: 'Despachar pedido' })).toHaveCount(0);

  // Entregas: aparece con referencia simulada PY-GT-… y estado logístico.
  await nav(page)
    .getByRole('link', { name: /Entregas/ })
    .click();
  await expect(page).toHaveURL(/\/backoffice\/entregas$/);
  await expect(page.getByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible();
  await expect(row(page).getByText('Buscando repartidor')).toBeVisible();
  await expect(row(page).getByText(/^PY-GT-77\d+$/)).toBeVisible();

  // Avanza (simulación) hasta entregado: el pedido pasa por "en camino" y termina en "Entregado".
  await row(page)
    .getByRole('button', { name: `Ver seguimiento de ${ORDER}` })
    .click();
  const detail = await advanceToEnd(page, /MON-307051/);
  await expect(detail.getByText('Pedido entregado. No hay acciones pendientes.')).toBeVisible();
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
