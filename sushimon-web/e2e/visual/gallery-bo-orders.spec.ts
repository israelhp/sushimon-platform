import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Captura complementaria del prototipo del backoffice: tabla de pedidos, detalle, modal Rechazar, popovers
 * (notificaciones, usuario, sucursal), navegación móvil, aviso (toast) y estado de cocina. La galería general
 * solo cubre login, panel y tablero. Solo bajo demanda (el login del prototipo es simulado; la red sigue bloqueada):
 *   CAPTURE_PROTOTYPE=1 pnpm --filter sushimon-web exec playwright test --project=visual gallery-bo-orders
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

const toBoard = async (page: Page, profile?: RegExp) => {
  await login(page, profile);
  await nav(page, 'Pedidos');
};

const SCREENS: Record<string, Step> = {
  'pedidos-tabla': async (p) => {
    await toBoard(p);
    await p.getByRole('button', { name: 'Tabla', exact: true }).click();
    await p.waitForTimeout(300);
  },
  'pedidos-drawer': async (p) => {
    await toBoard(p);
    await openOrder(p, /^#?SM-7057/);
  },
  'pedidos-reject': async (p) => {
    await toBoard(p);
    await openOrder(p, /^#?SM-7057/);
    await p.getByRole('button', { name: 'Rechazar' }).click();
    await p.waitForTimeout(300);
  },
  'pedidos-drawer-despacho': async (p) => {
    await toBoard(p);
    await openOrder(p, /^#?SM-7052/);
  },
  'shell-notif': async (p) => {
    await login(p);
    await p.getByRole('button', { name: /Pedidos nuevos/ }).click();
    await p.waitForTimeout(300);
  },
  'shell-user': async (p) => {
    await login(p);
    await p.getByRole('button', { name: 'Menú de la cuenta' }).click();
    await p.waitForTimeout(300);
  },
  'shell-branch': async (p) => {
    await login(p);
    if (p.viewportSize()!.width < 900) {
      await p.getByRole('button', { name: /abrir menú/i }).click();
      await p.waitForTimeout(300);
    }
    await p.locator('.brsel-btn').first().click();
    await p.waitForTimeout(300);
  },
  'shell-nav-mobile': async (p) => {
    test.skip(p.viewportSize()!.width >= 900, 'Solo móvil');
    await login(p);
    await p.getByRole('button', { name: /abrir menú/i }).click();
    await p.waitForTimeout(400);
  },
  'pedidos-toast': async (p) => {
    await toBoard(p);
    await p
      .getByRole('button', { name: 'Aceptar pedido' })
      .filter({ visible: true })
      .first()
      .click();
    await p.waitForTimeout(250);
  },
  'pedidos-cocina': (p) => toBoard(p, /Cocina Zona 4/),
  'pedidos-cocina-despacho': async (p) => {
    await toBoard(p, /Cocina Zona 4/);
    await openOrder(p, /^#?SM-7051/);
  },
  'panel-cocina-nav': async (p) => {
    await login(p, /Cocina Zona 4/);
    if (p.viewportSize()!.width < 900) {
      await p.getByRole('button', { name: /abrir menú/i }).click();
      await p.waitForTimeout(300);
    }
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
