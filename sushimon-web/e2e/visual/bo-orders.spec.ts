import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';
import { demoStaffFromSeed } from '../../src/mocks/fixtures/staff';

/**
 * Fidelidad del backoffice (login, shell, Panel y Pedidos) frente a las capturas del prototipo
 * (`docs/ui/extracted/screens/bo-*`; las extra salen de `gallery-bo-orders.spec.ts`).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3210 pnpm --filter sushimon-web exec playwright test --project=visual bo-orders
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);

/** Sesiones de demostración con los `grants` que calcula el mock (F03). */
const SESSIONS = {
  admin: demoStaffFromSeed('u1'),
  kitchen: demoStaffFromSeed('u5'),
} as const;

interface Screen {
  /** Prefijo de la captura del prototipo (`{reference}-{viewport}-{theme}.png`). */
  reference: string;
  path: string;
  /** Sin sesión de demostración si se omite. */
  staff?: keyof typeof SESSIONS;
  mobileOnly?: boolean;
  step?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const visible = (page: Page, role: 'button' | 'tab', name: string | RegExp, exact = false) =>
  page.getByRole(role, { name, exact }).filter({ visible: true }).first();

const board = (p: Page) =>
  p
    .getByText(/MON-3070\d\d/)
    .first()
    .waitFor({ timeout: 90_000 });
const openOrder = async (p: Page, code: RegExp) => {
  await p.getByText(code).filter({ visible: true }).first().click();
  await p.getByRole('dialog').waitFor();
  await p.waitForTimeout(300);
};
const burger = (p: Page) => visible(p, 'button', /abrir menú/i).click();

const SCREEN_LIST: Record<string, Screen> = {
  login: {
    reference: 'bo-login',
    path: '/backoffice/login',
    ready: (p) => p.getByRole('button', { name: 'Ingresar' }).waitFor({ timeout: 90_000 }),
  },
  panel: {
    reference: 'bo-panel',
    path: '/backoffice/panel',
    staff: 'admin',
    ready: (p) => p.getByText('Ventas del día').first().waitFor({ timeout: 90_000 }),
  },
  pedidos: {
    reference: 'bo-pedidos',
    path: '/backoffice/pedidos',
    staff: 'admin',
    ready: board,
  },
  'pedidos-tabla': {
    reference: 'bo-pedidos-tabla',
    path: '/backoffice/pedidos',
    staff: 'admin',
    ready: board,
    step: async (p) => {
      await visible(p, 'button', 'Tabla', true).click();
      await p.getByText('Todos los pedidos').waitFor();
    },
  },
  'pedidos-drawer': {
    reference: 'bo-pedidos-drawer',
    path: '/backoffice/pedidos',
    staff: 'admin',
    ready: board,
    step: (p) => openOrder(p, /^#MON-307057$/),
  },
  'pedidos-reject': {
    reference: 'bo-pedidos-reject',
    path: '/backoffice/pedidos',
    staff: 'admin',
    ready: board,
    step: async (p) => {
      await openOrder(p, /^#MON-307057$/);
      await visible(p, 'button', 'Rechazar', true).click();
      await p.getByRole('dialog', { name: 'Rechazar pedido' }).waitFor();
    },
  },
  'pedidos-drawer-despacho': {
    reference: 'bo-pedidos-drawer-despacho',
    path: '/backoffice/pedidos',
    staff: 'admin',
    ready: board,
    step: (p) => openOrder(p, /^#MON-307052$/),
  },
  'pedidos-toast': {
    reference: 'bo-pedidos-toast',
    path: '/backoffice/pedidos',
    staff: 'admin',
    ready: board,
    step: async (p) => {
      await visible(p, 'button', 'Aceptar pedido', true).click();
      await p
        .locator('.toast')
        .filter({ hasText: /aceptado/ })
        .waitFor();
    },
  },
  'pedidos-cocina': {
    reference: 'bo-pedidos-cocina',
    path: '/backoffice/pedidos',
    staff: 'kitchen',
    ready: board,
  },
  'pedidos-cocina-despacho': {
    reference: 'bo-pedidos-cocina-despacho',
    path: '/backoffice/pedidos',
    staff: 'kitchen',
    ready: board,
    step: (p) => openOrder(p, /^#MON-307051$/),
  },
  'shell-notif': {
    reference: 'bo-shell-notif',
    path: '/backoffice/panel',
    staff: 'admin',
    ready: (p) => p.getByText('Ventas del día').first().waitFor({ timeout: 90_000 }),
    step: async (p) => {
      await visible(p, 'button', /Pedidos nuevos/).click();
      await p.getByText('por aceptar').first().waitFor();
    },
  },
  'shell-user': {
    reference: 'bo-shell-user',
    path: '/backoffice/panel',
    staff: 'admin',
    ready: (p) => p.getByText('Ventas del día').first().waitFor({ timeout: 90_000 }),
    step: async (p) => {
      await visible(p, 'button', 'Menú de la cuenta').click();
      await p.getByText('Cambiar rol (demo)').waitFor();
    },
  },
  'shell-branch': {
    reference: 'bo-shell-branch',
    path: '/backoffice/panel',
    staff: 'admin',
    ready: (p) => p.getByText('Ventas del día').first().waitFor({ timeout: 90_000 }),
    step: async (p) => {
      if (p.viewportSize()!.width < 900) await burger(p);
      await p.locator('.brsel-btn').first().click();
      await p.locator('.menu-pop').waitFor();
    },
  },
  'shell-nav-mobile': {
    reference: 'bo-shell-nav-mobile',
    path: '/backoffice/panel',
    staff: 'admin',
    mobileOnly: true,
    ready: (p) => p.getByText('Ventas del día').first().waitFor({ timeout: 90_000 }),
    step: async (p) => {
      await burger(p);
      await p.waitForTimeout(400);
    },
  },
  'panel-cocina-nav': {
    reference: 'bo-panel-cocina-nav',
    path: '/backoffice/pedidos',
    staff: 'kitchen',
    ready: board,
    step: async (p) => {
      if (p.viewportSize()!.width < 900) await burger(p);
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, screen] of Object.entries(SCREEN_LIST)) {
      test(`bo-orders/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        test.skip(!!screen.mobileOnly && viewport !== 'mobile', 'Solo móvil');
        const file = join(SCREENS, `${screen.reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        test.setTimeout(120_000);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        const session = screen.staff
          ? JSON.stringify({ customer: null, staff: SESSIONS[screen.staff] })
          : '';
        await page.addInitScript(
          ([theme, session]) => {
            localStorage.setItem('monsushi-theme', theme!);
            if (session) sessionStorage.setItem('monsushi-demo-session-v1', session);
          },
          [theme, session] as const,
        );
        await page.goto(BASE + screen.path);
        await screen.ready(page);
        await screen.step?.(page);
        await page.waitForTimeout(500);
        const app = await capture(page);
        const result = await compareAndAttach(
          `${name}-${viewport}-${theme}`,
          readFileSync(file),
          app,
          testInfo,
        );
        console.log(
          `[visual] bo-orders/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(MAX_RATIO);
      });
    }
  }
}
