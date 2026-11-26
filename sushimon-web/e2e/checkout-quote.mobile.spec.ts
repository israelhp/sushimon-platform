import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DUMPLINGS, cartV2, deliveryMode } from './support/cart';

/** F19 · Cotización en móvil (Pixel 7, datos SIMULADOS): resumen visible en «Envío», barra inferior con el total del servidor, sin desbordes y objetivos ≥ 44 px. */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · «Envío» con cotización, barra inferior, sin desbordes y axe · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(
      ([cart, mode, t]) => {
        localStorage.setItem('monsushi-theme', t!);
        if (!sessionStorage.getItem('__seeded')) {
          sessionStorage.setItem('__seeded', '1');
          localStorage.setItem('monsushi-cart-v2', cart!);
          localStorage.setItem('monsushi-order-mode-v1', mode!);
        }
      },
      [cartV2('sucursal-1', [{ ...DUMPLINGS, quantity: 2 }]), deliveryMode('sucursal-1'), theme],
    );
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { level: 1, name: 'Tu pedido' })).toBeVisible({
      timeout: 90_000,
    });
    const bar = page
      .getByRole('button', { name: /Continuar a entrega/i })
      .filter({ visible: true });
    await expect(bar).toBeEnabled();
    await bar.click();
    await page.getByRole('heading', { level: 1, name: 'Entrega' }).waitFor();
    await page
      .getByRole('button', { name: /Continuar a envío/i })
      .filter({ visible: true })
      .click();
    await page.getByRole('heading', { level: 1, name: 'Envío' }).waitFor();

    const summary = page.getByRole('region', { name: /Resumen/i }).filter({ visible: true });
    await expect(summary.getByTestId('summary-total')).toHaveText('Q121.00');
    await expect(summary.getByText('Simulación').first()).toBeVisible();
    const pay = page.getByRole('button', { name: /Continuar a pago/i }).filter({ visible: true });
    await expect(pay).toBeEnabled();
    const box = await pay.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalOverflow(page)).toBe(true);
    const violations = (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations).toEqual([]);
  });
}

test('móvil · bloqueo: la barra fija muestra el motivo en una frase, el botón es aria-disabled y no hay desbordes', async ({
  page,
}) => {
  await page.addInitScript(
    ([cart, mode]) => {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('monsushi-cart-v2', cart!);
        localStorage.setItem('monsushi-order-mode-v1', mode!);
      }
    },
    [
      cartV2('sucursal-1', [{ ...DUMPLINGS, quantity: 2 }]),
      JSON.stringify({
        type: 'delivery',
        when: { kind: 'now' },
        branchId: 'sucursal-1',
        address: null,
      }),
    ],
  );
  await page.goto('/checkout');
  const visible = (name: RegExp) =>
    page.getByRole('button', { name }).filter({ visible: true }).first();
  await expect(visible(/Continuar a entrega/i)).toBeEnabled({ timeout: 90_000 });
  await visible(/Continuar a entrega/i).click();
  await page.locator('#paso-actual').getByRole('button', { name: 'Cambiar' }).nth(1).click();
  await page.getByLabel('Municipio').selectOption({ label: 'Palencia' });
  await visible(/Continuar a envío/i).click();
  await page.getByRole('heading', { level: 1, name: 'Envío' }).waitFor();
  const pay = visible(/Continuar a pago/i);
  await expect(pay).toHaveAttribute('aria-disabled', 'true');
  const reason = page.locator('#checkout-bar-reason');
  await expect(reason).toBeVisible();
  await expect(reason).toHaveText(/Hay un problema con tu pedido/);
  await expect(pay).toHaveAccessibleDescription(/Hay un problema con tu pedido/);
  expect(await noHorizontalOverflow(page)).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(violations).toEqual([]);
});
