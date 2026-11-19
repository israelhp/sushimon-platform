import { expect, type Page } from '@playwright/test';
import { DUMPLINGS, cartV2, pickupMode } from './cart';

/** Ayudas del checkout (datos SIMULADOS) para las pruebas de F20. */
export const deliveryMode = (branchId: string) =>
  JSON.stringify({ type: 'delivery', when: { kind: 'now' }, branchId, address: null });

export interface SeedOptions {
  mode?: 'pickup' | 'delivery';
  theme?: 'light' | 'dark';
  /** Fallos de prueba del mock (`window.__sushimonMockFaults`), p. ej. `{ 'POST /v1/orders': ['lost-response'] }`. */
  faults?: Record<string, string[]>;
  locale?: 'es' | 'en';
}

/** Siembra el carrito y el modo de pedido una sola vez por pestaña, y registra las solicitudes del adaptador mock. */
export async function seedCheckout(page: Page, options: SeedOptions = {}) {
  const { mode = 'pickup', theme = 'light', faults, locale } = options;
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  if (locale === 'en')
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost' }]);
  await page.addInitScript(
    ([cart, orderMode, t, f]) => {
      localStorage.setItem('monsushi-theme', t!);
      const w = window as unknown as {
        __sushimonMockRequests: string[];
        __sushimonMockFaults?: unknown;
      };
      w.__sushimonMockRequests = [];
      if (f) w.__sushimonMockFaults = JSON.parse(f);
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('monsushi-cart-v2', cart!);
        localStorage.setItem('monsushi-order-mode-v1', orderMode!);
      }
    },
    [
      cartV2('sucursal-1', [{ ...DUMPLINGS, quantity: 2 }]),
      mode === 'pickup' ? pickupMode('sucursal-1') : deliveryMode('sucursal-1'),
      theme,
      faults ? JSON.stringify(faults) : '',
    ],
  );
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { level: 1, name: /Tu pedido|Your order/ })).toBeVisible({
    timeout: 90_000,
  });
}

export const button = (page: Page, name: RegExp) =>
  page.getByRole('button', { name }).filter({ visible: true }).first();

export async function next(page: Page, step: string) {
  const b = button(page, new RegExp(`Continuar a ${step}`, 'i'));
  await expect(b).toBeEnabled();
  await b.click();
  await expect(page.getByRole('heading', { level: 1, name: step })).toBeVisible();
}

/** Hasta «Confirmación» (F24: el único método es efectivo; no hay nada que elegir). */
export async function toReview(page: Page) {
  for (const step of ['Entrega', 'Envío', 'Pago']) await next(page, step);
  await next(page, 'Confirmación');
}

export const cartLines = async (page: Page): Promise<number> =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('monsushi-cart-v2') ?? '{"lines":[]}').lines.length,
  );

export const orderPosts = async (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests.filter(
        (r) => r === 'POST /v1/orders',
      ).length,
  );

/** Pedidos «persistidos» del mock (forma real) guardados en la pestaña; espera al volcado con debounce. */
export async function placedOrders(page: Page): Promise<number> {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('sushimon-mock-store-v1:default');
    return raw ? (JSON.parse(raw).placedOrders ?? []).length : 0;
  });
}
