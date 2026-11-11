import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Captura complementaria del prototipo: Cuenta con sesión (datos, direcciones, favoritos, pedidos,
 * reorden), hub con sesión y 404. La galería general solo cubre las pantallas sin sesión.
 * Solo bajo demanda (el login "Google" del prototipo es local; la red sigue bloqueada):
 *   CAPTURE_PROTOTYPE=1 E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual gallery-account
 * Salida: docs/ui/extracted/screens/store-{pantalla}-{viewport}-{theme}.png (ignorado por git).
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

type Step = (page: Page) => Promise<void>;

/** La tienda usa MemoryRouter: se navega con clics en enlaces internos (a /mas si no hay uno visible). */
async function go(page: Page, href: string) {
  if (!(await page.locator(`a[href="${href}"]:visible`).count())) {
    await page.locator('a[href="/mas"]:visible').first().click();
    await page.waitForTimeout(200);
  }
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForTimeout(300);
}

/** Inicio de sesión simulado del prototipo (cuenta de prueba). */
async function login(page: Page) {
  await go(page, '/cuenta');
  await page
    .getByRole('button', { name: /Continuar con Google/ })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Continuar con Google/ })
    .click();
  await page.waitForTimeout(300);
  const account = page.getByRole('button', { name: /Cliente Demo/ }).filter({ visible: true });
  if (await account.count()) await account.first().click();
  // Espera a que desaparezca el aviso de bienvenida.
  await page.waitForTimeout(6500);
}

async function inAccount(page: Page, href: string) {
  await login(page);
  await go(page, href);
  await page.waitForTimeout(500);
}

const SCREENS: Record<string, Step> = {
  'cuenta-signed': async (p) => {
    await login(p);
  },
  'cuenta-datos': (p) => inAccount(p, '/cuenta/datos'),
  'cuenta-direcciones': (p) => inAccount(p, '/cuenta/direcciones'),
  'cuenta-direcciones-form': async (p) => {
    await inAccount(p, '/cuenta/direcciones');
    await p
      .getByRole('button', { name: /Agregar dirección/ })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(400);
  },
  'cuenta-favoritos': (p) => inAccount(p, '/cuenta/favoritos'),
  'cuenta-pedidos': (p) => inAccount(p, '/cuenta/pedidos'),
  'cuenta-pedidos-historial': async (p) => {
    await inAccount(p, '/cuenta/pedidos');
    await p
      .getByRole('tab', { name: /Historial/ })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(300);
  },
  'cuenta-reorden': async (p) => {
    await inAccount(p, '/cuenta/pedidos');
    await p
      .getByRole('tab', { name: /Historial/ })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(300);
    await p
      .getByRole('button', { name: /Volver a pedir/ })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(800);
  },
  'cuenta-favoritos-invitado': (p) => go(p, '/cuenta').then(() => go(p, '/cuenta/favoritos')),
  'mas-signed': async (p) => {
    await login(p);
    await go(p, '/mas');
  },
  404: async (p) => {
    // El prototipo usa MemoryRouter (no hay URL): se navega a una ruta inexistente con el `navigator`
    // del router, que se localiza recorriendo el árbol de React desde #root (solo lectura de la página).
    await p.evaluate(() => {
      const root = document.getElementById('root') as unknown as Record<string, unknown>;
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      type Fiber = {
        memoizedProps?: { navigator?: { push: (to: string) => void } };
        child?: Fiber | null;
        sibling?: Fiber | null;
      };
      const walk = (fiber: Fiber | null | undefined): { push: (to: string) => void } | null => {
        for (let f = fiber; f; f = f.sibling) {
          const nav = f.memoizedProps?.navigator;
          if (nav?.push) return nav;
          const found = walk(f.child);
          if (found) return found;
        }
        return null;
      };
      walk((root[key!] as Fiber) ?? null)?.push('/ruta-que-no-existe');
    });
    await p.waitForTimeout(400);
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [screen, step] of Object.entries(SCREENS)) {
      test(`store/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
        test.skip(!process.env.CAPTURE_PROTOTYPE, 'Solo bajo demanda (CAPTURE_PROTOTYPE=1).');
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT });
        await page.goto(pathToFileURL(PROTOTYPES.store).href);
        await expect(page.locator('#root')).not.toBeEmpty();
        await step(page);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `store-${screen}-${viewport}-${theme}.png`), await capture(page));
      });
    }
  }
}
