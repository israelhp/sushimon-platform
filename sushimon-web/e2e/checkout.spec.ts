import AxeBuilder from '@axe-core/playwright';
import { DUMPLINGS, cartV2, pickupMode } from './support/cart';
import { expect, test, type Page } from '@playwright/test';

/**
 * Checkout de punta a punta (datos simulados, sin red externa): efectivo y tarjeta NeoNet SIMULADA.
 * El escenario del servidor de pruebas es `default` (no se puede cambiar por prueba), así que el rechazo se
 * provoca con la tarjeta de prueba 4000 0000 0000 0002.
 *   E2E_PORT=3202 pnpm --filter sushimon-web exec playwright test --project=e2e checkout
 */

/**
 * Modo "recoger" y un Dumplings en el carrito (preferencias del cliente en localStorage, como las deja el
 * menú), y desde el inicio: carrito → Continuar → checkout.
 */
async function toCheckout(page: Page) {
  await page.addInitScript(
    ([cart, mode]) => {
      localStorage.setItem('monsushi-cart-v2', cart!);
      localStorage.setItem('monsushi-order-mode-v1', mode!);
    },
    [cartV2('sucursal-1', [DUMPLINGS]), pickupMode('sucursal-1')],
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

  await page.getByRole('radio', { name: /Efectivo/ }).click();
  await next(page, /Continuar a confirmación/i);
  await expect(page.getByRole('heading', { level: 1, name: 'Confirmación' })).toBeVisible();
  await next(page, /Realizar pedido/);

  await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())!;
  expect(number).toMatch(/^MON-\d{6}$/);
  await expect(page.getByRole('link', { name: 'Seguir mi pedido' })).toHaveAttribute(
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

test('tarjeta rechazada: reintento y cambio a efectivo sin perder el carrito', async ({ page }) => {
  await toCheckout(page);
  await toPayment(page);
  await next(page, /Continuar a confirmación/i);
  await next(page, /Pagar ahora/);

  const dialog = page.getByRole('dialog', { name: 'Pasarela de pago' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Demo / Sin cobro real')).toBeVisible();

  await dialog.getByRole('button', { name: /4000 0000 0000 0002/ }).click();
  await dialog.getByRole('button', { name: /Simular pago/ }).click();
  await expect(dialog.getByText('No se pudo completar el pago')).toBeVisible();
  // Ni el número ni el CVV quedan en pantalla ni en el almacenamiento del navegador.
  await expect(dialog.getByLabel('Número de tarjeta')).toHaveCount(0);
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(storage).not.toContain('4000000000000002');
  expect(storage).not.toContain('4000 0000 0000 0002');
  expect(storage.toLowerCase()).not.toContain('cvv');

  await dialog.getByRole('button', { name: 'Reintentar pago' }).click();
  await expect(dialog.getByLabel('Número de tarjeta')).toBeVisible();
  await dialog.getByRole('button', { name: /4000 0000 0000 0002/ }).click();
  await dialog.getByRole('button', { name: /Simular pago/ }).click();
  await dialog.getByRole('button', { name: 'Cambiar método de pago' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Pago' })).toBeVisible();
  const cart = await page.evaluate(() => localStorage.getItem('monsushi-cart-v2'));
  expect(JSON.parse(cart!).lines).toHaveLength(1);

  await page.getByRole('radio', { name: /Efectivo/ }).click();
  await next(page, /Continuar a confirmación/i);
  await next(page, /Realizar pedido/);
  await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
});

test('tarjeta aprobada: el pedido queda pagado y la pasarela cierra con foco accesible', async ({
  page,
}) => {
  await toCheckout(page);
  await toPayment(page);
  await next(page, /Continuar a confirmación/i);
  await next(page, /Pagar ahora/);

  const dialog = page.getByRole('dialog', { name: 'Pasarela de pago' });
  await dialog.getByRole('button', { name: /Simular pago/ }).click();
  await expect(dialog.getByText('Pago aprobado')).toBeVisible();
  await dialog.getByRole('button', { name: 'Consultar pedido' }).click();
  await expect(page.getByRole('heading', { name: '¡Pedido pagado!' })).toBeVisible();
  await expect(
    page.getByText('Pagado — Pendiente de aceptación del restaurante').first(),
  ).toBeVisible();
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
  test(`la pasarela NeoNet es un diálogo accesible (listo y rechazado) · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
    await toCheckout(page);
    await toPayment(page);
    await next(page, /Continuar a confirmación/i);
    await next(page, /Pagar ahora/);
    const dialog = page.getByRole('dialog', { name: 'Pasarela de pago' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();

    const audit = async () =>
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(await audit()).toEqual([]);

    await dialog.getByRole('button', { name: /4000 0000 0000 0002/ }).click();
    await dialog.getByRole('button', { name: /Simular pago/ }).click();
    await expect(dialog.getByText('No se pudo completar el pago')).toBeVisible();
    expect(await audit()).toEqual([]);

    // Esc cierra y devuelve el foco a la página.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
