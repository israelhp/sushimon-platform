import { expect, test, type Page } from '@playwright/test';

/**
 * F14 (MOCK_ONLY): gestor de imágenes del backoffice contra el ALMACÉN SIMULADO. Se sube un PNG real, el navegador lo optimiza
 * a WebP con canvas, calcula el SHA-256 y la cola recorre intent → «PUT» simulado → complete → vínculo. NO se contacta a R2 ni
 * a ningún origen externo (el host de las URLs simuladas es `.invalid` y jamás se pide).
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function enterAsAdmin(page: Page) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: /Ana Lucía Pérez/ }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
}

test('administrador: sube una imagen, la reordena, edita su texto y la desvincula; sin red externa', async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !/^(data|blob|about):/.test(url)) external.push(url);
  });
  await enterAsAdmin(page);
  await page
    .getByRole('navigation', { name: 'Menú principal' })
    .getByRole('link', { name: 'Productos' })
    .click();
  await page.getByRole('button', { name: 'Editar Dumplings' }).click({ timeout: 90_000 });
  const dialog = page.getByRole('dialog', { name: 'Editar producto' });
  await expect(dialog.getByRole('heading', { name: 'Imágenes' })).toBeVisible();
  await expect(dialog.getByText('Simulación').first()).toBeVisible();
  await expect(dialog.getByText('1/8')).toBeVisible();

  await dialog
    .getByLabel('Seleccionar imágenes para subir')
    .setInputFiles({ name: 'roll.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(
    dialog.getByRole('listitem', { name: 'Archivo roll.png' }).getByText('Listo'),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByRole('listitem', { name: 'Imagen 2 de 2' })).toBeVisible();

  // Reordenar con botones: la nueva sube al primer lugar y el foco se conserva.
  await dialog.getByRole('button', { name: 'Subir la imagen 2' }).click();
  await expect(dialog.getByRole('button', { name: 'Subir la imagen 1' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Bajar la imagen 1' })).toBeFocused();
  await expect(
    dialog.getByRole('listitem', { name: 'Imagen 1 de 2' }).getByText('Principal'),
  ).toBeVisible();

  // Texto alternativo.
  await dialog
    .getByRole('textbox', { name: 'Texto alternativo de la imagen 1' })
    .fill('Roll nuevo');
  await dialog.getByRole('button', { name: 'Guardar texto de la imagen 1' }).click();
  await expect(page.locator('.toast', { hasText: 'Texto alternativo guardado' })).toBeVisible();

  // Desvincular con confirmación (el archivo queda en la biblioteca).
  await dialog.getByRole('button', { name: 'Desvincular la imagen 1' }).click();
  await page
    .getByRole('dialog', { name: 'Desvincular imagen' })
    .getByRole('button', { name: 'Desvincular' })
    .click();
  await expect(dialog.getByText('1/8')).toBeVisible();
  await dialog.getByRole('button', { name: 'Biblioteca de imágenes' }).click();
  const library = page.getByRole('dialog', { name: 'Biblioteca de imágenes' });
  await expect(library.getByRole('listitem')).toHaveCount(4);

  expect(external).toEqual([]);
});

test('sin permisos de escritura global no hay carga de imágenes (solo lectura)', async ({
  page,
}) => {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: /Marco Antonio Gómez/ }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
  await page
    .getByRole('navigation', { name: 'Menú principal' })
    .getByRole('link', { name: 'Productos' })
    .click();
  // El encargado no puede editar productos: el botón de edición está deshabilitado.
  await expect(page.getByRole('button', { name: 'Editar Dumplings' })).toBeDisabled({
    timeout: 90_000,
  });
});
