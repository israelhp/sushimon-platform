import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PROTOTYPES, VIEWPORTS, capture, preparePage } from './harness';

/**
 * Capturas de referencia del CHECKOUT del prototipo (cada paso, la pasarela NeoNet y la confirmación).
 * La galería general no las genera bien (no elige el modo de pedido antes de agregar), así que se hacen aquí.
 * Solo bajo demanda (no es un gate):
 *   CAPTURE_CHECKOUT=1 E2E_PORT=3199 pnpm --filter sushimon-web exec playwright test --project=visual gallery-checkout
 * Salida: docs/ui/extracted/screens/store-checkout-*.png (ignorado por git).
 * La tienda del prototipo usa MemoryRouter: se navega haciendo clic. Todo el flujo es simulado y la red está bloqueada.
 */
const OUT = resolve(__dirname, '../../../docs/ui/extracted/screens');
const FROZEN_AT = process.env.DEMO_NOW ?? '2026-11-11T13:00:00-06:00';

const shoot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `store-checkout-${name}.png`), await capture(page));
};

const press = async (page: Page, name: string | RegExp, wait = 300) => {
  await page.getByRole('button', { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(wait);
};

/** Elige "Recoger" (o "A domicilio") en la hoja de modo, agrega Dumplings y abre el checkout. */
async function toCheckout(page: Page, type: 'pickup' | 'delivery') {
  await press(page, /Iniciar pedido/);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: type === 'pickup' ? /^Recoger$/ : /^A domicilio$/ })
    .click();
  if (type === 'delivery') {
    await page
      .getByRole('dialog')
      .getByPlaceholder('Dirección (calle, avenida, número)')
      .fill('6a avenida 10-50');
    await page.getByRole('dialog').getByPlaceholder('Zona').fill('10');
  }
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Ver el menú/ })
    .click();
  await page.waitForTimeout(800);
  // Móvil: botón "Agregar" en la tarjeta. Escritorio: la tarjeta abre la ficha y se agrega desde ella.
  await page
    .locator('a[href="/menu"]:visible')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  const quickAdd = page.getByText(/^Agregar$/).filter({ visible: true });
  if (await quickAdd.count()) {
    await quickAdd.first().click();
  } else {
    await page.getByText('Dumplings', { exact: true }).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Agregar/ })
      .last()
      .click();
  }
  await page.waitForTimeout(300);
  // El aviso "agregado" del prototipo se desvanece antes de seguir (no es parte del checkout).
  await page.waitForTimeout(3600);
  // Escritorio: el panel "Tu pedido" ya está a la vista; móvil: se abre con el botón del pedido.
  const proceed = page.getByText(/^Continuar$/).filter({ visible: true });
  if (!(await proceed.count())) {
    await page
      .getByRole('button', { name: /pedido/i })
      .filter({ visible: true })
      .last()
      .click();
    await page.waitForTimeout(300);
  }
  await proceed.first().click();
  await page.waitForTimeout(400);
}

const next = (page: Page, label: string | RegExp) => press(page, label, 500);

const SCREENS: Record<string, (page: Page) => Promise<void>> = {
  '1-pedido': async (p) => {
    await toCheckout(p, 'pickup');
  },
  '2-entrega': async (p) => {
    await toCheckout(p, 'pickup');
    await next(p, /Continuar a Entrega/i);
  },
  '3-envio-recoger': async (p) => {
    await toCheckout(p, 'pickup');
    await next(p, /Continuar a Entrega/i);
    await next(p, /Continuar a Envío/i);
  },
  '3-envio-domicilio': async (p) => {
    await toCheckout(p, 'delivery');
    await next(p, /Continuar a Entrega/i);
    await next(p, /Continuar a Envío/i);
    await p.waitForTimeout(1200);
  },
  '4-pago': async (p) => {
    await toCheckout(p, 'pickup');
    await next(p, /Continuar a Entrega/i);
    await next(p, /Continuar a Envío/i);
    await next(p, /Continuar a Pago/i);
  },
  '5-confirmacion': async (p) => {
    await toCheckout(p, 'pickup');
    await next(p, /Continuar a Entrega/i);
    await next(p, /Continuar a Envío/i);
    await next(p, /Continuar a Pago/i);
    await next(p, /Continuar a Confirmación/i);
  },
  'neonet-listo': async (p) => {
    await payByCard(p);
  },
  'neonet-aprobado': async (p) => {
    await payByCard(p);
    await press(p, /Simular pago/, 2600);
  },
  'neonet-rechazado': async (p) => {
    await payByCard(p);
    await p
      .getByRole('button', { name: /4000 0000 0000 0002/ })
      .filter({ visible: true })
      .click();
    await press(p, /Simular pago/, 2600);
  },
  'neonet-pendiente': async (p) => {
    await payByCard(p);
    await p
      .getByRole('button', { name: /4000 0000 0000 0077/ })
      .filter({ visible: true })
      .click();
    await press(p, /Simular pago/, 2600);
  },
  'pedido-efectivo': async (p) => {
    await toCheckout(p, 'pickup');
    await next(p, /Continuar a Entrega/i);
    await next(p, /Continuar a Envío/i);
    await next(p, /Continuar a Pago/i);
    await p.getByRole('radio', { name: /Efectivo/ }).click();
    await next(p, /Continuar a Confirmación/i);
    await press(p, /Realizar pedido/, 2200);
  },
  'pedido-tarjeta': async (p) => {
    await payByCard(p);
    await press(p, /Simular pago/, 2600);
    await press(p, /Consultar pedido/, 500);
  },
};

async function payByCard(p: Page) {
  await toCheckout(p, 'pickup');
  await next(p, /Continuar a Entrega/i);
  await next(p, /Continuar a Envío/i);
  await next(p, /Continuar a Pago/i);
  await next(p, /Continuar a Confirmación/i);
  await press(p, /Pagar ahora/, 2200);
}

test.describe('Capturas del checkout del prototipo', () => {
  test.skip(!process.env.CAPTURE_CHECKOUT, 'Solo bajo demanda: CAPTURE_CHECKOUT=1');
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
      for (const [name, go] of Object.entries(SCREENS)) {
        test(`checkout/${name} · ${viewport} · ${theme}`, async ({ page }) => {
          await preparePage(page, { theme, viewport, frozenAt: FROZEN_AT });
          await page.goto(pathToFileURL(PROTOTYPES.store).href);
          await expect(page.locator('#root')).not.toBeEmpty();
          await go(page);
          await shoot(page, `${name}-${viewport}-${theme}`);
        });
      }
    }
  }
});
