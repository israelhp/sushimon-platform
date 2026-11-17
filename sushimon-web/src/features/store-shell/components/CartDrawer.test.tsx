import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AddToCartInput } from '@/lib/cart-rules';
import { cartInput } from '@/test/cart';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { CartDrawer } from './CartDrawer';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

async function openCart(
  inputs: AddToCartInput[],
  options: { scenario?: 'error' | 'product-unavailable'; branchId?: string | null } = {},
) {
  const branchId = options.branchId === undefined ? 'sucursal-1' : (options.branchId ?? undefined);
  const view = await renderStore(<CartDrawer />, { scenario: options.scenario, branchId });
  await act(async () => {
    if (inputs.length > 0) {
      view.api().cart.add(inputs.map((i) => ({ ...i, branchId: branchId ?? i.branchId })));
    }
    view.api().shell.openCart();
  });
  return view;
}

const dialog = () => screen.findByRole('dialog', { name: 'Tu pedido' });

describe('CartDrawer · revalidación (F18)', () => {
  it('cerrado NO consulta nada; abierto pide el menú UNA vez y la ficha SOLO de productos únicos', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<CartDrawer />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await act(async () => {
      view.api().cart.add([cartInput('dumplings', 1), cartInput('dumplings', 1, 'sin salsa')]);
    });
    expect(spy.count('GET', /store\/(menu|products)|availability/)).toBe(0);
    await act(async () => view.api().shell.openCart());
    await screen.findAllByText('Q53 × 1 = Q53');
    expect(spy.count('GET', /^\/v1\/store\/menu$/)).toBe(1);
    // Dos líneas del MISMO producto => una sola ficha (no una por línea).
    expect(spy.count('GET', /^\/v1\/store\/products\/dumplings$/)).toBe(1);
  });

  it('cambiar cantidades NO vuelve a consultar', async () => {
    const spy = createSpyClient();
    const user = userEvent.setup();
    const view = await renderStore(<CartDrawer />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await act(async () => {
      view.api().cart.add(cartInput('dumplings', 1));
      view.api().shell.openCart();
    });
    const d = await dialog();
    await within(d).findByText('Q53 × 1 = Q53');
    await waitFor(() => expect(within(d).getByRole('link', { name: /Continuar/ })).toBeVisible());
    const before = spy.calls.length;
    await user.click(within(d).getByRole('button', { name: 'Agregar uno de Dumplings' }));
    await user.click(within(d).getByRole('button', { name: 'Agregar uno de Dumplings' }));
    await within(d).findByText('Q53 × 3 = Q159');
    expect(spy.calls.length).toBe(before);
  });
});

describe('CartDrawer', () => {
  it('muestra el estado vacío con enlace al menú y sin «Continuar»', async () => {
    const view = await openCart([]);
    const d = await dialog();
    expect(within(d).getByText('Tu pedido está vacío')).toBeInTheDocument();
    expect(within(d).getByRole('link', { name: 'Ir al menú' })).toHaveAttribute('href', '/menu');
    expect(within(d).queryByText('Subtotal estimado')).not.toBeInTheDocument();
    expect(within(d).queryByRole('link', { name: /Continuar/ })).not.toBeInTheDocument();
    expect(view.api().cart.count).toBe(0);
  });

  it('F13: usa el precio EFECTIVO de la sucursal elegida y lo AVISA (no es silencioso)', async () => {
    await openCart([cartInput('dynamita-roll', 2)], { branchId: 'sucursal-2' });
    const d = await dialog();
    expect(await within(d).findByText('Q86 × 2 = Q172')).toBeInTheDocument();
    // El precio base (Q82) cambió al de la sucursal: queda un aviso hasta el «Entendido».
    expect(await within(d).findByText(/El precio cambió: Q82 → Q86/)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(d).getByRole('button', { name: 'Entendido, precio de Dynamita Roll' }));
    await waitFor(() => expect(within(d).queryByText(/El precio cambió/)).not.toBeInTheDocument());
    expect(within(d).getByText('Q86 × 2 = Q172')).toBeInTheDocument();
  });

  it('lista líneas con extras, nota y subtotal en centavos exactos; la promoción no se resta', async () => {
    await openCart([
      cartInput('california-roll', 2, '', {
        selections: [{ groupId: 'mgroup-extras', optionId: 'mopt-queso-crema', quantity: 1 }],
        options: [
          {
            groupId: 'mgroup-extras',
            optionId: 'mopt-queso-crema',
            groupName: 'Extras',
            optionName: 'Queso crema',
            extraCents: 500,
          },
        ],
      }),
      cartInput('dumplings', 1, 'Sin ajonjolí'),
    ]);
    const d = await dialog();
    // (57 + 5) × 2 = 124 ; + 53 = 177
    expect(await within(d).findByText('Q62 × 2 = Q124')).toBeInTheDocument();
    expect(within(d).getByText('+ Queso crema (Q5)')).toBeInTheDocument();
    expect(within(d).getByText('Q53 × 1 = Q53')).toBeInTheDocument();
    expect(within(d).getByText('Nota: Sin ajonjolí')).toBeInTheDocument();
    expect(within(d).getByText('Q177')).toBeInTheDocument();
    expect(
      within(d).getByText(/promociones y el total final se validan en el checkout/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(d).getByRole('link', { name: /Continuar/ })).toHaveAttribute(
        'href',
        '/checkout',
      ),
    );
    expect(within(d).getByText('3 productos')).toBeInTheDocument();
  });

  it('configuraciones distintas son líneas separadas; idénticas se unifican', async () => {
    const view = await openCart([cartInput('dumplings', 1), cartInput('dumplings', 2)]);
    const d = await dialog();
    await within(d).findByText('Q53 × 3 = Q159');
    expect(view.api().cart.lines).toHaveLength(1);
    await act(async () => {
      view.api().cart.add(cartInput('dumplings', 1, 'sin salsa'));
    });
    await waitFor(() => expect(view.api().cart.lines).toHaveLength(2));
  });

  it('incrementa, disminuye, elimina con «Deshacer» y vacía con confirmación', async () => {
    const user = userEvent.setup();
    const view = await openCart([cartInput('california-roll', 1), cartInput('dumplings', 1)]);
    const d = await dialog();
    await within(d).findByText('Q57 × 1 = Q57');

    await user.click(within(d).getByRole('button', { name: 'Agregar uno de California Roll' }));
    expect(await within(d).findByText('Q57 × 2 = Q114')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Quitar uno de California Roll' }));
    expect(await within(d).findByText('Q57 × 1 = Q57')).toBeInTheDocument();

    await user.click(within(d).getByRole('button', { name: 'Eliminar Dumplings' }));
    expect(within(d).queryByText('Dumplings')).not.toBeInTheDocument();
    expect(view.api().cart.lines).toHaveLength(1);
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(view.api().cart.lines).toHaveLength(2));

    await user.click(within(d).getByRole('button', { name: 'Vaciar pedido' }));
    const confirm = await screen.findByRole('alertdialog', { name: '¿Vaciar tu pedido?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(view.api().cart.lines).toHaveLength(2);
    await user.click(within(d).getByRole('button', { name: 'Vaciar pedido' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: '¿Vaciar tu pedido?' })).getByRole(
        'button',
        {
          name: 'Sí, vaciar',
        },
      ),
    );
    expect(view.api().cart.lines).toHaveLength(0);
    expect(await within(d).findByText('Tu pedido está vacío')).toBeInTheDocument();
  });

  it('un producto agotado se marca, bloquea «Continuar» y se resuelve con «Quitar»', async () => {
    const user = userEvent.setup();
    await openCart([cartInput('platanito-roll', 1), cartInput('dumplings', 1)], {
      scenario: 'product-unavailable',
    });
    const d = await dialog();
    expect(await within(d).findByText('Agotado en esta sucursal')).toBeInTheDocument();
    const blocked = within(d).getByRole('button', { name: /Continuar/ });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(within(d).getByText(/Quita o corrige los productos marcados/)).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Eliminar Platanito Roll' }));
    expect(await within(d).findByRole('link', { name: /Continuar/ })).toBeInTheDocument();
  });

  it('producto inexistente (404) y extras eliminados u obligatorios sin elegir bloquean y no se corrigen solos', async () => {
    const view = await openCart([
      cartInput('fantasma-roll', 1),
      cartInput('california-roll', 1, '', {
        selections: [{ groupId: 'mgroup-extras', optionId: 'mopt-no-existe', quantity: 1 }],
        options: [
          {
            groupId: 'mgroup-extras',
            optionId: 'mopt-no-existe',
            groupName: 'Extras',
            optionName: 'Extra viejo',
            extraCents: 0,
          },
        ],
      }),
      cartInput('sushi-pizza', 1),
    ]);
    const d = await dialog();
    expect(await within(d).findByText('Este producto ya no está disponible')).toBeInTheDocument();
    expect(
      await within(d).findByText('Una opción que elegiste ya no está disponible.'),
    ).toBeInTheDocument();
    expect(
      await within(d).findByText('Los extras de este producto cambiaron. Revisa tu selección.'),
    ).toBeInTheDocument();
    expect(within(d).getAllByRole('button', { name: /^Editar / })).toHaveLength(2);
    expect(within(d).getByRole('button', { name: /Continuar/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Las selecciones guardadas siguen intactas.
    expect(
      view.api().cart.lines.find((l) => l.productId === 'california-roll')?.selections,
    ).toEqual([{ groupId: 'mgroup-extras', optionId: 'mopt-no-existe', quantity: 1 }]);
  });

  it('error de revalidación: banner con «Reintentar» y «Continuar» bloqueado', async () => {
    await openCart([cartInput('california-roll', 1)], { scenario: 'error' });
    const d = await dialog();
    const alert = await within(d).findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: /Continuar/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sin sucursal elegida: avisa y no deja continuar', async () => {
    await openCart([cartInput('dumplings', 1)], { branchId: null });
    const d = await dialog();
    expect(
      (await within(d).findAllByText(/Elige una sucursal para continuar/)).length,
    ).toBeGreaterThan(0);
    expect(within(d).getByRole('button', { name: /Continuar/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('Esc cierra, el foco entra al diálogo y vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup();
    const view = await renderStore(
      <>
        <button type="button">abrir</button>
        <CartDrawer />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'abrir' });
    trigger.focus();
    await act(async () => view.api().shell.openCart());
    const d = await dialog();
    expect(d).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(d).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(view.api().shell.cartOpen).toBe(false);
    expect(trigger).toHaveFocus();
  });
});
