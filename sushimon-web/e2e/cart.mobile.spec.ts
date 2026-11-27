import { expect, test, type Page } from './support/test';
import { CART_KEY, DUMPLINGS, cartV2, pickupMode } from './support/cart';

/**
 * F18 — Carrito en móvil (Pixel 7, datos SIMULADOS): barra «Ver pedido», cajón sin desbordes y objetivos táctiles ≥ 44 px,
 * en tema claro y oscuro.
 */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · barra inferior, cajón sin desbordes y botones ≥ 44 px · ${theme}`, async ({
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
      [cartV2('sucursal-1', [{ ...DUMPLINGS, quantity: 2 }]), pickupMode('sucursal-1'), theme],
    );
    await page.goto('/menu');
    const bar = page.getByRole('button', { name: /Ver pedido/ });
    await expect(bar).toContainText('2 productos · Q106', { timeout: 90_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    await bar.click();
    const drawer = page.getByRole('dialog', { name: 'Tu pedido' });
    await expect(drawer.getByText('Q53 × 2 = Q106')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    for (const name of [
      'Quitar uno de Dumplings',
      'Agregar uno de Dumplings',
      'Eliminar Dumplings',
    ]) {
      const box = await drawer.getByRole('button', { name }).boundingBox();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    const cart = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), CART_KEY))!);
    expect(cart.lines[0].quantity).toBe(2);
  });
}

test('móvil · la tarjeta agrega directo si no hay extras y abre la ficha si los hay', async ({
  page,
}) => {
  await page.addInitScript(
    ([mode]) => localStorage.setItem('monsushi-order-mode-v1', mode!),
    [pickupMode('sucursal-1')],
  );
  await page.goto('/menu');
  await page
    .getByRole('button', { name: 'Agregar Dumplings a tu pedido' })
    .click({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Quitar uno de Dumplings' })).toBeVisible();
  const cart = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), CART_KEY))!);
  expect(cart.lines).toHaveLength(1);
  expect(cart.lines[0]).toMatchObject({ productId: 'dumplings', quantity: 1, selections: [] });
  await page.getByRole('button', { name: 'Agregar Sushi Pizza a tu pedido' }).click();
  await expect(page.getByRole('dialog', { name: 'Sushi Pizza' })).toBeVisible();
  const after = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), CART_KEY))!);
  expect(after.lines).toHaveLength(1);
});

test('móvil · /menu con un carrito persistido de varios productos únicos NO pide fichas hasta abrir el cajón', async ({
  page,
}) => {
  const slugs = [
    'dumplings',
    'california-roll',
    'joselito-roll',
    'cayibel-roll',
    'dynamita-roll',
    'loco-ribs',
  ];
  await page.addInitScript(
    ([cart, mode]) => {
      (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests = [];
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('monsushi-cart-v2', cart!);
        localStorage.setItem('monsushi-order-mode-v1', mode!);
      }
    },
    [
      cartV2(
        'sucursal-1',
        slugs.map((productId) => ({ productId, unitCents: 5000 })),
      ),
      pickupMode('sucursal-1'),
    ],
  );
  await page.goto('/menu');
  await expect(page.getByRole('button', { name: /Ver pedido/ })).toContainText('6 productos', {
    timeout: 90_000,
  });
  await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const requests = () =>
    page.evaluate(
      () => (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests,
    );
  // `next dev` ejecuta React en StrictMode (monta dos veces): una consulta recién montada puede pedirse dos veces solo en desarrollo.
  // Las pruebas de vitest (sin StrictMode) verifican «exactamente una»; aquí se comparan las solicitudes DISTINTAS.
  const details = (list: string[]) =>
    list.filter((r) => /^GET \/v1\/store\/products\/[^/?]+/.test(r));
  // Cajón cerrado: ninguna ficha (el resumen de escritorio no se monta en móvil).
  expect(details(await requests())).toEqual([]);
  await page.getByRole('button', { name: /Ver pedido/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(drawer).toBeVisible();
  // Al abrirlo, UNA ficha por producto único (y no más).
  await expect
    .poll(async () => new Set(details(await requests()).map((r) => r.replace(/\?.*$/, ''))).size)
    .toBe(slugs.length);
  await expect(drawer.getByRole('link', { name: /Continuar/ })).toBeVisible();
});
