import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** F22 · Pedidos del backoffice en móvil (Pixel 7, datos SIMULADOS): sin desbordes, acciones ≥ 44 px y axe claro/oscuro. */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

async function enterAs(page: Page, profile: RegExp, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('monsushi-theme', t), theme);
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
  await page.goto('/backoffice/pedidos');
}

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · pedidos: tablero, detalle y modal de motivo · ${theme}`, async ({ page }) => {
    await enterAs(page, /Marco Antonio Gómez/, theme);
    const card = page.locator('.kcard', { hasText: '#MON-307057' });
    await expect(card).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    const accept = card.getByRole('button', { name: 'Aceptar pedido' });
    expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const violations = async (include?: string) => {
      const builder = new AxeBuilder({ page }).withTags([
        'wcag2a',
        'wcag2aa',
        'wcag21a',
        'wcag21aa',
      ]);
      if (include) builder.include(include);
      return (await builder.analyze()).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
    };
    expect(await violations()).toEqual([]);

    await card
      .getByRole('button', { name: /#MON-307057/ })
      .first()
      .click();
    const drawer = page.getByRole('dialog', { name: /MON-307057/ });
    await expect(drawer.getByText('Productos', { exact: true })).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await violations('[role="dialog"]')).toEqual([]);

    await drawer.getByRole('button', { name: 'Rechazar' }).click();
    const modal = page.getByRole('dialog', { name: 'Rechazar pedido' });
    await expect(modal).toBeVisible();
    const reject = modal.getByRole('button', { name: 'Confirmar rechazo' });
    expect((await reject.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await violations('[role="dialog"][aria-labelledby]:last-of-type')).toEqual([]);
  });
}

test('móvil · tabla de pedidos: filtros y «Cargar más» sin desbordes', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/, 'light');
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Ver detalle de #MON/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cargar más' })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('móvil 360 px · tabla con rango personalizado: sin desbordes y objetivos táctiles ≥ 44 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await enterAs(page, /Ana Lucía Pérez/, 'light');
  const card = page.locator('.kcard-main').first();
  await expect(card).toBeVisible();
  expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir', exact: true }).click();
  await expect(page.getByLabel('Desde')).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  for (const target of [
    page.getByRole('button', { name: 'Limpiar filtros' }),
    page.getByRole('tab').first(),
    page.locator('.chip').first(),
    page.locator('.seg button').first(),
  ]) {
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
});
