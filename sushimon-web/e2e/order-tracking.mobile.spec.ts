import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { button, seedCheckout, toReview } from './support/checkout';

/** F21 · Seguimiento en móvil (Pixel 7, datos SIMULADOS): orden, sin desbordes, botones ≥ 44 px y axe claro/oscuro. */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · seguimiento: orden de secciones, sin desbordes y axe · ${theme}`, async ({
    page,
  }) => {
    await seedCheckout(page, { theme });
    await toReview(page);
    await button(page, /Realizar pedido/).click();
    await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
    await page.getByTestId('view-tracking').click();
    await page.waitForURL(/\/seguimiento$/);
    await expect(page.getByTestId('order-tracking')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    // Orden: número, estado, fases/historial, entrega o retiro y resumen.
    const y = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
    const order = [
      await y('[data-testid="order-number"]'),
      await y('[data-testid="status-label"]'),
      await y('[data-testid="phases"]'),
      await y('#trk-fulfillment'),
      await y('#trk-summary'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const advance = page.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
    expect((await advance.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await advance.click();
    await expect(page.getByTestId('status-label')).toHaveText('Aceptado por la sucursal');
    expect(await noHorizontalOverflow(page)).toBe(true);
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations).toEqual([]);
  });
}
