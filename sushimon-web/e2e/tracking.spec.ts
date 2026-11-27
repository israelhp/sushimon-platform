import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';

/**
 * Consulta de invitado → seguimiento → reclamo, con datos mock (pedido de demostración MON-490217 · 5555-1234)
 * y sin red externa. Los enlaces de WhatsApp solo se comprueban, nunca se abren.
 *   E2E_PORT=3203 pnpm --filter sushimon-web exec playwright test --project=e2e tracking
 */

async function consult(page: Page, orderNumber: string, phone: string) {
  await page.getByLabel('Número de pedido').fill(orderNumber);
  await page.getByLabel('Teléfono').fill(phone);
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

test.describe('consulta de invitado y seguimiento', () => {
  test('datos incorrectos: aviso genérico accesible, igual para pedido inexistente', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/consultar');
    await page.getByRole('button', { name: 'Consultar', exact: true }).click();
    await expect(page.getByLabel('Número de pedido')).toBeFocused();
    await expect(page.getByText('Ingresa el número de pedido', { exact: true })).toBeVisible();

    await consult(page, 'MON-490217', '5555-9999');
    const notice = 'No encontramos un pedido con esos datos. Revisa el número y el teléfono.';
    await expect(page.getByText(notice)).toBeVisible();
    await consult(page, 'MON-111111', '5555-1234');
    await expect(page.getByText(notice)).toBeVisible();
    await expect(page).toHaveURL(/\/consultar/, { timeout: 90_000 });
  });

  test('pedido ajeno por URL directa lleva a la consulta (no se revela nada)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/pedidos/MON-490217');
    await expect(page).toHaveURL(/\/consultar\?pedido=MON-490217&notfound=1/, { timeout: 90_000 });
    await expect(page.getByLabel('Número de pedido')).toHaveValue('MON-490217');
    await expect(page.getByText(/No encontramos un pedido con esos datos/)).toBeVisible();
  });

  test('consulta correcta → seguimiento (6 pasos) → avance de demostración → reclamo', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto('/consultar');
    await page.getByRole('button', { name: 'Usar datos de prueba' }).click();
    await page.getByRole('button', { name: 'Consultar', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'MON-490217' })).toBeVisible({
      timeout: 120_000,
    });
    const steps = page.getByRole('list', { name: 'Progreso del pedido' }).getByRole('listitem');
    await expect(steps).toHaveCount(6);
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);

    // Botón de demostración rotulado como simulación: avanza hasta que cambia el paso visible.
    const demo = page.getByRole('button', { name: 'Ver siguiente estado (simulación)' });
    await expect(page.getByText('Simulación').first()).toBeVisible();
    const current = page.locator('[aria-current="step"]');
    const before = await current.innerText();
    for (let i = 0; i < 4 && (await current.innerText()) === before; i++) {
      await demo.click();
      await page.waitForTimeout(250);
    }
    expect(await current.innerText()).not.toBe(before);

    await expectNoSeriousA11yViolations(page);

    // El reclamo por WhatsApp va prellenado (solo se verifica el enlace).
    const whatsapp = page.getByRole('link', { name: /Reportar por WhatsApp/ });
    const href = (await whatsapp.getAttribute('href')) ?? '';
    expect(href).toMatch(/^https:\/\/wa\.me\/\d{11,15}\?text=/);
    expect(decodeURIComponent(href)).toContain('Pedido: MON-490217');

    // Reclamo en la app con POST /v1/incidents (mock).
    await page.getByRole('link', { name: 'Reportar el problema en la app' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Reportar un problema/ })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    await page.getByRole('button', { name: 'Enviar incidencia' }).click();
    await expect(page.getByRole('radio', { name: 'Faltó un producto' })).toBeFocused();
    await expect(page.getByText('Elegí qué pasó')).toBeVisible();

    await page.getByRole('radio', { name: 'Demora o no llegó' }).check();
    await page.getByLabel('Describí el problema').fill('El pedido llegó 40 minutos tarde');
    await page.getByRole('radio', { name: 'Crédito para mi próximo pedido' }).check();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Enviar incidencia' }).click();
    await expect(page.getByText('¡Recibimos tu reporte!')).toBeVisible();
    await expect(page.getByText(/INC-\d+/).first()).toBeVisible();

    // El reclamo queda en el detalle del pedido.
    await page.getByRole('link', { name: 'Ver pedido' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Reclamos' })).toBeVisible();
    await expect(page.getByText('El pedido llegó 40 minutos tarde')).toBeVisible();
  });

  test('?next=incidencia continúa al hub de reclamos con el pedido destacado', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/incidencias');
    await page.getByRole('link', { name: 'Buscar mi pedido con número y teléfono' }).click();
    await expect(page).toHaveURL(/\/consultar\?next=incidencia/, { timeout: 90_000 });
    await consult(page, 'MON-490217', '5555-1234');
    await expect(page).toHaveURL(/\/incidencias\?pedido=MON-490217/, { timeout: 90_000 });
    const item = page.getByRole('listitem').filter({ hasText: 'MON-490217' });
    await expect(item).toBeVisible();
    await expect(item.getByRole('link', { name: /Reportar por WhatsApp/ })).toHaveAttribute(
      'href',
      /wa\.me/,
    );
    await expectNoSeriousA11yViolations(page);
  });
});
