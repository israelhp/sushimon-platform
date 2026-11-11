import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Captura complementaria del prototipo del backoffice para el catálogo: productos en tabla, como encargado, modal
 * Producto (alta y con error) y modal Promoción (alta y con error). La galería general ya cubre las pantallas base.
 * Solo bajo demanda (el login del prototipo es simulado; la red sigue bloqueada):
 *   CAPTURE_PROTOTYPE=1 pnpm --filter sushimon-web exec playwright test --project=visual gallery-bo-catalog
 * Salida: docs/ui/extracted/screens/bo-{pantalla}-{viewport}-{theme}.png (ignorado por git).
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

type Step = (page: Page) => Promise<void>;

async function login(page: Page, profile?: RegExp) {
  if (profile) await page.getByRole('button', { name: profile }).click();
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

const toScreen = async (page: Page, label: string, profile?: RegExp) => {
  await login(page, profile);
  await nav(page, label);
};

const click = async (page: Page, name: string | RegExp, exact = true) => {
  await page.getByRole('button', { name, exact }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
};

const SCREENS: Record<string, Step> = {
  'productos-tabla': async (p) => {
    await toScreen(p, 'Productos');
    await click(p, 'Tabla');
  },
  'productos-encargado': (p) => toScreen(p, 'Productos', /Marco Antonio Gómez/),
  'productos-modal': async (p) => {
    await toScreen(p, 'Productos');
    await click(p, 'Nuevo producto');
  },
  'productos-modal-error': async (p) => {
    await toScreen(p, 'Productos');
    await click(p, 'Nuevo producto');
    await click(p, 'Guardar producto');
  },
  'productos-modal-editar': async (p) => {
    await toScreen(p, 'Productos');
    await click(p, 'Editar California Roll');
  },
  'promociones-modal': async (p) => {
    await toScreen(p, 'Promociones');
    await click(p, 'Nueva promoción');
  },
  'promociones-modal-error': async (p) => {
    await toScreen(p, 'Promociones');
    await click(p, 'Nueva promoción');
    await click(p, 'Crear promoción');
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [screen, step] of Object.entries(SCREENS)) {
      test(`bo-catalog/${screen} · ${viewport} · ${theme}`, async ({ page }) => {
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
