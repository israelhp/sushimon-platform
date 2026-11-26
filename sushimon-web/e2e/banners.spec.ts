import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { demoStaffFromSeed } from '../src/mocks/fixtures/staff';

/**
 * F16 (simplificado, ADR-0033) — Banners con datos SIMULADOS (el mock reproduce la semántica del contrato; nada se probó contra la
 * API real ni contra R2/CDN real). Un banner = imagen + texto alternativo + activo; máximo 5; orden = creación. El estado del mock
 * vive en la pestaña (sessionStorage): lo que el administrador cambia lo ve la tienda en la misma sesión. La semilla trae 4
 * banners (3 activos y 1 inactivo).
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/panel$/, { timeout: 90_000 });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });
const bannerRow = (page: Page, alt: string) =>
  page.locator('[data-testid="banner-row"]', { hasText: alt });

async function openBanners(page: Page, count = '4/5 banners') {
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

/** Texto alternativo de cada diapositiva del carrusel (imagen o, si falla, el fondo de marca con su nombre accesible). */
const slideAlts = (page: Page) =>
  page
    .locator('section[aria-roledescription] article')
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.querySelector('img')?.getAttribute('alt') ??
          el.querySelector('[data-banner-image]')?.getAttribute('aria-label') ??
          '',
      ),
    );

const SEED_ALTS = [
  'Selección de rolls favoritos de Sushi Mon',
  'Mesa con rolls y bebidas durante el Happy Hour',
  'Calientito Roll recién salido de la cocina',
];

test('administrador: agrega, edita, activa, elimina y llega al tope de 5; el Inicio lo refleja', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await openBanners(page);
  await expect(page.getByText(/hasta 30 segundos/).first()).toBeVisible();

  // Alta: validación, imagen REAL optimizada en el navegador (canvas) y texto alternativo.
  await page.getByRole('button', { name: 'Agregar banner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar banner' });
  await dialog.getByRole('button', { name: 'Crear banner' }).click();
  await expect(dialog.getByText('Elige o sube una imagen.')).toBeVisible();
  await expect(dialog.getByText('Escribe el texto alternativo de la imagen.')).toBeVisible();
  await expect(dialog.getByText(/Describe lo que se ve, sin empezar con/)).toBeVisible();

  await dialog
    .getByLabel('Seleccionar la imagen del banner')
    .setInputFiles({ name: 'portada.png', mimeType: 'image/png', buffer: pngBuffer(900, 600) });
  await expect(dialog.getByText(/Imagen lista · de .+ a .+ tras optimizar/)).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByLabel(/^Texto alternativo/).fill('Rolls frescos sobre hielo');

  // Previsualización SIN publicar: la imagen elegida recortada, en tres tamaños.
  const preview = dialog.getByTestId('banner-preview');
  await expect(preview.locator('img')).toBeVisible();
  await dialog.getByRole('button', { name: 'Móvil', exact: true }).click();
  await expect(preview).toHaveAttribute('data-device', 'mobile');

  await dialog.getByRole('button', { name: 'Crear banner' }).click();
  await expect(page.locator('.toast', { hasText: 'Banner creado' })).toBeVisible();
  await expect(page.getByText('5/5 banners', { exact: true })).toBeVisible();
  await expect(bannerRow(page, 'Rolls frescos sobre hielo')).toContainText('Activo');

  // Tope: «Agregar banner» deshabilitado con aviso.
  await expect(page.getByRole('button', { name: 'Agregar banner' })).toBeDisabled();
  await expect(page.getByText(/Ya hay 5 banners \(el máximo\)/)).toBeVisible();

  // Edición: carga el detalle, cambia el texto alternativo y guarda con `expectedVersion`.
  await page.getByRole('button', { name: 'Editar banner: Rolls frescos sobre hielo' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar banner' });
  await expect(edit.getByLabel(/^Texto alternativo/)).toHaveValue('Rolls frescos sobre hielo');
  await edit.getByLabel(/^Texto alternativo/).fill('Rolls de verano');
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.toast', { hasText: 'Banner actualizado' })).toBeVisible();
  await expect(bannerRow(page, 'Rolls de verano')).toBeVisible();

  // Activar / desactivar.
  const sw = page.getByRole('switch', { name: 'Activar banner: Rolls con decoración navideña' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  // La tienda lo refleja en la misma sesión: los 5 activos en orden de creación.
  await page.goto('/');
  await expect(page.locator('section[aria-roledescription] article').first()).toBeVisible({
    timeout: 60_000,
  });
  expect(await slideAlts(page)).toEqual([
    ...SEED_ALTS,
    'Rolls con decoración navideña',
    'Rolls de verano',
  ]);

  // Eliminar con confirmación: se libera un lugar y la tienda deja de mostrarlo.
  await page.goto('/backoffice/banners');
  await expect(page.getByText('5/5 banners', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Eliminar banner: Rolls de verano' }).click();
  const confirm = page.getByRole('dialog', { name: 'Eliminar banner' });
  await expect(confirm.getByText(/no se puede deshacer/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Eliminar banner' }).click();
  await expect(page.locator('.toast', { hasText: 'Banner eliminado' })).toBeVisible();
  await expect(page.getByText('4/5 banners', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar banner' })).toBeEnabled();
  await page.goto('/');
  await expect(page.locator('section[aria-roledescription] article').first()).toBeVisible({
    timeout: 60_000,
  });
  expect(await slideAlts(page)).toEqual([...SEED_ALTS, 'Rolls con decoración navideña']);
});

test('tienda: carrusel solo con imágenes de banners activos, teclado, pausa y sin enlaces ni textos', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const slides = page.locator('section[aria-roledescription] article');
  await expect(slides.first()).toBeVisible({ timeout: 90_000 });
  // Los 3 activos en orden de creación (el inactivo no sale), sin sucursal ni idioma que cambien la lista.
  expect(await slideAlts(page)).toEqual(SEED_ALTS);
  await expect(slides.locator('h2, a, button')).toHaveCount(0);

  // Teclado: ← / → sobre los indicadores; con movimiento reducido no avanza solo.
  const dot = (n: number) => page.getByRole('button', { name: `Ir a la promoción ${n}` });
  await dot(1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dot(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('End');
  await expect(dot(3)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('button', { name: 'Pausar carrusel' })).toHaveCount(0);

  // Con otra sucursal y en inglés la lista de banners es la misma.
  await pickBranch(page, 'sucursal-1');
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: page.url() }]);
  await page.goto('/');
  await expect(slides.first()).toBeVisible({ timeout: 90_000 });
  expect(await slideAlts(page)).toEqual(SEED_ALTS);
});

test('encargado sin permisos de banners: el menú no ofrece la pantalla', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(nav(page).getByRole('link', { name: 'Banners' })).toHaveCount(0);
});

const ADMIN_SESSION = demoStaffFromSeed('u1');

for (const theme of ['light', 'dark'] as const) {
  test(`a11y: lista, formulario y confirmación sin violaciones serias o críticas · ${theme}`, async ({
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
    await expect(page.getByText('4/5 banners', { exact: true })).toBeVisible({ timeout: 60_000 });
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
    await page
      .getByRole('button', { name: 'Editar banner: Rolls con decoración navideña' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Editar banner' });
    await expect(dialog.getByTestId('banner-preview')).toBeVisible();
    await audit('editar');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await page.getByRole('button', { name: 'Agregar banner' }).click();
    await page
      .getByRole('dialog', { name: 'Agregar banner' })
      .getByRole('button', { name: 'Crear banner' })
      .click();
    await expect(page.getByText('Elige o sube una imagen.')).toBeVisible();
    await audit('agregar con errores');
    await page
      .getByRole('dialog', { name: 'Agregar banner' })
      .getByRole('button', { name: 'Cancelar' })
      .click();
    await page
      .getByRole('button', { name: 'Eliminar banner: Rolls con decoración navideña' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Eliminar banner' })).toBeVisible();
    await audit('eliminar');
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
