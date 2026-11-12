import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Captura complementaria del prototipo del backoffice: modal Usuario (Usuarios) e Historial de pedidos (Reportes).
 * Solo bajo demanda (el login del prototipo es simulado; red bloqueada):
 *   CAPTURE_PROTOTYPE=1 pnpm --filter sushimon-web exec playwright test --project=visual gallery-bo-admin
 * Salida: docs/ui/extracted/screens/bo-{pantalla}-{viewport}-{theme}.png (ignorado por git).
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

type Step = (page: Page) => Promise<void>;

async function login(page: Page) {
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForTimeout(600);
}

async function nav(page: Page, label: string) {
  if (page.viewportSize()!.width < 900) {
    await page.getByRole('button', { name: /abrir menú/i }).click();
    await page.waitForTimeout(300);
  }
  await page.locator('nav, aside').getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(400);
}

const SCREENS: Record<string, Step> = {
  'usuarios-modal': async (p) => {
    await login(p);
    await nav(p, 'Usuarios');
    await p
      .getByRole('button', { name: /Nuevo usuario/ })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(400);
  },
  'reportes-historial': async (p) => {
    await login(p);
    await nav(p, 'Reportes');
    await p
      .getByText('Historial de pedidos', { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(400);
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [screen, step] of Object.entries(SCREENS)) {
      test(`bo/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
        test.skip(!process.env.CAPTURE_PROTOTYPE, 'Solo bajo demanda (CAPTURE_PROTOTYPE=1).');
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT });
        await page.goto(pathToFileURL(PROTOTYPES.backoffice).href);
        await page.getByRole('button', { name: 'Ingresar' }).waitFor();
        await step(page);
        mkdirSync(OUT, { recursive: true });
        await expect(page.locator('body')).toBeVisible();
        writeFileSync(join(OUT, `bo-${screen}-${viewport}-${theme}.png`), await capture(page));
      });
    }
  }
}
