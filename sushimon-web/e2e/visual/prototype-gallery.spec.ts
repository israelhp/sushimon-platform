import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, capture, preparePage, VIEWPORTS } from './harness';

/**
 * Galería de referencia: capturas de los prototipos (red bloqueada, reloj congelado) para que
 * quien implemente una pantalla la compare. Proyecto `gallery`, solo bajo demanda:
 *   pnpm --filter sushimon-web capture:prototypes
 * Salida: docs/ui/extracted/screens/ (ignorado por git). Filtrar con --grep "store/menu".
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
export const DEMO_NOW = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

type Step = (page: Page) => Promise<void>;

/** La tienda usa MemoryRouter: se navega haciendo clic en los enlaces internos. */
async function storeLink(page: Page, href: string) {
  const link = page.locator(`a[href="${href}"]:visible`).first();
  if (!(await link.count())) {
    await page.locator('a[href="/mas"]:visible').first().click();
  }
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForTimeout(250);
}

async function clickText(page: Page, text: string | RegExp) {
  await page.getByText(text).filter({ visible: true }).first().click();
  await page.waitForTimeout(250);
}

const STORE_SCREENS: Record<string, Step> = {
  home: async () => {},
  'home-full': async (p) => {
    await p.setViewportSize({ width: p.viewportSize()!.width, height: 3200 });
  },
  menu: (p) => storeLink(p, '/menu'),
  promos: (p) => storeLink(p, '/promociones'),
  mas: (p) => storeLink(p, '/mas'),
  cuenta: (p) => storeLink(p, '/cuenta'),
  consultar: (p) => storeLink(p, '/consultar'),
  incidencias: (p) => storeLink(p, '/incidencias'),
  trabaja: (p) => storeLink(p, '/trabaja-con-nosotros'),
  'product-sheet': async (p) => {
    await storeLink(p, '/menu');
    await p.locator('main article, main li').filter({ visible: true }).first().click();
    await p.waitForTimeout(300);
  },
  'cart-drawer': async (p) => {
    await storeLink(p, '/menu');
    await clickText(p, /^Agregar$/);
    await clickText(p, /^Agregar$/);
    await p
      .getByRole('button', { name: /pedido/i })
      .filter({ visible: true })
      .last()
      .click();
    await p.waitForTimeout(300);
  },
  'order-mode-sheet': async (p) => {
    await p
      .getByRole('button', { name: /Iniciar pedido/ })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(300);
  },
  'auth-modal': async (p) => {
    await storeLink(p, '/cuenta');
    await clickText(p, /Continuar con Google/);
  },
  checkout: async (p) => {
    await storeLink(p, '/menu');
    await clickText(p, /^Agregar$/);
    await p
      .locator('a[href="/checkout"]:visible, button:has-text("Pedido"):visible')
      .first()
      .click();
    await p.waitForTimeout(300);
  },
};

const BO_ROUTES = [
  'Panel',
  'Pedidos',
  'Entregas',
  'Productos',
  'Categorías',
  'Promociones',
  'Sucursales',
  'Usuarios',
  'Reportes',
] as const;

async function boLogin(page: Page) {
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForTimeout(600);
}

async function boNav(page: Page, label: string) {
  const vw = page.viewportSize()!.width;
  if (vw < 900) {
    await page
      .locator('button[aria-label*="menú" i], button[aria-label*="menu" i]')
      .first()
      .click();
    await page.waitForTimeout(300);
  }
  await page.locator('nav, aside').getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(400);
}

const BO_SCREENS: Record<string, Step> = {
  login: async () => {},
  ...Object.fromEntries(
    BO_ROUTES.map((label) => [
      label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
      async (p: Page) => {
        await boLogin(p);
        if (label !== 'Panel') await boNav(p, label);
      },
    ]),
  ),
  'pedidos-drawer': async (p) => {
    await boLogin(p);
    await boNav(p, 'Pedidos');
    await p
      .getByText(/^SM-\d+/)
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(400);
  },
};

async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.png`), await capture(page));
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [screen, go] of Object.entries(STORE_SCREENS)) {
      test(`store/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
        await preparePage(page, { theme, viewport, frozenAt: DEMO_NOW });
        await page.goto(pathToFileURL(PROTOTYPES.store).href);
        await expect(page.locator('#root')).not.toBeEmpty();
        await go(page);
        await shoot(page, `store-${screen}-${viewport}-${theme}`);
      });
    }
    for (const [screen, go] of Object.entries(BO_SCREENS)) {
      test(`backoffice/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
        await preparePage(page, { theme, viewport, frozenAt: DEMO_NOW });
        await page.goto(pathToFileURL(PROTOTYPES.backoffice).href);
        await page.getByRole('button', { name: 'Ingresar' }).waitFor();
        await go(page);
        await shoot(page, `bo-${screen}-${viewport}-${theme}`);
      });
    }
  }
}
