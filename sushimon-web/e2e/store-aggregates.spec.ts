import { DUMPLINGS, cartV2 } from './support/cart';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F17 — Medición de solicitudes `/v1/*` por pantalla con datos SIMULADOS (mock fiel a la semántica del contrato; nada se probó contra la
 * API real ni una CDN). El adaptador mock no emite solicitudes de red, así que no se pueden contar con `page.on('request')`: el propio
 * adaptador anota cada solicitud en `window.__sushimonMockRequests` cuando la página lo define (instrumentación solo de pruebas).
 * `page.on('request')` se usa para comprobar que NO hubo ninguna solicitud `/v1/` real. Se excluyen del conteo `GET /v1/store/config`
 * (solo existe en el mock: con http no se emite, ver `getStoreConfig`) y `/v1/demo/*` (extras simulados, inexistentes en la API real).
 *
 * Línea base (derivada por lectura en la spec 018, modo http, caché fría): Inicio 6, Menú 8, búsqueda +1 por tecleo, ficha +1 en cascada.
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3207 pnpm --filter sushimon-web exec playwright test --project=e2e store-aggregates
 */

const ORDER_MODE_KEY = 'monsushi-order-mode-v1';

/** Define el registro de solicitudes del mock ANTES de que cargue cada página. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests = [];
  });
}

async function pickBranch(page: Page, branchId: string | null) {
  await page.addInitScript(
    ([key, id]) => {
      if (!id) return;
      localStorage.setItem(
        key as string,
        JSON.stringify({
          type: 'delivery',
          branchId: id,
          address: {
            department: 'Guatemala',
            municipality: 'Guatemala',
            zone: '10',
            line: '6a avenida 10-50',
            references: '',
          },
        }),
      );
    },
    [ORDER_MODE_KEY, branchId],
  );
}

/** Solicitudes `/v1/*` del mock, sin config ni demo, como `METHOD /ruta` (sin query) más la query para inspección. */
async function requests(page: Page): Promise<string[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __sushimonMockRequests?: string[] }).__sushimonMockRequests ?? [],
  );
  return all.filter((r) => !/ \/v1\/(demo\/|store\/config)/.test(r));
}

const route = (r: string) => r.replace(/\?.*$/, '');
const count = (list: string[], rx: RegExp) => list.filter((r) => rx.test(r)).length;

/**
 * Espera DETERMINISTA a que la app quede en reposo: red inactiva y dos cuadros de animación seguidos de un ciclo ocioso del navegador
 * (el mock responde en memoria, sin temporizadores arbitrarios).
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
              .requestIdleCallback;
            if (idle) idle(() => resolve());
            else resolve();
          }),
        ),
      ),
  );
}

function noRealApiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (/\/v1\//.test(new URL(request.url()).pathname)) seen.push(request.url());
  });
  return seen;
}

function report(label: string, list: string[]) {
  test.info().annotations.push({ type: 'solicitudes', description: `${label}: ${list.length}` });
  console.log(`[F17] ${label}: ${list.length}\n  ${list.join('\n  ')}`);
}

test.describe('F17 · solicitudes por pantalla (mock fiel)', () => {
  test('Inicio con sucursal: 2 solicitudes (sucursales + bootstrap); sin catálogo, overlay, banners ni categorías aparte', async ({
    page,
  }) => {
    const real = noRealApiRequests(page);
    await instrument(page);
    await pickBranch(page, 'sucursal-1');
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /¿Tenés hambre\?|hambre/i }).first(),
    ).toBeVisible({
      timeout: 90_000,
    });
    await settle(page);
    const list = await requests(page);
    report('Inicio con sucursal', list);
    expect(list.map(route).sort()).toEqual(['GET /v1/branches', 'GET /v1/store/bootstrap']);
    expect(count(list, /store\/(products|menu|banners|categories|promotions)/)).toBe(0);
    expect(real).toEqual([]);
  });

  test('Inicio sin sucursal: 2 solicitudes (sucursales + bootstrap sin branchId)', async ({
    page,
  }) => {
    await instrument(page);
    await pickBranch(page, null);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /hambre/i }).first()).toBeVisible({
      timeout: 90_000,
    });
    await settle(page);
    const list = await requests(page);
    report('Inicio sin sucursal', list);
    expect(count(list, /store\/bootstrap/)).toBe(1);
    expect(list.find((r) => /bootstrap/.test(r))).not.toMatch(/branchId/);
    expect(count(list, /store\/(products|menu|banners)/)).toBe(0);
  });

  test('Inicio con sucursal y un cliente con favoritos: se suman /me/favorites y el menú de la sucursal (solo para pintar sus favoritos)', async ({
    page,
  }) => {
    await instrument(page);
    await pickBranch(page, 'sucursal-1');
    // El cliente demo entra y marca un favorito desde el menú.
    await page.goto('/menu');
    const heart = page.getByRole('button', { name: /^Agregar Dumplings a favoritos$/ }).first();
    await expect(heart).toBeVisible({ timeout: 60_000 });
    await heart.click();
    const dialog = page.getByRole('dialog', { name: 'Iniciar sesión' });
    await dialog.getByRole('button', { name: /Continuar con Google/ }).click();
    await dialog.getByRole('button', { name: /Cliente Demo/ }).click();
    await expect(dialog).toBeHidden();
    // Con sesión, el corazón ya guarda: se marca desde el menú.
    await heart.click();
    await expect(
      page.getByRole('button', { name: /^Quitar Dumplings de favoritos$/ }).first(),
    ).toBeVisible({ timeout: 30_000 });
    // Carga en frío del Inicio (nueva navegación: el registro se reinicia).
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Tus favoritos/ })).toBeVisible({
      timeout: 60_000,
    });
    await settle(page);
    const list = await requests(page);
    report('Inicio con sucursal y favoritos', list);
    expect(count(list, /GET \/v1\/store\/bootstrap/)).toBe(1);
    expect(count(list, /GET \/v1\/me\/favorites/)).toBeGreaterThanOrEqual(1);
    expect(count(list, /GET \/v1\/store\/menu/)).toBe(1);
    expect(count(list, /store\/(products|banners)/)).toBe(0);
  });

  test('Menú con sucursal: sucursales + categorías + menú + promociones compactas (live/upcoming); sin catálogo completo ni overlay aparte', async ({
    page,
  }) => {
    const real = noRealApiRequests(page);
    await instrument(page);
    await pickBranch(page, 'sucursal-1');
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 90_000 });
    await settle(page);
    const list = await requests(page);
    report('Menú con sucursal', list);
    expect(list.map(route).sort()).toEqual([
      'GET /v1/branches',
      'GET /v1/store/categories',
      'GET /v1/store/menu',
      'GET /v1/store/promotions',
      'GET /v1/store/promotions',
    ]);
    expect(list.filter((r) => /promotions/.test(r)).every((r) => /compact=true/.test(r))).toBe(
      true,
    );
    expect(count(list, /store\/products/)).toBe(0);
    expect(real).toEqual([]);
  });

  test('Menú: abrir el carrito suma la disponibilidad de la sucursal (carga perezosa) y no el menú otra vez', async ({
    page,
  }) => {
    await instrument(page);
    await pickBranch(page, 'sucursal-1');
    await page.addInitScript(
      (cart) => localStorage.setItem('monsushi-cart-v2', cart),
      cartV2('sucursal-1', [DUMPLINGS]),
    );
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 90_000 });
    await settle(page);
    const before = await requests(page);
    // Sin `.catch`: la prueba FALLA si el carrito no se abre.
    await page
      .getByRole('button', { name: /Ver tu pedido/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Tu pedido' })).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Tu pedido' }).getByText('Q53 × 1 = Q53'),
    ).toBeVisible();
    await settle(page);
    const delta = (await requests(page)).slice(before.length);
    report('Menú + carrito abierto (delta)', delta);
    // F18: abrir el carrito revalida contra la sucursal DEL CARRITO con lo que el Menú ya tiene en caché (menú: sin petición extra
    // mientras esté fresco) + UNA ficha por producto único (extras) + la disponibilidad de la sucursal. Nunca una solicitud por línea
    // ni el catálogo completo (`/store/products` sin slug).
    expect(count(delta, /^GET \/v1\/store\/menu/)).toBeLessThanOrEqual(1);
    // En escritorio el resumen del menú ya revalidó al cargar: abrir el cajón reutiliza esa caché (ficha: UNA en total).
    const unique = (list: string[]) => new Set(list.filter((r) => /products\/dumplings/.test(r)));
    expect(unique([...before, ...delta]).size).toBe(1); // `next dev` (StrictMode) puede repetir una consulta recién montada
    expect(count(delta, /^GET \/v1\/store\/products\/dumplings/)).toBe(0);
    expect(count(delta, /^GET \/v1\/store\/products(\?|$)/)).toBe(0);
    expect(count(delta, /availability/)).toBe(1);
  });

  test('Búsqueda de 3 caracteres tecleados seguidos: UNA solicitud /store/search tras el debounce', async ({
    page,
  }) => {
    await instrument(page);
    await pickBranch(page, 'sucursal-1');
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 90_000 });
    await settle(page);
    const before = await requests(page);
    await page.getByRole('searchbox', { name: 'Buscar en el menú' }).pressSequentially('dum', {
      delay: 60,
    });
    await expect(page.getByRole('heading', { name: 'Resultados para «dum»' })).toBeVisible({
      timeout: 30_000,
    });
    await settle(page);
    const delta = (await requests(page)).slice(before.length);
    report('Búsqueda de 3 caracteres (delta)', delta);
    expect(delta.map(route)).toEqual(['GET /v1/store/search']);
    expect(delta[0]).toMatch(/q=dum/);
    expect(delta[0]).toMatch(/branchId=sucursal-1/);
  });

  test('Ficha: abrir un producto pide UNA ficha por slug con la sucursal, sin cascada de catálogo', async ({
    page,
  }) => {
    await instrument(page);
    await pickBranch(page, 'sucursal-1');
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 90_000 });
    await settle(page);
    const before = await requests(page);
    await page
      .getByRole('button', { name: /^Dumplings/ })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Dumplings' })).toBeVisible({ timeout: 30_000 });
    await settle(page);
    const delta = (await requests(page)).slice(before.length);
    report('Ficha (delta)', delta);
    // Una ficha por slug (en `next dev`, StrictMode puede repetir la consulta recién montada: se comparan las distintas).
    expect([...new Set(delta.map(route))]).toEqual(['GET /v1/store/products/dumplings']);
    expect(delta[0]).toMatch(/branchId=sucursal-1/);
  });
});

/** Axe (WCAG 2 A/AA) sobre toda la página o sobre un selector; solo impactos serios o críticos. */
async function expectNoSeriousA11y(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  const results = await builder.analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

/** Termina las animaciones de entrada (el contraste no es fiable con opacidades a medias). */
const animationsDone = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );

async function openMenu(
  page: Page,
  theme: 'light' | 'dark',
  branchId: string | null = 'sucursal-1',
) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
  await pickBranch(page, branchId);
  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible({ timeout: 90_000 });
}

const searchbox = (page: Page) => page.getByRole('searchbox', { name: 'Buscar en el menú' });

/** ADR-0036: la sucursal sale de la cobertura de la dirección (Fraijanes solo lo cubre Sucursal 2). */
async function switchBranch(page: Page, name: string) {
  await page
    .getByRole('button', { name: /Cambiar la dirección de entrega/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Pedir ahora' });
  await sheet.getByLabel('Municipio').selectOption({ label: 'Fraijanes' });
  await sheet.getByLabel('Dirección exacta').fill('Calle principal 123');
  await expect(
    sheet.getByText(new RegExp(`Entregamos en esta dirección desde ${name}`)),
  ).toBeVisible();
  await sheet.getByRole('button', { name: /Ver (el )?menú/ }).click();
  await expect(sheet).toBeHidden();
}

test.describe('F17 · UX de búsqueda y ficha (mock fiel)', () => {
  test('mínimo 2 caracteres: aviso asociado al campo, el menú sigue y no hay solicitud; luego estado vacío', async ({
    page,
  }) => {
    await instrument(page);
    await openMenu(page, 'light');
    await settle(page);
    const before = await requests(page);
    await searchbox(page).fill('a');
    const hint = page.getByText('Escribe al menos 2 caracteres para buscar.');
    await expect(hint).toBeVisible();
    await expect(searchbox(page)).toHaveAttribute(
      'aria-describedby',
      (await hint.getAttribute('id')) ?? '',
    );
    await expect(page.getByRole('heading', { name: /^Entradas/ })).toBeVisible();
    await settle(page);
    expect(count((await requests(page)).slice(before.length), /store\/search/)).toBe(0);
    await searchbox(page).fill('zzzz');
    await expect(page.getByText('Sin resultados para «zzzz»').first()).toBeVisible();
    await expectNoSeriousA11y(page);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe: búsqueda con resultados, «Ver más», actualización y agotado · ${theme}`, async ({
      page,
    }) => {
      await openMenu(page, theme, 'sucursal-2');
      await searchbox(page).fill('de');
      await expect(page.getByRole('heading', { name: 'Resultados para «de»' })).toBeVisible();
      await expect(page.getByText(/Mostrando 20 de/).first()).toBeVisible();
      await expectNoSeriousA11y(page);
      // «Ver más» acumula y el foco va al contador.
      await page.getByRole('button', { name: 'Ver más' }).click();
      const counter = page
        .getByRole('region', { name: /Resultados para/ })
        .getByText(/Mostrando 2[1-9] de/);
      await expect(counter).toBeVisible();
      await expect(counter).toBeFocused();
      // Agotado en la sucursal 2: insignia visible + control deshabilitado.
      await searchbox(page).fill('gaseosa');
      await expect(page.getByRole('heading', { name: 'Resultados para «gaseosa»' })).toBeVisible();
      await expect(page.getByText('Agotado', { exact: true }).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Gaseosas: agotado, no se puede agregar' }).first(),
      ).toBeDisabled();
      await animationsDone(page);
      await expectNoSeriousA11y(page);
    });

    test(`axe: ficha con datos F17 (oferta, extras, promoción) · ${theme}`, async ({ page }) => {
      await openMenu(page, theme, 'sucursal-1');
      await page
        .getByRole('button', { name: /^Gaseosas/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'Gaseosas' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/Promoción:/)).toBeVisible();
      await animationsDone(page);
      await expectNoSeriousA11y(page, '[role="dialog"]');
    });
  }

  test('ficha: el diálogo abre YA (esqueleto aria-busy) y luego muestra los datos de la sucursal; Agregar = total del resumen', async ({
    page,
  }) => {
    await openMenu(page, 'light', 'sucursal-1');
    await page
      .getByRole('button', { name: /^Sushi Pizza/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Sushi Pizza' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole('group', { name: /Salsa/ })).toBeVisible();
    const estimated =
      (await dialog
        .getByText('Precio estimado por unidad')
        .locator('xpath=following-sibling::*[1]')
        .textContent()) ?? '';
    const add = (await dialog.getByRole('button', { name: /^Agregar\s*Q/ }).textContent()) ?? '';
    const amount = (text: string) => Number(text.replace(/[^0-9.]/g, ''));
    expect(amount(add)).toBe(amount(estimated));
  });

  test('cambio de sucursal sin mezclar: en la búsqueda no queda ninguna tarjeta ni precio de la sucursal anterior', async ({
    page,
  }) => {
    await openMenu(page, 'light', 'sucursal-1');
    await searchbox(page).fill('dynamita');
    await expect(page.getByRole('heading', { name: 'Resultados para «dynamita»' })).toBeVisible();
    await expect(page.getByText('Resultados en Sucursal 1')).toBeVisible();
    await expect(page.getByText('Q82').first()).toBeVisible();
    await switchBranch(page, 'Sucursal 2');
    // El campo sigue montado y con su texto; los resultados son los de la sucursal 2.
    await expect(searchbox(page)).toHaveValue('dynamita');
    await expect(page.getByText('Resultados en Sucursal 2')).toBeVisible();
    await expect(page.getByText('Q86').first()).toBeVisible();
    await expect(page.getByText('Q82')).toHaveCount(0);
  });
});
