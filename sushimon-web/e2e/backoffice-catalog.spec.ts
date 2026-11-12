import { expect, test, type Page } from '@playwright/test';

/**
 * Backoffice, bloque 4: Productos, Categorías y Promociones con datos simulados. El estado del mock vive
 * en la pestaña (sessionStorage), así que lo que el administrador cambia lo ve la tienda en la misma sesión.
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });
const card = (page: Page, name: string) =>
  page.locator('.pcard').filter({ has: page.getByText(name, { exact: true }) });
const dumplings = (page: Page) => page.getByRole('switch', { name: 'Disponible: Dumplings' });

test('administrador: agota un producto en una sucursal y luego en todas; la tienda lo muestra no disponible', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Productos' }).click();
  await expect(page.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(dumplings(page)).toHaveAttribute('aria-checked', 'true');

  // Solo en la sucursal 2: con todas las sucursales queda parcial y la tienda sigue vendiéndolo.
  await page.getByRole('button', { name: /Cambiar de sucursal/ }).click();
  await page.getByRole('button', { name: /^Sucursal 2/ }).click();
  await expect(page.getByText(/disponibilidad para Sucursal 2/)).toBeVisible();
  await dumplings(page).click();
  await expect(page.locator('.toast', { hasText: 'Dumplings marcado como agotado' })).toBeVisible();
  await expect(card(page, 'Dumplings').getByText('Agotado')).toBeVisible();

  await page.getByRole('button', { name: /Cambiar de sucursal/ }).click();
  await page.getByRole('button', { name: /^Todas las sucursales/ }).click();
  await expect(card(page, 'Dumplings').getByText('Parcial 2/3')).toBeVisible();

  // Desde parcial, el interruptor activa todas; otro clic las agota en todas las sucursales.
  await card(page, 'Dumplings').getByRole('switch').click();
  await expect(card(page, 'Dumplings').getByText('Disponible', { exact: true })).toBeVisible();
  await card(page, 'Dumplings').getByRole('switch').click();
  await expect(card(page, 'Dumplings').getByText('Agotado')).toBeVisible();

  // La tienda lee el mismo estado (misma pestaña): el producto aparece como no disponible.
  await page.goto('/menu');
  await expect(
    page.getByText('No disponible por ahora').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 60_000 });
});

test('administrador: edita un producto y crea otro con validación', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/productos');
  await expect(dumplings(page)).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' });
  await dialog.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Escribe el nombre del producto.');
  await expect(dialog.getByRole('textbox', { name: 'Nombre', exact: true })).toBeFocused();

  await dialog.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Roll Mon especial');
  await dialog.getByLabel(/^Precio/).fill('48');
  await dialog.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.locator('.toast', { hasText: 'Producto creado' })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'Roll Mon especial')).toContainText('Q48.00');

  await page.getByRole('button', { name: 'Editar Roll Mon especial' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar producto' });
  await edit.getByLabel(/^Precio/).fill('52');
  await edit.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(card(page, 'Roll Mon especial')).toContainText('Q52.00');
});

test('administrador: crea una categoría, la reordena y la oculta de la tienda', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Categorías' }).click();
  await expect(page.getByRole('heading', { name: 'Categorías', level: 1 })).toBeVisible({
    timeout: 90_000,
  });

  const rows = page.locator('.crow .cname');
  await page.getByRole('textbox', { name: 'Nombre de la nueva categoría' }).fill('Bowls');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Categoría “Bowls” agregada al final' }),
  ).toBeVisible();
  await expect(rows.last()).toHaveText('Bowls');

  // Orden con teclado: baja "Entradas" y conserva el foco.
  const down = page.getByRole('button', { name: 'Bajar Entradas' });
  await down.focus();
  await page.keyboard.press('Enter');
  await expect(rows.nth(1)).toHaveText('Entradas');
  await expect(page.getByRole('button', { name: 'Bajar Entradas' })).toBeFocused();

  // Visibilidad en la web: la tienda deja de mostrar "Postres".
  await page.getByRole('switch', { name: 'Visible en la web: Postres' }).click();
  await expect(page.locator('.crow.off .cname')).toHaveText('Postres');
  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /^Postres/ })).toHaveCount(0);
});

test('administrador: crea una promoción con validación del formulario', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Promociones' }).click();
  await expect(page.getByRole('heading', { name: 'Promociones', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('2 activas de 3')).toBeVisible();

  await page.getByRole('button', { name: 'Nueva promoción' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva promoción' });
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Escribe el nombre de la promoción.');

  await dialog.getByRole('textbox', { name: 'Nombre' }).fill('Jueves de sashimi');
  await dialog.getByLabel('Hora fin').fill('11:00');
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'La hora de fin debe ser posterior a la de inicio.',
  );
  await dialog.getByLabel('Hora fin').fill('16:00');
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();

  await expect(page.locator('.toast', { hasText: 'Promoción creada y activa' })).toBeVisible();
  const created = page.locator('.promo').filter({ hasText: 'Jueves de sashimi' });
  await expect(created).toContainText('-15%');
  await expect(created).toContainText('Vigencia: 11 nov – 11 dic 2026');
  await expect(page.getByText('3 activas de 4')).toBeVisible();

  const combo = page.getByRole('switch', { name: 'Activar Combo Mon para 2' });
  await combo.click();
  await expect(combo).toHaveAttribute('aria-checked', 'true');
});

test('encargado: sin botones de edición, pero cambia la disponibilidad de su sucursal', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await nav(page).getByRole('link', { name: 'Productos' }).click();
  await expect(page.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(dumplings(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Nuevo producto' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar / })).toHaveCount(0);

  await dumplings(page).click();
  await expect(page.locator('.toast', { hasText: 'Dumplings marcado como agotado' })).toBeVisible();
  await expect(dumplings(page)).toHaveAttribute('aria-checked', 'false');

  // Categorías y promociones no están en su menú.
  await expect(nav(page).getByRole('link', { name: 'Categorías' })).toHaveCount(0);
  await page.goto('/backoffice/promociones');
  await expect(
    page.getByRole('heading', { name: 'No tienes permiso para ver esta pantalla' }),
  ).toBeVisible({ timeout: 60_000 });
});
