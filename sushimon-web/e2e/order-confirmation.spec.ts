import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  button,
  cartLines,
  next,
  orderPosts,
  placedOrders,
  seedCheckout,
  toReview,
} from './support/checkout';

/**
 * F20 · Confirmación del pedido contra el mock RETULADO como simulación (sin red externa): pickup y delivery OWN, doble clic,
 * error de red con reintento de la MISMA clave, QUOTE_CHANGED, carrito conservado en error y limpio en éxito, recarga de
 * `/pedidos/[id]`, axe claro/oscuro y es/en. (La confirmación REAL contra la API se verifica aparte con la API levantada.)
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3220 pnpm exec playwright test --project=e2e order-confirmation
 */
const audit = async (page: Page, scope?: string) => {
  const axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (scope) axe.include(scope);
  return (await axe.analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
};

const placedHeading = (page: Page) => page.getByRole('heading', { name: '¡Pedido registrado!' });

test('recoger: confirma un pedido SIMULADO, el carrito queda limpio y el número es MON-000000', async ({
  page,
}) => {
  await seedCheckout(page);
  await toReview(page);
  await expect(page.getByText(/Simulación/).first()).toBeVisible();
  expect(await cartLines(page)).toBe(1);
  await button(page, /Realizar pedido/).click();
  await expect(placedHeading(page)).toBeVisible();
  await expect(page.getByTestId('order-number')).toHaveText(/^MON-\d{6}$/);
  expect(await cartLines(page)).toBe(0);
  expect(await orderPosts(page)).toBe(1);
  expect(await placedOrders(page)).toBe(1);
});

test('entrega propia: confirma con la dirección y la tarifa del servidor', async ({ page }) => {
  await seedCheckout(page, { mode: 'delivery' });
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  await expect(placedHeading(page)).toBeVisible();
  expect(await placedOrders(page)).toBe(1);
  await page.getByRole('link', { name: 'Ver detalle del pedido' }).click();
  await expect(page.getByText(/Q121\.00/).first()).toBeVisible();
});

test('doble clic en «Realizar pedido»: UN solo POST y UN solo pedido', async ({ page }) => {
  await seedCheckout(page);
  await toReview(page);
  await button(page, /Realizar pedido/).dblclick();
  await expect(placedHeading(page)).toBeVisible();
  expect(await orderPosts(page)).toBe(1);
  expect(await placedOrders(page)).toBe(1);
});

test('red caída tras el commit: reintenta con la MISMA clave y no duplica el pedido', async ({
  page,
}) => {
  await seedCheckout(page, { faults: { 'POST /v1/orders': ['lost-response'] } });
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  await expect(page.getByTestId('placing')).toBeVisible();
  await expect(placedHeading(page)).toBeVisible({ timeout: 15_000 });
  expect(await orderPosts(page)).toBe(2);
  expect(await placedOrders(page)).toBe(1);
});

test('QUOTE_CHANGED: alertdialog con el nuevo total, exige re-aceptación y el carrito se conserva hasta el éxito', async ({
  page,
}) => {
  await seedCheckout(page, { faults: { 'POST /v1/orders': ['price-change'] } });
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  const dialog = page.getByRole('alertdialog', { name: 'El total de tu pedido cambió' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('changed-total')).toContainText('Q108.00');
  expect(await cartLines(page)).toBe(1);
  expect(await orderPosts(page)).toBe(1);
  expect(await placedOrders(page)).toBe(0);
  // El diálogo modal (el resto de la página queda inerte detrás).
  expect(await audit(page, '[role="alertdialog"]')).toEqual([]);
  await dialog.getByRole('button', { name: 'Aceptar y confirmar' }).click();
  await expect(placedHeading(page)).toBeVisible();
  expect(await orderPosts(page)).toBe(2);
  expect(await placedOrders(page)).toBe(1);
  expect(await cartLines(page)).toBe(0);
});

test('error del servidor (503 ORDERS_UNAVAILABLE): mensaje claro, sin reintento automático y el carrito se conserva; luego éxito limpia', async ({
  page,
}) => {
  await seedCheckout(page, { faults: { 'POST /v1/orders': ['unavailable'] } });
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  await expect(page.getByText(/No podemos recibir pedidos ahora/)).toBeVisible();
  expect(await cartLines(page)).toBe(1);
  expect(await orderPosts(page)).toBe(1);
  expect(await audit(page)).toEqual([]);
  await button(page, /Realizar pedido/).click();
  await expect(placedHeading(page)).toBeVisible();
  expect(await cartLines(page)).toBe(0);
});

test('recarga de /pedidos/[id]: el seguimiento simulado sigue disponible', async ({ page }) => {
  await seedCheckout(page);
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  await expect(placedHeading(page)).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())!;
  await page.getByRole('link', { name: 'Ver detalle del pedido' }).click();
  await page.waitForURL(`**/pedidos/${number}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe en la confirmación (revisión y pedido registrado) · ${theme}`, async ({ page }) => {
    await seedCheckout(page, { theme });
    await toReview(page);
    expect(await audit(page)).toEqual([]);
    await button(page, /Realizar pedido/).click();
    await expect(placedHeading(page)).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });
}

test('en inglés: la confirmación y el cuadro de cambio de total se traducen', async ({ page }) => {
  await seedCheckout(page, { locale: 'en', faults: { 'POST /v1/orders': ['price-change'] } });
  for (const step of ['Delivery info', 'Shipping', 'Payment']) {
    await button(page, /Continue to/i).click();
    await expect(page.getByRole('heading', { level: 1, name: step })).toBeVisible();
  }
  await page.getByRole('radio', { name: /Cash/ }).click();
  await button(page, /Continue to/i).click();
  await button(page, /Place order/).click();
  await expect(page.getByRole('alertdialog', { name: 'Your order total changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept and confirm' }).click();
  await expect(page.getByRole('heading', { name: /Order placed|registered/i })).toBeVisible();
});

test('sin cotización lista, «Realizar pedido» no envía', async ({ page }) => {
  await seedCheckout(page);
  await next(page, 'Entrega');
  await next(page, 'Envío');
  await expect(button(page, /Continuar a pago/i)).toBeEnabled();
  expect(await orderPosts(page)).toBe(0);
});
