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
const editDumplings = (page: Page) => page.getByRole('button', { name: 'Editar Dumplings' });
/** Preferencia de la tienda (solo comodidad, no autenticación): sucursal para el pedido a domicilio. */
const pickBranch = (page: Page, branchId: string) =>
  page.evaluate((id) => {
    localStorage.setItem(
      'monsushi-order-mode-v1',
      JSON.stringify({
        type: 'delivery',
        branchId: id,
        address: {
          department: 'Guatemala',
          municipality: 'Guatemala',
          zone: '10',
          line: '6a avenida 10-50',
          references: '',
        },
      }),
    );
  }, branchId);

test('administrador: agota un producto en una sucursal y fija un precio especial; la tienda lo refleja por sucursal', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Productos' }).click();
  await expect(page.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(editDumplings(page)).toBeVisible({ timeout: 60_000 });

  // F13 (contrato): sección «Sucursales» del editor del producto, con una fila por sucursal.
  await editDumplings(page).click();
  const dialog = page.getByRole('dialog', { name: 'Editar producto' });
  const row = (branch: string) => dialog.locator('li').filter({ hasText: branch }).first();
  await expect(row('Sucursal 2').getByTestId('effective-price')).toHaveText('Q53.00');
  await row('Sucursal 2').getByRole('switch', { name: 'Disponible: Sucursal 2' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Sucursal 2 marcado como agotado' }),
  ).toBeVisible();
  await expect(row('Sucursal 2').getByText('No ofertado')).toBeVisible();
  await row('Sucursal 1').getByLabel('Sucursal 1: precio especial').fill('49');
  await row('Sucursal 1')
    .getByRole('button', { name: 'Sucursal 1: guardar precio especial' })
    .click();
  await expect(row('Sucursal 1').getByTestId('effective-price')).toHaveText('Q49.00');
  await dialog.getByRole('button', { name: 'Cerrar' }).first().click();

  // La tienda lee el mismo estado (misma pestaña) y SOLO de la sucursal elegida.
  await pickBranch(page, 'sucursal-2');
  await page.goto('/menu');
  await expect(
    page.getByText('Agotado', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 60_000 });
  await pickBranch(page, 'sucursal-1');
  await page.goto('/menu');
  await expect(
    page.getByText('Q49', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Agotado', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('administrador: vista «Por sucursal» con filtro de precio especial', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/productos');
  await expect(editDumplings(page)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Por sucursal' }).click();
  await page.getByRole('combobox', { name: 'Sucursal' }).selectOption('sucursal-2');
  await page.getByRole('checkbox', { name: 'Solo con precio especial' }).check();
  const list = page.getByRole('list', { name: 'Productos de la sucursal' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('Dynamita Roll')).toBeVisible();
  await expect(list.getByTestId('effective-price')).toHaveText('Q86.00');
});

test('administrador: edita un producto y crea otro con validación', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/productos');
  await expect(editDumplings(page)).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' });
  await dialog.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(dialog.getByRole('alert').first()).toContainText('Escribe un nombre');
  await expect(dialog.getByRole('textbox', { name: 'Nombre', exact: true })).toBeFocused();

  await dialog.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Roll Mon especial');
  await dialog.getByRole('combobox', { name: /^Categoría/ }).selectOption({ label: 'Sushi Rolls' });
  await dialog.getByLabel(/^Precio/).fill('48');
  await dialog.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Producto «Roll Mon especial» creado' }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  // La lista es paginada (20 por página): se busca en el servidor.
  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('Roll Mon especial');
  await expect(card(page, 'Roll Mon especial')).toContainText('Q48.00');

  await page.getByRole('button', { name: 'Editar Roll Mon especial' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar producto' });
  await edit.getByLabel(/^Precio/).fill('52');
  await edit.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(card(page, 'Roll Mon especial')).toContainText('Q52.00');
});

test('administrador: crea una subcategoría, la reordena con el teclado y desactiva un padre: la tienda deja de publicarlo', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Categorías' }).click();
  await expect(page.getByRole('heading', { name: 'Categorías', level: 1 })).toBeVisible({
    timeout: 90_000,
  });

  const rows = page.locator('.crow .cname');
  await expect(rows.first()).toHaveText('Entradas', { timeout: 60_000 });

  // Alta de una subcategoría desde la fila del padre (slug autogenerado).
  await page.getByRole('button', { name: 'Agregar subcategoría a Entradas' }).click();
  const create = page.getByRole('dialog', { name: 'Nueva categoría' });
  await create.getByLabel('Nombre').fill('Entradas frías');
  await create.getByRole('button', { name: 'Crear' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Categoría «Entradas frías» creada al final de su nivel' }),
  ).toBeVisible();
  await expect(rows.nth(1)).toHaveText('Entradas frías');

  // Un slug repetido se explica sin cerrar el diálogo (409 CATEGORY_SLUG_TAKEN).
  await page.getByRole('button', { name: 'Nueva categoría' }).click();
  const dup = page.getByRole('dialog', { name: 'Nueva categoría' });
  await dup.getByLabel('Nombre').fill('Otra');
  await dup.getByLabel('Slug (URL)').fill('rolls');
  await dup.getByRole('button', { name: 'Crear' }).click();
  await expect(dup.getByText('Este slug ya está en uso.')).toBeVisible();
  await dup.getByRole('button', { name: 'Cancelar' }).click();

  // Orden con teclado entre hermanas: baja "Entradas" y conserva el foco.
  const down = page.getByRole('button', { name: 'Bajar Entradas', exact: true });
  await down.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Bajar Entradas', exact: true })).toBeFocused();
  await expect(rows.first()).toHaveText('Monchis');

  // Desactivar con confirmación: "Postres" deja de verse en la tienda.
  await page.getByRole('button', { name: 'Desactivar Postres' }).click();
  await page
    .getByRole('dialog', { name: /Desactivar «Postres»/ })
    .getByRole('button', { name: 'Desactivar' })
    .click();
  await expect(page.locator('.crow.off .cname', { hasText: 'Postres' })).toBeVisible();

  // Eliminar (ADR-0034): una categoría en uso (Sushi Rolls) se rechaza con conteos y sin cerrar; una sin uso se elimina.
  await page.getByRole('button', { name: 'Eliminar Sushi Rolls' }).click();
  const inUse = page.getByRole('dialog', { name: 'Eliminar «Sushi Rolls»' });
  await expect(inUse.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await inUse.getByRole('button', { name: 'Eliminar categoría' }).click();
  await expect(inUse.getByRole('alert')).toContainText('está en uso: 2 subcategorías');
  await inUse.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Eliminar Rolls fríos' }).click();
  await page
    .getByRole('dialog', { name: 'Eliminar «Rolls fríos»' })
    .getByRole('button', { name: 'Eliminar categoría' })
    .click();
  await expect(
    page.locator('.toast', { hasText: 'Categoría «Rolls fríos» eliminada' }),
  ).toBeVisible();
  await expect(page.locator('.crow .cname', { hasText: 'Rolls fríos' })).toHaveCount(0);
  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /^Postres/ })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Categorías' }).getByRole('link', { name: 'Postres' }),
  ).toHaveCount(0);
});

test('tienda: las subcategorías aparecen bajo su categoría y la inactiva no se publica', async ({
  page,
}) => {
  await page.goto('/menu?cat=rolls');
  await expect(page.getByRole('heading', { name: /^Sushi Rolls/ })).toBeVisible({
    timeout: 90_000,
  });
  const sub = page.getByRole('navigation', { name: 'Subcategorías de Sushi Rolls' });
  await expect(sub.getByRole('link', { name: 'Rolls fríos' })).toBeVisible();
  await expect(page.getByText('Temporada')).toHaveCount(0);
});

// Promociones (F15): ver `promotions.spec.ts`.

test('encargado: sin botones de edición, pero cambia la disponibilidad de su sucursal', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await nav(page).getByRole('link', { name: 'Productos' }).click();
  await expect(page.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(editDumplings(page)).toBeVisible({ timeout: 60_000 });
  // Solo lectura con aviso (el servidor responde 403 de todos modos); la disponibilidad por sucursal (F13) sigue.
  await expect(page.getByText('Tienes acceso de solo lectura al catálogo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo producto' })).toBeDisabled();
  await expect(editDumplings(page)).toBeDisabled();

  // Sin botón «Sucursales» por producto: la vista «Por sucursal» (matriz) es donde el encargado marca agotados.
  await page.getByRole('button', { name: 'Por sucursal' }).click();
  const matrix = page.getByRole('list', { name: 'Productos de la sucursal' });
  await page.getByRole('searchbox', { name: 'Buscar producto en la sucursal' }).fill('dumplings');
  await expect(page.getByRole('combobox', { name: 'Sucursal' })).toBeDisabled();
  const dumplings = matrix.locator('li').filter({ hasText: 'Dumplings' }).first();
  await expect(dumplings.getByLabel('Dumplings: precio especial')).toBeDisabled();
  const toggle = dumplings.getByRole('switch', { name: 'Disponible: Dumplings' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Categorías (solo lectura, catalog.read) sí; promociones no están en su menú.
  await nav(page).getByRole('link', { name: 'Categorías' }).click();
  await expect(page.getByText(/Solo lectura/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Nueva categoría' })).toBeDisabled();
  await expect(nav(page).getByRole('link', { name: 'Promociones' })).toHaveCount(0);
  await page.goto('/backoffice/promociones');
  await expect(
    page.getByRole('heading', { name: 'No tienes permiso para ver esta pantalla' }),
  ).toBeVisible({ timeout: 60_000 });
});

test('administrador: eliminar producto (ADR-0035) rechaza uno en uso con conteos y elimina uno sin uso', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Productos' }).click();
  await expect(editDumplings(page)).toBeVisible({ timeout: 90_000 });

  await page.getByRole('button', { name: 'Eliminar Dumplings' }).click();
  const inUse = page.getByRole('dialog', { name: 'Eliminar «Dumplings»' });
  await expect(inUse.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await inUse.getByRole('button', { name: 'Eliminar producto' }).click();
  await expect(inUse.getByRole('alert')).toContainText('3 pedidos y 1 promoción');
  await inUse.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('sushi pizza');
  await page.getByRole('button', { name: 'Eliminar Sushi Pizza' }).click();
  await page
    .getByRole('dialog', { name: 'Eliminar «Sushi Pizza»' })
    .getByRole('button', { name: 'Eliminar producto' })
    .click();
  await expect(
    page.locator('.toast', { hasText: 'Producto «Sushi Pizza» eliminado' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar Sushi Pizza' })).toHaveCount(0);
});
