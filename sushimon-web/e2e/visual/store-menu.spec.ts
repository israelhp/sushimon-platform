import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad del Menú, la ficha de producto y Promociones frente a las capturas del prototipo
 * (`pnpm capture:prototypes` y `gallery-menu.spec.ts`, en docs/ui/extracted/screens/).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual store-menu
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);
/**
 * Promociones en móvil agrega una insignia de estado ("Hoy a partir de las 3:00 p. m.", pedida por la
 * spec y ausente del prototipo) que baja el resto de la pantalla una fila: el umbral de regresión es mayor.
 */
const MAX_RATIO_OVERRIDES: Record<string, number> = { 'promos/mobile': 0.2 };

type Step = (page: Page) => Promise<void>;

const menuReady = async (page: Page) => {
  await page.getByRole('heading', { name: /^Menú/ }).waitFor();
  await page.getByRole('heading', { name: /^Entradas/ }).waitFor();
  await page.waitForTimeout(300);
};

const STEPS: Record<string, { path: string; reference: string; step: Step }> = {
  menu: { path: '/menu', reference: 'store-menu', step: async () => {} },
  'product-sheet': {
    path: '/menu',
    reference: 'store-product-sheet',
    step: async (p) => {
      await p
        .getByRole('button', { name: /Dumplings/ })
        .filter({ visible: true })
        .first()
        .click();
      await p.getByRole('dialog', { name: 'Dumplings' }).waitFor();
      await p.waitForTimeout(300);
    },
  },
  promos: { path: '/promociones', reference: 'store-promos', step: async () => {} },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, { path, reference, step }] of Object.entries(STEPS)) {
      test(`store-menu/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
        await page.goto(`${BASE}${path}`);
        if (name === 'promos') {
          await page.getByText('Papas Mon Locas').first().waitFor();
          await page.waitForTimeout(300);
        } else {
          await menuReady(page);
        }
        await step(page);
        const app = await capture(page);
        const result = await compareAndAttach(
          `${name}-${viewport}-${theme}`,
          readFileSync(file),
          app,
          testInfo,
        );
        console.log(
          `[visual] store-menu/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(MAX_RATIO_OVERRIDES[`${name}/${viewport}`] ?? MAX_RATIO);
      });
    }
  }
}
