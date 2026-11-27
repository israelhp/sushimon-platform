import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { CART_KEY, DUMPLINGS, cartV2, pickupMode } from './support/cart';

/**
 * F18 — Carrito local (MOCK_ONLY: datos simulados, sin API real ni red externa). Cubre agregar con extras, unificar/separar
 * configuraciones, persistencia, sincronización entre pantallas y pestañas, política de sucursal, estados por línea, idiomas,
 * temas, accesibilidad y que el invitado y la sesión de demostración vean el MISMO carrito sin duplicarlo.
 *   CI=1 NEXT_PUBLIC_AUTH_SOURCE=mock NEXT_PUBLIC_DATA_SOURCE=mock E2E_PORT=3210 pnpm --filter sushimon-web exec playwright test --project=e2e cart
 */

const MODE_KEY = 'monsushi-order-mode-v1';

async function seed(page: Page, cart: string | null, branchId: string | null = 'sucursal-1') {
  await page.addInitScript(
    ([cartKey, cartValue, modeKey, modeValue]) => {
      // Solo la PRIMERA carga: así una recarga conserva lo que la app haya guardado después.
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      if (cartValue) localStorage.setItem(cartKey!, cartValue);
      if (modeValue) localStorage.setItem(modeKey!, modeValue);
    },
    [CART_KEY, cart, MODE_KEY, branchId ? pickupMode(branchId) : null],
  );
}

const savedCart = async (page: Page) =>
  JSON.parse((await page.evaluate((k) => localStorage.getItem(k), CART_KEY)) ?? 'null');

async function openDrawer(page: Page) {
  await page
    .getByRole('button', { name: /Ver tu pedido/ })
    .filter({ visible: true })
    .first()
    .click();
  const drawer = page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function expectNoSeriousA11y(page: Page, scope?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  const results = await (scope ? builder.include(scope) : builder).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

async function openSushiPizza(page: Page) {
  await page.goto('/menu');
  await page
    .getByRole('button', { name: /^Sushi Pizza/ })
    .filter({ visible: true })
    .first()
    .click({ timeout: 90_000 });
  const dialog = page.getByRole('dialog', { name: 'Sushi Pizza' });
  await expect(dialog.getByRole('group', { name: /Salsa/ })).toBeVisible();
  return dialog;
}

async function addPizza(page: Page, sauce: RegExp, extras: RegExp[] = []) {
  const dialog = page.getByRole('dialog', { name: 'Sushi Pizza' });
  await dialog.getByRole('group', { name: /Salsa/ }).getByRole('radio', { name: sauce }).check();
  for (const extra of extras) {
    await dialog
      .getByRole('group', { name: /Extras/ })
      .getByRole('checkbox', { name: extra })
      .check();
  }
  await dialog.getByRole('button', { name: /^Agregar\s*Q/ }).click();
  await expect(dialog).toBeHidden();
}

test.describe('carrito · agregar, unificar y persistir', () => {
  test('con extras: «Agregar» espera la salsa obligatoria, guarda las selecciones y el contador son unidades', async ({
    page,
  }) => {
    await seed(page, null);
    const dialog = await openSushiPizza(page);
    const add = dialog.getByRole('button', { name: /^Agregar\s*Q/ });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expectNoSeriousA11y(page, '[role="dialog"]');
    await dialog.getByRole('button', { name: 'Aumentar cantidad' }).click();
    await addPizza(page, /Ponzu/, [/Queso crema/]);
    await expect(
      page
        .getByRole('navigation', { name: 'Principal' })
        .getByRole('button', { name: 'Ver tu pedido, 2 productos' }),
    ).toBeVisible();
    const cart = await savedCart(page);
    expect(cart).toMatchObject({ v: 2, branchId: 'sucursal-1' });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: 'sushi-pizza', quantity: 2 });
    expect(cart.lines[0].selections).toEqual([
      { groupId: 'mgroup-extras', optionId: 'mopt-queso-crema', quantity: 1 },
      { groupId: 'mgroup-salsa', optionId: 'mopt-ponzu', quantity: 1 },
    ]);
    const drawer = await openDrawer(page);
    await expect(drawer.getByText('+ Queso crema (Q5)')).toBeVisible();
    // (72 + 0 + 5) × 2
    await expect(drawer.getByText('Q77 × 2 = Q154')).toBeVisible();
    await expect(
      drawer.getByText(/promociones y el total final se validan en el checkout/i),
    ).toBeVisible();
  });

  test('misma configuración se unifica; otra opción o nota son líneas separadas; persiste tras recargar', async ({
    page,
  }) => {
    await seed(page, null);
    await openSushiPizza(page);
    await addPizza(page, /Ponzu/);
    await page
      .getByRole('button', { name: /Sushi Pizza/ })
      .filter({ visible: true })
      .first()
      .click();
    await addPizza(page, /Ponzu/);
    await page
      .getByRole('button', { name: /Sushi Pizza/ })
      .filter({ visible: true })
      .first()
      .click();
    await addPizza(page, /Mayo spicy/);
    await expect
      .poll(async () =>
        (await savedCart(page))?.lines.map((l: { quantity: number }) => l.quantity).sort(),
      )
      .toEqual([1, 2]);

    await page.reload();
    const drawer = await openDrawer(page);
    await expect(drawer.getByRole('listitem').filter({ hasText: 'Sushi Pizza' })).toHaveCount(2);
    expect((await savedCart(page)).lines).toHaveLength(2);
    await expect(drawer.getByRole('link', { name: /Continuar/ })).toBeVisible();
  });

  test('vaciar pide confirmación y quitar ofrece «Deshacer»', async ({ page }) => {
    await seed(
      page,
      cartV2('sucursal-1', [
        DUMPLINGS,
        { productId: 'loco-ribs', name: 'Loco Ribs', unitCents: 4200 },
      ]),
    );
    await page.goto('/menu');
    const drawer = await openDrawer(page);
    await drawer.getByRole('button', { name: 'Eliminar Dumplings' }).click();
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await expect(drawer.getByText('Dumplings', { exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: 'Vaciar pedido' }).click();
    const confirm = page.getByRole('alertdialog', { name: '¿Vaciar tu pedido?' });
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    expect((await savedCart(page)).lines).toHaveLength(2);
    await drawer.getByRole('button', { name: 'Vaciar pedido' }).click();
    await page
      .getByRole('alertdialog', { name: '¿Vaciar tu pedido?' })
      .getByRole('button', { name: 'Sí, vaciar' })
      .click();
    await expect(drawer.getByText('Tu pedido está vacío')).toBeVisible();
    expect((await savedCart(page)).lines).toEqual([]);
  });
});

test.describe('carrito · teclado y edición (U1, U4)', () => {
  test('quitar con teclado deja «Deshacer» DENTRO del cajón, enfocado, y Enter restaura la línea', async ({
    page,
  }) => {
    await seed(
      page,
      cartV2('sucursal-1', [
        DUMPLINGS,
        { productId: 'loco-ribs', name: 'Loco Ribs', unitCents: 4200 },
      ]),
    );
    await page.goto('/menu');
    const drawer = await openDrawer(page);
    await drawer.getByRole('button', { name: 'Eliminar Dumplings' }).focus();
    await page.keyboard.press('Enter');
    const undo = drawer.getByRole('button', { name: 'Deshacer' });
    await expect(undo).toBeFocused();
    expect((await savedCart(page)).lines).toHaveLength(1);
    await page.keyboard.press('Enter');
    await expect(drawer.getByText('Dumplings', { exact: true })).toBeVisible();
    expect((await savedCart(page)).lines.map((l: { productId: string }) => l.productId)).toEqual([
      'dumplings',
      'loco-ribs',
    ]);
  });

  test('editar una línea abre la ficha ENCIMA del cajón (sin cerrarlo), guarda en el mismo sitio y devuelve el foco a la fila', async ({
    page,
  }) => {
    await seed(
      page,
      cartV2('sucursal-1', [
        DUMPLINGS,
        {
          productId: 'sushi-pizza',
          name: 'Sushi Pizza',
          unitCents: 7200,
          selections: [{ groupId: 'mgroup-salsa', optionId: 'mopt-ponzu' }],
          options: [
            {
              groupId: 'mgroup-salsa',
              optionId: 'mopt-ponzu',
              groupName: 'Salsa',
              optionName: 'Ponzu',
              extraCents: 0,
            },
          ],
        },
      ]),
    );
    await page.goto('/menu');
    const drawer = await openDrawer(page);
    await drawer.getByRole('button', { name: 'Editar Sushi Pizza' }).click();
    const sheet = page.getByRole('dialog', { name: 'Sushi Pizza' });
    await expect(sheet.getByRole('radio', { name: /Ponzu/ })).toBeChecked();
    await expect(drawer).toBeVisible();
    await sheet.getByRole('radio', { name: /Mayo spicy/ }).check();
    await sheet.getByRole('button', { name: /Guardar cambios/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText('Cambios guardados')).toBeVisible();
    await expect(drawer).toBeVisible();
    const cart = await savedCart(page);
    expect(cart.lines.map((l: { productId: string }) => l.productId)).toEqual([
      'dumplings',
      'sushi-pizza',
    ]);
    expect(cart.lines[1].selections[0].optionId).toBe('mopt-mayo-spicy');
    await expect(drawer.locator(`[data-line-id="${cart.lines[1].lineId}"]`)).toBeFocused();
  });
});

test.describe('carrito · estados por línea y política de sucursal', () => {
  test('agotado en la sucursal y precio cambiado: se avisan, bloquean (o no) «Continuar» y no son silenciosos', async ({
    page,
  }) => {
    // sucursal-2: Gaseosas agotadas; Dynamita Roll cuesta Q86 (el carrito recordaba Q82).
    await seed(
      page,
      cartV2('sucursal-2', [
        { productId: 'gaseosas', name: 'Gaseosas', unitCents: 1000 },
        { productId: 'dynamita-roll', name: 'Dynamita Roll', unitCents: 8200 },
      ]),
      'sucursal-2',
    );
    await page.goto('/menu');
    const drawer = await openDrawer(page);
    await expect(drawer.getByText('Agotado en esta sucursal')).toBeVisible();
    await expect(drawer.getByText(/El precio cambió: Q82 → Q86/)).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Continuar/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expectNoSeriousA11y(page, '[role="dialog"]');
    await drawer.getByRole('button', { name: 'Eliminar Gaseosas' }).click();
    await expect(drawer.getByRole('link', { name: /Continuar/ })).toBeVisible();
    await drawer.getByRole('button', { name: 'Entendido, precio de Dynamita Roll' }).click();
    await expect(drawer.getByText(/El precio cambió/)).toHaveCount(0);
    await expect(drawer.getByText('Q86 × 1 = Q86')).toBeVisible();
  });

  test('cambiar de sucursal muestra el plan por línea y NADA se vacía hasta confirmar', async ({
    page,
  }) => {
    await seed(
      page,
      cartV2('sucursal-1', [
        DUMPLINGS,
        { productId: 'gaseosas', name: 'Gaseosas', unitCents: 1000 },
        { productId: 'dynamita-roll', name: 'Dynamita Roll', unitCents: 8200 },
      ]),
    );
    await page.goto('/menu');
    // El cambio llega desde el selector: mismo estado que guarda la hoja de modo de pedido.
    await page.evaluate(
      ([key, mode]) => {
        localStorage.setItem(key!, mode!);
      },
      [MODE_KEY, pickupMode('sucursal-2')],
    );
    await page.reload();
    const dialog = page.getByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByText(/El precio cambió: Q82 → Q86/)).toBeVisible();
    await expect(dialog.getByText(/Se quita: Agotado en esta sucursal/)).toBeVisible();
    await expectNoSeriousA11y(page, '[role="alertdialog"]');
    expect((await savedCart(page)).branchId).toBe('sucursal-1');
    expect((await savedCart(page)).lines).toHaveLength(3);
    await dialog.getByRole('button', { name: 'Conservar las válidas (2)' }).click();
    await expect(dialog).toBeHidden();
    const cart = await savedCart(page);
    expect(cart.branchId).toBe('sucursal-2');
    expect(cart.lines.map((l: { productId: string }) => l.productId).sort()).toEqual([
      'dumplings',
      'dynamita-roll',
    ]);
  });

  test('«Mantener» la sucursal anterior revierte el selector y conserva el carrito', async ({
    page,
  }) => {
    await seed(page, cartV2('sucursal-1', [DUMPLINGS]), 'sucursal-2');
    await page.goto('/menu');
    const dialog = page.getByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    await dialog.getByRole('button', { name: /^Mantener / }).click();
    await expect(dialog).toBeHidden();
    const mode = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), MODE_KEY))!);
    expect(mode.branchId).toBe('sucursal-1');
    expect((await savedCart(page)).lines).toHaveLength(1);
  });

  test('un carrito de la versión anterior (v1) se descarta con un aviso y no se migra', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem(
          'monsushi-cart-v1',
          JSON.stringify([{ productId: 'dumplings', quantity: 1, note: '' }]),
        );
      }
    });
    await page.goto('/menu');
    await expect(
      page.getByText('Actualizamos tu pedido: vuelve a agregar tus productos.').first(),
    ).toBeVisible({ timeout: 90_000 });
    expect(await page.evaluate(() => localStorage.getItem('monsushi-cart-v1'))).toBeNull();
    await expect(
      page.getByRole('button', { name: /Ver tu pedido, 0 productos/ }).first(),
    ).toBeAttached();
  });
});

test.describe('carrito · sincronización, sesión, idioma y tema', () => {
  test('una sola fuente entre pantallas y pestañas (evento storage) y el invitado conserva su carrito al iniciar sesión', async ({
    page,
    context,
  }) => {
    await seed(page, cartV2('sucursal-1', [DUMPLINGS]));
    await page.goto('/menu');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('button', { name: 'Ver tu pedido, 1 producto' })).toBeVisible({
      timeout: 90_000,
    });

    // Otra pestaña del mismo navegador agrega una unidad: ésta se entera sin recargar.
    const other = await context.newPage();
    await other.goto('/menu');
    const otherDrawer = await openDrawer(other);
    await otherDrawer.getByRole('button', { name: 'Agregar uno de Dumplings' }).click();
    await expect(nav.getByRole('button', { name: 'Ver tu pedido, 2 productos' })).toBeVisible();
    await other.close();

    // Otra pantalla (Inicio): mismo contador.
    await page.goto('/');
    await expect(nav.getByRole('button', { name: 'Ver tu pedido, 2 productos' })).toBeVisible({
      timeout: 90_000,
    });

    // Sesión de demostración: el carrito es anónimo, no se duplica ni se vacía.
    await page.goto('/cuenta');
    await page
      .getByRole('button', { name: /Continuar con Google/ })
      .first()
      .click();
    const login = page.getByRole('dialog', { name: 'Iniciar sesión' });
    await login.getByRole('button', { name: /Continuar con Google/ }).click();
    await login.getByRole('button', { name: /Cliente Demo/ }).click();
    await expect(login).toBeHidden();
    await expect(nav.getByRole('button', { name: 'Ver tu pedido, 2 productos' })).toBeVisible();
    expect((await savedCart(page)).lines).toHaveLength(1);
  });

  test('inglés y tema oscuro: textos traducidos, sin violaciones de accesibilidad', async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: 'en', domain: 'localhost', path: '/' },
    ]);
    await page.addInitScript(() => localStorage.setItem('monsushi-theme', 'dark'));
    await seed(page, cartV2('sucursal-1', [DUMPLINGS]));
    await page.goto('/menu');
    const drawer = await (async () => {
      await page
        .getByRole('button', { name: /View your order|View order/ })
        .filter({ visible: true })
        .first()
        .click({ timeout: 90_000 });
      return page.getByRole('dialog', { name: 'Your order' });
    })();
    await expect(drawer.getByText('Estimated subtotal')).toBeVisible();
    await expect(
      drawer.getByText(/Promotions and the final total are validated at checkout/),
    ).toBeVisible();
    await expectNoSeriousA11y(page, '[role="dialog"]');
  });

  test('el checkout simulado sigue rotulado como demostración: «Continuar» lleva a /checkout sin crear pedido real', async ({
    page,
  }) => {
    await seed(page, cartV2('sucursal-1', [DUMPLINGS]));
    await page.goto('/menu');
    const drawer = await openDrawer(page);
    await drawer.getByRole('link', { name: /Continuar/ }).click();
    await page.waitForURL('**/checkout');
    await expect(page.getByRole('heading', { level: 1, name: 'Tu pedido' })).toBeVisible();
    expect((await savedCart(page)).lines).toHaveLength(1);
  });
});
