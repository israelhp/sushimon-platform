import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { button, seedCheckout, toReview } from './support/checkout';

/**
 * F21 · Seguimiento del pedido (`/pedidos/[id]/seguimiento`) con el MOCK rotulado como simulación (sin red externa): confirmar el
 * pedido → «Ver estado de mi pedido» → fases, historial real y avance simulado hasta terminal; acceso perdido en otra pestaña; axe
 * claro/oscuro; es/en. (El seguimiento REAL contra la API se verifica aparte con la API levantada.)
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3221 pnpm exec playwright test --project=e2e order-tracking
 */
const audit = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

const SEGUIMIENTO = /\/pedidos\/[0-9a-f-]{36}\/seguimiento$/;

async function openTracking(page: Page, options: Parameters<typeof seedCheckout>[1] = {}) {
  await seedCheckout(page, options);
  if (options.locale === 'en') {
    for (const step of ['Delivery info', 'Shipping', 'Payment']) {
      await button(page, /Continue to/i).click();
      await expect(page.getByRole('heading', { level: 1, name: step })).toBeVisible();
    }
    await page.getByRole('radio', { name: /Cash/ }).click();
    await button(page, /Continue to/i).click();
    await button(page, /Place order/).click();
    await expect(page.getByRole('heading', { name: /Order placed|registered/i })).toBeVisible();
  } else {
    await toReview(page);
    await button(page, /Realizar pedido/).click();
    await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
  }
  await page.getByTestId('view-tracking').click();
  await page.waitForURL(SEGUIMIENTO);
  await expect(page.getByTestId('order-tracking')).toBeVisible();
}

test('confirmar → «Ver estado de mi pedido» → seguimiento con avance simulado hasta «Recogido»', async ({
  page,
}) => {
  await openTracking(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Número de pedido: MON-\d{6}$/);
  await expect(page.getByTestId('status-label')).toHaveText('Pedido recibido');
  await expect(page.getByText('Simulación').first()).toBeVisible();
  // El token nunca viaja en la URL.
  expect(page.url()).not.toContain('smo_');
  const phases = page.getByTestId('phases').getByRole('listitem');
  await expect(phases).toHaveCount(5);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByTestId('timeline-event')).toHaveCount(1);

  const advance = page.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
  for (const label of ['Aceptado por la sucursal', 'En preparación', 'Listo para recoger']) {
    await advance.click();
    await expect(page.getByTestId('status-label')).toHaveText(label);
  }
  await advance.click();
  await expect(page.getByTestId('status-label')).toHaveText('Recogido');
  await expect(advance).toHaveCount(0);
  await expect(page.getByTestId('timeline-event')).toHaveCount(5);
  await expect(page.getByTestId('phase-time')).toHaveCount(5);
  // El estado terminal detiene el polling: ninguna solicitud de seguimiento más.
  const count = () =>
    page.evaluate(
      () =>
        (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests.filter(
          (r) => r.endsWith('/tracking'),
        ).length,
    );
  const before = await count();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  expect(await count()).toBe(before);
  // Vuelve al detalle de F20.
  await page.getByRole('link', { name: 'Ver detalle del pedido' }).click();
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/);
});

test('el seguimiento anuncia el cambio en UNA región aria-live y no roba el foco', async ({
  page,
}) => {
  await openTracking(page);
  const root = page.getByTestId('order-tracking');
  expect(await root.locator('[aria-live], [role="status"], [role="alert"]').count()).toBe(1);
  await expect(page.getByTestId('live')).toHaveText('');
  const advance = page.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
  await advance.focus();
  await advance.press('Enter'); // teclado completo
  await expect(page.getByTestId('live')).toHaveText(
    'El estado de tu pedido cambió: Aceptado por la sucursal.',
  );
  await expect(advance).toBeFocused();
});

test('otra pestaña o dispositivo (sin credencial): «Se perdió el acceso a este pedido», sin datos', async ({
  page,
  context,
}) => {
  await openTracking(page);
  const url = page.url();
  const other = await context.newPage(); // nuevo `sessionStorage`: sin credencial ni pedido
  await other.goto(url);
  await expect(
    other.getByRole('heading', { name: 'Se perdió el acceso a este pedido' }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(other.getByTestId('status-label')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe en el seguimiento (en curso y terminal) · ${theme}`, async ({ page }) => {
    await openTracking(page, { theme });
    expect(await audit(page)).toEqual([]);
    const advance = page.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
    for (let i = 0; i < 4; i++) await advance.click();
    await expect(page.getByTestId('status-label')).toHaveText('Recogido');
    expect(await audit(page)).toEqual([]);
  });
}

test('en inglés: el seguimiento se traduce', async ({ page }) => {
  await openTracking(page, { locale: 'en' });
  await expect(page.getByTestId('status-label')).toHaveText('Order received');
  await expect(page.getByRole('heading', { name: 'Order progress' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View order details' })).toBeVisible();
});

test('entrega propia: «En camino» sin repartidor ni hora estimada', async ({ page }) => {
  await openTracking(page, { mode: 'delivery' });
  const advance = page.getByRole('button', { name: /siguiente estado|next status/i });
  for (const label of ['Aceptado por la sucursal', 'En preparación', 'Listo, esperando entrega']) {
    await advance.click();
    await expect(page.getByTestId('status-label')).toHaveText(label);
  }
  await advance.click();
  await expect(page.getByTestId('status-label')).toHaveText('En camino');
  const text = (await page.getByTestId('order-tracking').textContent()) ?? '';
  expect(text).not.toMatch(/llega en|aprox\./i);
  await expect(page.getByTestId('fulfillment-note')).toHaveText(
    'Entrega a domicilio por la sucursal',
  );
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe con el último estado atenuado (sin conexión) y recuperación anunciada · ${theme}`, async ({
    page,
  }) => {
    await openTracking(page, { theme });
    const id = /pedidos\/([0-9a-f-]{36})\//.exec(page.url())![1]!;
    // El siguiente refresco (provocado por el avance simulado) pierde la red: queda el último estado, atenuado, con aviso.
    await page.evaluate((route) => {
      (
        window as unknown as { __sushimonMockFaults: Record<string, string[]> }
      ).__sushimonMockFaults = { [route]: ['offline'] };
    }, `GET /v1/orders/${id}/tracking`);
    await page.getByRole('button', { name: 'Ver siguiente estado (simulación)' }).click();
    await expect(page.getByTestId('conn-message')).toContainText('Sin conexión');
    await expect(page.getByTestId('live')).toContainText('Sin conexión');
    await expect(page.locator('[data-stale="true"]')).toHaveCount(1);
    await expect(page.getByTestId('status-label')).toHaveText('Pedido recibido');
    expect(await audit(page)).toEqual([]);
    // Al volver la red se actualiza, se anuncia UNA vez y el aviso (contenedor estable) se oculta.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('status-label')).toHaveText('Aceptado por la sucursal');
    await expect(page.getByTestId('conn-notice')).toBeHidden();
    await expect(page.locator('[data-stale="true"]')).toHaveCount(0);
  });
}
