import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { seedCheckout, toReview, button } from './support/checkout';

/**
 * F24 · Pagos en EFECTIVO en modo MOCK (datos SIMULADOS, sin red externa): el adaptador responde `/v1/admin/orders/{id}/payment*`
 * con la forma real del contrato. El cobro simulado NUNCA es un cobro real y está rotulado «Simulación». Sesión de DEMOSTRACIÓN
 * (no autoriza nada). Móvil: ver `cash-payments.mobile.spec.ts`.
 *   E2E_PORT=3202 pnpm --filter sushimon-web exec playwright test --project=e2e cash-payments
 */
test.skip(({ isMobile }) => isMobile, 'el móvil tiene su propio archivo');

const ORDER = 'MON-307057'; // PICKUP · sucursal 1 · «Nuevo» · total Q197.00
const ADMIN = /Ana Lucía Pérez/; // administradora: única con payments.read/confirm (P91)
const MANAGER = /Marco Antonio Gómez/;

async function enterAs(
  page: Page,
  profile: RegExp,
  options: { theme?: 'light' | 'dark'; faults?: Record<string, string[]> } = {},
) {
  const { theme = 'light', faults } = options;
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(
    ([t, f]) => {
      localStorage.setItem('monsushi-theme', t!);
      const w = window as unknown as {
        __sushimonMockRequests: string[];
        __sushimonMockFaults?: unknown;
      };
      w.__sushimonMockRequests = [];
      if (f) w.__sushimonMockFaults = JSON.parse(f);
    },
    [theme, faults ? JSON.stringify(faults) : ''],
  );
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
  await page.goto('/backoffice/pedidos');
}

const requests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests,
  );
const cashPosts = async (page: Page) =>
  (await requests(page)).filter((r) => r.startsWith('POST') && r.endsWith('/payment/cash'));

async function openOrder(page: Page, code = ORDER) {
  await expect(page.locator('.kcard', { hasText: `#${code}` })).toBeVisible({ timeout: 90_000 });
  await page.getByText(`#${code}`).first().click();
  const drawer = page.getByRole('dialog', { name: new RegExp(code) });
  const panel = drawer.getByTestId('payment-panel');
  await expect(panel).toBeVisible();
  return { drawer, panel };
}

async function fillModal(page: Page, tendered: string) {
  const modal = page.getByRole('dialog', { name: 'Registrar pago en efectivo' });
  await modal.getByLabel('Efectivo recibido').fill(tendered);
  await modal.getByLabel('Confirmo que recibí físicamente el dinero').check();
  return modal;
}

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  return (await builder.analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

test('registrar cobro: efectivo con cambio, éxito solo tras la respuesta, solo lectura y el pedido NO avanza', async ({
  page,
}) => {
  await enterAs(page, ADMIN);
  const { drawer, panel } = await openOrder(page);
  await expect(panel.getByText('Pago en efectivo', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-payment-status="PENDING"]')).toHaveText('Pago pendiente');
  await expect(panel.getByTestId('payment-due')).toHaveText('Q197.00');
  await expect(panel.getByText('Simulación')).toBeVisible();

  await panel.getByRole('button', { name: 'Registrar pago en efectivo' }).click();
  const modal = page.getByRole('dialog', { name: 'Registrar pago en efectivo' });
  await expect(modal.getByLabel('Efectivo recibido')).toBeFocused();
  await expect(modal.getByRole('button', { name: 'Registrar pago' })).toBeDisabled();
  await fillModal(page, '200');
  await expect(modal.getByTestId('cash-change')).toHaveText('Q3.00');
  expect(await cashPosts(page)).toEqual([]); // el cambio es solo local: sin peticiones por tecla
  await modal.getByRole('button', { name: 'Registrar pago' }).click();

  await expect(
    page.locator('.toast', {
      hasText: 'Pago del pedido MON-307057 registrado. Cambio entregado: Q3.00.',
    }),
  ).toBeVisible();
  await expect(modal).toBeHidden();
  await expect(panel.getByText('Pagado', { exact: true }).first()).toBeVisible();
  await expect(panel.getByTestId('payment-tendered')).toHaveText('Q200.00');
  await expect(panel.getByTestId('payment-change')).toHaveText('Q3.00');
  await expect(panel.getByTestId('payment-outstanding')).toHaveText('Q0.00');
  await expect(panel.getByRole('button', { name: 'Registrar pago en efectivo' })).toHaveCount(0);
  await expect(panel.getByText(/Solo lectura/)).toBeVisible();
  expect(await cashPosts(page)).toHaveLength(1);

  // El historial (payments.read) lista CREATED y CASH_RECEIVED; el estado del pedido sigue «Nuevo».
  await panel.getByText('Historial del pago').click();
  await expect(panel.getByText('Efectivo recibido', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Nuevo', exact: true }).getByText('#MON-307057'),
  ).toBeVisible();
  await expect(
    page.locator('.kcard', { hasText: '#MON-307057' }).getByText('Pagado', { exact: true }),
  ).toBeVisible();
});

test('doble clic en «Registrar pago»: sale UN solo POST y un solo cobro', async ({ page }) => {
  await enterAs(page, ADMIN);
  const { panel } = await openOrder(page);
  await panel.getByRole('button', { name: 'Registrar pago en efectivo' }).click();
  const modal = await fillModal(page, '200');
  await modal.getByRole('button', { name: 'Registrar pago' }).dblclick();
  await expect(modal).toBeHidden();
  expect(await cashPosts(page)).toHaveLength(1);
});

test('409: otra persona ya registró el pago → mensaje, datos actuales y sin cobrar de nuevo', async ({
  page,
}) => {
  await enterAs(page, ADMIN, {
    faults: { [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['payment-already-registered'] },
  });
  const { panel } = await openOrder(page);
  await panel.getByRole('button', { name: 'Registrar pago en efectivo' }).click();
  const modal = await fillModal(page, '200');
  await modal.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(modal.getByRole('alert')).toContainText('Otra persona ya registró este pago');
  await expect(modal.getByRole('alert')).toContainText('por Otra persona');
  await expect(modal.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);
  await modal.getByRole('button', { name: 'Cerrar' }).last().click();
  await expect(panel.getByText('Pagado', { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Registrar pago en efectivo' })).toHaveCount(0);
  expect(await cashPosts(page)).toHaveLength(1);
});

test('respuesta perdida: reintentar usa el MISMO intento y no cobra dos veces', async ({
  page,
}) => {
  await enterAs(page, ADMIN, {
    faults: { [`POST /v1/admin/orders/${ORDER}/payment/cash`]: ['lost-response'] },
  });
  const { panel } = await openOrder(page);
  await panel.getByRole('button', { name: 'Registrar pago en efectivo' }).click();
  const modal = await fillModal(page, '200');
  await modal.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(modal.getByTestId('cash-error')).toContainText('no sabemos si el cobro se registró');
  await expect(page.locator('.toast', { hasText: 'registrado. Cambio' })).toHaveCount(0);
  await modal.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(
    page.locator('.toast', { hasText: 'ya estaba registrado por ti (pedido MON-307057)' }),
  ).toBeVisible();
  await expect(panel.getByText('Pagado', { exact: true }).first()).toBeVisible();
});

test('sin permiso (encargado): no hay botón de cobro y se explica; el tablero muestra la insignia de pago', async ({
  page,
}) => {
  await enterAs(page, MANAGER);
  const { panel } = await openOrder(page);
  await expect(panel.getByRole('button', { name: 'Registrar pago en efectivo' })).toHaveCount(0);
  await expect(
    panel.getByText('No tienes permiso para registrar pagos en esta sucursal.'),
  ).toBeVisible();
  expect((await requests(page)).some((r) => r.includes('/payment'))).toBe(false);
});

for (const theme of ['light', 'dark'] as const) {
  test(`accesibilidad: panel y modal sin violaciones graves; Esc cierra y devuelve el foco · ${theme}`, async ({
    page,
  }) => {
    await enterAs(page, ADMIN, { theme });
    const { panel } = await openOrder(page);
    expect(await axe(page, '[data-testid="payment-panel"]')).toEqual([]);
    const trigger = panel.getByRole('button', { name: 'Registrar pago en efectivo' });
    await trigger.click();
    const modal = page.getByRole('dialog', { name: 'Registrar pago en efectivo' });
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
    // Error de campo visible y asociado (aria-describedby / aria-invalid).
    await modal.getByLabel('Efectivo recibido').fill('100');
    await modal.getByLabel('Efectivo recibido').blur();
    await expect(modal.getByText('Faltan Q97.00 para cubrir el total.').first()).toBeVisible();
    await expect(modal.getByLabel('Efectivo recibido')).toHaveAttribute('aria-invalid', 'true');
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('punta a punta: pedido en efectivo → recibo PENDIENTE → cobro en el backoffice → recibo y seguimiento PAGADOS (sin empleado)', async ({
  page,
}) => {
  // 1) El cliente pide en efectivo (solo método) y ve el pago pendiente.
  await seedCheckout(page);
  await toReview(page);
  await button(page, /Realizar pedido/).click();
  await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())!;
  const tracking = await page
    .getByRole('link', { name: 'Ver estado de mi pedido' })
    .getAttribute('href');
  const id = /\/pedidos\/([0-9a-f-]{36})\/seguimiento/.exec(tracking!)![1]!;

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.goto(`/pedidos/${id}/recibo`);
  await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('receipt-payment')).toContainText('Pago en efectivo: Pendiente');
  await expect(page.getByTestId('receipt')).not.toContainText(/efectivo recibido|cambio/i);

  // 2) El personal registra el cobro (misma pestaña: el almacén simulado vive en la sesión).
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: ADMIN }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
  await page.goto('/backoffice/pedidos');
  const { panel } = await openOrder(page, number);
  await panel.getByRole('button', { name: 'Registrar pago en efectivo' }).click();
  const modal = page.getByRole('dialog', { name: 'Registrar pago en efectivo' });
  const due = (await modal.getByTestId('cash-due').textContent())!;
  expect(due).toMatch(/^Q\d+\.\d{2}$/);
  await modal.getByLabel('Efectivo recibido').fill('500');
  await modal.getByLabel('Confirmo que recibí físicamente el dinero').check();
  await modal.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(modal).toBeHidden();
  await expect(panel.getByText('Pagado', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  // 3) El cliente ve el pago REAL en el recibo (con importes) y en el seguimiento (sin importes), sin identidad del empleado.
  await page.goto(`/pedidos/${id}/recibo`);
  await expect(page.getByTestId('receipt-payment')).toContainText('Pago en efectivo: Pagado', {
    timeout: 60_000,
  });
  const rows = page.getByTestId('payment-receipt');
  await expect(rows).toContainText('Importe pagado');
  await expect(rows).toContainText('Q500.00');
  await expect(rows).toContainText('Cambio');
  await expect(page.getByTestId('receipt')).not.toContainText(/Ana Luc|empleado|recibido por/i);
  await page.goto(`/pedidos/${id}/seguimiento`);
  await expect(page.getByTestId('payment-status')).toHaveAttribute('data-payment-status', 'PAID', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('payment-receipt')).toHaveCount(0);
  // El estado operativo sigue «recibido»: pagar no acepta ni entrega.
  await expect(page.getByTestId('status-label')).toHaveText('Pedido recibido');
});

test('en inglés: el paso Pago dice «Cash» con la instrucción del retiro', async ({ page }) => {
  await seedCheckout(page, { locale: 'en' });
  for (const step of ['Delivery info', 'Shipping', 'Payment']) {
    await button(page, /Continue to/i).click();
    await expect(page.getByRole('heading', { level: 1, name: step })).toBeVisible();
  }
  await expect(page.getByTestId('payment-instructions')).toHaveText(
    'Pay in cash when you pick up your order at the branch.',
  );
  await expect(page.locator('body')).not.toContainText(/transfer|card|neonet/i);
});
