import { expect, test } from '@playwright/test';
import {
  DEMO_HISTORY,
  DEMO_PICKUP,
  axeBlocking,
  noHorizontalOverflow,
  openHistory,
  seedHistory,
} from './support/history';

/** F23 · móvil (Pixel 7, datos SIMULADOS): sin desbordes a 390 px, objetivos ≥ 44 px y axe claro/oscuro. */
test.skip(({ isMobile }) => !isMobile, 'solo en el proyecto e2e-mobile');
test.describe.configure({ timeout: 120_000 });

const minHeight = async (locator: import('@playwright/test').Locator) =>
  (await locator.boundingBox())!.height;

for (const theme of ['light', 'dark'] as const) {
  test(`móvil · Mis pedidos, detalle, recibo y diálogo de reorden: sin desbordes, ≥ 44 px y axe · ${theme}`, async ({
    page,
  }) => {
    await seedHistory(page, { theme });
    await openHistory(page, 'Historial');
    expect(await noHorizontalOverflow(page)).toBe(true);
    const row = page.getByTestId('history-row').first();
    for (const target of [
      row.getByRole('link', { name: /Ver detalle: MON-482193/ }),
      row.getByRole('link', { name: /Ver recibo: MON-482193/ }),
      row.getByRole('button', { name: /Volver a pedir: MON-482193/ }),
    ]) {
      expect(await minHeight(target)).toBeGreaterThanOrEqual(44);
    }
    expect(await axeBlocking(page)).toEqual([]);

    await page.getByRole('button', { name: 'Volver a pedir: MON-479850' }).click();
    const dialog = page.getByRole('dialog', { name: 'Volver a pedir' });
    await expect(dialog.getByTestId('group-AVAILABLE')).toBeVisible({ timeout: 60_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(
      await minHeight(dialog.getByRole('button', { name: 'Añadir al carrito' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await axeBlocking(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Escape');

    await page.goto(`/pedidos/${DEMO_PICKUP}`);
    await expect(page.getByTestId('reorder')).toBeVisible({ timeout: 90_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await axeBlocking(page)).toEqual([]);

    await page.goto(`/pedidos/${DEMO_HISTORY}/recibo`);
    await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 90_000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await minHeight(page.getByTestId('print-receipt'))).toBeGreaterThanOrEqual(44);
    expect(await axeBlocking(page)).toEqual([]);
  });
}

test('móvil · las 4 acciones de cada fila no desbordan a 320, 360 y 390 px', async ({ page }) => {
  await seedHistory(page);
  await openHistory(page, 'Historial');
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    const overflowing = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-testid="history-row"]')].filter(
          (row) => row.scrollWidth > row.clientWidth + 1,
        ).length,
    );
    expect(overflowing, `ancho ${width}`).toBe(0);
    await expect(
      page
        .getByTestId('history-row')
        .first()
        .getByRole('button', { name: /Volver a pedir/ }),
    ).toBeVisible();
  }
});
