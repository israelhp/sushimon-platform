import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { DUMPLINGS, cartV2, pickupMode } from './support/cart';

/**
 * F19 · Cotización de checkout contra el mock RETULADO como simulación (sin red externa): recoger y entrega propia, PedidosYa
 * `UNKNOWN`, cupón, carrera al cambiar la zona rápido (la última manda), axe en claro y oscuro. El paso final sigue siendo la
 * confirmación simulada. (La paridad contra la API real http se verifica aparte, con la API levantada.)
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3210 pnpm exec playwright test --project=e2e checkout-quote
 */
const deliveryMode = (branchId: string) =>
  JSON.stringify({ type: 'delivery', when: { kind: 'now' }, branchId, address: null });

async function seed(page: Page, mode: 'pickup' | 'delivery', theme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(
    ([cart, orderMode, t]) => {
      localStorage.setItem('monsushi-theme', t!);
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('monsushi-cart-v2', cart!);
        localStorage.setItem('monsushi-order-mode-v1', orderMode!);
      }
    },
    [
      cartV2('sucursal-1', [{ ...DUMPLINGS, quantity: 2 }]),
      mode === 'pickup' ? pickupMode('sucursal-1') : deliveryMode('sucursal-1'),
      theme,
    ],
  );
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { level: 1, name: 'Tu pedido' })).toBeVisible({
    timeout: 90_000,
  });
}

const button = (page: Page, name: RegExp) =>
  page.getByRole('button', { name }).filter({ visible: true }).first();

async function next(page: Page, step: string) {
  const b = button(page, new RegExp(`Continuar a ${step}`, 'i'));
  await expect(b).toBeEnabled();
  await b.click();
  await expect(page.getByRole('heading', { level: 1, name: step })).toBeVisible();
}

const summary = (page: Page) =>
  page.getByRole('region', { name: /Resumen/i }).filter({ visible: true });

const audit = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

for (const theme of ['light', 'dark'] as const) {
  test(`recoger: «Continuar» espera la cotización, importes del servidor, rótulo «Simulación» y axe · ${theme}`, async ({
    page,
  }) => {
    await seed(page, 'pickup', theme);
    await next(page, 'Entrega');
    await next(page, 'Envío');
    const panel = summary(page);
    await expect(panel.getByText('Simulación').first()).toBeVisible();
    await expect(panel.getByTestId('summary-subtotal')).toHaveText('Q106.00');
    await expect(panel.getByTestId('summary-fee')).toHaveText('Sin costo');
    await expect(panel.getByTestId('summary-total')).toHaveText('Q106.00');
    await expect(button(page, /Continuar a pago/i)).toBeEnabled();
    expect(await audit(page)).toEqual([]);
    await next(page, 'Pago');
  });
}

test('entrega propia: tarifa del servidor, PedidosYa «Por verificar» sin tarifa y no seleccionable, total con envío', async ({
  page,
}) => {
  await seed(page, 'delivery');
  await next(page, 'Entrega');
  await next(page, 'Envío');
  const own = page.getByRole('radio', { name: /Entrega propia/ });
  const py = page.getByRole('radio', { name: /PedidosYa/ });
  await expect(own).toBeChecked();
  await expect(page.getByTestId('shipping-fee')).toHaveText('Tarifa: Q15.00');
  await expect(py).toBeDisabled();
  await expect(py).toHaveAttribute('data-status', 'unknown');
  await expect(py).toHaveAccessibleName(/Por verificar/);
  await expect(py).not.toHaveAccessibleName(/Tarifa/);
  const panel = summary(page);
  await expect(panel.getByTestId('summary-fee')).toHaveText('Q15.00');
  await expect(panel.getByTestId('summary-total')).toHaveText('Q121.00');
  await expect(button(page, /Continuar a pago/i)).toBeEnabled();
  expect(await audit(page)).toEqual([]);
  // PedidosYa no cambia nada al pulsarlo.
  await py.click({ force: true });
  await expect(own).toBeChecked();
});

test('recalcular (volver a la pestaña) no pierde el foco del radio de proveedor ni vacía la UI', async ({
  page,
}) => {
  await seed(page, 'delivery');
  await next(page, 'Entrega');
  await next(page, 'Envío');
  const own = page.getByRole('radio', { name: /Entrega propia/ });
  await expect(own).toBeChecked();
  await own.focus();
  // Volver a la pestaña refresca la cotización en Envío (en Pago/Confirmación no).
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(own).toBeFocused();
  await expect(page.getByTestId('summary-total').filter({ visible: true }).first()).toBeVisible();
  await expect(button(page, /Continuar a pago/i)).toBeEnabled();
  await expect(own).toBeFocused();
});

test('bloqueo (entrega sin cobertura verificable): botón aria-disabled con motivo, el foco va al bloqueo, recoger sigue disponible y axe', async ({
  page,
}) => {
  await seed(page, 'delivery');
  await next(page, 'Entrega');
  await page.locator('#paso-actual').getByRole('button', { name: 'Cambiar' }).nth(1).click();
  await page.getByLabel('Municipio').selectOption({ label: 'Palencia' });
  await next(page, 'Envío');
  const alert = page.getByRole('alert').filter({ hasText: 'No pudimos verificar la entrega' });
  await expect(alert).toBeVisible();
  const pay = button(page, /Continuar a pago/i);
  await expect(pay).toHaveAttribute('aria-disabled', 'true');
  await expect(pay).toHaveAccessibleDescription(/Hay un problema con tu pedido/);
  expect(await audit(page)).toEqual([]);
  await pay.click({ force: true });
  await expect(alert).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'Envío' })).toBeVisible();
  // Un bloqueo de a domicilio no bloquea recoger.
  await page.getByRole('button', { name: 'Recoger en sucursal' }).click();
  await expect(pay).not.toHaveAttribute('aria-disabled', 'true');
});

test('cupón: un mensaje genérico si no aplica y el descuento del servidor si aplica', async ({
  page,
}) => {
  await seed(page, 'pickup');
  await next(page, 'Entrega');
  await next(page, 'Envío');
  const input = page.getByLabel(/Cupón de descuento/);
  await input.fill('NOEXISTE');
  // Escribir no cotiza ni marca error: solo «Aplicar».
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Este cupón no es válido para tu pedido.')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(button(page, /Continuar a pago/i)).toBeEnabled();
  await page.getByRole('button', { name: 'Quitar' }).click();
  await input.fill('bienvenido10');
  await input.press('Enter');
  await expect(page.getByText('Cupón aplicado.', { exact: true })).toBeVisible();
  const panel = summary(page);
  await expect(panel.getByTestId('summary-discount')).toHaveText('−Q10.60');
  await expect(panel.getByTestId('summary-total')).toHaveText('Q95.40');
});

test('carrera al cambiar la zona rápido: la última manda (tarifa de la zona final)', async ({
  page,
}) => {
  await seed(page, 'delivery');
  await next(page, 'Entrega');
  // La dirección demo está resumida: «Cambiar» (segundo) abre el formulario.
  await page.locator('#paso-actual').getByRole('button', { name: 'Cambiar' }).nth(1).click();
  const zone = page.getByLabel('Zona', { exact: true });
  await zone.selectOption('2'); // Q20
  await zone.selectOption('19'); // Q30 (la última)
  await next(page, 'Envío');
  await expect(page.getByTestId('shipping-fee')).toHaveText('Tarifa: Q30.00');
  await expect(summary(page).getByTestId('summary-fee')).toHaveText('Q30.00');
  await expect(summary(page).getByTestId('summary-total')).toHaveText('Q136.00');
});

test('el paso final sigue SIMULADO: confirma un pedido de demostración sin cobro real', async ({
  page,
}) => {
  await seed(page, 'pickup');
  for (const step of ['Entrega', 'Envío', 'Pago']) await next(page, step);
  await next(page, 'Confirmación');
  await button(page, /Realizar pedido/).click();
  await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
});
