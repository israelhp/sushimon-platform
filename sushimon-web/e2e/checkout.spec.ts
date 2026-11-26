import AxeBuilder from '@axe-core/playwright';
import { DUMPLINGS, cartV2, deliveryMode } from './support/cart';
import { expect, test, type Page } from '@playwright/test';

/**
 * Checkout de punta a punta (datos simulados, sin red externa). F24: el ÚNICO método es EFECTIVO (sin elegir, sin tarjeta,
 * Neonet ni transferencia): el pedido nace con el pago en efectivo PENDIENTE y nada se marca como pagado.
 *   E2E_PORT=3202 pnpm --filter sushimon-web exec playwright test --project=e2e checkout
 */

/**
 * Modo «a domicilio» y un Dumplings en el carrito (preferencias del cliente en localStorage, como las deja el
 * menú), y desde el inicio: carrito → Continuar → checkout.
 */
async function toCheckout(page: Page) {
  await page.addInitScript(
    ([cart, mode]) => {
      localStorage.setItem('monsushi-cart-v2', cart!);
      localStorage.setItem('monsushi-order-mode-v1', mode!);
    },
    [cartV2('sucursal-1', [DUMPLINGS]), deliveryMode('sucursal-1')],
  );
  await page.goto('/');
  await page.getByRole('heading', { name: /hambre/i }).waitFor();
  await page
    .getByRole('button', { name: /Ver tu pedido/ })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Tu pedido' })
    .getByRole('link', { name: /Continuar/ })
    .click();
  await page.waitForURL('**/checkout');
  await expect(page.getByRole('heading', { level: 1, name: 'Tu pedido' })).toBeVisible();
}

const next = (page: Page, name: RegExp) =>
  page.getByRole('button', { name }).filter({ visible: true }).first().click();

async function toPayment(page: Page) {
  for (const step of ['Entrega', 'Envío', 'Pago']) {
    await next(page, new RegExp(`Continuar a ${step}`, 'i'));
    await expect(page.getByRole('heading', { level: 1, name: step })).toBeVisible();
  }
}

test('pedido en efectivo de punta a punta: confirma, vacía el carrito y recuerda el último pedido', async ({
  page,
}) => {
  await toCheckout(page);
  await expect(page.getByText('Paso 1 de 5', { exact: true })).toBeVisible();
  await toPayment(page);
  // F24: solo efectivo, sin nada que elegir, con la instrucción de entrega y el total cotizado.
  await expect(page.getByTestId('payment-cash')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByTestId('payment-instructions')).toHaveText(
    'Realiza el pago en efectivo cuando recibas tu pedido.',
  );
  await expect(page.getByTestId('payment-total')).toContainText('Q68.00');
  await expect(page.locator('body')).not.toContainText(
    /transferencia|tarjeta|neonet|comprobante|pagar ahora/i,
  );
  await next(page, /Continuar a confirmación/i);
  await expect(page.getByRole('heading', { level: 1, name: 'Confirmación' })).toBeVisible();
  await next(page, /Realizar pedido/);

  await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())!;
  expect(number).toMatch(/^MON-\d{6}$/);
  await expect(page.getByRole('link', { name: 'Ver detalle del pedido' })).toHaveAttribute(
    'href',
    `/pedidos/${number}`,
  );

  // Carrito vacío y datos del pedido guardados para "Tu último pedido" (sin datos de tarjeta).
  const stored = await page.evaluate(() => ({
    cart: localStorage.getItem('monsushi-cart-v2'),
    last: localStorage.getItem('monsushi-last-order-v1'),
    draft: sessionStorage.getItem('monsushi-checkout-v1'),
  }));
  expect(JSON.parse(stored.cart ?? '{"lines":[]}').lines).toEqual([]);
  expect(JSON.parse(stored.last!).id).toBe(number);
  expect(stored.draft).toBeNull();

  await page.goto('/');
  await expect(page.getByText('Tu último pedido')).toBeVisible();
});

test('la barra de progreso y el estado sobreviven al cambio de idioma y de tema', async ({
  page,
}) => {
  await toCheckout(page);
  await next(page, /Continuar a entrega/i);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrega' })).toBeVisible();

  await page.getByRole('button', { name: /Cambiar idioma a English/ }).click();
  await expect(page.getByText('Step 2 of 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Delivery info' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).first().click();
  await expect(page.getByText('Step 2 of 5', { exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`el paso Pago (solo efectivo) no tiene violaciones de accesibilidad graves · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
    await toCheckout(page);
    await toPayment(page);
    await expect(page.getByTestId('payment-cash')).toBeVisible();
    const violations = (
      await new AxeBuilder({ page })
        .include('#paso-actual')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(violations).toEqual([]);
  });
}
