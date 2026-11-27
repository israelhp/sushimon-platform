import { expect, test, type Page } from './support/test';

/**
 * F15 — Promociones, cupones y Happy Hour con datos SIMULADOS (el mock reproduce la semántica del contrato; nada se probó contra la
 * API real). El estado del mock vive en la pestaña (sessionStorage): lo que el administrador cambia lo ve la tienda en la misma
 * sesión. «Ahora» de la demo = miércoles 11 nov 2026, 14:25 en Guatemala (el Happy Hour empieza hoy a las 15:00).
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });
const promo = (page: Page, name: string) =>
  page.locator('.promo').filter({ has: page.locator('.promo-name', { hasText: name }) });

async function openPromotions(page: Page) {
  await nav(page).getByRole('link', { name: 'Promociones' }).click();
  await expect(page.getByRole('heading', { name: 'Promociones', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('6 promociones', { exact: true })).toBeVisible({ timeout: 60_000 });
}

/** Preferencia de la tienda (solo comodidad, no autenticación): sucursal para recoger. */
const pickBranch = (page: Page, branchId: string) =>
  page.evaluate((id) => {
    localStorage.setItem(
      'monsushi-order-mode-v1',
      JSON.stringify({ type: 'pickup', when: { kind: 'now' }, branchId: id, address: null }),
    );
  }, branchId);

test('administrador: valida, crea, edita y activa promociones; filtra el listado', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await openPromotions(page);

  // Alta con validación del formulario.
  await page.getByRole('button', { name: 'Nueva promoción' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva promoción' });
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();
  await expect(dialog.getByText(/Escribe un nombre de 1 a 120/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Nombre' }).fill('Jueves de sashimi');
  await dialog.getByLabel('Descuento (%)').fill('150');
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();
  await expect(dialog.getByText('El descuento no puede superar 100 %.')).toBeVisible();
  await dialog.getByLabel('Descuento (%)').fill('15');

  // Horario Happy Hour: jueves 18:00–22:00 y viernes 22:00 → 02:00 (cruza la medianoche).
  await dialog.getByRole('button', { name: 'Añadir franja' }).click();
  await dialog.getByLabel('Día de la franja 1').selectOption('4');
  await dialog.getByLabel('Inicio de la franja 1').fill('18:00');
  await dialog.getByLabel('Fin de la franja 1').fill('22:00');
  await dialog.getByRole('button', { name: 'Añadir franja' }).click();
  await dialog.getByLabel('Día de la franja 2').selectOption('5');
  await dialog.getByLabel('Inicio de la franja 2').fill('22:00');
  await dialog.getByLabel('Fin de la franja 2').fill('02:00');
  await dialog
    .getByRole('group', { name: 'Franja 2' })
    .getByRole('checkbox', { name: 'Cruza la medianoche' })
    .check();
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();

  await expect(page.locator('.toast', { hasText: 'Promoción creada y activa' })).toBeVisible();
  const created = promo(page, 'Jueves de sashimi');
  await expect(created).toContainText('-15%');
  await expect(created).toContainText('Vigencia: 11 nov 2026 – 10 dic 2026');
  // jueves + viernes 22–24 + sábado 00–02 = 3 tramos del contrato.
  await expect(created).toContainText('3 franjas semanales');
  await expect(page.getByText('7 promociones', { exact: true })).toBeVisible();

  // Edición: carga el detalle, cambia el nombre y guarda con `expectedVersion`.
  await page.getByRole('button', { name: 'Editar Jueves de sashimi' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar promoción' });
  await expect(edit.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Jueves de sashimi');
  await edit.getByRole('textbox', { name: 'Nombre' }).fill('Jueves de sake');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.toast', { hasText: 'Jueves de sake actualizada' })).toBeVisible();
  await expect(promo(page, 'Jueves de sake')).toBeVisible();

  // Activar / desactivar.
  const combo = page.getByRole('switch', { name: 'Activar Combo Mon para 2' });
  await combo.click();
  await expect(combo).toHaveAttribute('aria-checked', 'true');

  // Filtros: por estado y por código.
  await page.getByLabel('Filtrar por estado').selectOption('expired');
  await expect(promo(page, 'Semana del cliente')).toBeVisible();
  await expect(page.locator('.promo')).toHaveCount(1);
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByRole('searchbox', { name: 'Buscar por nombre o código' }).fill('bienvenido10');
  await expect(page.locator('.promo')).toHaveCount(1);
  await expect(promo(page, 'Cupón de bienvenida')).toContainText('Código: BIENVENIDO10');
});

test('administrador: un código repetido da 409 en el campo y no cierra el modal', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await openPromotions(page);
  await page.getByRole('button', { name: 'Nueva promoción' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva promoción' });
  await dialog.getByRole('textbox', { name: 'Nombre' }).fill('Otro cupón');
  await dialog.getByLabel('Código del cupón').fill('bienvenido10');
  await dialog.getByRole('button', { name: 'Crear promoción' }).click();
  await expect(
    dialog.getByText('Ya existe una promoción con ese código. Elige otro.').first(),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('tienda: Happy Hour, promociones y cupón sin código por sucursal; el administrador cambia lo que ve la tienda', async ({
  page,
}) => {
  await page.goto('/');
  await pickBranch(page, 'sucursal-1');
  await page.goto('/promociones');
  await expect(
    page.getByRole('heading', { name: 'Promociones y Happy Hour', level: 1 }),
  ).toBeVisible({ timeout: 90_000 });

  const happy = page.getByRole('region', { name: 'Happy Hour' });
  await expect(happy).toBeVisible({ timeout: 60_000 });
  await expect(happy).toContainText('Lunes a jueves');
  await expect(happy).toContainText('3:00 p. m. – 6:00 p. m.');
  await expect(happy).toContainText('Hoy a partir de las 3:00 p. m.');
  await expect(happy).toContainText('Solo en restaurante');
  // Precio indicativo que dio la API (Q53.00 − 25 %).
  const dumplings = happy.locator('article').filter({ hasText: 'Dumplings' });
  await expect(dumplings).toContainText('Q39.75');
  await expect(dumplings).toContainText('Q53.00');

  // Cupón: «Requiere código», sin el código ni su descuento.
  const coupons = page.getByRole('region', { name: 'Cupones' });
  await expect(coupons).toContainText('Cupón de bienvenida');
  await expect(coupons).toContainText('Requiere código');
  await expect(page.locator('body')).not.toContainText('BIENVENIDO10');

  // Por sucursal: «Fin de mes» está en la 1 y la 2, no en la 3.
  await expect(page.getByText('Fin de mes: bebidas')).toBeVisible();
  await page.getByLabel('Sucursal', { exact: true }).selectOption('sucursal-3');
  await expect(page.getByText('Cupón de bienvenida')).toBeVisible();
  await expect(page.getByText('Fin de mes: bebidas')).toHaveCount(0);
  await page.getByLabel('Sucursal', { exact: true }).selectOption('sucursal-1');
  await expect(page.getByText('Fin de mes: bebidas')).toBeVisible();

  // El administrador la desactiva (misma pestaña/sesión del mock) y la tienda ya no la muestra.
  await enterAs(page, /Ana Lucía Pérez/);
  await openPromotions(page);
  await page.getByRole('switch', { name: 'Activar Fin de mes: bebidas' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Fin de mes: bebidas desactivada' }),
  ).toBeVisible();
  await page.goto('/promociones');
  await expect(page.getByRole('region', { name: 'Happy Hour' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Fin de mes: bebidas')).toHaveCount(0);
});
