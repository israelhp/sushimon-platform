import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, capture, preparePage, VIEWPORTS } from './harness';

/**
 * Galería de referencia: capturas de los prototipos (red bloqueada, reloj congelado) para que
 * quien implemente una pantalla la compare a ojo. Proyecto `gallery`, solo bajo demanda:
 *   pnpm --filter sushimon-web capture:prototypes
 * Salida: docs/ui/extracted/screens/ (ignorado por git).
 */

const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
export const DEMO_NOW = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

type Step = (page: Page) => Promise<void>;

const STORE_SCREENS: Record<string, Step> = {
  home: async () => {},
  menu: async (p) => {
    await p
      .getByRole('link', { name: /^Menú$/ })
      .first()
      .click();
  },
  promos: async (p) => {
    await p
      .getByRole('link', { name: /Promociones/ })
      .first()
      .click();
  },
  mas: async (p) => {
    await p.getByRole('link', { name: /^Más$/ }).first().click();
  },
};

const BO_SCREENS: Record<string, Step> = {
  login: async () => {},
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
        await page.waitForTimeout(300);
        await shoot(page, `store-${screen}-${viewport}-${theme}`);
      });
    }
    for (const [screen, go] of Object.entries(BO_SCREENS)) {
      test(`backoffice/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
        await preparePage(page, { theme, viewport, frozenAt: DEMO_NOW });
        await page.goto(pathToFileURL(PROTOTYPES.backoffice).href);
        await page.waitForTimeout(1500);
        await go(page);
        await shoot(page, `bo-${screen}-${viewport}-${theme}`);
      });
    }
  }
}
