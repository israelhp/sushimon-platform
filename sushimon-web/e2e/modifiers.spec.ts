import AxeBuilder from '@axe-core/playwright';
import { deliveryMode } from './support/cart';
import { expect, test, type Page } from '@playwright/test';

/**
 * F12 — Extras (modificadores) con datos simulados fieles al contrato: administración (grupos, opciones, asociación al
 * producto) y selector de la ficha pública. El estado del mock vive en la pestaña (sessionStorage): lo que el administrador
 * cambia lo ve la tienda en la misma sesión. Desde F18 el carrito guarda los extras elegidos.
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3210 pnpm --filter sushimon-web exec playwright test --project=e2e modifiers
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
}

async function expectNoSeriousA11y(page: Page, scope?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  const results = await (scope ? builder.include(scope) : builder).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });

test('tienda: la ficha de Sushi Pizza exige la salsa (radio), limita los extras y estima el total', async ({
  page,
}) => {
  // F18: agregar exige sucursal elegida en el modo de pedido.
  await page.addInitScript(
    (mode) => localStorage.setItem('monsushi-order-mode-v1', mode),
    deliveryMode('sucursal-1'),
  );
  await page.goto('/menu');
  await page
    .getByRole('button', { name: /^Sushi Pizza/ })
    .filter({ visible: true })
    .first()
    .click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Sushi Pizza' });
  const salsa = dialog.getByRole('group', { name: /Salsa/ });
  await expect(salsa.getByText('Obligatorio')).toBeVisible();
  await expect(salsa.getByText('Elige 1')).toBeVisible();
  const add = dialog.getByRole('button', { name: /^Agregar\s*Q/ });
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByText('Completa los grupos obligatorios')).toBeVisible();

  await salsa.getByRole('radio', { name: /Ponzu/ }).check();
  await expect(add).toHaveAttribute('aria-disabled', 'false');

  const extras = dialog.getByRole('group', { name: /Extras/ });
  await expect(extras.getByText('Elige hasta 3')).toBeVisible();
  await extras.getByRole('checkbox', { name: /Queso crema/ }).check();
  await extras.getByRole('checkbox', { name: /Aguacate/ }).check();
  await extras.getByRole('checkbox', { name: /Salsa extra/ }).check();
  await expect(dialog.getByText('+Q12.00')).toBeVisible();
  // Sushi Pizza Q72.00 + extras Q12.00.
  await expect(dialog.getByText('Q84.00')).toBeVisible();
  await expect(dialog.getByText(/el servidor recalcula el precio/)).toBeVisible();
  await expectNoSeriousA11y(page, '[role="dialog"]');

  // Quitar un extra recalcula el estimado; la línea del carrito guarda la salsa y los extras elegidos (F18).
  await extras.getByRole('checkbox', { name: /Aguacate/ }).uncheck();
  await expect(dialog.getByText('+Q8.00')).toBeVisible();
  await add.click();
  await expect(page.getByText('1 × Sushi Pizza agregado a tu pedido')).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('monsushi-cart-v2'));
  const [line] = JSON.parse(saved!).lines;
  expect(line.selections.map((x: { optionId: string }) => x.optionId).sort()).toEqual([
    'mopt-ponzu',
    'mopt-queso-crema',
    'mopt-salsa-extra',
  ]);
});

test('backoffice: crea un grupo con opciones, las reordena, lo asocia a Dumplings y la tienda lo ofrece', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await nav(page).getByRole('link', { name: 'Extras' }).click();
  await expect(page.getByRole('heading', { name: 'Extras', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expectNoSeriousA11y(page);

  await page.getByRole('button', { name: 'Nuevo grupo' }).click();
  const create = page.getByRole('dialog', { name: 'Nuevo grupo de extras' });
  await create.getByRole('button', { name: 'Guardar grupo' }).click();
  await expect(create.getByRole('alert').first()).toContainText('Escribe un nombre');
  await create.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Término');
  await create.getByRole('textbox', { name: 'Mínimo a elegir' }).fill('1');
  await create.getByRole('button', { name: 'Agregar opción' }).click();
  await create.getByRole('textbox', { name: 'Nombre de la opción 1' }).fill('Medio');
  await create.getByRole('button', { name: 'Agregar opción' }).click();
  await create.getByRole('textbox', { name: 'Nombre de la opción 2' }).fill('Bien cocido');
  await create.getByRole('textbox', { name: 'Precio extra de la opción 2' }).fill('2.50');
  await create.getByRole('button', { name: 'Guardar grupo' }).click();
  await expect(page.locator('.toast', { hasText: 'Grupo «Término» creado' })).toBeVisible();

  // Nombre repetido (sin distinguir mayúsculas): 409 en el campo.
  await page.getByRole('button', { name: 'Nuevo grupo' }).click();
  const dup = page.getByRole('dialog', { name: 'Nuevo grupo de extras' });
  await dup.getByRole('textbox', { name: 'Nombre', exact: true }).fill('TÉRMINO');
  await dup.getByRole('button', { name: 'Guardar grupo' }).click();
  await expect(dup.getByText('Este nombre ya está en uso.')).toBeVisible();
  await dup.getByRole('button', { name: 'Cancelar' }).click();

  // Opciones: reordenar con botones (foco conservado) y desactivar.
  await page.getByRole('button', { name: 'Opciones de Término' }).click();
  const options = page.getByRole('dialog', { name: 'Opciones de Término' });
  await options.getByRole('button', { name: 'Bajar Medio' }).click();
  await expect(options.getByText('Medio movida a la posición 2 de 2')).toBeAttached();
  await expect(options.getByRole('button', { name: 'Subir Medio' })).toBeFocused();
  await expectNoSeriousA11y(page, '[role="dialog"]');
  await options.getByRole('button', { name: 'Cerrar', exact: true }).last().click();

  // Asociar al producto desde su editor.
  await nav(page).getByRole('link', { name: 'Productos' }).click();
  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('Dumplings');
  await page.getByRole('button', { name: 'Editar Dumplings' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar producto' });
  await expect(edit.getByText('Este producto no tiene grupos de extras.')).toBeVisible();
  await edit.getByRole('combobox', { name: 'Grupo de extras a agregar' }).selectOption('Término');
  await edit.getByRole('button', { name: 'Agregar grupo' }).click();
  await edit.getByRole('button', { name: 'Guardar extras' }).click();
  await expect(page.locator('.toast', { hasText: 'Extras del producto guardados' })).toBeVisible();
  await expectNoSeriousA11y(page, '[role="dialog"]');
  await edit.getByRole('button', { name: 'Cancelar' }).click();

  // La tienda (misma pestaña) ofrece el grupo obligatorio en la ficha.
  await page.goto('/menu');
  await page
    .getByRole('button', { name: /^Dumplings/ })
    .filter({ visible: true })
    .first()
    .click({ timeout: 60_000 });
  const sheet = page.getByRole('dialog', { name: 'Dumplings' });
  const group = sheet.getByRole('group', { name: /Término/ });
  await expect(group.getByText('Obligatorio')).toBeVisible();
  await expect(group.getByText('+Q2.50')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Agregar\s*Q/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('el encargado ve los grupos en solo lectura con aviso', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await page.goto('/backoffice/modificadores');
  await expect(page.getByRole('heading', { name: 'Extras', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('Tienes acceso de solo lectura al catálogo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo grupo' })).toBeDisabled();
});
