import { expect, test, type Page } from '@playwright/test';
import { demoStaffFromSeed } from '../src/mocks/fixtures/staff';

/**
 * F16 — Banners en móvil (Pixel 7) con datos SIMULADOS: el carrusel del Inicio (solo imágenes) y la pantalla del backoffice se adaptan sin
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
    await page.getByRole('button', { name: 'Agregar banner' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar banner' });
    await expect(dialog).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
  });
}

test('móvil · texto alternativo de longitud máxima (120): el formulario y la vista previa no desbordan a 320, 360 y 390 px', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (staff) =>
      sessionStorage.setItem('monsushi-demo-session-v1', JSON.stringify({ customer: null, staff })),
    admin,
  );
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/backoffice/banners');
    await expect(page.locator('[data-testid="banner-row"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole('button', { name: 'Agregar banner' }).click();
    const dialog = page.getByRole('dialog', { name: 'Agregar banner' });
    await dialog.getByRole('button', { name: 'Elegir de la biblioteca' }).click();
    await page
      .getByRole('dialog', { name: 'Imágenes de banner' })
      .getByRole('button', { name: 'Usar la imagen 1' })
      .click();
    await dialog.getByLabel(/^Texto alternativo/).fill('MON WWW '.repeat(15).slice(0, 120).trim());
    // Vista previa móvil pequeña (320 px): cabe dentro del diálogo.
    await dialog.getByRole('button', { name: /Móvil pequeño/ }).click();
    const preview = dialog.getByTestId('banner-preview');
    await expect(preview).toHaveAttribute('data-device', 'mobileSmall');
    const box = (await preview.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
  }
});
