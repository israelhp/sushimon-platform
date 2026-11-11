import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, capture, compareAndAttach, preparePage } from './harness';

/**
 * Fidelidad del checkout (5 pasos, pasarela NeoNet y confirmación) frente a las capturas del prototipo
 * generadas por `gallery-checkout.spec.ts` (docs/ui/extracted/screens/store-checkout-*.png).
 * Reporte de diferencia de píxeles por pantalla; falla solo si la diferencia es grande (regresión).
 *   E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual store-checkout
 */
const SCREENS = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const MAX_RATIO = Number(process.env.VISUAL_MAX_RATIO ?? 0.12);

const DEMO_ADDRESS = {
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '10',
  line: '6a avenida 10-50, Edificio Demo, apto. 3',
  references: 'Portón negro, frente al parque',
};

interface Scenario {
  reference: string;
  type: 'pickup' | 'delivery';
  step: 1 | 2 | 3 | 4 | 5;
  payment?: 'card' | 'cash';
  /** Umbral propio cuando la diferencia con el prototipo es intencional (ver `neonet-pendiente`). */
  maxRatio?: number;
  /** Espera el título del paso y, después, acciones propias de la pantalla. */
  after?: (page: Page) => Promise<void>;
}

const STEP_TITLE = ['Tu pedido', 'Entrega', 'Envío', 'Pago', 'Confirmación'] as const;

const press = async (page: Page, name: string | RegExp, wait = 500) => {
  await page.getByRole('button', { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(wait);
};

const openGateway = async (page: Page) => {
  await press(page, /Pagar ahora/, 300);
  await page.getByRole('dialog', { name: 'Pasarela de pago' }).waitFor();
  await page.waitForTimeout(300);
};

const SCENARIOS: Record<string, Scenario> = {
  '1-pedido': { reference: 'store-checkout-1-pedido', type: 'pickup', step: 1 },
  '2-entrega': { reference: 'store-checkout-2-entrega', type: 'pickup', step: 2 },
  '3-envio-recoger': { reference: 'store-checkout-3-envio-recoger', type: 'pickup', step: 3 },
  '3-envio-domicilio': {
    reference: 'store-checkout-3-envio-domicilio',
    type: 'delivery',
    step: 3,
    after: async (p) => {
      await p.getByTestId('shipping-fee').waitFor();
      await p.waitForTimeout(300);
    },
  },
  '4-pago': { reference: 'store-checkout-4-pago', type: 'pickup', step: 4 },
  '5-confirmacion': { reference: 'store-checkout-5-confirmacion', type: 'pickup', step: 5 },
  'neonet-listo': {
    reference: 'store-checkout-neonet-listo',
    type: 'pickup',
    step: 5,
    after: openGateway,
  },
  'neonet-aprobado': {
    reference: 'store-checkout-neonet-aprobado',
    type: 'pickup',
    step: 5,
    after: async (p) => {
      await openGateway(p);
      await press(p, /Simular pago/, 600);
      await p.getByText('Pago aprobado').first().waitFor();
    },
  },
  'neonet-rechazado': {
    reference: 'store-checkout-neonet-rechazado',
    type: 'pickup',
    step: 5,
    after: async (p) => {
      await openGateway(p);
      await p.getByRole('button', { name: /4000 0000 0000 0002/ }).click();
      await press(p, /Simular pago/, 600);
      await p.getByText('No se pudo completar el pago').first().waitFor();
    },
  },
  'neonet-pendiente': {
    reference: 'store-checkout-neonet-pendiente',
    type: 'pickup',
    step: 5,
    // Diferencia intencional: agrega "Consultar pedido" (seguir con el pago en verificación) y omite el
    // panel "Modo de pruebas" del prototipo (con el adaptador mock no se puede forzar el resultado de la consulta).
    maxRatio: 0.3,
    after: async (p) => {
      await openGateway(p);
      await p.getByRole('button', { name: /4000 0000 0000 0077/ }).click();
      await press(p, /Simular pago/, 600);
      await p.getByText('Estamos verificando el estado de tu pago').first().waitFor();
    },
  },
  'pedido-efectivo': {
    reference: 'store-checkout-pedido-efectivo',
    type: 'pickup',
    step: 5,
    payment: 'cash',
    after: async (p) => {
      await press(p, /Realizar pedido/, 600);
      await p.getByRole('heading', { name: '¡Pedido registrado!' }).waitFor();
    },
  },
  'pedido-tarjeta': {
    reference: 'store-checkout-pedido-tarjeta',
    type: 'pickup',
    step: 5,
    after: async (p) => {
      await openGateway(p);
      await press(p, /Simular pago/, 600);
      await p.getByText('Pago aprobado').first().waitFor();
      await press(p, /Consultar pedido/, 600);
      await p.getByRole('heading', { name: '¡Pedido pagado!' }).waitFor();
    },
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      test(`store-checkout/${name} · ${viewport} · ${theme}`, async ({ page }, testInfo) => {
        const file = join(SCREENS, `${sc.reference}-${viewport}-${theme}.png`);
        test.skip(!existsSync(file), `Falta la captura del prototipo: ${file}`);
        await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT }, BASE);
        await page.addInitScript(
          ([theme, type, step, payment, address]) => {
            localStorage.setItem('monsushi-theme', theme!);
            localStorage.setItem(
              'monsushi-cart-v1',
              JSON.stringify([{ productId: 'dumplings', quantity: 1, note: '' }]),
            );
            localStorage.setItem(
              'monsushi-order-mode-v1',
              JSON.stringify({
                type,
                when: { kind: 'now' },
                branchId: null,
                address: type === 'delivery' ? JSON.parse(address!) : null,
              }),
            );
            sessionStorage.setItem(
              'monsushi-checkout-v1',
              JSON.stringify({
                step: Number(step),
                contact: { name: 'Cliente Demo', phone: '5555-1234', email: 'cliente@ejemplo.com' },
                address: JSON.parse(address!),
                addressId: 'other',
                notes: '',
                pickupBranchId: null,
                deliveryBranchId: null,
                payment,
              }),
            );
          },
          [
            theme,
            sc.type,
            String(sc.step),
            sc.payment ?? 'card',
            JSON.stringify(DEMO_ADDRESS),
          ] as const,
        );
        await page.goto(`${BASE}/checkout`);
        await page.getByRole('heading', { level: 1, name: STEP_TITLE[sc.step - 1] }).waitFor();
        // Datos ya pintados (no solo el esqueleto de carga).
        await page
          .locator('[aria-busy="true"]')
          .first()
          .waitFor({ state: 'detached' })
          .catch(() => {});
        await page.waitForTimeout(300);
        await sc.after?.(page);
        const app = await capture(page);
        const result = await compareAndAttach(
          `${name}-${viewport}-${theme}`,
          readFileSync(file),
          app,
          testInfo,
        );
        console.log(
          `[visual] store-checkout/${name} ${viewport} ${theme}: ${(result.ratio * 100).toFixed(2)}% (${result.diffPixels}/${result.totalPixels})`,
        );
        expect(result.ratio).toBeLessThan(sc.maxRatio ?? MAX_RATIO);
      });
    }
  }
}
