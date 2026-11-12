import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad de Entregas y del modal Despachar (elegir, cotización PedidosYa simulada, repartidor propio) frente
 * a las capturas del prototipo (`docs/ui/extracted/screens/bo-*`; las extra salen de `gallery-bo-deliveries.spec.ts`).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3231 pnpm --filter sushimon-web exec playwright test --project=visual bo-deliveries
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);

const SESSIONS = {
  admin: {
    userId: 'u1',
    email: 'ana.perez@sushimon.gt',
    name: 'Ana Lucía Pérez',
    role: 'admin',
    branchId: null,
  },
} as const;

interface Screen {
  /** Prefijo de la captura del prototipo (`{reference}-{viewport}-{theme}.png`). */
  reference: string;
  path: string;
  /** Umbral propio (justificado en el comentario del caso); por defecto `MAX_RATIO`. */
  max?: number;
  step?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const visible = (page: Page, role: 'button' | 'radio', name: string | RegExp, exact = false) =>
  page.getByRole(role, { name, exact }).filter({ visible: true }).first();

const entregas = (p: Page) =>
  p
    .getByRole('heading', { name: 'Entregas', level: 1 })
    .waitFor({ timeout: 90_000 })
    .then(() =>
      p
        .getByText(/MON-3070\d\d/)
        .first()
        .waitFor({ timeout: 90_000 }),
    );
const board = (p: Page) =>
  p
    .getByText(/MON-3070\d\d/)
    .first()
    .waitFor({ timeout: 90_000 });

/** Pedidos → "Despachar pedido" del primer pedido listo (a domicilio, sin logística) → paso elegir. */
const toDispatch = async (p: Page) => {
  // Como en el prototipo, el modal se abre desde el detalle del pedido (que queda detrás del velo).
  const ready = p.locator('.kcard', {
    has: p.getByRole('button', { name: 'Despachar pedido' }),
  });
  await ready.filter({ visible: true }).last().locator('.kcard-main').click();
  const drawer = p.getByRole('dialog').first();
  await drawer.waitFor();
  await drawer.getByRole('button', { name: /despachar pedido/i }).click();
  await p.getByRole('dialog', { name: 'Despachar pedido' }).waitFor();
  await p.waitForTimeout(300);
};

const SCREEN_LIST: Record<string, Screen> = {
  entregas: { reference: 'bo-entregas', path: '/backoffice/entregas', ready: entregas },
  'entregas-filtros': {
    reference: 'bo-entregas-filtros',
    path: '/backoffice/entregas',
    ready: entregas,
    step: async (p) => {
      await visible(p, 'button', '7 días', true).click();
      await visible(p, 'button', 'Con diferencia', true).click();
      await p.waitForTimeout(300);
    },
  },
  'entregas-detalle': {
    reference: 'bo-entregas-detalle',
    path: '/backoffice/entregas',
    ready: entregas,
    step: async (p) => {
      // MON-307049 = el pedido «en camino» con PedidosYa (equivale al SM-7049 del prototipo).
      await visible(p, 'button', /^Ver seguimiento de #?MON-307049/).click();
      await p.getByRole('dialog').waitFor();
      await p.waitForTimeout(400);
    },
  },
  'despacho-elegir': {
    reference: 'bo-despacho-elegir',
    path: '/backoffice/pedidos',
    ready: board,
    step: toDispatch,
  },
  'despacho-cotizacion': {
    reference: 'bo-despacho-cotizacion',
    path: '/backoffice/pedidos',
    ready: board,
    step: async (p) => {
      await toDispatch(p);
      await visible(p, 'button', /PedidosYa Courier/).click();
      await p.getByRole('button', { name: 'Confirmar y solicitar' }).waitFor();
      await p.waitForTimeout(300);
    },
  },
  'despacho-propio': {
    reference: 'bo-despacho-propio',
    path: '/backoffice/pedidos',
    ready: board,
    step: async (p) => {
      await toDispatch(p);
      await visible(p, 'button', /Repartidor del restaurante/).click();
      await p.getByRole('dialog', { name: 'Repartidor del restaurante' }).waitFor();
      await p.waitForTimeout(300);
    },
  },
  'despacho-propio-elegido': {
    reference: 'bo-despacho-propio-elegido',
    path: '/backoffice/pedidos',
    ready: board,
    step: async (p) => {
      await toDispatch(p);
      await visible(p, 'button', /Repartidor del restaurante/).click();
      await p.getByRole('dialog', { name: 'Repartidor del restaurante' }).waitFor();
      await visible(p, 'radio', /./).click();
      await p.waitForTimeout(300);
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, screen] of Object.entries(SCREEN_LIST)) {
      test(`bo-deliveries/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${screen.reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        test.setTimeout(120_000);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        const session = JSON.stringify({ customer: null, staff: SESSIONS.admin });
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
          `[visual] bo-deliveries/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(screen.max ?? MAX_RATIO);
      });
    }
  }
}
