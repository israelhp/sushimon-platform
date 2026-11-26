import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F09 · Geografía, zonas propias y cobertura (datos simulados, sin red externa). El mock emula las reglas del servidor
 * (spec 008): normalización de etiqueta, unicidad, prioridad específica > general, tarifa decimal y PedidosYa SIEMPRE
 * `UNKNOWN` (integración bloqueada). La sesión del backoffice es de DEMOSTRACIÓN: la API real decide permisos y alcance.
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock pnpm --filter sushimon-web exec playwright test --project=e2e delivery-coverage
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
}

async function openDelivery(page: Page, branch: string) {
  await page.goto('/backoffice/sucursales');
  await page.getByRole('button', { name: `Entrega y zonas de ${branch}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Entrega y zonas' });
  await expect(dialog.getByRole('switch', { name: `Entrega propia en ${branch}` })).toBeVisible();
  return dialog;
}

async function openDeliverySheet(page: Page) {
  await page.goto('/');
  await page.getByRole('heading', { name: /hambre/i }).waitFor();
  await page
    .getByRole('button', { name: /Iniciar pedido/ })
    .first()
    .click();
  // ADR-0036: la hoja «Pedir ahora» es solo a domicilio; los campos de dirección ya están visibles.
  return page.getByRole('dialog', { name: 'Pedir ahora' });
}

test('admin crea una zona; la tienda comprueba la cobertura y muestra la tarifa del servidor', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openDelivery(page, 'Sucursal 2');

  // PedidosYa: integración pendiente, sin ningún indicador de conexión.
  const integration = dialog.getByTestId('pedidosya-integration');
  await expect(integration).toContainText('Integración pendiente de documentación y credenciales');
  await expect(integration).not.toContainText(/conectad/i);

  await dialog.getByRole('tab', { name: 'Zonas propias' }).click();
  await expect(dialog.getByText('20 zonas', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Nueva zona' }).click();
  const form = page.getByRole('dialog', { name: 'Nueva zona de entrega' });
  await form.getByRole('button', { name: 'Crear zona' }).click();
  await expect(form.getByText('Elige el municipio.')).toBeVisible();
  await expect(form.getByLabel('Departamento')).toBeFocused();
  await form.getByLabel('Departamento').selectOption({ label: 'Guatemala' });
  await form.getByLabel('Municipio').selectOption({ label: 'Palencia' });
  await form.getByLabel('Tarifa de envío (GTQ)').fill('15.001');
  await form.getByRole('button', { name: 'Crear zona' }).click();
  await expect(form.getByText(/hasta 2 decimales/).first()).toBeVisible();
  await form.getByLabel('Tarifa de envío (GTQ)').fill('12.5');
  await form.getByRole('button', { name: 'Crear zona' }).click();
  await expect(page.locator('.toast', { hasText: 'Zona creada' })).toBeVisible();
  await expect(dialog.getByText('21 zonas', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Q12.50')).toBeVisible();

  // Tienda: departamento → municipio; la comprobación ocurre al completar la selección (no por pulsación).
  const sheet = await openDeliverySheet(page);
  await expect(sheet.getByText(/Elegí departamento, municipio y zona/)).toBeVisible();
  await sheet.getByLabel('Municipio').selectOption({ label: 'Palencia' });
  await sheet.getByLabel('Dirección exacta').fill('Calle principal 123');
  await expect(sheet.getByText('Entregamos en esta dirección desde Sucursal 2.')).toBeVisible();
  await expect(sheet.getByTestId('coverage-fee')).toHaveText('Q12.50');
  await expect(sheet.getByText(/Tiempo estimado de entrega/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Ver el menú' }).click();
  await expect(page).toHaveURL(/\/menu$/);
});

test('sin zona propia PedidosYa queda «por confirmar» (no «sin cobertura»); solo informa, sin ofrecer recoger', async ({
  page,
}) => {
  const sheet = await openDeliverySheet(page);
  await sheet.getByLabel('Municipio').selectOption({ label: 'Palencia' });
  await sheet.getByLabel('Dirección exacta').fill('Calle principal 123');
  await expect(sheet.getByText(/No pudimos confirmar si llegamos a esa dirección/)).toBeVisible();
  await expect(sheet.getByText('Por ahora no llegamos a esa dirección.')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Ver el menú' }).click();
  await expect(page).not.toHaveURL(/\/menu$/);
  await expect(
    sheet.getByText(/No pudimos confirmar si llegamos a esa dirección/).last(),
  ).toBeVisible();
  // Sin alternativas: ni recoger en sucursal ni programar.
  await expect(sheet.getByRole('button', { name: /Recoger|Programar/ })).toHaveCount(0);
});

test('departamento sin municipios cargados: aviso claro y no se puede continuar a domicilio', async ({
  page,
}) => {
  const sheet = await openDeliverySheet(page);
  await sheet.getByLabel('Departamento').selectOption({ label: 'Escuintla' });
  await expect(
    sheet.getByText(
      'Por ahora solo ofrecemos entrega a domicilio en el departamento de Guatemala.',
    ),
  ).toBeVisible();
  await sheet.getByLabel('Dirección exacta').fill('Calle principal 123');
  await sheet.getByRole('button', { name: 'Ver el menú' }).click();
  await expect(page).not.toHaveURL(/\/menu$/);
});

test('admin desactiva la entrega propia con confirmación y la tienda deja de confirmarla', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await enterAs(page, /Ana Lucía Pérez/);
  // Con PedidosYa deshabilitado y la propia apagada en las tres sucursales activas el domicilio queda sin cobertura.
  for (const branch of ['Sucursal 1', 'Sucursal 2', 'Sucursal 3']) {
    const dialog = await openDelivery(page, branch);
    await dialog.getByRole('switch', { name: `Entrega propia en ${branch}` }).click();
    await page
      .getByRole('dialog', { name: 'Desactivar la entrega propia' })
      .getByRole('button', { name: 'Confirmar' })
      .click();
    await expect(
      page.locator('.toast', { hasText: `Entrega propia desactivada en ${branch}` }),
    ).toBeVisible();
    await dialog.getByRole('switch', { name: `PedidosYa habilitado en ${branch}` }).click();
    await page
      .getByRole('dialog', { name: 'Deshabilitar PedidosYa' })
      .getByRole('button', { name: 'Confirmar' })
      .click();
    await expect(
      page.locator('.toast', { hasText: `PedidosYa deshabilitado en ${branch}` }),
    ).toBeVisible();
  }

  const sheet = await openDeliverySheet(page);
  await sheet.getByLabel('Zona', { exact: true }).selectOption('10');
  await sheet.getByLabel('Dirección exacta').fill('6a avenida 10-50');
  await expect(sheet.getByText('Por ahora no llegamos a esa dirección.')).toBeVisible();
  await expect(sheet.getByText(/No podemos confirmar/)).toHaveCount(0);
});

test('un duplicado se rechaza con un mensaje claro y el formulario sigue abierto', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openDelivery(page, 'Sucursal 1');
  await dialog.getByRole('tab', { name: 'Zonas propias' }).click();
  await dialog.getByRole('button', { name: 'Nueva zona' }).click();
  const form = page.getByRole('dialog', { name: 'Nueva zona de entrega' });
  await form.getByLabel('Departamento').selectOption({ label: 'Guatemala' });
  await form.getByLabel('Municipio').selectOption({ label: 'Guatemala' });
  await form.getByLabel('Zona (opcional)').fill('  zona   10 ');
  await form.getByLabel('Tarifa de envío (GTQ)').fill('10');
  await form.getByRole('button', { name: 'Crear zona' }).click();
  await expect(form.getByText(/Ya existe una zona con esa etiqueta/)).toBeVisible();
  await expect(form.getByLabel('Zona (opcional)')).toHaveAttribute('aria-invalid', 'true');
  await expect(form).toBeVisible();
});

test('un encargado solo lee: sin crear ni editar zonas', async ({ page }) => {
  test.setTimeout(150_000);
  await enterAs(page, /Marco Antonio Gómez/);
  const dialog = await openDelivery(page, 'Sucursal 1');
  await expect(
    dialog.getByText(/Solo lectura: no tienes permiso para modificar la entrega/),
  ).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Entrega propia en Sucursal 1' })).toBeDisabled();
  await dialog.getByRole('tab', { name: 'Zonas propias' }).click();
  await expect(dialog.getByRole('table', { name: 'Zonas de entrega propias' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Nueva zona' })).toHaveCount(0);
});

test('accesibilidad: cobertura en la hoja de pedido y formulario de zona sin violaciones serias', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const sheet = await openDeliverySheet(page);
  await sheet.getByLabel('Municipio').selectOption({ label: 'Palencia' });
  await sheet.getByLabel('Dirección exacta').fill('Calle principal 123');
  await expect(sheet.getByText(/No podemos confirmar el envío a domicilio/)).toBeVisible();
  const store = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(store.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );

  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openDelivery(page, 'Sucursal 1');
  await dialog.getByRole('tab', { name: 'Zonas propias' }).click();
  await dialog.getByRole('button', { name: 'Nueva zona' }).click();
  const form = page.getByRole('dialog', { name: 'Nueva zona de entrega' });
  await form.getByRole('button', { name: 'Crear zona' }).click();
  await expect(form.getByText('Elige el municipio.')).toBeVisible();
  const bo = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(bo.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );
});
