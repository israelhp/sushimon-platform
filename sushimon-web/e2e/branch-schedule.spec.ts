import { DUMPLINGS, cartV2, pickupMode } from './support/cart';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * F08 · Horarios, cierres y disponibilidad (datos simulados, sin red externa). El mock emula las reglas del servidor
 * (spec 007); el reloj de la demo parte del miércoles 2026-11-11 14:25 en Guatemala y avanza con el tiempo real.
 * La sesión es de DEMOSTRACIÓN: la API real decide permisos y alcance.
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock pnpm --filter sushimon-web test:e2e
 */

async function enterAs(page: Page, profile: RegExp) {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
}

async function openSchedule(page: Page, branch: string) {
  await page.goto('/backoffice/sucursales');
  await expect(page.getByText('5 sucursales', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Horario y cierres de ${branch}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Horario y cierres' });
  await expect(dialog.getByLabel('Apertura del intervalo 1 de Martes').first()).toBeVisible();
  return dialog;
}

const publicRegion = async (page: Page, branch: string) => {
  await page.goto('/mas');
  await page.getByRole('button', { name: `Ver horario: ${branch}` }).click();
  return page.getByRole('region', { name: `Horario de ${branch}` });
};

test('admin: abre el lunes de la Sucursal 3 y la tienda lo muestra', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openSchedule(page, 'Sucursal 3');

  // la Sucursal 3 no atiende los lunes
  const monday = dialog.getByRole('switch', { name: 'Atiende el día Lunes' });
  await expect(monday).toHaveAttribute('aria-checked', 'false');
  await monday.click();
  await expect(dialog.getByLabel('Apertura del intervalo 1 de Lunes')).toHaveValue('12:00');
  await dialog.getByLabel('Cierre del intervalo 1 de Lunes').fill('21:00');
  await dialog.getByRole('button', { name: 'Guardar horario' }).click();
  const confirm = page.getByRole('dialog', { name: 'Guardar horario' });
  await expect(confirm.getByText(/Cambian: Lunes\./)).toBeVisible();
  await confirm.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await expect(page.locator('.toast', { hasText: 'Horario de Sucursal 3 guardado' })).toBeVisible();

  // Tienda: horario semanal real con el lunes ya atendido
  const region = await publicRegion(page, 'Sucursal 3');
  await expect(region.getByText('Lunes').first()).toBeVisible();
  await expect(region.getByText('Sin atención')).toHaveCount(0);
  await expect(region.getByText('12:00 p. m. – 9:00 p. m.')).toBeVisible();
});

test('admin: detecta solapes sin guardar y divide un turno que pasa de medianoche', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openSchedule(page, 'Sucursal 1');

  // solape: viernes 12:00–22:00 + 20:00–23:00
  await dialog.getByRole('button', { name: 'Agregar intervalo a Viernes' }).click();
  await dialog.getByLabel('Apertura del intervalo 2 de Viernes').fill('20:00');
  await dialog.getByLabel('Cierre del intervalo 2 de Viernes').fill('23:00');
  await dialog.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(dialog.getByText('Se solapa con days[4].intervals[0] (12:00-22:00)')).toBeVisible();
  await expect(dialog.getByLabel('Apertura del intervalo 2 de Viernes')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Guardar horario' })).toHaveCount(0);

  // se corrige quitando el intervalo y usando el atajo: viernes 22:00 → 02:00 (parte en vie 22–24 y sáb 00–02)
  await dialog.getByRole('button', { name: 'Quitar intervalo 2 de Viernes' }).click();
  await dialog.getByLabel('Día de inicio').selectOption({ label: 'Viernes' });
  await dialog.getByLabel('Abre', { exact: true }).fill('22:00');
  await dialog.getByLabel('Cierra al día siguiente a las').fill('02:00');
  await dialog.getByRole('button', { name: 'Dividir y agregar turno' }).click();
  await expect(
    dialog.getByText(/Turno dividido: Viernes 22:00–24:00 y Sábado 00:00–02:00/),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Guardar horario' }).click();
  await page
    .getByRole('dialog', { name: 'Guardar horario' })
    .getByRole('button', { name: 'Confirmar y guardar' })
    .click();
  await expect(page.locator('.toast', { hasText: 'Horario de Sucursal 1 guardado' })).toBeVisible();

  // los tramos contiguos del viernes se muestran fusionados y el sábado de madrugada
  const region = await publicRegion(page, 'Sucursal 1');
  await expect(region.getByText('12:00 p. m. – 12:00 a. m.').first()).toBeVisible();
  await expect(region.getByText('12:00 a. m. – 2:00 a. m.')).toBeVisible();
});

test('cierre de emergencia: la tienda lo refleja y el admin lo termina', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openSchedule(page, 'Sucursal 1');
  await dialog.getByRole('tab', { name: 'Cierres' }).click();
  await expect(dialog.getByText('Motivo: Mantenimiento de campana extractora')).toBeVisible();

  // un cierre que empieza ya pide confirmación
  await dialog.getByRole('button', { name: 'Nuevo cierre' }).click();
  const form = page.getByRole('dialog', { name: 'Nuevo cierre' });
  await form.getByRole('button', { name: 'Crear cierre' }).click();
  await expect(form.getByText('Indica cuándo empieza el cierre.')).toBeVisible();
  await form.getByLabel('Inicio (hora de Guatemala)').fill('2026-11-11T14:00');
  await form.getByLabel('Fin (hora de Guatemala, no incluido)').fill('2026-11-11T22:00');
  await form.getByLabel('Motivo (opcional, solo visible aquí)').fill('Corte de energía');
  await form.getByRole('button', { name: 'Crear cierre' }).click();
  const confirm = page.getByRole('dialog', { name: 'Este cierre empieza ya' });
  await confirm.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('.toast', { hasText: 'Cierre creado' })).toBeVisible();
  await expect(dialog.getByText('Motivo: Corte de energía')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText('Cierre extraordinario').first()).toBeVisible();

  // Tienda: estado, mensaje en el carrito y SIN el motivo
  await page.evaluate(
    ([cart, mode]) => {
      localStorage.setItem('monsushi-cart-v2', cart!);
      localStorage.setItem('monsushi-order-mode-v1', mode!);
    },
    [cartV2('sucursal-1', [DUMPLINGS]), pickupMode('sucursal-1')],
  );
  await page.goto('/');
  await page.getByRole('heading', { name: /hambre/i }).waitFor();
  await page
    .getByRole('button', { name: /Ver tu pedido/ })
    .filter({ visible: true })
    .first()
    .click();
  const cart = page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(cart.getByText('Sucursal 1 no recibe pedidos en este momento.')).toBeVisible();
  await expect(cart.getByText(/Corte de energía/)).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );

  const region = await publicRegion(page, 'Sucursal 1');
  await expect(region.getByText('Cierre extraordinario')).toBeVisible();
  await expect(page.getByText(/Corte de energía/)).toHaveCount(0);

  // el admin termina el cierre en curso y la sucursal vuelve a abrir
  const again = await openSchedule(page, 'Sucursal 1');
  await again.getByRole('tab', { name: 'Cierres' }).click();
  await again.getByRole('button', { name: /Terminar ahora el cierre del/ }).click();
  await page
    .getByRole('dialog', { name: 'Terminar cierre ahora' })
    .getByRole('button', { name: 'Terminar ahora' })
    .click();
  await expect(page.locator('.toast', { hasText: 'Cierre terminado' })).toBeVisible();
  await again.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText('Abierta ahora').first()).toBeVisible();
});

test('cancela un cierre futuro con confirmación', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openSchedule(page, 'Sucursal 1');
  await dialog.getByRole('tab', { name: 'Cierres' }).click();
  await dialog.getByRole('button', { name: /Cancelar cierre del/ }).click();
  await page
    .getByRole('dialog', { name: 'Cancelar cierre' })
    .getByRole('button', { name: 'Cancelar cierre' })
    .click();
  await expect(page.locator('.toast', { hasText: 'Cierre cancelado' })).toBeVisible();
  await expect(dialog.getByText('Sin cierres')).toBeVisible();
});

test('el encargado ve el horario de su sucursal en solo lectura', async ({ page }) => {
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: /Marco Antonio Gómez/ }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.goto('/backoffice/sucursales');
  await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Horario y cierres' });
  await expect(
    dialog.getByText(/Solo lectura: no tienes permiso para modificar horarios/),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Guardar horario' })).toHaveCount(0);
  await expect(dialog.getByLabel('Apertura del intervalo 1 de Lunes')).toBeDisabled();
});

test('la tienda muestra el horario real: estado, próximo cierre y día sin atención', async ({
  page,
}) => {
  const region = await publicRegion(page, 'Sucursal 3');
  await expect(region.getByText('Abierta', { exact: true })).toBeVisible();
  await expect(region.getByText(/Cierra hoy a las 10:00 p\. m\./)).toBeVisible();
  await expect(region.getByText('Sin atención')).toBeVisible(); // lunes
  await expect(region.getByText('Hora de Guatemala')).toBeVisible();
});

test('BRANCH_SCHEDULE_BUSY: avisa, conserva lo escrito y «Reintentar» guarda', async ({ page }) => {
  await enterAs(page, /Ana Lucía Pérez/);
  await page.goto('/backoffice/sucursales');
  await expect(page.getByText('5 sucursales', { exact: true })).toBeVisible();
  // Sucursal 5 trae sembrada una ocupación simulada (409 una vez, determinista).
  await page.getByRole('button', { name: 'Horario y cierres de Sucursal 5' }).click();
  const dialog = page.getByRole('dialog', { name: 'Horario y cierres' });
  await dialog.getByRole('switch', { name: 'Atiende el día Lunes' }).click();
  await dialog.getByLabel('Cierre del intervalo 1 de Lunes').fill('20:00');
  await dialog.getByRole('button', { name: 'Guardar horario' }).click();
  await page
    .getByRole('dialog', { name: 'Guardar horario' })
    .getByRole('button', { name: 'Confirmar y guardar' })
    .click();
  await expect(
    dialog.getByText(/Otra persona está guardando cambios en esta sucursal/),
  ).toBeVisible();
  await expect(dialog.getByLabel('Cierre del intervalo 1 de Lunes')).toHaveValue('20:00');
  await dialog.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.locator('.toast', { hasText: 'Horario de Sucursal 5 guardado' })).toBeVisible();
  await expect(dialog.getByText(/Otra persona está guardando/)).toHaveCount(0);
});

test('un cierre que empieza hace más de una hora se rechaza con error en el campo de inicio', async ({
  page,
}) => {
  await enterAs(page, /Ana Lucía Pérez/);
  const dialog = await openSchedule(page, 'Sucursal 1');
  await dialog.getByRole('tab', { name: 'Cierres' }).click();
  await dialog.getByRole('button', { name: 'Nuevo cierre' }).click();
  const form = page.getByRole('dialog', { name: 'Nuevo cierre' });
  await form.getByLabel('Inicio (hora de Guatemala)').fill('2026-11-11T12:00');
  await form.getByLabel('Fin (hora de Guatemala, no incluido)').fill('2026-11-11T18:00');
  await form.getByRole('button', { name: 'Crear cierre' }).click();
  await expect(form.getByText('El inicio no puede ser anterior a una hora atrás.')).toBeVisible();
  await expect(form.getByLabel('Inicio (hora de Guatemala)')).toBeFocused();
});
