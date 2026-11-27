import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { deflateSync } from 'node:zlib';
import { demoStaffFromSeed } from '../src/mocks/fixtures/staff';

/**
 * F16 — Banners con datos SIMULADOS (el mock reproduce la semántica del contrato; nada se probó contra la API real ni contra
 * R2/CDN real). El estado del mock vive en la pestaña (sessionStorage): lo que el administrador cambia lo ve la tienda en la misma
 * sesión. «Ahora» de la demo = miércoles 11 nov 2026, 14:25 en Guatemala (el Happy Hour y su banner empiezan hoy a las 15:00).
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });
const bannerRow = (page: Page, code: string) =>
  page.locator(`[data-testid="banner-row"][data-code="${code}"]`);

async function openBanners(page: Page, count = '8 banners') {
  await nav(page).getByRole('link', { name: 'Banners' }).click();
  await expect(page.getByRole('heading', { name: 'Banners', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(count, { exact: true })).toBeVisible({ timeout: 60_000 });
}

/** PNG RGB válido (sin dependencias): lo decodifica el navegador de verdad al optimizar. */
function pngBuffer(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = 180;
    row[2 + x * 3] = (x * 255) / width;
    row[3 + x * 3] = 60;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const slideTitles = (page: Page) =>
  page.locator('section[aria-roledescription] article h2').allTextContents();

/** Preferencia de la tienda (solo comodidad, no autenticación): sucursal para recoger. */
const pickBranch = (page: Page, branchId: string) =>
  page.evaluate((id) => {
    localStorage.setItem(
      'monsushi-order-mode-v1',
      JSON.stringify({ type: 'pickup', when: { kind: 'now' }, branchId: id, address: null }),
    );
  }, branchId);

test('administrador: crea, edita, activa y reordena banners; el Inicio lo refleja', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await openBanners(page);

  // Avisos visibles: demora de caché y subida solo para administración.
  await expect(page.getByText(/hasta 30 segundos/).first()).toBeVisible();
  await expect(page.getByText(/solo un administrador/)).toBeVisible();

  // Alta: validación, imagen REAL optimizada en el navegador (canvas), textos es/en, CTA y vigencia.
  await page.getByRole('button', { name: 'Nuevo banner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo banner' });
  await dialog.getByRole('button', { name: 'Crear banner' }).click();
  await expect(dialog.getByText('Elige o sube una imagen para el banner.')).toBeVisible();
  await expect(dialog.getByText(/El título en español es obligatorio/)).toBeVisible();

  await dialog.getByLabel('Código').fill('verano-2026');
  await dialog
    .getByLabel('Seleccionar la imagen del banner')
    .setInputFiles({ name: 'portada.png', mimeType: 'image/png', buffer: pngBuffer(900, 600) });
  await expect(dialog.getByText('Imagen lista')).toBeVisible({ timeout: 30_000 });
  const es = dialog.getByRole('group', { name: 'Textos en español (obligatorios)' });
  await es.getByLabel(/^Título/).fill('Verano de rolls');
  await es.getByLabel(/^Texto alternativo/).fill('Rolls frescos sobre hielo');
  await es.getByLabel('Texto del botón').fill('Pídelo ya');
  const en = dialog.getByRole('group', { name: 'Textos en inglés (opcionales)' });
  await en.getByLabel('Título', { exact: true }).fill('Roll summer');
  await dialog.getByLabel('Destino del botón').selectOption('CATEGORY');
  await dialog.getByLabel('Categoría de destino').selectOption({ label: 'Sushi Rolls' });

  // Previsualización SIN publicar: imagen real elegida y el respaldo a español en inglés.
  const preview = dialog.getByTestId('banner-preview');
  await expect(preview).toContainText('Verano de rolls');
  await expect(preview.locator('img')).toBeVisible();
  await dialog.getByRole('button', { name: 'Móvil', exact: true }).click();
  await expect(preview).toHaveAttribute('data-device', 'mobile');
  await dialog.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(preview).toContainText('Roll summer');
  await expect(dialog.getByText(/Saldrán en español \(sin traducción\):/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Crear banner' }).click();
  await expect(page.locator('.toast', { hasText: 'Banner creado' })).toBeVisible();
  await expect(page.getByText('9 banners', { exact: true })).toBeVisible();
  await expect(bannerRow(page, 'verano-2026')).toContainText('Publicado');

  // Edición: carga el detalle, cambia el título y guarda con `expectedVersion`.
  await page.getByRole('button', { name: 'Editar Verano de rolls' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar banner' });
  const esEdit = edit.getByRole('group', { name: 'Textos en español (obligatorios)' });
  await expect(esEdit.getByLabel(/^Título/)).toHaveValue('Verano de rolls');
  await expect(edit.getByLabel('Código')).toBeDisabled();
  await esEdit.getByLabel(/^Título/).fill('Verano de sushi');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.toast', { hasText: 'Verano de sushi actualizado' })).toBeVisible();
  await expect(bannerRow(page, 'verano-2026')).toContainText('Verano de sushi');

  // Un código repetido da 409 en el campo y no cierra el modal.
  await page.getByRole('button', { name: 'Nuevo banner' }).click();
  const dup = page.getByRole('dialog', { name: 'Nuevo banner' });
  await dup.getByLabel('Código').fill('favoritos');
  await dup.getByRole('button', { name: 'Elegir de la biblioteca' }).click();
  await page
    .getByRole('dialog', { name: 'Imágenes de banner' })
    .getByRole('button', { name: 'Usar la imagen 1' })
    .click();
  const dupEs = dup.getByRole('group', { name: 'Textos en español (obligatorios)' });
  await dupEs.getByLabel(/^Título/).fill('Repetido');
  await dupEs.getByLabel(/^Texto alternativo/).fill('Alt');
  await dup.getByRole('button', { name: 'Crear banner' }).click();
  await expect(
    dup.getByText('Ya existe un banner con ese código. Elige otro.').first(),
  ).toBeVisible();
  await dup.getByRole('button', { name: 'Cancelar' }).click();

  // Activar / desactivar.
  const sw = page.getByRole('switch', { name: 'Activar Tu primer pedido, con sorpresa' });
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  // Reordenar con el teclado: «calientito» sube dos posiciones y queda sobre «favoritos».
  const rows = page.locator('[data-testid="banner-row"]');
  const up = page.getByRole('button', { name: 'Subir Te merecés un calientito' });
  await expect(up).toBeEnabled();
  await up.focus();
  await page.keyboard.press('Enter');
  await expect(rows.nth(1)).toHaveAttribute('data-code', 'calientito');
  await expect(up).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(rows.first()).toHaveAttribute('data-code', 'calientito');

  // Filtros: por estado derivado y por búsqueda de título/código.
  await page.getByLabel('Filtrar por estado').selectOption('SCHEDULED');
  await expect(page.locator('[data-testid="banner-row"]')).toHaveCount(1);
  await expect(bannerRow(page, 'navidad-en-rolls')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByRole('searchbox', { name: 'Buscar por título o código' }).fill('verano');
  await expect(page.locator('[data-testid="banner-row"]')).toHaveCount(1);

  // La tienda lo refleja en la misma sesión: orden nuevo + el banner nuevo (hasta 30 s de caché real en http).
  await page.goto('/');
  await expect(page.locator('section[aria-roledescription] article').first()).toBeVisible({
    timeout: 60_000,
  });
  expect(await slideTitles(page)).toEqual([
    'Te merecés un calientito',
    'Los favoritos de los MONcheros',
    '¿Querés ser MONchero?',
    'Verano de sushi',
  ]);

  // Desactivar el banner nuevo lo retira de la tienda (la sesión de demostración sigue abierta en la pestaña).
  await page.goto('/backoffice/banners');
  await expect(page.getByText('9 banners', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('switch', { name: 'Activar Verano de sushi' }).click();
  await expect(page.locator('.toast', { hasText: 'Verano de sushi desactivado' })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('section[aria-roledescription] article').first()).toBeVisible({
    timeout: 60_000,
  });
  expect(await slideTitles(page)).toHaveLength(3);
});

test('tienda: carrusel con banners por sucursal e idioma, teclado, pausa y destinos cerrados', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const slides = page.locator('section[aria-roledescription] article');
  await expect(slides.first()).toBeVisible({ timeout: 90_000 });
  // Sin sucursal y a las 14:25: favoritos, calientito y equipo (Happy Hour espera a las 15:00).
  expect(await slideTitles(page)).toEqual([
    'Los favoritos de los MONcheros',
    'Te merecés un calientito',
    '¿Querés ser MONchero?',
  ]);
  await expect(page.locator('body')).not.toContainText(/Q\d+\.\d\d.*Happy|BIENVENIDO10/);

  // Teclado: ← / → sobre los indicadores; con movimiento reducido no avanza solo.
  const dot = (n: number) => page.getByRole('button', { name: `Ir a la promoción ${n}` });
  await dot(1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dot(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('End');
  await expect(dot(3)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('button', { name: 'Pausar carrusel' })).toHaveCount(0);

  // Destino por función cerrada: la tercera lleva a «Trabaja con nosotros».
  await page.getByRole('link', { name: /Ver oportunidades/ }).click();
  await expect(page).toHaveURL(/\/trabaja-con-nosotros$/);

  // Con la sucursal 1 se suma «Fin de mes» (sin inglés).
  await pickBranch(page, 'sucursal-1');
  await page.goto('/');
  await expect(slides.first()).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await slideTitles(page)).length).toBe(4);
  expect((await slideTitles(page))[3]).toBe('Fin de mes: bebidas');

  // Inglés: textos en inglés y `lang="es"` solo donde falta la traducción.
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: page.url() }]);
  await page.goto('/');
  await expect(slides.first()).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await slideTitles(page)).length).toBe(4);
  expect(await slideTitles(page)).toEqual([
    "MONcheros' favorites",
    'You deserve something hot',
    'Want to be a MONchero?',
    'Fin de mes: bebidas',
  ]);
  await expect(slides.nth(3).locator('h2')).toHaveAttribute('lang', 'es');
  await expect(slides.nth(0).locator('h2')).not.toHaveAttribute('lang', /.+/);
});

test('encargado sin permisos de banners: el menú no ofrece la pantalla', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(nav(page).getByRole('link', { name: 'Banners' })).toHaveCount(0);
});

const ADMIN_SESSION = demoStaffFromSeed('u1');

for (const theme of ['light', 'dark'] as const) {
  test(`a11y: lista, formulario y vista previa sin violaciones serias o críticas · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(
      ([value, staff]) => {
        localStorage.setItem('monsushi-theme', value as string);
        sessionStorage.setItem(
          'monsushi-demo-session-v1',
          JSON.stringify({ customer: null, staff }),
        );
      },
      [theme, ADMIN_SESSION] as const,
    );
    await page.goto('/backoffice/banners');
    await expect(page.getByRole('heading', { name: 'Banners', level: 1 })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText('8 banners', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(300);
    const audit = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(blocking, `${label}: ${JSON.stringify(blocking.map((v) => v.id))}`).toEqual([]);
    };
    await audit('lista');
    await page.getByRole('button', { name: 'Editar Fin de mes: bebidas' }).click();
    const dialog = page.getByRole('dialog', { name: 'Editar banner' });
    await expect(dialog.getByTestId('banner-preview')).toBeVisible();
    await audit('editar');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await page.getByRole('button', { name: 'Nuevo banner' }).click();
    await page
      .getByRole('dialog', { name: 'Nuevo banner' })
      .getByRole('button', { name: 'Crear banner' })
      .click();
    await expect(page.getByText('Elige o sube una imagen para el banner.')).toBeVisible();
    await audit('nuevo con errores');
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`a11y: el carrusel del Inicio (fondo de marca sobre la imagen simulada) sin violaciones serias o críticas · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
    await page.goto('/');
    await expect(page.locator('section[aria-roledescription] article').first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page })
      .include('section[aria-roledescription]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      blocking,
      JSON.stringify(blocking.map((v) => [v.id, v.nodes.map((n) => n.target)])),
    ).toEqual([]);
    // Las diapositivas inertes no se leen y el desplazador no es una región viva.
    await expect(
      page.locator('section[aria-roledescription] [aria-live]:not([role="status"])'),
    ).toHaveCount(0);
  });
}
