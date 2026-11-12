import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad del catálogo del backoffice (Productos, Categorías, Promociones y sus modales) frente a las capturas
 * del prototipo (`docs/ui/extracted/screens/bo-*`; las extra salen de `gallery-bo-catalog.spec.ts`).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 * Los datos del catálogo canónico (29 productos) difieren de los 18 del prototipo: parte de la diferencia es contenido.
 *   E2E_PORT=3231 pnpm --filter sushimon-web exec playwright test --project=visual bo-catalog
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
  manager: {
    userId: 'u2',
    email: 'marco.gomez@sushimon.gt',
    name: 'Marco Antonio Gómez',
    role: 'manager',
    branchId: 'sucursal-1',
  },
} as const;

interface Screen {
  /** Prefijo de la captura del prototipo (`{reference}-{viewport}-{theme}.png`). */
  reference: string;
  path: string;
  /** Umbral propio (justificado en el caso); por defecto `MAX_RATIO`. */
  max?: number;
  staff: keyof typeof SESSIONS;
  step?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
}

const click = async (p: Page, name: string) => {
  await p.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
  await p.waitForTimeout(300);
};

const products = (p: Page) =>
  p.getByRole('switch', { name: 'Disponible: Dumplings' }).waitFor({ timeout: 90_000 });
const categories = (p: Page) => p.getByText('Orden del menú').first().waitFor({ timeout: 90_000 });
const promotions = (p: Page) => p.getByText('Happy Hour 2x1').waitFor({ timeout: 90_000 });

const SCREEN_LIST: Record<string, Screen> = {
  productos: {
    reference: 'bo-productos',
    path: '/backoffice/productos',
    staff: 'admin',
    ready: products,
  },
  'productos-tabla': {
    reference: 'bo-productos-tabla',
    path: '/backoffice/productos',
    staff: 'admin',
    ready: products,
    step: (p) => click(p, 'Tabla'),
  },
  'productos-encargado': {
    reference: 'bo-productos-encargado',
    path: '/backoffice/productos',
    staff: 'manager',
    ready: products,
  },
  'productos-modal': {
    reference: 'bo-productos-modal',
    path: '/backoffice/productos',
    staff: 'admin',
    ready: products,
    step: async (p) => {
      await click(p, 'Nuevo producto');
      await p.getByRole('dialog', { name: 'Nuevo producto' }).waitFor();
    },
  },
  'productos-modal-error': {
    reference: 'bo-productos-modal-error',
    path: '/backoffice/productos',
    staff: 'admin',
    ready: products,
    step: async (p) => {
      await click(p, 'Nuevo producto');
      await click(p, 'Guardar producto');
      await p.getByRole('dialog').getByRole('alert').waitFor();
    },
  },
  'productos-modal-editar': {
    reference: 'bo-productos-modal-editar',
    path: '/backoffice/productos',
    // Intencional: el modal real añade «Nombre/Descripción en inglés» (es/en) y usa el catálogo canónico de 29
    // productos y sus categorías; el prototipo tiene 18 productos y no tiene esos campos (medido: 5–12.4 %).
    max: 0.15,
    staff: 'admin',
    ready: products,
    step: async (p) => {
      await click(p, 'Editar California Roll');
      await p.getByRole('dialog', { name: 'Editar producto' }).waitFor();
    },
  },
  categorias: {
    reference: 'bo-categorias',
    path: '/backoffice/categorias',
    staff: 'admin',
    ready: categories,
  },
  promociones: {
    reference: 'bo-promociones',
    path: '/backoffice/promociones',
    staff: 'admin',
    ready: promotions,
  },
  'promociones-modal': {
    reference: 'bo-promociones-modal',
    path: '/backoffice/promociones',
    staff: 'admin',
    ready: promotions,
    step: async (p) => {
      await click(p, 'Nueva promoción');
      await p.getByRole('dialog', { name: 'Nueva promoción' }).waitFor();
    },
  },
  'promociones-modal-error': {
    reference: 'bo-promociones-modal-error',
    path: '/backoffice/promociones',
    staff: 'admin',
    ready: promotions,
    step: async (p) => {
      await click(p, 'Nueva promoción');
      await click(p, 'Crear promoción');
      await p.getByRole('dialog').getByRole('alert').waitFor();
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, screen] of Object.entries(SCREEN_LIST)) {
      test(`bo-catalog/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${screen.reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        test.setTimeout(120_000);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        const session = JSON.stringify({ customer: null, staff: SESSIONS[screen.staff] });
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
          `[visual] bo-catalog/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(screen.max ?? MAX_RATIO);
      });
    }
  }
}
