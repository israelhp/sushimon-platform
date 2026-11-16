import { expect, test, type Page } from '@playwright/test';

/**
 * SC-007 / FR-007: la demo funciona sin red externa. Recorre las rutas principales de la tienda y
 * del backoffice y falla ante cualquier solicitud a un origen distinto del servidor de la app
 * (fuentes autoalojadas, sin CDN, sin analítica, sin llamadas reales a PedidosYa/Neonet/Supabase).
 */
function watchExternal(page: Page, origin: string): string[] {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(origin) || /^(data|blob|about):/.test(url)) return;
    external.push(`${request.method()} ${url}`);
  });
  return external;
}

const STORE_ROUTES = [
  '/',
  '/menu',
  '/promociones',
  '/checkout',
  '/mas',
  '/cuenta',
  '/consultar',
  '/incidencias',
  '/trabaja-con-nosotros',
];

const BACKOFFICE_SCREENS = [
  'panel',
  'pedidos',
  'entregas',
  'productos',
  'categorias',
  'modificadores',
  'promociones',
  'sucursales',
  'usuarios',
  'roles',
  'reportes',
];

test('tienda: ninguna solicitud sale del servidor de la app', async ({ page, baseURL }) => {
  const external = watchExternal(page, new URL(baseURL!).origin);
  for (const route of STORE_ROUTES) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.locator('h1').first()).toBeVisible();
  }
  expect(external).toEqual([]);
});

test('backoffice: ninguna solicitud sale del servidor de la app', async ({ page, baseURL }) => {
  const external = watchExternal(page, new URL(baseURL!).origin);
  // La sesión de demostración vive en sessionStorage (por pestaña): se recorre en una sola.
  await page.goto('/backoffice/login', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL('**/backoffice/panel');
  for (const screen of BACKOFFICE_SCREENS) {
    await page.goto(`/backoffice/${screen}`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1').first()).toBeVisible();
  }
  expect(external).toEqual([]);
});
