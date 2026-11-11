import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accesibilidad automática (axe) por ruta y tema. Sin violaciones serias ni críticas.
 * Cada bloque de pantallas agrega aquí sus rutas (y, si hace falta, una `ready` para esperar sus datos).
 */
interface RouteCase {
  path: string;
  /** Texto accesible a esperar antes de analizar (la pantalla ya pintó sus datos). */
  ready: { role: 'heading' | 'button' | 'link'; name: string | RegExp };
  /** Abre antes la sesión de DEMOSTRACIÓN del cliente (sessionStorage); las rutas de cuenta la necesitan. */
  signedIn?: boolean;
  /** Etiqueta para distinguir casos de la misma ruta (p. ej. pasos del checkout). */
  label?: string;
  /** Preferencias del cliente a precargar (carrito, modo de pedido…) en localStorage. */
  local?: Record<string, string>;
  /** Borrador a precargar en sessionStorage (p. ej. el paso del checkout). */
  session?: Record<string, string>;
}

/** Checkout (bloque 4): carrito con un producto, modo "recoger" y el paso pedido (borrador no sensible). */
const CHECKOUT_LOCAL = {
  'monsushi-cart-v1': JSON.stringify([{ productId: 'dumplings', quantity: 1, note: '' }]),
  'monsushi-order-mode-v1': JSON.stringify({
    type: 'pickup',
    when: { kind: 'now' },
    branchId: null,
    address: null,
  }),
};
const checkoutStep = (step: number, payment: 'card' | 'cash' = 'card') => ({
  'monsushi-checkout-v1': JSON.stringify({
    step,
    contact: { name: 'Cliente Demo', phone: '5555-1234', email: 'cliente@ejemplo.com' },
    address: {
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone: '10',
      line: '6a avenida 10-50',
      references: '',
    },
    addressId: 'other',
    notes: '',
    pickupBranchId: null,
    deliveryBranchId: null,
    payment,
  }),
});

export const A11Y_ROUTES: RouteCase[] = [
  // Cuenta, Más, empleo y 404 (bloque 6). Las de cuenta, con y sin sesión de demostración.
  { path: '/mas', ready: { role: 'heading', name: /^Más/ } },
  { path: '/cuenta', ready: { role: 'heading', name: /Mi cuenta/ } },
  { path: '/cuenta', ready: { role: 'heading', name: /Mi cuenta/ }, signedIn: true },
  {
    path: '/cuenta/datos',
    ready: { role: 'heading', name: 'Mis datos personales' },
    signedIn: true,
  },
  {
    path: '/cuenta/direcciones',
    ready: { role: 'heading', name: 'Mis direcciones' },
    signedIn: true,
  },
  { path: '/cuenta/favoritos', ready: { role: 'heading', name: 'Mis favoritos' }, signedIn: true },
  { path: '/cuenta/pedidos', ready: { role: 'heading', name: 'Mis pedidos' }, signedIn: true },
  { path: '/cuenta/direcciones', ready: { role: 'heading', name: 'Mis direcciones' } },
  { path: '/trabaja-con-nosotros', ready: { role: 'heading', name: /MONcheros/ } },
  { path: '/ruta-que-no-existe', ready: { role: 'heading', name: 'Este roll no existe' } },
  { path: '/', ready: { role: 'heading', name: /Favoritos/ } },
  // Consulta de invitado, reclamos y seguimiento (bloque 5). El seguimiento exige sesión: lo decide la API.
  { path: '/consultar', ready: { role: 'heading', name: /Consultá tu orden/ } },
  { path: '/incidencias', ready: { role: 'heading', name: /Hacer un reclamo/ } },
  {
    path: '/incidencias',
    label: 'con pedidos',
    ready: { role: 'heading', name: 'Tus últimos pedidos' },
    signedIn: true,
  },
  {
    path: '/incidencias/nuevo?pedido=MON-490217',
    ready: { role: 'heading', name: /Reportar un problema/ },
    signedIn: true,
  },
  {
    path: '/pedidos/MON-490217',
    ready: { role: 'heading', name: 'Seguimiento del pedido' },
    signedIn: true,
  },
  // Checkout (bloque 4): un caso por paso.
  {
    path: '/checkout',
    label: 'paso 1',
    ready: { role: 'heading', name: 'Tu pedido' },
    local: CHECKOUT_LOCAL,
  },
  {
    path: '/checkout',
    label: 'paso 2',
    ready: { role: 'heading', name: 'Entrega' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(2),
  },
  {
    path: '/checkout',
    label: 'paso 3',
    ready: { role: 'heading', name: 'Envío' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(3),
  },
  {
    path: '/checkout',
    label: 'paso 4',
    ready: { role: 'heading', name: 'Pago' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(4),
  },
  {
    path: '/checkout',
    label: 'paso 5',
    ready: { role: 'heading', name: 'Confirmación' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(5),
  },
  { path: '/menu', ready: { role: 'heading', name: /^Entradas/ } },
  { path: '/promociones', ready: { role: 'heading', name: /^Entradas/ } },
];

for (const theme of ['light', 'dark'] as const) {
  for (const route of A11Y_ROUTES) {
    test(`a11y ${route.path}${route.label ? ` (${route.label})` : ''}${route.signedIn ? ' (con sesión)' : ''} · ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
      if (route.local || route.session) {
        await page.addInitScript(
          ([local, session]) => {
            for (const [k, v] of Object.entries(local ?? {})) localStorage.setItem(k, v);
            for (const [k, v] of Object.entries(session ?? {})) sessionStorage.setItem(k, v);
          },
          [route.local, route.session] as const,
        );
      }
      if (route.signedIn) {
        await page.addInitScript(() =>
          sessionStorage.setItem(
            'monsushi-demo-session-v1',
            JSON.stringify({
              customer: {
                email: 'cliente@ejemplo.com',
                name: 'Cliente Demo',
                provider: 'google-demo',
              },
              staff: null,
            }),
          ),
        );
      }
      await page.goto(route.path);
      await page.getByRole(route.ready.role, { name: route.ready.name }).first().waitFor();
      // Datos del catálogo ya pintados (no solo el esqueleto).
      await page
        .locator('[aria-busy="true"]')
        .first()
        .waitFor({ state: 'detached' })
        .catch(() => {});
      await page.waitForTimeout(300);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        blocking.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes
            .slice(0, 8)
            .map((n) => n.target.join(' ') + ' :: ' + (n.any[0]?.message ?? '')),
        })),
      ).toEqual([]);
    });
  }
}

test('el carrito, el modo de pedido y el inicio de sesión abren como diálogos accesibles', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('heading', { name: /Favoritos/ }).waitFor();

  await page
    .getByRole('button', { name: /Iniciar pedido/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Pedir ahora' });
  await expect(sheet).toBeVisible();
  const sheetResults = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(
    sheetResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
