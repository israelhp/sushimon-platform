import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Capturas complementarias del prototipo para el seguimiento de pedido: `pedidos/:id` (domicilio, recoger,
 * con avance de demostración, con la página completa), consulta con error genérico e incidencias con
 * pedidos. Solo bajo demanda:
 *   CAPTURE_PROTOTYPE=1 E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual gallery-tracking
 * Salida: docs/ui/extracted/screens/store-{tracking,tracking-full,tracking-demo,tracking-pickup,
 * consultar-error,incidencias-orders}-{viewport}-{theme}.png (ignorado por git).
 * La tienda usa MemoryRouter: se navega haciendo clic en los enlaces internos.
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const TALL = { desktop: 1700, mobile: 2700 } as const;

async function storeLink(page: Page, href: string) {
  const link = page.locator(`a[href="${href}"]:visible`).first();
  if (!(await link.count())) await page.locator('a[href="/mas"]:visible').first().click();
  await page.locator(`a[href="${href}"]:visible`).first().click();
  await page.waitForTimeout(250);
}

async function consult(page: Page, orderNumber: string, phone: string) {
  await storeLink(page, '/consultar');
  await page.locator('#tr-id').fill(orderNumber);
  await page.locator('#tr-phone').fill(phone);
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
}

async function openTracking(page: Page, orderNumber = 'MON-490217') {
  await consult(page, orderNumber, '5555-1234');
  await page.getByRole('heading', { level: 1, name: orderNumber }).waitFor();
  await page.waitForTimeout(300);
}

async function tall(page: Page, viewport: keyof typeof VIEWPORTS) {
  await page.setViewportSize({ width: VIEWPORTS[viewport].width, height: TALL[viewport] });
  await page.waitForTimeout(200);
}

const SCREENS: Record<string, (page: Page, viewport: keyof typeof VIEWPORTS) => Promise<void>> = {
  tracking: (p) => openTracking(p),
  'tracking-full': async (p, v) => {
    await openTracking(p);
    await tall(p, v);
  },
  'tracking-demo': async (p, v) => {
    await openTracking(p);
    // El pedido de la demo está "En camino": un avance lo deja en "Entregado" (otro lo terminaría).
    await p.getByRole('button', { name: 'Ver siguiente estado (simulación)' }).click();
    await p.waitForTimeout(200);
    await tall(p, v);
  },
  'tracking-pickup': async (p, v) => {
    await openTracking(p, 'MON-482193');
    await tall(p, v);
  },
  'consultar-error': async (p) => {
    await consult(p, 'MON-490217', '5555-9999');
    await p.getByText(/No encontramos un pedido/).waitFor();
    await p.waitForTimeout(200);
  },
  'incidencias-orders': async (p) => {
    await openTracking(p);
    await storeLink(p, '/incidencias');
    await p.getByText('Tus últimos pedidos').waitFor();
    await p.waitForTimeout(200);
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [screen, go] of Object.entries(SCREENS)) {
      test(`store/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
        test.skip(!process.env.CAPTURE_PROTOTYPE, 'Solo bajo demanda (CAPTURE_PROTOTYPE=1).');
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT });
        await page.goto(pathToFileURL(PROTOTYPES.store).href);
        await expect(page.locator('#root')).not.toBeEmpty();
        await go(page, viewport);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `store-${screen}-${viewport}-${theme}.png`), await capture(page));
      });
    }
  }
}
