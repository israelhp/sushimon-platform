import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';
import { demoStaffFromSeed } from '../../src/mocks/fixtures/staff';

/**
 * Fidelidad de Sucursales, Usuarios (+ modal) y Reportes (resumen e historial) frente a las capturas del
 * prototipo (`docs/ui/extracted/screens/bo-*`; las extra salen de `gallery-bo-admin.spec.ts`).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3231 pnpm --filter sushimon-web exec playwright test --project=visual bo-admin
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);

/** Sesión de demostración del administrador, con los `grants` que calcula el mock (F03). */
const ADMIN = demoStaffFromSeed('u1');

interface Screen {
  /** Prefijo de la captura del prototipo (`{reference}-{viewport}-{theme}.png`). */
  reference: string;
  path: string;
  /** Umbral propio (justificado en el comentario del caso); por defecto `MAX_RATIO`. */
  max?: number;
  step?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const visible = (page: Page, role: 'button' | 'tab', name: string | RegExp, exact = false) =>
  page.getByRole(role, { name, exact }).filter({ visible: true }).first();

const branches = (p: Page) => p.getByText(/sucursales configuradas/).waitFor({ timeout: 90_000 });
const users = (p: Page) => p.getByText(/^\d+ usuarios?$/).waitFor({ timeout: 90_000 });
const reports = (p: Page) =>
  p.getByRole('img', { name: /Pedidos por día y sucursal/ }).waitFor({ timeout: 90_000 });

const SCREEN_LIST: Record<string, Screen> = {
  sucursales: { reference: 'bo-sucursales', path: '/backoffice/sucursales', ready: branches },
  usuarios: { reference: 'bo-usuarios', path: '/backoffice/usuarios', ready: users },
  'usuarios-modal': {
    reference: 'bo-usuarios-modal',
    path: '/backoffice/usuarios',
    ready: users,
    step: async (p) => {
      await visible(p, 'button', /Nuevo usuario/).click();
      await p.getByRole('dialog', { name: 'Nuevo usuario' }).waitFor();
      await p.waitForTimeout(300);
    },
  },
  reportes: { reference: 'bo-reportes', path: '/backoffice/reportes', ready: reports },
  'reportes-historial': {
    reference: 'bo-reportes-historial',
    path: '/backoffice/reportes',
    ready: reports,
    step: async (p) => {
      await visible(p, 'tab', 'Historial de pedidos').click();
      await p.getByRole('heading', { name: 'Pedidos del periodo' }).waitFor();
      await p.waitForTimeout(300);
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, screen] of Object.entries(SCREEN_LIST)) {
      test(`bo-admin/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${screen.reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        test.setTimeout(120_000);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        const session = JSON.stringify({ customer: null, staff: ADMIN });
        await page.addInitScript(
          ([theme, session]) => {
            localStorage.setItem('monsushi-theme', theme!);
            sessionStorage.setItem('monsushi-demo-session-v1', session!);
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
          `[visual] bo-admin/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(screen.max ?? MAX_RATIO);
      });
    }
  }
}
