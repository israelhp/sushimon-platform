import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F27 · Motoristas en móvil (390 px, datos SIMULADOS): sin desbordes horizontales, objetivos táctiles ≥ 44 px, modal accesible y
 * axe en claro/oscuro. El filtro `e2e-mobile` solo corre `*.mobile.spec.ts`.
 */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');
test.use({ viewport: { width: 390, height: 844 } });

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  return (await builder.analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · Motoristas: tarjetas, interruptor y formulario táctiles, sin desbordes · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('monsushi-theme', t), theme);
    await page.goto('/backoffice/login');
    await page.getByRole('button', { name: /Ana Lucía Pérez/ }).click();
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
    await page.goto('/backoffice/motoristas');
    await expect(page.getByText('7 motoristas')).toBeVisible({ timeout: 90_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await axe(page)).toEqual([]);

    const row = page
      .getByRole('table', { name: 'Motoristas propios' })
      .getByRole('row')
      .filter({ hasText: 'Luis Coc' });
    // Objetivos táctiles ≥ 44 px: acciones y fila del interruptor.
    for (const target of [
      row.getByRole('button', { name: 'Editar a Luis Coc' }),
      row.getByRole('button', { name: 'Trasladar a Luis Coc a otra sucursal' }),
      row.getByRole('button', { name: 'Desactivar a Luis Coc' }),
      row.locator('label.sw-row'),
      page.getByRole('button', { name: 'Nuevo motorista' }),
      page.getByRole('button', { name: /^Cambiar el orden/ }),
    ]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await row.getByRole('switch', { name: 'Disponible: Luis Coc' }).click();
    await expect(row.getByRole('switch')).toBeChecked();

    await page.getByRole('button', { name: 'Nuevo motorista' }).click();
    const modal = page.getByRole('dialog', { name: 'Nuevo motorista' });
    await expect(modal).toBeVisible();
    const box = (await modal.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await noHorizontalOverflow(page)).toBe(true);
    for (const target of [
      modal.getByLabel('Nombre completo'),
      modal.getByLabel('Teléfono'),
      modal.getByRole('button', { name: 'Cancelar' }),
      modal.getByRole('button', { name: 'Guardar' }),
    ]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
    await modal.getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('button', { name: 'Ver detalle de Luis Coc' }).click();
    const drawer = page.getByRole('dialog', { name: 'Luis Coc' });
    await expect(drawer.getByTestId('rider-detail')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
  });
}
