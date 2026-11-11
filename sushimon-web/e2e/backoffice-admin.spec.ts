import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Backoffice (bloque 5): Sucursales, Usuarios y Reportes con datos simulados. La sesión es de DEMOSTRACIÓN: ni
 * Google ni este acceso dan permisos; en mock, el adaptador reproduce las reglas de rol y sucursal del servidor.
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Menú principal' });

const kpi = (page: Page, label: string) =>
  page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) });

test('admin: crea un usuario y edita una sucursal', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);

  await nav(page)
    .getByRole('link', { name: /Usuarios/ })
    .click();
  await expect(page).toHaveURL(/\/backoffice\/usuarios$/);
  await expect(page.getByText('8 usuarios · 7 activos')).toBeVisible();

  await page.getByRole('button', { name: /Nuevo usuario/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo usuario' });
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Completa el nombre y un correo válido.');
  await expect(dialog.getByLabel('Nombre completo')).toBeFocused();

  await dialog.getByLabel('Nombre completo').fill('Lucía Prueba');
  await dialog.getByLabel('Correo').fill('lucia.prueba@sushimon.gt');
  await dialog.getByRole('button', { name: 'Sucursal 2' }).click();
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('9 usuarios · 8 activos')).toBeVisible();
  await expect(page.getByText('lucia.prueba@sushimon.gt')).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'invitación por correo simulada' })).toBeVisible();

  await nav(page)
    .getByRole('link', { name: /Sucursales/ })
    .click();
  await expect(page.getByText('3 de 5 sucursales configuradas')).toBeVisible();
  await page.getByRole('button', { name: 'Editar Sucursal 2' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar sucursal' });
  await edit.getByLabel('Teléfono').fill('+502 2222-3333');
  await edit.getByRole('button', { name: 'Guardar sucursal' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('+502 2222-3333')).toBeVisible();

  // Cerrar una sucursal con el interruptor.
  const sw = page.getByRole('switch', { name: 'Sucursal abierta: Sucursal 3' });
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Cerrada · no recibe pedidos')).toBeVisible();
});

test('admin: al llegar a 5 sucursales el alta se deshabilita y explica el tope', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/sucursales');
  await page
    .getByRole('button', { name: /Agregar sucursal/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /Agregar sucursal/ })
    .first()
    .click();
  await expect(page.getByText('5 de 5 sucursales configuradas')).toBeVisible();
  const full = page.getByRole('button', { name: /Límite de 5 sucursales alcanzado/ });
  await expect(full).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText(/pendiente de decisión del negocio/)).toBeVisible();
});

test('encargado: ve Reportes de su sucursal, pero no Usuarios ni Sucursales', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(nav(page).getByRole('link', { name: /Reportes/ })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /Usuarios/ })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: /Sucursales/ })).toHaveCount(0);

  await nav(page)
    .getByRole('link', { name: /Reportes/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await expect(page.getByText('Sucursal 1 · Zona 4 · Cuatro Grados Norte').first()).toBeVisible();
  await expect(page.locator('.legend span')).toHaveCount(1);

  await page.goto('/backoffice/usuarios');
  await expect(page.getByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  await page.goto('/backoffice/sucursales');
  await expect(page.getByText('No tienes permiso para ver esta pantalla')).toBeVisible();
});

test('reportes: el rango elegido da totales coherentes entre el resumen y el historial', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/reportes');
  await expect(page.getByRole('img', { name: /Pedidos por día y sucursal/ })).toBeVisible();

  await page.getByRole('button', { name: '30 días', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos por día y sucursal' })).toBeVisible();
  await expect(page.getByText('Vie 13 oct – Mié 11 nov · 30 días').first()).toBeVisible();
  const orders = (await kpi(page, 'Pedidos').locator('.kpi-val').innerText()).trim();
  const sales = (await kpi(page, 'Ventas').locator('.kpi-foot').innerText()).trim();

  await page.getByRole('tab', { name: 'Historial de pedidos' }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos del periodo' })).toBeVisible();
  await expect(kpi(page, 'Pedidos').locator('.kpi-val')).toHaveText(orders);
  await expect(kpi(page, 'Ventas').locator('.kpi-val')).toHaveText(sales);

  // Un rango propio de 3 días: el historial muestra solo esos días y sus totales cambian.
  await page.getByLabel('Desde').fill('2026-11-05');
  await page.getByLabel('Hasta').fill('2026-11-07');
  await expect(page.getByText('Jue 5 nov – Sáb 7 nov · 3 días').first()).toBeVisible();
  await expect(kpi(page, 'Pedidos').locator('.kpi-val')).not.toHaveText(orders);
  const dayHeads = page.locator('.day-h .strong');
  await expect(dayHeads).toHaveCount(3);

  await page.getByRole('tab', { name: 'Resumen y gráficos' }).click();
  await expect(page.getByRole('img', { name: /Pedidos por día y sucursal/ })).toBeVisible();
  await expect(page.getByLabel('Desde')).toHaveValue('2026-11-05');
});

test('el modal Usuario abierto no tiene violaciones graves de accesibilidad', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/usuarios');
  await page.getByRole('button', { name: /Nuevo usuario/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo usuario' });
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
  ).toEqual([]);
});
