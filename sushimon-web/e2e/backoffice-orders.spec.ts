import { expect, test, type Page } from '@playwright/test';

/**
 * Backoffice (bloques 1–2): acceso de demostración, shell por rol, Panel y Pedidos con datos simulados.
 * La sesión es de DEMOSTRACIÓN (no autoriza nada); en mock, el adaptador reproduce las reglas del servidor.
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, code: string) => page.locator('.kcard', { hasText: code });

test('sin sesión de demostración, las pantallas del backoffice llevan al acceso', async ({
  page,
}) => {
  await page.goto('/backoffice/pedidos');
  await expect(page).toHaveURL(/\/backoffice\/login$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByText('Demostración', { exact: true })).toBeVisible();
});

test('/backoffice redirige a la pantalla de inicio del rol', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(page).toHaveURL(/\/backoffice\/panel$/);
  await page.goto('/backoffice');
  await expect(page).toHaveURL(/\/backoffice\/panel$/);
});

test('encargado: acepta, prepara y deja listo un pedido de recoger en tienda', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(page).toHaveURL(/\/backoffice\/panel$/);
  await expect(page.getByRole('heading', { name: /Buenas tardes, Marco/ })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Menú principal' });
  await nav.getByRole('link', { name: /Pedidos/ }).click();
  await expect(page).toHaveURL(/\/backoffice\/pedidos$/);
  await expect(column(page, 'Nuevo').getByText('#MON-307057')).toBeVisible();

  await card(page, '#MON-307057').getByRole('button', { name: 'Aceptar pedido' }).click();
  await expect(page.locator('.toast', { hasText: 'Pedido #MON-307057 aceptado' })).toBeVisible();
  await expect(column(page, 'Aceptado').getByText('#MON-307057')).toBeVisible();

  await card(page, '#MON-307057').getByRole('button', { name: 'Marcar en preparación' }).click();
  await expect(column(page, 'Preparación').getByText('#MON-307057')).toBeVisible();

  await card(page, '#MON-307057').getByRole('button', { name: 'Marcar listo' }).click();
  await expect(column(page, 'Listo').getByText('#MON-307057')).toBeVisible();
  await expect(
    card(page, '#MON-307057').getByRole('button', { name: 'Entregado al cliente' }),
  ).toBeVisible();
});

test('encargado: rechaza un pedido con motivo desde el detalle', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await page.goto('/backoffice/pedidos');
  await page.getByText('#MON-307057').first().click();
  const drawer = page.getByRole('dialog', { name: /MON-307057/ });
  await expect(drawer.getByText('Sin aceptar +5 min')).toBeVisible();
  await drawer.getByRole('button', { name: 'Rechazar' }).click();
  await page
    .getByRole('dialog', { name: 'Rechazar pedido' })
    .getByRole('button', { name: 'Sucursal saturada' })
    .click();
  await expect(drawer.getByText('Pedido rechazado. Motivo: Sucursal saturada')).toBeVisible();
  await expect(column(page, 'Nuevo').getByText('#MON-307057')).toHaveCount(0);
});

test('encargado: "Despachar" abre el modal con PedidosYa simulado y repartidor propio', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await page.goto('/backoffice/pedidos');
  await card(page, '#MON-307051').getByRole('button', { name: 'Despachar pedido' }).click();
  const modal = page.getByRole('dialog', { name: 'Despachar pedido' });
  await expect(modal.getByRole('button', { name: /PedidosYa Courier/ })).toBeVisible();
  await expect(modal.getByRole('button', { name: /Repartidor del restaurante/ })).toBeVisible();
  await expect(modal.getByText('Simulación')).toBeVisible();
});

test('cocina: solo ve Pedidos en el menú y no puede despachar', async ({ page }) => {
  await enterAs(page, /Cocina Zona 4/);
  await expect(page).toHaveURL(/\/backoffice\/pedidos$/);
  const nav = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(nav.getByRole('link')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: /Entregas/ })).toHaveCount(0);
  await expect(page.getByTitle('Sucursal asignada a tu usuario')).toBeVisible();

  await expect(card(page, '#MON-307051')).toBeVisible();
  await expect(page.getByRole('button', { name: /Despachar/ })).toHaveCount(0);
  await page.getByText('#MON-307051').first().click();
  await expect(page.getByText(/Un encargado de sucursal lo despachará/)).toBeVisible();
});

test('tabla de pedidos: filtros y búsqueda', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/pedidos');
  await page.getByRole('button', { name: 'Tabla', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos los pedidos' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar pedidos' }).fill('diego');
  await expect(page.getByRole('button', { name: 'Ver detalle de #MON-307055' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver detalle de #MON-307057' })).toHaveCount(0);
});

test('el pedido de demostración llega y suena la campana', async ({ page }) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await page.goto('/backoffice/pedidos');
  await expect(page.getByText('#MON-307057').first()).toBeVisible();
  await page.getByRole('button', { name: /Demo: llega un pedido/ }).click();
  await expect(page.locator('.toast', { hasText: /Nuevo pedido #/ })).toBeVisible();
  await expect(page.getByText('Sonando · pedido nuevo')).toBeVisible();
});
