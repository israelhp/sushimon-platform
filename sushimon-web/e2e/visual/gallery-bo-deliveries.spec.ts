import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Captura complementaria del prototipo del backoffice: Entregas (con filtros y detalle) y el modal Despachar en
 * todos sus pasos (elegir, cargando, cotización PedidosYa, repartidor propio, propio con selección) más el
 * seguimiento de un pedido ya despachado. Solo bajo demanda (el login del prototipo es simulado; red bloqueada):
 *   CAPTURE_PROTOTYPE=1 pnpm --filter sushimon-web exec playwright test --project=visual gallery-bo-deliveries
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

const openOrder = async (page: Page, code: RegExp) => {
  await page.getByText(code).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
};

const toEntregas = async (page: Page) => {
  await login(page);
  await nav(page, 'Entregas');
};

/** Pedidos → detalle del pedido listo SM-7052 → "Despachar pedido" (paso: elegir). */
const toDispatch = async (page: Page) => {
  await login(page);
  await nav(page, 'Pedidos');
  await openOrder(page, /^#?SM-7052/);
  await page
    .getByRole('button', { name: /despachar pedido/i })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForTimeout(300);
};

const SCREENS: Record<string, Step> = {
  'entregas-filtros': async (p) => {
    await toEntregas(p);
    await p.getByRole('button', { name: '7 días', exact: true }).click();
    await p.getByRole('button', { name: 'Con diferencia', exact: true }).click();
    await p.waitForTimeout(300);
  },
  'entregas-detalle': async (p) => {
    await toEntregas(p);
    await openOrder(p, /^#?SM-7049/);
  },
  'despacho-elegir': toDispatch,
  'despacho-cargando': async (p) => {
    await toDispatch(p);
    await p.getByRole('button', { name: /PedidosYa Courier/ }).click();
    await p.waitForTimeout(150);
  },
  'despacho-cotizacion': async (p) => {
    await toDispatch(p);
    await p.getByRole('button', { name: /PedidosYa Courier/ }).click();
    await p.waitForTimeout(1700);
  },
  'despacho-propio': async (p) => {
    await toDispatch(p);
    await p.getByRole('button', { name: /Repartidor del restaurante/ }).click();
    await p.waitForTimeout(300);
  },
  'despacho-propio-elegido': async (p) => {
    await toDispatch(p);
    await p.getByRole('button', { name: /Repartidor del restaurante/ }).click();
    await p.getByRole('radio', { name: /Pedro Ajanel/ }).click();
    await p.waitForTimeout(300);
  },
  'despacho-solicitado': async (p) => {
    await toDispatch(p);
    await p.getByRole('button', { name: /PedidosYa Courier/ }).click();
    await p.waitForTimeout(1700);
    await p.getByRole('button', { name: 'Confirmar y solicitar' }).click();
    await p.waitForTimeout(500);
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
