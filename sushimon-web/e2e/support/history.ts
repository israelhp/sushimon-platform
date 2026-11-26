import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { deliveryMode } from './cart';

/** Ayudas de F23 (historial, recibo y «Volver a pedir») contra el MOCK rotulado como simulación (sin red externa). */
export const DEMO_ACTIVE = '00000000-0000-4000-8000-000000490217'; // MON-490217 (en curso)
export const DEMO_PICKUP = '00000000-0000-4000-8000-000000482193'; // MON-482193 (recogido)
export const DEMO_HISTORY = '00000000-0000-4000-8000-000000479850'; // MON-479850 (entregado; producto retirado y precio cambiado)

export interface HistorySeed {
  theme?: 'light' | 'dark';
  locale?: 'es' | 'en';
  /** Cliente de demostración con sesión (por defecto sí). */
  signedIn?: boolean;
  /** Carrito local a precargar (`monsushi-cart-v2` ya serializado). */
  cart?: string;
  /** Fallos de prueba del mock (`window.__sushimonMockFaults`). */
  faults?: Record<string, string[]>;
  /** Sucursal del modo de pedido (por defecto `sucursal-1`); debe coincidir con la del carrito sembrado. */
  modeBranch?: string;
  /** Cuenta cuántas veces se llama a `window.print`. */
  stubPrint?: boolean;
}

export async function seedHistory(page: Page, options: HistorySeed = {}) {
  const {
    theme = 'light',
    locale,
    signedIn = true,
    cart,
    faults,
    stubPrint,
    modeBranch = 'sucursal-1',
  } = options;
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  if (locale === 'en') {
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost' }]);
  }
  await page.addInitScript(
    ([t, session, cartJson, mode, f, print]) => {
      localStorage.setItem('monsushi-theme', t!);
      const w = window as unknown as {
        __sushimonMockRequests: string[];
        __sushimonMockFaults?: unknown;
        __printed?: number;
      };
      w.__sushimonMockRequests = [];
      if (f) w.__sushimonMockFaults = JSON.parse(f);
      if (print) {
        w.__printed = 0;
        window.print = () => {
          w.__printed = (w.__printed ?? 0) + 1;
        };
      }
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        if (session) sessionStorage.setItem('monsushi-demo-session-v1', session);
        if (cartJson) localStorage.setItem('monsushi-cart-v2', cartJson);
        localStorage.setItem('monsushi-order-mode-v1', mode!);
      }
    },
    [
      theme,
      signedIn
        ? JSON.stringify({
            customer: {
              email: 'cliente@ejemplo.com',
              name: 'Cliente Demo',
              provider: 'google-demo',
            },
            staff: null,
          })
        : '',
      cart ?? '',
      deliveryMode(modeBranch),
      faults ? JSON.stringify(faults) : '',
      stubPrint ? '1' : '',
    ] as const,
  );
}

export const requests = (page: Page): Promise<string[]> =>
  page.evaluate(
    () => (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests,
  );

export async function axeBlocking(page: Page, scope?: string) {
  const axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (scope) axe.include(scope);
  return (await axe.analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }));
}

export const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

export async function openHistory(page: Page, tab?: RegExp | string) {
  await page.goto('/cuenta/pedidos');
  await expect(page.getByRole('heading', { level: 1, name: /Mis pedidos|My orders/ })).toBeVisible({
    timeout: 90_000,
  });
  if (tab) await page.getByRole('tab', { name: tab }).click();
  await expect(page.getByTestId('history-row').first()).toBeVisible({ timeout: 60_000 });
}
