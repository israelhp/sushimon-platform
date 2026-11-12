import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad de la consulta de invitado, el seguimiento de pedido y los reclamos frente a las capturas del
 * prototipo (`pnpm capture:prototypes` y `gallery-tracking`, en docs/ui/extracted/screens/). Reporte de
 * diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual store-tracking
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);
const TALL = { desktop: 1700, mobile: 2700 } as const;

type Viewport = keyof typeof VIEWPORTS;
type Step = (page: Page, viewport: Viewport) => Promise<void>;

async function consult(page: Page, orderNumber: string, phone: string) {
  await page.goto(`${BASE}/consultar`);
  await page.locator('#tr-id').fill(orderNumber);
  await page.locator('#tr-phone').fill(phone);
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
}

async function openTracking(page: Page, orderNumber = 'MON-490217') {
  await consult(page, orderNumber, '5555-1234');
  await page.getByRole('heading', { level: 1, name: orderNumber }).waitFor();
}

/** Lleva el pedido de la demo al mismo estado que el prototipo ("En camino") con el botón de demostración. */
async function advanceToOnTheWay(page: Page) {
  const next = page.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
  for (let i = 0; i < 8; i++) {
    if (
      await page
        .locator('main span.inline-flex.rounded-full', { hasText: /^En camino$/ })
        .first()
        .isVisible()
    )
      return;
    await next.click();
    await page.waitForTimeout(150);
  }
}

async function tall(page: Page, viewport: Viewport) {
  await page.setViewportSize({ width: VIEWPORTS[viewport].width, height: TALL[viewport] });
  await page.waitForTimeout(200);
}

const STEPS: Record<string, { reference: string; step: Step }> = {
  consultar: {
    reference: 'store-consultar',
    step: async (p) => {
      await p.goto(`${BASE}/consultar`);
      await p.getByRole('heading', { level: 1 }).waitFor();
    },
  },
  incidencias: {
    reference: 'store-incidencias',
    step: async (p) => {
      await p.goto(`${BASE}/incidencias`);
      await p.getByText('No encontramos pedidos en este dispositivo.').waitFor();
    },
  },
  'consultar-error': {
    reference: 'store-consultar-error',
    step: async (p) => {
      await consult(p, 'MON-490217', '5555-9999');
      await p.getByText(/No encontramos un pedido/).waitFor();
    },
  },
  tracking: {
    reference: 'store-tracking',
    step: async (p) => {
      await openTracking(p);
      await advanceToOnTheWay(p);
    },
  },
  'tracking-full': {
    reference: 'store-tracking-full',
    step: async (p, v) => {
      await openTracking(p);
      await advanceToOnTheWay(p);
      await tall(p, v);
    },
  },
  'tracking-demo': {
    reference: 'store-tracking-demo',
    step: async (p, v) => {
      await openTracking(p);
      await advanceToOnTheWay(p);
      await p.getByRole('button', { name: 'Ver siguiente estado (simulación)' }).click();
      await tall(p, v);
    },
  },
  'tracking-pickup': {
    reference: 'store-tracking-pickup',
    step: async (p, v) => {
      await openTracking(p, 'MON-482193');
      await tall(p, v);
    },
  },
  'incidencias-orders': {
    reference: 'store-incidencias-orders',
    step: async (p) => {
      await openTracking(p);
      await p.goto(`${BASE}/incidencias`);
      await p.getByText('Tus últimos pedidos').waitFor();
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as Viewport[]) {
    for (const [name, { step, reference }] of Object.entries(STEPS)) {
      test(`store-tracking/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
        await step(page, viewport);
        await page.waitForTimeout(300);
        const app = await capture(page);
        const result = await compareAndAttach(
          `${name}-${viewport}-${theme}`,
          readFileSync(file),
          app,
          testInfo,
        );
        console.log(
          `[visual] store-tracking/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(MAX_RATIO);
      });
    }
  }
}
