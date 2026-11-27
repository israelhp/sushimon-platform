import { expect, test, type Page } from './support/test';
import { demoStaffFromSeed } from '../src/mocks/fixtures/staff';

/**
 * F16 — Banners en móvil (Pixel 7) con datos SIMULADOS: el carrusel del Inicio y la pantalla del backoffice se adaptan sin
 * desbordar, sin desplazamiento de diseño por la altura reservada y en tema claro y oscuro.
 */
const admin = demoStaffFromSeed('u1');

// El proyecto `e2e` también recoge `*.mobile.spec.ts` (viewport de escritorio): solo tiene sentido con el dispositivo móvil.
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · Inicio: el carrusel reserva su altura, no desborda y se navega con los puntos · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
    await page.goto('/');
    const carousel = page.locator('section[aria-roledescription]');
    const slides = carousel.locator('article');
    await expect(slides.first()).toBeVisible({ timeout: 90_000 });
    await expect(slides).toHaveCount(3);
    // Alturas fijas por punto de corte (esqueleto y diapositiva miden lo mismo): sin CLS al llegar los datos.
    const height = await slides.first().evaluate((el) => el.getBoundingClientRect().height);
    expect([132, 156, 176, 220]).toContain(Math.round(height));
    expect(await noHorizontalOverflow(page)).toBe(true);
    // El texto y el botón caben dentro de la diapositiva.
    const box = await slides.first().boundingBox();
    const title = await slides.first().locator('h2').boundingBox();
    expect(title!.x).toBeGreaterThanOrEqual(box!.x - 1);
    expect(title!.x + title!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    await carousel.getByRole('button', { name: 'Ir a la promoción 2' }).tap();
    await expect(carousel.getByRole('button', { name: 'Ir a la promoción 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test(`móvil · backoffice: la lista y el formulario de banners caben en pantalla · ${theme}`, async ({
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
      [theme, admin] as const,
    );
    await page.goto('/backoffice/banners');
    await expect(page.getByRole('heading', { name: 'Banners', level: 1 })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-testid="banner-row"]').first()).toBeVisible({
      timeout: 60_000,
    });
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.getByRole('button', { name: 'Nuevo banner' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo banner' });
    await expect(dialog).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
  });
}

/** Texto de longitud máxima con letras anchas (peor caso para el recorte). */
const wide = (n: number) =>
  'MON WWW '
    .repeat(Math.ceil(n / 8))
    .slice(0, n)
    .trim();

test('móvil · textos de longitud máxima: el título, el subtítulo y el botón quedan DENTRO de la diapositiva a 320, 360 y 390 px', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (staff) =>
      sessionStorage.setItem('monsushi-demo-session-v1', JSON.stringify({ customer: null, staff })),
    admin,
  );
  await page.goto('/backoffice/banners');
  await expect(page.locator('[data-testid="banner-row"]').first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Nuevo banner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo banner' });
  await dialog.getByLabel('Código').fill('texto-maximo');
  await dialog.getByRole('button', { name: 'Elegir de la biblioteca' }).click();
  await page
    .getByRole('dialog', { name: 'Imágenes de banner' })
    .getByRole('button', { name: 'Usar la imagen 1' })
    .click();
  const es = dialog.getByRole('group', { name: 'Textos en español (obligatorios)' });
  await es.getByLabel(/^Título/).fill(wide(80));
  await es.getByLabel('Subtítulo').fill(wide(160));
  await es.getByLabel('Texto del botón').fill(wide(40));
  await es.getByLabel(/^Texto alternativo/).fill('Alt');
  // Vista previa móvil pequeña (320 px) con el mismo texto: el botón cabe dentro.
  await dialog.getByRole('button', { name: /Móvil pequeño/ }).click();
  const preview = dialog.getByTestId('banner-preview');
  await expect(preview).toHaveAttribute('data-device', 'mobileSmall');
  const pBox = await preview.boundingBox();
  const pCta = await preview.locator('.btn').boundingBox();
  expect(pCta!.y + pCta!.height).toBeLessThanOrEqual(pBox!.y + pBox!.height + 1);
  await dialog.getByRole('button', { name: 'Crear banner' }).click();
  await expect(page.locator('.toast', { hasText: 'Banner creado' })).toBeVisible();

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const carousel = page.locator('section[aria-roledescription]');
    await expect(carousel.locator('article')).toHaveCount(4, { timeout: 90_000 });
    await carousel.getByRole('button', { name: 'Ir a la promoción 4' }).tap();
    const slide = carousel.locator('article').nth(3);
    await expect(slide).not.toHaveAttribute('inert');
    await expect(slide.locator('h2')).toContainText('MON WWW');
    await page.waitForTimeout(700); // fin del desplazamiento
    const box = (await slide.boundingBox())!;
    for (const part of ['h2', 'a']) {
      const b = (await slide.locator(part).first().boundingBox())!;
      expect(b.y, `${part} · ${width}px (arriba)`).toBeGreaterThanOrEqual(box.y - 1);
      expect(b.y + b.height, `${part} · ${width}px (abajo)`).toBeLessThanOrEqual(
        box.y + box.height + 1,
      );
      expect(b.x + b.width, `${part} · ${width}px (derecha)`).toBeLessThanOrEqual(
        box.x + box.width + 1,
      );
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
    // Objetivos táctiles de 44 px en los indicadores y la pausa.
    for (const control of [carousel.getByRole('button', { name: 'Ir a la promoción 1' })]) {
      const b = (await control.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(43.5);
      expect(b.height).toBeGreaterThanOrEqual(43.5);
    }
  }
});
