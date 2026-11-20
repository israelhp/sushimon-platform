import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F22 · Pedidos del backoffice (tablero, tabla, detalle y comandos) en modo MOCK: el adaptador responde `/v1/admin/orders*` con la
 * forma real del contrato y la misma matriz que el servidor. Sesión de DEMOSTRACIÓN (no autoriza nada). Móvil: ver
 * `backoffice-orders.mobile.spec.ts`.
 */
test.skip(({ isMobile }) => isMobile, 'el móvil tiene su propio archivo');

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

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, code: string) => page.locator('.kcard', { hasText: code });
const requests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests,
  );

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

test('usa solo /v1/admin/orders* (nunca las rutas legadas ni el despacho simulado)', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(column(page, 'Nuevo').getByText('#MON-307057')).toBeVisible();
  await card(page, '#MON-307057').getByRole('button', { name: 'Aceptar pedido' }).click();
  await expect(column(page, 'Aceptado').getByText('#MON-307057')).toBeVisible();
  const all = await requests(page);
  expect(all).toContain('POST /v1/admin/orders/MON-307057/accept');
  expect(
    all.filter((r) => /\/orders|dispatch|\/deliveries/.test(r) && !/ \/v1\/admin\/orders/.test(r)),
  ).toEqual([]);
});

test('409: si otra persona ya rechazó el pedido, avisa el estado actual y refresca sin reintentar', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/, {
    faults: { 'POST /v1/admin/orders/MON-307057/accept': ['other-rejected'] },
  });
  await card(page, '#MON-307057').getByRole('button', { name: 'Aceptar pedido' }).click();
  await expect(page.locator('.toast', { hasText: 'cambió: ahora está «Rechazado»' })).toBeVisible();
  await expect(column(page, 'Nuevo').getByText('#MON-307057')).toHaveCount(0);
  const posts = (await requests(page)).filter((r) => r.startsWith('POST /v1/admin/orders'));
  expect(posts).toEqual(['POST /v1/admin/orders/MON-307057/accept']); // sin reintento automático
});

test('200 replayed: otra persona ya había aceptado → aviso claro', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/, {
    faults: { 'POST /v1/admin/orders/MON-307057/accept': ['other-applied'] },
  });
  await card(page, '#MON-307057').getByRole('button', { name: 'Aceptar pedido' }).click();
  await expect(page.locator('.toast', { hasText: 'Otra persona ya lo había hecho' })).toBeVisible();
  await expect(column(page, 'Aceptado').getByText('#MON-307057')).toBeVisible();
});

test('cancelar con consecuencias y pendingActions informativas (sin ejecutar nada)', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/); // administradora: ve todas las sucursales
  await page.getByText('#MON-307056').first().click();
  const drawer = page.getByRole('dialog', { name: /MON-307056/ });
  await drawer.getByRole('button', { name: 'Cancelar pedido' }).click();
  const modal = page.getByRole('dialog', { name: 'Cancelar pedido' });
  await expect(modal.getByText(/no podrá reactivarse/)).toBeVisible();
  await expect(modal.getByText(/No escribas datos personales/)).toBeVisible();
  await modal.getByRole('textbox', { name: /Motivo/ }).fill('Cliente no contesta');
  await modal.getByRole('button', { name: 'Confirmar cancelación' }).click();
  await expect(drawer.getByText('Pedido cancelado. Motivo: Cliente no contesta')).toBeVisible();
  // F24: sin efectivo cobrado no hay «posible devolución» (ni reembolso inventado); el pago sigue PENDIENTE.
  await expect(drawer.getByText(/Posible devolución pendiente/)).toHaveCount(0);
  await expect(
    drawer.getByTestId('payment-panel').locator('[data-payment-status="PENDING"]'),
  ).toHaveText('Pago pendiente');
});

test('pedido nuevo: contador, resaltado y un solo aviso; el sonido está apagado por defecto', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(column(page, 'Nuevo').getByText('#MON-307057')).toBeVisible();
  const sound = page.getByRole('button', { name: /Sonido de pedidos nuevos/ });
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.kcard.fresh')).toHaveCount(0); // la línea base no avisa

  await page.getByRole('button', { name: /Demo: llega un pedido/ }).click();
  await expect(page.locator('.kcard.fresh')).toHaveCount(1);
  await expect(column(page, 'Nuevo').getByText('1 nuevo')).toBeVisible();
  const live = page.locator('p[role="status"][aria-live="polite"].sr-only');
  await expect(live).toHaveCount(1);
  await expect(live).toHaveText(/^Pedido nuevo: MON-\d+$/);
  expect(await page.evaluate(() => localStorage.getItem('monsushi-bo-orders-sound'))).toBeNull();

  // Interactuar con la lista quita el resaltado.
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  await expect(page.locator('.kcard.fresh')).toHaveCount(0);
});

test('429 en el tablero: indica la espera y se recupera sola al pasar el Retry-After', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/, {
    faults: { 'GET /v1/admin/orders/board': ['rate-limited'] },
  });
  await expect(
    page.getByText(/Demasiadas solicitudes\. Se reintentará automáticamente en unos \d+ s\./),
  ).toBeVisible();
  await expect(column(page, 'Nuevo').getByText('#MON-307057')).toBeVisible({ timeout: 30_000 });
});

test('tabla: búsqueda y tipo en el servidor, paginación por cursor sin duplicados', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  const rows = page.getByRole('button', { name: /^Ver detalle de #MON/ });
  await expect(rows).toHaveCount(25);
  await page.getByRole('button', { name: 'Cargar más' }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(25);
  const labels = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(new Set(labels).size).toBe(labels.length);

  await page.getByRole('searchbox', { name: 'Buscar pedidos' }).fill('diego');
  await expect(page.getByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver detalle de #MON-307057' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe · tablero, detalle y modal de motivo · ${theme}`, async ({ page }) => {
    await enterAs(page, /Ana Lucía Pérez/, { theme });
    await expect(column(page, 'Nuevo').getByText('#MON-307058')).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByText('#MON-307058').first().click();
    const drawer = page.getByRole('dialog', { name: /MON-307058/ });
    await expect(drawer.getByText('Productos', { exact: true })).toBeVisible();
    expect(await axe(page, '[role="dialog"]')).toEqual([]);

    await drawer.getByRole('button', { name: 'Rechazar' }).click();
    const modal = page.getByRole('dialog', { name: 'Rechazar pedido' });
    await modal.getByRole('button', { name: 'Confirmar rechazo' }).click();
    await expect(modal.getByRole('alert')).toBeVisible();
    expect(await axe(page, '[role="dialog"][aria-labelledby]:last-of-type')).toEqual([]);

    // Esc cierra el modal y el foco vuelve al botón que lo abrió.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Rechazar' })).toBeFocused();
  });
}

test('teclado: se llega a la tarjeta y a su acción sin ratón', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  const accept = card(page, '#MON-307057').getByRole('button', { name: 'Aceptar pedido' });
  await accept.focus();
  await expect(accept).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(column(page, 'Aceptado').getByText('#MON-307057')).toBeVisible();
});
