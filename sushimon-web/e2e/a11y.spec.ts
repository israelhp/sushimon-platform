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
}

export const A11Y_ROUTES: RouteCase[] = [
  { path: '/', ready: { role: 'heading', name: /Favoritos/ } },
];

for (const theme of ['light', 'dark'] as const) {
  for (const route of A11Y_ROUTES) {
    test(`a11y ${route.path} · ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
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
