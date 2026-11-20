import { expect, test } from '@playwright/test';
import { CART_KEY, DUMPLINGS, cartV2 } from './support/cart';
import { button, cartLines, seedCheckout, toReview } from './support/checkout';
import {
  DEMO_ACTIVE,
  DEMO_HISTORY,
  DEMO_PICKUP,
  axeBlocking,
  openHistory,
  requests,
  seedHistory,
} from './support/history';

/**
 * F23 · Historial, recibo imprimible y «Volver a pedir» contra el mock RETULADO como simulación (sin red externa).
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3230 pnpm exec playwright test --project=e2e order-history
 */
test.describe.configure({ timeout: 120_000 });

test.describe('Mis pedidos', () => {
  test('lista real paginada: en curso e historial desde el servidor, sin /v1/demo, con acciones y alias /mis-pedidos', async ({
    page,
  }) => {
    await seedHistory(page);
    await page.goto('/mis-pedidos');
    await expect(page).toHaveURL(/\/cuenta\/pedidos$/);
    await expect(page.getByTestId('history-row')).toHaveCount(1, { timeout: 60_000 });
    const active = page.getByTestId('history-row').first();
    await expect(active).toContainText('MON-490217');
    await expect(active.getByRole('link', { name: /Seguimiento: MON-490217/ })).toHaveAttribute(
      'href',
      `/pedidos/${DEMO_ACTIVE}/seguimiento`,
    );
    await page.getByRole('tab', { name: 'Historial' }).click();
    await expect(page.getByTestId('history-row')).toHaveCount(2);
    await expect(page.getByTestId('history-row').first()).toContainText('MON-482193');
    // Terminal: sin «Seguimiento».
    await expect(page.getByRole('link', { name: /Seguimiento: MON-482193/ })).toHaveCount(0);
    // Sin resumen «pedidos / gastado» y solo la ruta real.
    await expect(page.getByText('Total en pedidos')).toHaveCount(0);
    const calls = (await requests(page)).filter((r) => r.includes('/orders'));
    expect(
      calls.some((r) => r.startsWith('GET /v1/me/orders?') && r.includes('status=pending')),
    ).toBe(true);
    expect(calls.some((r) => r.includes('status=delivered'))).toBe(true);
    expect(calls.some((r) => r.includes('/v1/demo'))).toBe(false);
  });

  test('filtros de sucursal y fechas viajan al servidor; vacío con filtros y «Quitar filtros»', async ({
    page,
  }) => {
    await seedHistory(page);
    await openHistory(page);
    await page.getByLabel('Sucursal').selectOption('sucursal-2');
    await expect(page.getByText('No hay pedidos con estos filtros.')).toBeVisible();
    expect((await requests(page)).some((r) => r.includes('branchId=sucursal-2'))).toBe(true);
    await page.getByRole('button', { name: 'Quitar filtros' }).first().click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await page.getByLabel('Desde').fill('2026-11-10');
    await page.getByLabel('Hasta').fill('2026-11-01');
    await expect(page.getByText(/anterior o igual a la final/)).toBeVisible();
  });

  test('sin sesión: invitación a iniciar sesión y ninguna solicitud de pedidos', async ({
    page,
  }) => {
    await seedHistory(page, { signedIn: false });
    await page.goto('/cuenta/pedidos');
    await expect(page.getByRole('heading', { name: /sesión para usar esta sección/ })).toBeVisible({
      timeout: 90_000,
    });
    expect((await requests(page)).filter((r) => r.includes('/orders'))).toEqual([]);
  });

  test('error 503 con «Reintentar»; luego carga', async ({ page }) => {
    await seedHistory(page, { faults: { 'GET /v1/me/orders': ['busy'] } });
    await page.goto('/cuenta/pedidos');
    const alert = page.getByRole('tabpanel').getByRole('alert');
    await expect(alert).toContainText('El servicio está ocupado', { timeout: 90_000 });
    await alert.getByRole('button', { name: /Reintentar/ }).click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('cerrar sesión descarta la lista y conserva el carrito anónimo', async ({ page }) => {
    await seedHistory(page, { cart: cartV2('sucursal-1', [DUMPLINGS]) });
    await page.goto('/cuenta');
    await page.getByRole('link', { name: /Mis pedidos/ }).click();
    await expect(page.getByTestId('history-row')).toHaveCount(1, { timeout: 60_000 });
    await page.locator('#contenido').getByRole('link', { name: 'Mi cuenta' }).click();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.goto('/cuenta/pedidos');
    await expect(page.getByRole('heading', { name: /sesión para usar esta sección/ })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId('history-row')).toHaveCount(0);
    expect(await cartLines(page)).toBe(1);
  });

  test('Mi cuenta no consulta pedidos al abrirse', async ({ page }) => {
    await seedHistory(page);
    await page.goto('/cuenta');
    await expect(page.getByRole('link', { name: /Mis pedidos/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('link', { name: /Mis pedidos/ })).toContainText('recibos');
    expect((await requests(page)).filter((r) => r.includes('/me/orders'))).toEqual([]);
  });
});

test.describe('Detalle y recibo', () => {
  test('detalle histórico con seguimiento, «Ver recibo» y «Volver a pedir»; el recibo se imprime solo desde el botón', async ({
    page,
  }) => {
    await seedHistory(page, { stubPrint: true });
    await openHistory(page, 'Historial');
    await page.getByRole('link', { name: /Ver detalle: MON-482193/ }).click();
    await expect(page).toHaveURL(new RegExp(`/pedidos/${DEMO_PICKUP}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Detalle de tu pedido' })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    await expect(page.getByTestId('order-status')).toHaveText('Recogido');
    await expect(page.getByTestId('view-tracking')).toHaveAttribute(
      'href',
      `/pedidos/${DEMO_PICKUP}/seguimiento`,
    );
    await page.getByTestId('view-receipt').click();
    await expect(page).toHaveURL(new RegExp(`/pedidos/${DEMO_PICKUP}/recibo$`));
    const receipt = page.getByTestId('receipt');
    await expect(receipt).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('receipt-number')).toHaveText('MON-482193');
    await expect(page).toHaveTitle('Recibo MON-482193');
    await expect(page.getByTestId('receipt-legend')).toHaveText(
      'Este documento es un recibo informativo del pedido. No es una factura ni un documento fiscal.',
    );
    // F24: el pago en efectivo REAL (pendiente: sin textos de dinero recibido).
    await expect(page.getByTestId('receipt-payment')).toContainText('Pago en efectivo: Pendiente');
    await expect(receipt).not.toContainText(/pagado|NIT|FEL/);
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      0,
    );
    await page.getByTestId('print-receipt').click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(
      1,
    );
  });

  test('hoja de impresión: se ocultan encabezado, navegación y botones; la leyenda permanece y el fondo es blanco (también en oscuro)', async ({
    page,
  }) => {
    await seedHistory(page, { theme: 'dark' });
    await page.goto(`/pedidos/${DEMO_PICKUP}/recibo`);
    await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 90_000 });
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    await expect(page.locator('header').first()).toBeHidden();
    await expect(page.locator('footer').first()).toBeHidden();
    await expect(page.getByTestId('print-receipt')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Volver al pedido' })).toBeHidden();
    await expect(page.getByTestId('receipt-legend')).toBeVisible();
    await expect(page.getByTestId('receipt-total')).toBeVisible();
    // Barra móvil inferior, avisos y capas fijas tampoco se imprimen.
    const fixedVisible = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-zone="store"] .fixed')].filter(
          (e) => getComputedStyle(e).display !== 'none',
        ).length,
    );
    expect(fixedVisible).toBe(0);
    const colors = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="receipt"]') as HTMLElement;
      return [getComputedStyle(root).color, getComputedStyle(document.body).backgroundColor];
    });
    expect(colors[0]).toBe('rgb(0, 0, 0)');
    expect(colors[1]).toBe('rgb(255, 255, 255)');
    // El navegador genera un PDF del documento (verifica que la hoja de impresión no revienta).
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  test('error 429 del recibo: espera y no se pinta un estado del pedido', async ({ page }) => {
    await seedHistory(page, {
      faults: { [`GET /v1/orders/${DEMO_PICKUP}/receipt`]: ['rate-limited'] },
    });
    await page.goto(`/pedidos/${DEMO_PICKUP}/recibo`);
    await expect(page.locator('#contenido').getByRole('alert')).toContainText(
      'demasiadas consultas',
      {
        timeout: 90_000,
      },
    );
    await expect(page.getByTestId('receipt')).toHaveCount(0);
    await expect(page.locator('#contenido').getByRole('alert').getByRole('button')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('pedido de invitado: la credencial vive solo en sessionStorage y el recibo se abre sin token en la URL', async ({
    page,
  }) => {
    await seedCheckout(page);
    await toReview(page);
    await button(page, /Realizar pedido/).click();
    await expect(page.getByRole('heading', { name: '¡Pedido registrado!' })).toBeVisible();
    await page.getByTestId('view-tracking').click();
    await page.waitForURL(/\/seguimiento$/);
    const orderId = page.url().split('/pedidos/')[1]!.split('/')[0]!;
    await page.goto(`/pedidos/${orderId}`);
    await page.getByTestId('view-receipt').click({ timeout: 90_000 });
    await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
    expect(page.url()).not.toContain('smo_');
    expect((await requests(page)).some((r) => r.includes('smo_'))).toBe(false);
    expect(
      await page.evaluate(() => localStorage.getItem('monsushi-order-' + location.pathname)),
    ).toBeNull();
    const storage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    expect(storage).not.toContain('smo_');
  });
});

test.describe('Volver a pedir', () => {
  test('revisa contra el catálogo (retirado y precio cambiado), añade solo lo válido, abre el carrito y nunca crea pedidos', async ({
    page,
  }) => {
    await seedHistory(page);
    await openHistory(page, 'Historial');
    await page.getByRole('button', { name: 'Volver a pedir: MON-479850' }).click();
    const dialog = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(dialog.getByTestId('group-AVAILABLE')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByTestId('price-change')).toContainText('Antes Q42.00 → ahora Q46.00');
    await expect(dialog.getByTestId('group-UNAVAILABLE')).toContainText('Roll de Temporada');
    await expect(dialog.getByTestId('group-UNAVAILABLE')).toContainText('ya no se vende');
    await dialog.getByRole('button', { name: 'Añadir al carrito' }).click();
    await expect(page.getByRole('dialog', { name: 'Tu pedido' })).toBeVisible();
    expect(await cartLines(page)).toBe(3);
    const calls = await requests(page);
    expect(calls.filter((r) => r === 'POST /v1/orders')).toEqual([]);
    expect(calls.some((r) => r.includes('/checkout/quote'))).toBe(false);
    expect(calls.filter((r) => r.endsWith('/reorder-preview'))).toHaveLength(1);
    // El carrito conserva las líneas al llegar al checkout.
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { level: 1, name: 'Tu pedido' })).toBeVisible({
      timeout: 90_000,
    });
    expect(await cartLines(page)).toBe(3);
  });

  test('carrito de otra sucursal: explica y solo ofrece reemplazar con confirmación; cancelar lo deja intacto', async ({
    page,
  }) => {
    await seedHistory(page, { cart: cartV2('sucursal-2', [DUMPLINGS]), modeBranch: 'sucursal-2' });
    await openHistory(page, 'Historial');
    await page.getByRole('button', { name: 'Volver a pedir: MON-479850' }).click();
    const dialog = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(dialog.getByTestId('cart-other-branch')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('button', { name: 'Añadir al carrito' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Reemplazar mi carrito' }).click();
    await expect(dialog.getByTestId('replace-confirm')).toContainText(
      'Se quitará 1 producto de tu carrito.',
    );
    await dialog.getByRole('button', { name: 'Volver' }).click();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    const cart = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), CART_KEY);
    expect(cart.branchId).toBe('sucursal-2');
    expect(cart.lines).toHaveLength(1);
  });

  test('pedido en curso: pide confirmar «¿Pedir otro igual?» antes de consultar', async ({
    page,
  }) => {
    await seedHistory(page);
    await openHistory(page);
    await page.getByRole('button', { name: 'Volver a pedir: MON-490217' }).click();
    const dialog = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(dialog.getByText('Este pedido sigue en curso. ¿Pedir otro igual?')).toBeVisible();
    expect((await requests(page)).filter((r) => r.endsWith('/reorder-preview'))).toEqual([]);
    await dialog.getByRole('button', { name: 'Sí, pedir otro igual' }).click();
    await expect(dialog.getByRole('button', { name: 'Añadir al carrito' })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('error 503 de la vista previa: avisa, no cambia el carrito y se puede reintentar', async ({
    page,
  }) => {
    await seedHistory(page, {
      cart: cartV2('sucursal-1', [DUMPLINGS]),
      faults: { [`POST /v1/orders/${DEMO_HISTORY}/reorder-preview`]: ['busy'] },
    });
    await openHistory(page, 'Historial');
    await page.getByRole('button', { name: 'Volver a pedir: MON-479850' }).click();
    const dialog = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(dialog.getByTestId('reorder-error')).toContainText('Tu carrito no cambió', {
      timeout: 60_000,
    });
    expect(await cartLines(page)).toBe(1);
    await dialog.getByRole('button', { name: 'Reintentar' }).click();
    await expect(dialog.getByTestId('group-AVAILABLE')).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe · lista, recibo y diálogo de reorden · ${theme}`, async ({ page }) => {
    await seedHistory(page, { theme });
    await openHistory(page, 'Historial');
    expect(await axeBlocking(page)).toEqual([]);
    await page.getByRole('button', { name: 'Volver a pedir: MON-479850' }).click();
    const dialog = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(dialog.getByTestId('group-AVAILABLE')).toBeVisible({ timeout: 60_000 });
    expect(await axeBlocking(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.goto(`/pedidos/${DEMO_PICKUP}/recibo`);
    await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 90_000 });
    expect(await axeBlocking(page)).toEqual([]);
    await page.goto(`/pedidos/${DEMO_PICKUP}`);
    await expect(page.getByTestId('reorder')).toBeVisible({ timeout: 90_000 });
    expect(await axeBlocking(page)).toEqual([]);
  });
}

test('en inglés: lista, recibo y diálogo se traducen (leyenda no fiscal incluida)', async ({
  page,
}) => {
  await seedHistory(page, { locale: 'en' });
  await page.goto('/cuenta/pedidos');
  await expect(page.getByRole('heading', { level: 1, name: 'My orders' })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByTestId('history-row').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Order again: MON-479850' }).click();
  const dialog = page.getByRole('dialog', { name: 'Order again' });
  await expect(dialog.getByTestId('price-change')).toContainText('Before Q42.00 → now Q46.00', {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.goto(`/pedidos/${DEMO_PICKUP}/recibo`);
  await expect(page.getByTestId('receipt-legend')).toHaveText(
    'This document is an informational receipt for the order. It is not an invoice or a tax document.',
    { timeout: 90_000 },
  );
  await expect(page.getByTestId('receipt-payment')).toContainText('Cash payment: Pending');
});
