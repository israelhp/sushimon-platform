import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';

/**
 * F28 · Entregas propias en móvil (390 px, datos SIMULADOS): sin desbordes horizontales ni solapamientos del título con las pestañas,
 * objetivos táctiles ≥ 44 px, detalle y modales accesibles, flujo crear → asignar → recoger → entregar → retorno y PedidosYa
 * rotulado como simulación; axe en claro/oscuro. El filtro `e2e-mobile` solo corre `*.mobile.spec.ts`.
 */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');
test.use({ viewport: { width: 390, height: 844 } });

const ORDER = 'MON-307051'; // sucursal 1 · a domicilio · listo · reparto propio

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  return (await builder.analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
}

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · Entregas: tarjetas, pestañas y detalle sin desbordes ni solapamientos · ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('monsushi-theme', t), theme);
    await enterAs(page, /Ana Lucía Pérez/);
    await page.goto('/backoffice/entregas');
    await expect(page.getByRole('heading', { name: 'Entregas', level: 1 })).toBeVisible({
      timeout: 90_000,
    });
    const row = page
      .getByRole('table', { name: 'Entregas con reparto propio' })
      .getByRole('row')
      .filter({ hasText: 'MON-307054' });
    await expect(row).toBeVisible({ timeout: 90_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await axe(page)).toEqual([]);

    // El título «Entregas» no se superpone con las pestañas (patrón `.page-h-fit` de F27).
    const heading = await page.getByRole('heading', { name: 'Entregas', level: 1 }).boundingBox();
    const tabs = await page.getByRole('tablist', { name: 'Tipo de reparto' }).boundingBox();
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(tabs!.y + 1);

    // Objetivos táctiles ≥ 44 px.
    for (const target of [
      row.getByRole('button', { name: 'Ver detalle de la entrega MON-307054' }),
      page.getByRole('tab', { name: 'Reparto propio' }),
      page.getByRole('tab', { name: 'Simulación PedidosYa' }),
    ]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await row.getByRole('button', { name: 'Ver detalle de la entrega MON-307054' }).click();
    const drawer = page.getByRole('dialog', { name: '#MON-307054' });
    await expect(drawer.getByTestId('delivery-rider')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await axe(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // PedidosYa: rotulado como simulación y separado.
    await page.getByRole('tab', { name: 'Simulación PedidosYa' }).click();
    await expect(page.getByTestId('simulation-banner')).toContainText('no es un envío real');
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
}

test('móvil · Entregas: crear → asignar → recoger → entregar → retorno con modales táctiles y accesibles', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterAs(page, /Marco Antonio Gómez/);
  await page.goto('/backoffice/pedidos');
  await page
    .locator('.kcard', { hasText: `#${ORDER}` })
    .getByRole('button', { name: 'Despachar' })
    .click();
  const drawer = page.getByRole('dialog', { name: `#${ORDER}` });
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: 'Asignar motorista' }).click();
  const assign = page.getByRole('dialog', { name: 'Asignar motorista' });
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(await axe(page, '[role="dialog"]')).toEqual([]);
  await assign.getByLabel('Motorista elegible').selectOption({ index: 1 });
  expect(
    (await assign.getByRole('button', { name: 'Asignar' }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await assign.getByRole('button', { name: 'Asignar' }).click();
  await expect(
    page.locator('.toast', { hasText: `Motorista asignado a #${ORDER}.` }),
  ).toBeVisible();

  await drawer.getByRole('button', { name: 'Marcar recogido' }).click();
  await expect(drawer.getByRole('button', { name: 'Marcar entregado' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Marcar entregado' }).click();
  const deliver = page.getByRole('alertdialog', { name: 'Marcar como entregado' });
  await expect(deliver).toBeVisible();
  expect(await axe(page, '[role="dialog"]')).toEqual([]);
  await deliver.getByRole('button', { name: 'Sí, marcar entregado' }).click();
  await expect(drawer.getByText('Esperando retorno').first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Registrar retorno' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Registrar retorno' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Registrar retorno' }).click();
  await expect(
    page.locator('.toast', { hasText: `Retorno registrado para #${ORDER}.` }),
  ).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});
