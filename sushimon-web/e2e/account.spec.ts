import { expect, test, type Page } from '@playwright/test';

/**
 * Flujos de Cuenta (Google SIMULADO), Más, Trabaja con nosotros y 404 con datos mock y sin red externa.
 *   E2E_PORT=3204 pnpm --filter sushimon-web exec playwright test --project=e2e account
 */

async function signInWithDemoGoogle(page: Page) {
  await page.goto('/cuenta');
  await page
    .getByRole('button', { name: /Continuar con Google/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await expect(dialog.getByText('Simulación')).toBeVisible();
  await dialog.getByRole('button', { name: /Continuar con Google/ }).click();
  await dialog.getByRole('button', { name: /Cliente Demo/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('cliente@ejemplo.com').first()).toBeVisible();
}

test.describe('cuenta (Google simulado)', () => {
  test('sin sesión las secciones piden iniciar sesión', async ({ page }) => {
    await page.goto('/cuenta/direcciones');
    await expect(
      page.getByRole('heading', { name: 'Iniciá sesión para usar esta sección' }),
    ).toBeVisible();
  });

  test('login simulado → dirección predeterminada → favorito → pedir de nuevo', async ({
    page,
  }) => {
    // Compilación en frío de varias rutas en el servidor de desarrollo.
    test.setTimeout(150_000);
    await signInWithDemoGoogle(page);
    await expect(page.getByRole('link', { name: /Mis direcciones/ })).toContainText(
      /2 direcciones guardadas/,
    );

    // Direcciones: agregar una nueva como predeterminada.
    await page.getByRole('link', { name: /Mis direcciones/ }).click();
    await expect(page.getByRole('heading', { name: 'Mis direcciones' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Agregar dirección' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nueva dirección' });
    await dialog.getByRole('button', { name: 'Guardar dirección' }).click();
    // Errores accesibles: el foco va al primer campo inválido (zona).
    await expect(dialog.getByLabel('Zona')).toBeFocused();
    await dialog.getByLabel('Zona').selectOption('15');
    await dialog.getByLabel('Dirección exacta').fill('2a calle 23-80, Vista Hermosa');
    await dialog.getByRole('radio', { name: 'Otra' }).click();
    await dialog.getByLabel(/Nombre de la dirección/).fill('Casa de mamá');
    await dialog.getByLabel('Usar como predeterminada').check();
    await dialog.getByRole('button', { name: 'Guardar dirección' }).click();
    await expect(dialog).toBeHidden();
    const created = page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ hasText: 'Casa de mamá' });
    await expect(created).toContainText('Predeterminada');
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(3);

    // Favoritos: marcar un producto desde el menú y verlo en la cuenta.
    await page.goto('/menu');
    await expect(
      page.getByRole('button', { name: /Agregar Dumplings a favoritos/ }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole('button', { name: /Agregar Dumplings a favoritos/ })
      .first()
      .click();
    await expect(page.getByText('Dumplings está en tus favoritos')).toBeVisible();
    await page.goto('/cuenta/favoritos');
    await expect(page.getByRole('heading', { name: 'Mis favoritos' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole('button', { name: /Quitar Dumplings de favoritos/ }).first(),
    ).toBeVisible();

    // Pedir de nuevo desde el historial.
    await page.goto('/cuenta/pedidos');
    await page.getByRole('tab', { name: /Historial/ }).click({ timeout: 60_000 });
    await page
      .getByRole('button', { name: /Volver a pedir: MON-/ })
      .first()
      .click();
    const reorder = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(reorder.getByText(/Basado en el pedido MON-/)).toBeVisible();
    await reorder.getByRole('button', { name: /Agregar al carrito/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tu pedido' })).toBeVisible();
  });
});

test.describe('Más', () => {
  test('hub con accesos, contacto, preferencias y privacidad', async ({ page }) => {
    await page.goto('/mas');
    await expect(page.getByRole('heading', { level: 1, name: /^Más/ })).toBeVisible();
    for (const name of [/Consultá tu orden/, /Reclamo/, /Promociones/, /Trabaja con nosotros/]) {
      await expect(page.getByRole('main').getByRole('link', { name })).toBeVisible();
    }
    await page.getByRole('main').getByText('Aviso de privacidad (demo)').click();
    await expect(page.getByRole('main').getByText(/prototipo de demostración/)).toBeVisible();
  });
});

test.describe('Trabaja con nosotros', () => {
  test('postulación inválida: resumen de errores y foco en el primer campo', async ({ page }) => {
    await page.goto('/trabaja-con-nosotros');
    await page.getByRole('button', { name: 'Enviar postulación' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Revisá los campos marcados' });
    await expect(summary).toBeVisible();
    await expect(page.getByLabel('Nombre completo *')).toBeFocused();
    await expect(page.getByLabel('Nombre completo *')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Escribí tu nombre completo.').first()).toBeVisible();
    await expect(page.getByText(/Simulación: por ahora el archivo no se sube/)).toBeVisible();
  });

  test('postulación válida con CV simulado', async ({ page }) => {
    await page.goto('/trabaja-con-nosotros');
    await page.getByRole('button', { name: 'Postularme: Mesero' }).click();
    await expect(page.getByLabel('Puesto de interés *')).toHaveValue('mesero');
    await page.getByLabel('Nombre completo *').fill('Ana López');
    await page.getByLabel('Correo electrónico *').fill('ana.lopez@ejemplo.com');
    await page.getByLabel('Teléfono *').fill('5555-6789');
    await page.getByLabel('Experiencia *').selectOption('y1to3');
    await page.locator('#j-cv').setInputFiles({
      name: 'CV-Ana.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    await expect(page.getByText('CV-Ana.pdf')).toBeVisible();
    await page.getByLabel(/Acepto el tratamiento/).check();
    await page.getByRole('button', { name: 'Enviar postulación' }).click();
    await expect(page.getByText('¡Recibimos tu postulación!')).toBeVisible();
  });
});

test.describe('404', () => {
  test('ruta inexistente: "Este roll no existe" con estado 404 y vuelta al inicio', async ({
    page,
  }) => {
    const response = await page.goto('/ruta-que-no-existe');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Este roll no existe' })).toBeVisible();
    await page.getByRole('link', { name: 'Volver al inicio' }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });
});
