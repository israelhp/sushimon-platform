import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Backoffice (bloque 5 + F03): Sucursales, Usuarios (empleados con asignaciones), Roles y Reportes con datos simulados. La sesión es de DEMOSTRACIÓN: ni
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

test('admin: crea un usuario, edita y desactiva una sucursal', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);

  await nav(page)
    .getByRole('link', { name: /Usuarios/ })
    .click();
  await expect(page).toHaveURL(/\/backoffice\/usuarios$/);
  await expect(page.getByText('11 usuarios', { exact: true })).toBeVisible();
  // La API no expone MFA por persona: la pantalla no inventa ese dato.
  await expect(page.getByText(/MFA pendiente/i)).toHaveCount(0);

  await page.getByRole('button', { name: /Nuevo usuario/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo usuario' });
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog.getByText('Escribe el nombre completo.')).toBeVisible();
  await expect(dialog.getByLabel('Nombre completo')).toBeFocused();

  await dialog.getByLabel('Nombre completo').fill('Lucía Prueba');
  await dialog.getByLabel('Correo').fill('lucia.prueba@sushimon.gt');
  await dialog.getByLabel('Rol de la asignación 1').selectOption({ label: 'Cocina' });
  await dialog.getByLabel('Sucursal de la asignación 1').selectOption({ label: 'Sucursal 2' });
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('12 usuarios', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar usuarios' }).fill('lucia.prueba');
  await expect(page.getByText('Pendiente de vincular Google')).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'quedó preautorizado' })).toBeVisible();

  await nav(page)
    .getByRole('link', { name: /Sucursales/ })
    .click();
  await expect(page.getByText('5 sucursales', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Sucursal 2' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar sucursal' });
  await edit.getByLabel('Teléfono (opcional)').fill('+502 2222-3333');
  await edit.getByRole('button', { name: 'Guardar sucursal' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('+502 2222-3333')).toBeVisible();

  // Desactivar una sucursal (estado administrativo) exige confirmar y dar un motivo.
  const sw = page.getByRole('switch', { name: 'Sucursal activa: Sucursal 3' });
  await sw.click();
  const confirm = page.getByRole('dialog', { name: 'Desactivar sucursal' });
  await confirm.getByRole('button', { name: 'Desactivar sucursal' }).click();
  await expect(confirm.getByText('Escribe el motivo de la desactivación.')).toBeVisible();
  await confirm.getByLabel('Motivo de la desactivación').fill('Remodelación');
  await confirm.getByRole('button', { name: 'Desactivar sucursal' }).click();
  await expect(confirm).toBeHidden();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Inactiva · oculta en la tienda')).toHaveCount(3);
});

test('admin: restablece el MFA de un empleado vinculado (simulado); no en su propia fila ni en pendientes', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/usuarios');
  await expect(page.getByText('11 usuarios', { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Usuarios internos' });
  const rowOf = (name: string) => table.getByRole('row').filter({ hasText: name });
  await expect(
    rowOf('Ana Lucía Pérez').getByRole('button', { name: /Restablecer MFA/ }),
  ).toHaveCount(0);

  await rowOf('Cocina Zona 4')
    .getByRole('button', { name: 'Restablecer MFA de Cocina Zona 4' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Restablecer MFA' });
  await expect(dialog.getByText(/volver a enrolar su autenticador/)).toBeVisible();
  await expect(dialog.getByText('Simulación')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();

  await rowOf('Cocina Zona 4')
    .getByRole('button', { name: 'Restablecer MFA de Cocina Zona 4' })
    .click();
  await dialog.getByRole('button', { name: 'Restablecer MFA' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator('.toast', { hasText: 'MFA de Cocina Zona 4 restablecido (simulación)' }),
  ).toBeVisible();

  // Un empleado pendiente de vincular no tiene factores: no se ofrece la acción.
  await page.getByRole('searchbox', { name: 'Buscar usuarios' }).fill('valeria');
  await expect(rowOf('Valeria Ixcoy')).toBeVisible();
  await expect(rowOf('Valeria Ixcoy').getByRole('button', { name: /Restablecer MFA/ })).toHaveCount(
    0,
  );
});

test('admin: crea una sucursal sin tope y rechaza un código duplicado', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/sucursales');
  await page.getByRole('button', { name: /Nueva sucursal/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva sucursal' });
  await dialog.getByLabel('Código').fill('sucursal-1');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Duplicada');
  await dialog.getByLabel('Dirección').fill('Calle 1');
  await dialog.getByRole('button', { name: 'Crear sucursal' }).click();
  await expect(dialog.getByText(/Ya existe una sucursal con ese código/).first()).toBeVisible();

  await dialog.getByLabel('Código').fill('zona-11');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Zona 11');
  await dialog.getByRole('button', { name: 'Crear sucursal' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('6 sucursales', { exact: true })).toBeVisible();
});

test('encargado: ve Reportes, Usuarios, Categorías (lectura) y Sucursales de su sucursal, sin crear sucursales', async ({
  page,
}) => {
  await enterAs(page, /Marco Antonio Gómez/);
  await expect(nav(page).getByRole('link', { name: /Reportes/ })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /Usuarios/ })).toBeVisible();
  // Categorías: solo lectura (catalog.read, F10); no ve Promociones.
  await expect(nav(page).getByRole('link', { name: /Categorías/ })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /Promociones/ })).toHaveCount(0);

  await nav(page)
    .getByRole('link', { name: /Reportes/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await expect(page.getByText('Sucursal 1 · Zona 4 · Cuatro Grados Norte').first()).toBeVisible();
  await expect(page.locator('.legend span')).toHaveCount(1);

  // Usuarios: solo el personal de su sucursal.
  await page.goto('/backoffice/usuarios');
  await expect(page.getByText('4 usuarios', { exact: true })).toBeVisible();
  await expect(page.getByText('Karla Rodríguez')).toHaveCount(0);
  // Restablecer MFA es solo del administrador general (alcance global).
  await expect(page.getByRole('button', { name: /Restablecer MFA/ })).toHaveCount(0);
  // Sucursales: solo la suya y en modo lectura.
  await page.goto('/backoffice/sucursales');
  await expect(page.getByText('1 sucursal', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Nueva sucursal/ })).toHaveCount(0);
});

test('cocina: no accede a Usuarios, Roles ni Sucursales', async ({ page }) => {
  await enterAs(page, /Cocina Zona 4/);
  for (const path of ['usuarios', 'roles', 'sucursales']) {
    await page.goto(`/backoffice/${path}`);
    await expect(page.getByText('No tienes permiso para ver esta pantalla')).toBeVisible();
  }
});

test('reportes: el rango elegido da totales coherentes entre el resumen y el historial', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/reportes');
  await expect(page.getByRole('img', { name: /Pedidos por día y sucursal/ })).toBeVisible();

  await page.getByRole('button', { name: '30 días', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos por día y sucursal' })).toBeVisible();
  await expect(page.getByText('Mar 13 oct – Mié 11 nov · 30 días').first()).toBeVisible();
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
  // El historial pagina de 25 en 25: se despliega todo el rango y se comprueba que son exactamente 3 días
  // y que la suma de pedidos por día (encabezados) es el total del resumen del periodo.
  const more = page.getByRole('button', { name: /^Mostrar \d+ más$/ });
  while (await more.isVisible()) await more.click();
  const dayHeads = page.locator('.day-h .strong');
  await expect(dayHeads).toHaveCount(3);
  const periodOrders = Number(
    (await kpi(page, 'Pedidos').locator('.kpi-val').innerText()).replace(/[^\d]/g, ''),
  );
  const perDay = await page.locator('.day-h .sm').allInnerTexts();
  const sumDays = perDay.reduce((acc, t) => acc + Number(/^(\d+) pedidos/.exec(t)?.[1] ?? NaN), 0);
  expect(sumDays).toBe(periodOrders);
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
  await expect(dialog.getByRole('alert').first()).toBeVisible();
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
