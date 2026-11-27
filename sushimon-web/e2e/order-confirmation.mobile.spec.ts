import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { button, cartLines, seedCheckout, toReview } from './support/checkout';

/** F20 · Confirmación en móvil (Pixel 7, datos SIMULADOS): barra inferior, botón ≥ 44 px, sin desbordes y axe claro/oscuro. */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · confirmar pedido simulado, sin desbordes y axe · ${theme}`, async ({ page }) => {
    await seedCheckout(page, { theme });
    await toReview(page);
    const place = button(page, /Realizar pedido/);
    const box = await place.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await place.click();
    await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
    expect(await cartLines(page)).toBe(0);
    expect(await noHorizontalOverflow(page)).toBe(true);
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations).toEqual([]);
  });
}

test('móvil · QUOTE_CHANGED: el cuadro de re-aceptación cabe en pantalla y es accionable', async ({
  page,
}) => {
  await seedCheckout(page, { faults: { 'POST /v1/orders': ['price-change'] } });
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  const dialog = page.getByRole('alertdialog', { name: 'El total de tu pedido cambió' });
  await expect(dialog).toBeVisible();
  const accept = dialog.getByRole('button', { name: 'Aceptar y confirmar' });
  expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await accept.click();
  await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
});
