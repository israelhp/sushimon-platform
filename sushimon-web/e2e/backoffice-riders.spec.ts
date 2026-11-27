import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';

/**
 * F27 · Motoristas propios del backoffice en modo MOCK (datos SIMULADOS, sin red externa): el adaptador responde
 * `/v1/admin/riders*` con la forma real del contrato (`admin-riders`). Sesión de DEMOSTRACIÓN (no autoriza nada). Móvil: ver
 * `backoffice-riders.mobile.spec.ts`.
 *   E2E_PORT=3202 pnpm --filter sushimon-web exec playwright test --project=e2e backoffice-riders
 */
test.skip(({ isMobile }) => isMobile, 'el móvil tiene su propio archivo');

const ADMIN = /Ana Lucía Pérez/; // administradora: única con riders.create/update (P93)
const MANAGER = /Marco Antonio Gómez/; // encargado de la sucursal 1: solo riders.read

async function enterAs(
  page: Page,
  profile: RegExp,
  options: {
    theme?: 'light' | 'dark';
    faults?: Record<string, string[]>;
    locale?: 'es' | 'en';
  } = {},
) {
  const { theme = 'light', faults, locale } = options;
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  if (locale) {
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost' }]);
  }
  await page.addInitScript(
    ([t, f]) => {
      localStorage.setItem('monsushi-theme', t!);
      const w = window as unknown as {
        __sushimonMockRequests: string[];
        __sushimonMockFaults?: unknown;
      };
      w.__sushimonMockRequests = [];
      if (f) w.__sushimonMockFaults = JSON.parse(f);
    },
    [theme, faults ? JSON.stringify(faults) : ''],
  );
  await page.goto('/backoffice/login');
  await page.getByRole('button', { name: profile }).click();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/backoffice\/(panel|pedidos)$/);
  await page.goto('/backoffice/motoristas');
  await expect(page.getByRole('heading', { name: 'Motoristas', level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(table(page).getByRole('row')).not.toHaveCount(1); // datos ya cargados (no el esqueleto)
  await expect(page.getByText(/motoristas?$/).first()).toBeVisible();
}

const requests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __sushimonMockRequests: string[] }).__sushimonMockRequests,
  );
const writes = async (page: Page) => (await requests(page)).filter((r) => !r.startsWith('GET'));
const table = (page: Page) => page.getByRole('table', { name: 'Motoristas propios' });
const rowOf = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name });

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  return (await builder.analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

test('menú: «Motoristas» en Operación (riders.read) y ruta propia', async ({ page }) => {
  await enterAs(page, ADMIN);
  const nav = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(nav.getByRole('link', { name: /Motoristas/ })).toHaveAttribute(
    'href',
    '/backoffice/motoristas',
  );
  await expect(nav.getByRole('link', { name: /Motoristas/ })).toHaveClass(/active/);
  await expect(page.getByText('7 motoristas')).toBeVisible();
});

test('flujo completo: alta → disponible → traslado → desactivar, con confirmaciones y sin red externa', async ({
  page,
}) => {
  await enterAs(page, ADMIN);
  await expect(table(page).getByRole('row')).toHaveCount(8);

  // Alta (nace NO disponible).
  await page.getByRole('button', { name: 'Nuevo motorista' }).click();
  const form = page.getByRole('dialog', { name: 'Nuevo motorista' });
  await expect(form).toBeVisible();
  await form.getByLabel('Sucursal').selectOption({ label: 'Sucursal 2' });
  await form.getByLabel('Nombre completo').fill('Ana Ruiz');
  await form.getByLabel('Teléfono').fill('+502 5550-9999');
  await form.getByLabel('Vehículo').selectOption({ label: 'Bicicleta' });
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.toast', { hasText: 'Ana Ruiz quedó registrado' })).toBeVisible();
  await expect(form).toBeHidden();
  const row = rowOf(page, 'Ana Ruiz');
  await expect(row.getByText('No disponible')).toBeVisible();
  await expect(row.getByText('+502****9999')).toBeVisible();
  await expect(row.getByText('Ocupación: sin entrega activa')).toBeVisible();

  // Disponible.
  await row.getByRole('switch', { name: 'Disponible: Ana Ruiz' }).click();
  await expect(page.locator('.toast', { hasText: 'Ana Ruiz quedó disponible.' })).toBeVisible();
  await expect(row.getByRole('switch')).toBeChecked();
  await expect(row.getByText('Disponible', { exact: true })).toBeVisible();

  // Traslado con confirmación: queda NO disponible en la nueva sucursal.
  await row.getByRole('button', { name: 'Trasladar a Ana Ruiz a otra sucursal' }).click();
  const move = page.getByRole('alertdialog', { name: 'Trasladar de sucursal' });
  await expect(move.getByText(/Quedará NO disponible/)).toBeVisible();
  await move.getByLabel('Sucursal destino').selectOption({ label: 'Sucursal 3' });
  await move.getByRole('button', { name: 'Trasladar' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Ana Ruiz se trasladó a Sucursal 3 y quedó no disponible.' }),
  ).toBeVisible();
  await expect(row.getByText('Sucursal 3')).toBeVisible();
  await expect(row.getByRole('switch')).not.toBeChecked();

  // Desactivar con confirmación y motivo opcional.
  await row.getByRole('button', { name: 'Desactivar a Ana Ruiz' }).click();
  const off = page.getByRole('dialog', { name: 'Desactivar motorista' });
  await off.getByLabel('Motivo (opcional)').fill('Prueba');
  await off.getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.locator('.toast', { hasText: 'Ana Ruiz desactivado.' })).toBeVisible();
  await expect(row.getByText('Inactivo', { exact: true }).first()).toBeVisible();
  await expect(row.getByRole('switch')).toBeDisabled();

  expect(await writes(page)).toEqual([
    'POST /v1/admin/riders',
    'PATCH /v1/admin/riders/rider-8/availability',
    'PATCH /v1/admin/riders/rider-8',
    'PATCH /v1/admin/riders/rider-8/status',
  ]);
});

test('edición y detalle: datos completos, versión y enlace a la pantalla Entregas sin historial', async ({
  page,
}) => {
  await enterAs(page, ADMIN);
  await page.getByRole('button', { name: 'Ver detalle de Luis Coc' }).click();
  const drawer = page.getByRole('dialog', { name: 'Luis Coc' });
  const detail = drawer.getByTestId('rider-detail');
  await expect(detail.getByText('+50255501002')).toBeVisible();
  await expect(detail.getByText('M219PLX')).toBeVisible();
  await expect(detail.getByTestId('rider-occupancy')).toHaveText('Sin entrega activa');
  await expect(detail.getByTestId('rider-deliveries')).toHaveText('Consulta la pantalla Entregas');
  await expect(detail.getByText(/historial de entregas/i)).toHaveCount(0);

  await drawer.getByRole('button', { name: 'Editar' }).click();
  const form = page.getByRole('dialog', { name: 'Editar motorista' });
  await expect(form.getByLabel('Teléfono')).toHaveValue('+50255501002');
  await form.getByLabel('Nombre completo').fill('Luis Alberto Coc');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Datos de Luis Alberto Coc actualizados.' }),
  ).toBeVisible();
  // El panel (cuyo nombre accesible es el del motorista) refleja el cambio y la versión nueva.
  const renamed = page.getByRole('dialog', { name: 'Luis Alberto Coc' });
  await expect(
    renamed.getByTestId('rider-detail').getByText('Luis Alberto Coc').first(),
  ).toBeVisible();
  await expect(renamed.getByTestId('rider-detail').getByText('2', { exact: true })).toBeVisible(); // versión
  await page.keyboard.press('Escape');
  await expect(renamed).toBeHidden();
});

test('errores del contrato: teléfono repetido (409) y conflicto de versión con «Recargar datos»', async ({
  page,
}) => {
  await enterAs(page, ADMIN, {
    faults: { 'PATCH /v1/admin/riders/rider-2': ['version-conflict'] },
  });
  await page.getByRole('button', { name: 'Nuevo motorista' }).click();
  const form = page.getByRole('dialog', { name: 'Nuevo motorista' });
  await form.getByLabel('Sucursal').selectOption({ label: 'Sucursal 1' });
  await form.getByLabel('Nombre completo').fill('Copia Phone');
  await form.getByLabel('Teléfono').fill('+50255501002');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form.getByText(/Ese teléfono ya está registrado/)).toBeVisible();
  await expect(form.getByLabel('Teléfono')).toBeFocused();
  await form.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Editar a Luis Coc' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar motorista' });
  await expect(edit.getByLabel('Teléfono')).toHaveValue('+50255501002');
  await edit.getByLabel('Nombre completo').fill('Mi cambio');
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await expect(edit.getByRole('alert')).toContainText('Otra persona modificó este motorista');
  await edit.getByRole('button', { name: 'Recargar datos' }).click();
  await expect(edit.getByText(/Se conservaron tus cambios/)).toBeVisible();
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await expect(
    page.locator('.toast', { hasText: 'Datos de Mi cambio actualizados.' }),
  ).toBeVisible();
});

test('disponibilidad: el 409 de entrega activa revierte el interruptor', async ({ page }) => {
  await enterAs(page, ADMIN, {
    faults: { 'PATCH /v1/admin/riders/rider-1/availability': ['has-active-delivery'] },
  });
  const sw = rowOf(page, 'Juan Carlos Pérez').getByRole('switch');
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(page.locator('.toast', { hasText: 'Tiene una entrega activa' })).toBeVisible();
  await expect(sw).toBeChecked();
});

test('filtros y búsqueda: nombre sin acentos, sucursal, estado y disponibilidad (con «Ocupado», F28)', async ({
  page,
}) => {
  await enterAs(page, ADMIN);
  await page.getByRole('searchbox', { name: 'Buscar motoristas por nombre' }).fill('angel');
  await expect(page.getByText('1 motorista', { exact: true })).toBeVisible();
  await expect(rowOf(page, 'Ángel Morales')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar motoristas por nombre' }).fill('');
  await expect(page.getByText('7 motoristas')).toBeVisible();
  const filters = page.getByRole('group', { name: 'Filtros de motoristas' });
  await filters.getByLabel('Sucursal').selectOption({ label: 'Sucursal 3' });
  await expect(page.getByText('2 motoristas')).toBeVisible();
  await filters.getByLabel('Estado').selectOption({ label: 'Inactivos' });
  await expect(page.getByText('1 motorista', { exact: true })).toBeVisible();
  await expect(
    filters.getByLabel('Disponibilidad').getByRole('option', { name: 'Ocupado' }),
  ).toHaveCount(1);
  await filters.getByLabel('Disponibilidad').selectOption({ label: 'Disponible' });
  await expect(page.getByText('Sin resultados')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page.getByText('7 motoristas')).toBeVisible();
});

test('el encargado solo lee: su sucursal, sin alta ni acciones', async ({ page }) => {
  await enterAs(page, MANAGER);
  await expect(page.getByText('3 motoristas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo motorista' })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Editar a/ })).toHaveCount(0);
  await expect(page.getByText('Solo lectura').first()).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('el backoffice es solo español: con la cookie en inglés el texto sigue en español', async ({
  page,
}) => {
  await enterAs(page, ADMIN, { locale: 'en' });
  await expect(page.getByRole('heading', { name: 'Motoristas', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo motorista' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`accesibilidad (axe): listado, detalle, formulario y confirmaciones · ${theme}`, async ({
    page,
  }) => {
    await enterAs(page, ADMIN, { theme });
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: 'Ver detalle de Juan Carlos Pérez' }).click();
    const drawer = page.getByRole('dialog', { name: 'Juan Carlos Pérez' });
    await expect(drawer.getByTestId('rider-detail')).toBeVisible();
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await page.getByRole('button', { name: 'Nuevo motorista' }).click();
    const form = page.getByRole('dialog', { name: 'Nuevo motorista' });
    await expect(form.getByLabel('Sucursal')).toBeVisible();
    await form.getByRole('button', { name: 'Guardar' }).click(); // muestra errores de validación
    await expect(form.getByRole('alert').first()).toBeVisible();
    expect(await axe(page, '[role="dialog"][aria-modal="true"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();

    await page.getByRole('button', { name: 'Trasladar a Luis Coc a otra sucursal' }).click();
    const move = page.getByRole('alertdialog', { name: 'Trasladar de sucursal' });
    await expect(move).toBeVisible();
    expect(await axe(page, '[role="alertdialog"]')).toEqual([]);
  });
}
