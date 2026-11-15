import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F06 · Favoritos del cliente (datos SIMULADOS, sin red externa; el flujo real depende del catálogo de F11).
 * El mock reproduce las reglas del servidor (spec 009): idempotencia, tope, 404, aislamiento por cuenta y catálogo no
 * disponible. La sesión es de DEMOSTRACIÓN (Google simulado): la API real decide.
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3193 pnpm --filter sushimon-web exec playwright test --project=e2e favorites
 */

const STORE_KEY = 'sushimon-mock-store-v1:default';

const heart = (page: Page, product: string, pressed?: boolean) =>
  page
    .getByRole('button', {
      name: new RegExp(`^(Agregar|Quitar) ${product} (a|de) favoritos$`),
      ...(pressed === undefined ? {} : { pressed }),
    })
    .first();

/** Un visitante toca el corazón: se abre el inicio de sesión (simulado) y elige la cuenta de prueba. */
async function signInFromHeart(page: Page, product: string, account: RegExp = /Cliente Demo/) {
  await heart(page, product).click();
  const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
  await expect(dialog.getByText('Simulación')).toBeVisible();
  await dialog.getByRole('button', { name: /Continuar con Google/ }).click();
  await dialog.getByRole('button', { name: account }).click();
  await expect(dialog).toBeHidden();
}

async function openMenu(page: Page) {
  await page.goto('/menu');
  await expect(heart(page, 'Dumplings')).toBeVisible({ timeout: 60_000 });
}

/** Marca el catálogo como "no disponible" en el store mock persistido de la pestaña (en cada carga). */
async function breakCatalog(page: Page) {
  await page.waitForFunction((key) => !!sessionStorage.getItem(key), STORE_KEY);
  await page.addInitScript((key) => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const store = JSON.parse(raw);
    store.favoritesCatalog = 'unavailable';
    sessionStorage.setItem(key, JSON.stringify(store));
  }, STORE_KEY);
}

async function expectNoSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

test.describe('favoritos del cliente (mock fiel al servidor)', () => {
  test('visitante: el corazón abre el login y no crea nada; tras entrar se marca desde el menú y se refleja en Inicio, ficha y Mis favoritos', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openMenu(page);
    // Visitante: no marca nada, invita a iniciar sesión.
    await heart(page, 'California Roll').click();
    await expect(page.getByRole('dialog', { name: 'Iniciar sesión' })).toBeVisible();
    await page
      .getByRole('button', { name: /Seguir como invitado|invitado/i })
      .first()
      .click();
    await expect(heart(page, 'California Roll', false)).toBeVisible();

    // Entra (cuenta demo con 2 favoritos) y vuelve a tocar el corazón: ahora sí se guarda.
    await signInFromHeart(page, 'California Roll');
    await expect(heart(page, 'Platanito Roll', true)).toBeVisible({ timeout: 30_000 });
    await expect(heart(page, 'California Roll', false)).toBeVisible();
    await heart(page, 'California Roll').click();
    await expect(page.getByText('California Roll está en tus favoritos')).toBeVisible();
    await expect(heart(page, 'California Roll', true)).toBeVisible();

    // Ficha de producto (detalle): el mismo estado, y se puede quitar y volver a marcar desde ahí.
    await page
      .getByRole('button', { name: /^California Roll/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: 'California Roll' });
    await expect(
      sheet.getByRole('button', { name: /Quitar California Roll de favoritos/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    // Inicio: las tarjetas destacadas muestran el corazón ya marcado (una sola fuente remota).
    await page.goto('/');
    await expect(heart(page, 'California Roll', true)).toBeVisible({ timeout: 60_000 });

    // Mis favoritos: orden de la API (el más reciente primero) con el precio del catálogo.
    await page.goto('/cuenta/favoritos');
    await expect(page.getByRole('heading', { name: 'Mis favoritos' })).toBeVisible({
      timeout: 60_000,
    });
    const list = page.getByRole('list', { name: 'Tus productos favoritos' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').first()).toContainText('California Roll');
    await expect(list.getByRole('listitem').first()).toContainText('Q57');

    // Quitar desde Mis favoritos: desaparece y el contador del hub lo refleja.
    await heart(page, 'California Roll', true).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('2 favoritos')).toBeVisible();
    await page.goto('/cuenta');
    await expect(page.getByRole('link', { name: /Mis favoritos/ })).toContainText('2 productos', {
      timeout: 60_000,
    });
  });

  test('cambio de cuenta: otra cuenta no ve los favoritos de la anterior y al volver recupera los suyos', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openMenu(page);
    await signInFromHeart(page, 'Dumplings');
    await expect(heart(page, 'Platanito Roll', true)).toBeVisible({ timeout: 30_000 });

    await page.goto('/cuenta');
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page
      .getByRole('button', { name: /Continuar con Google/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
    await dialog.getByRole('button', { name: /Continuar con Google/ }).click();
    await dialog.getByRole('button', { name: /Invitado Nuevo/ }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/cuenta/favoritos');
    await expect(page.getByText('Todavía no tenés favoritos')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('list', { name: 'Tus productos favoritos' })).toHaveCount(0);
    await openMenu(page);
    await expect(heart(page, 'Platanito Roll', false)).toBeVisible();
    await heart(page, 'Dumplings').click();
    await expect(page.getByText('Dumplings está en tus favoritos')).toBeVisible();

    // Vuelve la cuenta demo: sigue con SUS favoritos, sin los de la otra.
    await page.goto('/cuenta');
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page
      .getByRole('button', { name: /Continuar con Google/ })
      .first()
      .click();
    await dialog.getByRole('button', { name: /Continuar con Google/ }).click();
    await dialog.getByRole('button', { name: /Cliente Demo/ }).click();
    await expect(dialog).toBeHidden();
    await openMenu(page);
    await expect(heart(page, 'Platanito Roll', true)).toBeVisible({ timeout: 30_000 });
    await expect(heart(page, 'Dumplings', false)).toBeVisible();
  });

  test('catálogo no disponible: marcar avisa (503), Mis favoritos no inventa detalles y permite quitar', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openMenu(page);
    await signInFromHeart(page, 'Dumplings');
    await expect(heart(page, 'Platanito Roll', true)).toBeVisible({ timeout: 30_000 });
    // Una escritura real del mock para que el store quede persistido en la pestaña.
    await heart(page, 'Dumplings').click();
    await expect(page.getByText('Dumplings está en tus favoritos')).toBeVisible();
    await breakCatalog(page);

    await page.goto('/cuenta/favoritos');
    await expect(
      page.getByText(/No podemos mostrar los detalles de tus favoritos ahora/),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('No podemos mostrar los detalles ahora')).toHaveCount(3);
    await expectNoSeriousA11y(page);
    // Se puede quitar aunque el catálogo no responda (DELETE no lo usa).
    await page.getByRole('button', { name: /Quitar Dumplings de favoritos/ }).click();
    await expect(page.getByText('No podemos mostrar los detalles ahora')).toHaveCount(2);

    // Marcar uno nuevo: 503 CATALOG_UNAVAILABLE, aviso claro y el corazón queda sin marcar (rollback).
    await openMenu(page);
    await heart(page, 'California Roll').click();
    await expect(page.getByText(/Favoritos no está disponible por ahora/)).toBeVisible();
    await expect(heart(page, 'California Roll', false)).toBeVisible();
  });

  test('cuenta sin favoritos: estado vacío con acción al menú', async ({ page }) => {
    test.setTimeout(150_000);
    await openMenu(page);
    await signInFromHeart(page, 'Dumplings', /Invitado Nuevo/);
    await page.goto('/cuenta/favoritos');
    await expect(page.getByText('Todavía no tenés favoritos')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: /menú/i }).first()).toBeVisible();
    await expectNoSeriousA11y(page);
  });

  test('el teclado alcanza el corazón y lo alterna con Enter (aria-pressed, foco visible)', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await openMenu(page);
    await signInFromHeart(page, 'Dumplings');
    await expect(heart(page, 'Platanito Roll', true)).toBeVisible({ timeout: 30_000 });
    const target = heart(page, 'Dumplings', false);
    await target.focus();
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(heart(page, 'Dumplings', true)).toBeFocused();
    await expect(page.getByText('Dumplings está en tus favoritos')).toBeVisible();
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`a11y de Mis favoritos con datos y del menú con corazones · ${theme}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
    await openMenu(page);
    await signInFromHeart(page, 'Dumplings');
    await expect(heart(page, 'Platanito Roll', true)).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11y(page);
    await page.goto('/cuenta/favoritos');
    await expect(page.getByRole('list', { name: 'Tus productos favoritos' })).toBeVisible({
      timeout: 60_000,
    });
    await expectNoSeriousA11y(page);
  });
}
