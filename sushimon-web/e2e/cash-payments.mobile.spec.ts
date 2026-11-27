import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { button, next, seedCheckout } from './support/checkout';

/** F24 · Pagos en efectivo en móvil (Pixel 7, datos SIMULADOS): sin desbordes, objetivos ≥ 44 px, axe claro/oscuro y modal accesible. */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

const ORDER = 'MON-307057';
const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  return (await builder.analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · checkout solo efectivo: sin desbordes y sin violaciones · ${theme}`, async ({
    page,
  }) => {
    await seedCheckout(page, { theme });
    for (const step of ['Entrega', 'Envío', 'Pago']) await next(page, step);
    await expect(page.getByTestId('payment-cash')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByTestId('payment-instructions')).toHaveText(
      'Realiza el pago en efectivo cuando recojas tu pedido en la sucursal.',
    );
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await axe(page, '#paso-actual')).toEqual([]);
    await next(page, 'Confirmación');
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect((await button(page, /Realizar pedido/).boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
  });

  test(`móvil · backoffice: panel de pago y modal a pantalla casi completa · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('monsushi-theme', t), theme);
    await page.goto('/backoffice/login');
    await page.getByRole('button', { name: /Ana Lucía Pérez/ }).click();
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
    await page.goto('/backoffice/pedidos');
    const card = page.locator('.kcard', { hasText: `#${ORDER}` });
    await expect(card).toBeVisible({ timeout: 90_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    await expect(card.getByText('Pago pendiente')).toBeVisible();

    await card
      .getByRole('button', { name: new RegExp(`#${ORDER}`) })
      .first()
      .click();
    const drawer = page.getByRole('dialog', { name: new RegExp(ORDER) });
    const panel = drawer.getByTestId('payment-panel');
    await expect(panel).toBeVisible();
    const trigger = panel.getByRole('button', { name: 'Registrar pago en efectivo' });
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await axe(page, '[data-testid="payment-panel"]')).toEqual([]);

    await trigger.click();
    const modal = page.getByRole('dialog', { name: 'Registrar pago en efectivo' });
    await expect(modal).toBeVisible();
    const box = (await modal.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 4); // hoja inferior ≤ 640 px
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await noHorizontalOverflow(page)).toBe(true);
    for (const target of [
      modal.getByLabel('Efectivo recibido'),
      modal.getByRole('button', { name: 'Cancelar' }),
    ]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
    const check = modal.getByLabel('Confirmo que recibí físicamente el dinero');
    expect(
      (await check.locator('xpath=ancestor::label').boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await modal.getByLabel('Efectivo recibido').fill('200');
    await modal.getByLabel('Confirmo que recibí físicamente el dinero').check();
    await modal.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(modal).toBeHidden();
    await expect(panel.getByText('Pagado', { exact: true }).first()).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
}
