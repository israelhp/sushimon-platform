import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DUMPLINGS, cartV2 } from '../support/cart';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad del armazón de la tienda (encabezado, navegación, pie, carrito, modo de pedido) y del Inicio
 * frente a las capturas del prototipo (`pnpm capture:prototypes`, en docs/ui/extracted/screens/).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual store-shell
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
/** Umbral de regresión (ratio de píxeles distintos). El objetivo real es mucho menor; ver el reporte. */
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);

type Step = (page: Page) => Promise<void>;

const CART_FIXTURE = cartV2('sucursal-1', [
  DUMPLINGS,
  { productId: 'loco-ribs', name: 'Loco Ribs', unitCents: 4200 },
]);

async function ready(page: Page) {
  await page.getByRole('heading', { name: /hambre/i }).waitFor();
  // F17 (P23): sin destacados la sección «Favoritos» del Inicio no se renderiza; el ancla es «¿Tenés hambre?».
  await page.waitForTimeout(300);
}

const STEPS: Record<string, { step: Step; reference: string; fullHeight?: number }> = {
  home: { step: async () => {}, reference: 'store-home' },
  'home-full': { step: async () => {}, reference: 'store-home-full', fullHeight: 3200 },
  'cart-drawer': {
    reference: 'store-cart-drawer',
    step: async (p) => {
      await p
        .getByRole('button', { name: /Ver tu pedido/ })
        .filter({ visible: true })
        .first()
        .click();
      await p.getByRole('dialog', { name: 'Tu pedido' }).waitFor();
      await p.waitForTimeout(300);
    },
  },
  'order-mode-sheet': {
    reference: 'store-order-mode-sheet',
    step: async (p) => {
      await p
        .getByRole('button', { name: /Iniciar pedido/ })
        .filter({ visible: true })
        .first()
        .click();
      await p.getByRole('dialog').waitFor();
      await p.waitForTimeout(300);
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, { step, reference, fullHeight }] of Object.entries(STEPS)) {
      test(`store-shell/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        await page.addInitScript(
          ([theme, cart]) => {
            localStorage.setItem('monsushi-theme', theme!);
            if (cart) {
              localStorage.setItem('monsushi-cart-v2', cart);
              localStorage.setItem(
                'monsushi-order-mode-v1',
                JSON.stringify({
                  type: 'pickup',
                  when: { kind: 'now' },
                  branchId: 'sucursal-1',
                  address: null,
                }),
              );
            }
          },
          [theme, name === 'cart-drawer' ? CART_FIXTURE : ''] as const,
        );
        await page.goto(BASE);
        if (fullHeight) {
          await page.setViewportSize({ width: VIEWPORTS[viewport].width, height: fullHeight });
        }
        await ready(page);
        await step(page);
        const app = await capture(page);
        const result = await compareAndAttach(
          `${name}-${viewport}-${theme}`,
          readFileSync(file),
          app,
          testInfo,
        );
        console.log(
          `[visual] store-shell/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(MAX_RATIO);
      });
    }
  }
}
