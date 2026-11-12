import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad de Cuenta, Más, Trabaja con nosotros y 404 frente a las capturas del prototipo
 * (`docs/ui/extracted/screens/`; las de sesión iniciada salen de `gallery-account.spec.ts`).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3204 pnpm --filter sushimon-web exec playwright test --project=visual store-account
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);

const DEMO_SESSION = JSON.stringify({
  customer: { email: 'cliente@ejemplo.com', name: 'Cliente Demo', provider: 'google-demo' },
  staff: null,
});

interface Screen {
  /** Prefijo de la captura del prototipo (`{reference}-{viewport}-{theme}.png`). */
  reference: string;
  path: string;
  signedIn?: boolean;
  /** Acción posterior a la carga (abrir un modal, cambiar de pestaña…). */
  step?: (page: Page) => Promise<void>;
  /** Texto accesible que indica que la pantalla ya pintó sus datos. */
  ready: { role: 'heading' | 'button'; name: string | RegExp };
}

const visible = (page: Page, role: 'button' | 'tab', name: RegExp) =>
  page.getByRole(role, { name }).filter({ visible: true }).first();

const STEPS: Record<string, Screen> = {
  cuenta: {
    reference: 'store-cuenta',
    path: '/cuenta',
    ready: { role: 'heading', name: /Mi cuenta/ },
  },
  'cuenta-signed': {
    reference: 'store-cuenta-signed',
    path: '/cuenta',
    signedIn: true,
    ready: { role: 'heading', name: /Mi cuenta/ },
    step: async (p) => {
      await p.getByText('cliente@ejemplo.com').first().waitFor();
      await p
        .getByText(/direcciones guardadas/)
        .first()
        .waitFor();
    },
  },
  'auth-modal': {
    reference: 'store-auth-modal',
    path: '/cuenta',
    ready: { role: 'heading', name: /Mi cuenta/ },
    step: async (p) => {
      await visible(p, 'button', /Continuar con Google/).click();
      await p.getByRole('dialog').waitFor();
    },
  },
  'cuenta-datos': {
    reference: 'store-cuenta-datos',
    path: '/cuenta/datos',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis datos personales' },
    step: async (p) => {
      await p.getByLabel('Nombre completo').waitFor();
    },
  },
  'cuenta-direcciones': {
    reference: 'store-cuenta-direcciones',
    path: '/cuenta/direcciones',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis direcciones' },
    step: async (p) => {
      await p.getByText('Predeterminada').first().waitFor();
      await p
        .getByText(/Con envío desde/)
        .first()
        .waitFor();
    },
  },
  'cuenta-direcciones-form': {
    reference: 'store-cuenta-direcciones-form',
    path: '/cuenta/direcciones',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis direcciones' },
    step: async (p) => {
      await p.getByText('Predeterminada').first().waitFor();
      await visible(p, 'button', /Agregar dirección/).click();
      await p.getByRole('dialog', { name: 'Nueva dirección' }).waitFor();
    },
  },
  'cuenta-favoritos': {
    reference: 'store-cuenta-favoritos',
    path: '/cuenta/favoritos',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis favoritos' },
    step: async (p) => {
      await p.getByText('Platanito Roll').first().waitFor();
    },
  },
  'cuenta-favoritos-invitado': {
    reference: 'store-cuenta-favoritos-invitado',
    path: '/cuenta/favoritos',
    ready: { role: 'heading', name: 'Mis favoritos' },
  },
  'cuenta-pedidos': {
    reference: 'store-cuenta-pedidos',
    path: '/cuenta/pedidos',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis pedidos' },
    step: async (p) => {
      await p
        .getByText(/MON-\d+/)
        .first()
        .waitFor();
    },
  },
  'cuenta-pedidos-historial': {
    reference: 'store-cuenta-pedidos-historial',
    path: '/cuenta/pedidos',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis pedidos' },
    step: async (p) => {
      await visible(p, 'tab', /Historial/).click();
      await p
        .getByText(/MON-\d+/)
        .first()
        .waitFor();
    },
  },
  'cuenta-reorden': {
    reference: 'store-cuenta-reorden',
    path: '/cuenta/pedidos',
    signedIn: true,
    ready: { role: 'heading', name: 'Mis pedidos' },
    step: async (p) => {
      await visible(p, 'tab', /Historial/).click();
      await visible(p, 'button', /Volver a pedir/).click();
      await p.getByRole('dialog', { name: 'Volver a pedir' }).waitFor();
      await p.getByText(/Subtotal con precios de hoy/).waitFor();
    },
  },
  mas: { reference: 'store-mas', path: '/mas', ready: { role: 'heading', name: /^Más/ } },
  'mas-signed': {
    reference: 'store-mas-signed',
    path: '/mas',
    signedIn: true,
    ready: { role: 'heading', name: /^Más/ },
  },
  trabaja: {
    reference: 'store-trabaja',
    path: '/trabaja-con-nosotros',
    ready: { role: 'heading', name: /MONcheros/ },
  },
  '404': {
    reference: 'store-404',
    path: '/ruta-que-no-existe',
    ready: { role: 'heading', name: 'Este roll no existe' },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, screen] of Object.entries(STEPS)) {
      test(`store-account/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${screen.reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        test.setTimeout(120_000);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        await page.addInitScript(
          ([theme, session]) => {
            localStorage.setItem('monsushi-theme', theme!);
            if (session) sessionStorage.setItem('monsushi-demo-session-v1', session);
          },
          [theme, screen.signedIn ? DEMO_SESSION : ''] as const,
        );
        await page.goto(BASE + screen.path);
        await page
          .getByRole(screen.ready.role, { name: screen.ready.name })
          .first()
          .waitFor({ timeout: 90_000 });
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
          `[visual] store-account/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(MAX_RATIO);
      });
    }
  }
}
