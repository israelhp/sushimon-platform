import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Captura complementaria del prototipo: ficha de producto ABIERTA (la galería general no logra abrirla)
 * en desktop y móvil, claro/oscuro. Solo bajo demanda:
 *   CAPTURE_PROTOTYPE=1 E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual gallery-menu
 * Salida: docs/ui/extracted/screens/store-product-sheet-{viewport}-{theme}.png (ignorado por git).
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

async function openSheet(page: Page) {
  const menu = page.locator('a[href="/menu"]:visible').first();
  if (!(await menu.count())) await page.locator('a[href="/mas"]:visible').first().click();
  await page.locator('a[href="/menu"]:visible').first().click();
  await page.waitForTimeout(250);
  await page
    .getByRole('button', { name: /Dumplings/ })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(300);
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    test(`store/product-sheet-open · ${viewport} · ${theme}`, async ({ page }) => {
      test.skip(!process.env.CAPTURE_PROTOTYPE, 'Solo bajo demanda (CAPTURE_PROTOTYPE=1).');
      await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT });
      await page.goto(pathToFileURL(PROTOTYPES.store).href);
      await expect(page.locator('#root')).not.toBeEmpty();
      await openSheet(page);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `store-product-sheet-${viewport}-${theme}.png`), await capture(page));
    });
  }
}
