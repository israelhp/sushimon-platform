import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductSheetHost } from '@/features/catalog/components/product-sheet-host';
import { CartDrawer } from '@/features/store-shell/components/CartDrawer';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

const pizza = (sauceId: string, sauceName: string, note = '') =>
  cartInput('sushi-pizza', 1, note, {
    unitCents: 7200,
    selections: [{ groupId: 'mgroup-salsa', optionId: sauceId, quantity: 1 }],
    options: [
      {
        groupId: 'mgroup-salsa',
        optionId: sauceId,
        groupName: 'Salsa',
        optionName: sauceName,
        extraCents: 0,
      },
    ],
  });

async function openDrawer(inputs = [cartInput('california-roll', 1), cartInput('dumplings', 1)]) {
  const view = await renderStore(
    <>
      <CartDrawer />
      <ProductSheetHost />
    </>,
    { branchId: 'sucursal-1' },
  );
  await act(async () => {
    view.api().cart.add(inputs);
    view.api().shell.openCart();
  });
  const drawer = await screen.findByRole('dialog', { name: 'Tu pedido' });
  return { view, drawer };
}

describe('Deshacer INLINE, alcanzable con teclado (U1)', () => {
  it('quitar con teclado lleva el foco a «Deshacer» dentro del cajón y Enter restaura la línea en su sitio', async () => {
    const user = userEvent.setup();
    const { view, drawer } = await openDrawer();
    await within(drawer).findByText('Q53 × 1 = Q53');
    const remove = within(drawer).getByRole('button', { name: 'Eliminar California Roll' });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(view.api().cart.lines.map((l) => l.productId)).toEqual(['dumplings']);
    const undo = await within(drawer).findByRole('button', { name: 'Deshacer' });
    expect(undo).toHaveFocus();
    expect(drawer).toContainElement(undo); // dentro del diálogo, no en un toast fuera de él
    expect(within(drawer).getByText('California Roll eliminado')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(view.api().cart.lines.map((l) => l.productId)).toEqual([
        'california-roll',
        'dumplings',
      ]),
    );
    expect(within(drawer).queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });

  it('dos eliminaciones seguidas conservan cada una su «Deshacer» (ninguna se pierde)', async () => {
    const user = userEvent.setup();
    const { view, drawer } = await openDrawer();
    await within(drawer).findByText('Q53 × 1 = Q53');
    await user.click(within(drawer).getByRole('button', { name: 'Eliminar California Roll' }));
    await user.click(within(drawer).getByRole('button', { name: 'Eliminar Dumplings' }));
    expect(await within(drawer).findAllByRole('button', { name: 'Deshacer' })).toHaveLength(2);
    expect(view.api().cart.lines).toHaveLength(0);
    // Con el carrito vacío pero con marcadores pendientes no se pinta «vacío» encima de ellos.
    expect(within(drawer).queryByText('Tu pedido está vacío')).not.toBeInTheDocument();
    for (const button of within(drawer).getAllByRole('button', { name: 'Deshacer' })) {
      await user.click(button);
    }
    await waitFor(() => expect(view.api().cart.lines).toHaveLength(2));
  });

  it('el marcador se descarta solo pasado el tiempo (y se pausa con el foco encima)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { drawer } = await openDrawer();
      await within(drawer).findByText('Q53 × 1 = Q53');
      act(() => within(drawer).getByRole('button', { name: 'Eliminar Dumplings' }).click());
      const undo = await within(drawer).findByRole('button', { name: 'Deshacer' });
      // enfocado = en pausa: no expira aunque pase el tiempo
      act(() => vi.advanceTimersByTime(30_000));
      expect(undo).toBeInTheDocument();
      act(() => undo.blur());
      act(() => vi.advanceTimersByTime(8_000));
      expect(within(drawer).queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Editar una línea: ficha encima del cajón (U4, U5, S5)', () => {
  it('«Editar» está en toda línea con extras o nota y NO cierra ni reabre el cajón; guarda en el mismo sitio y devuelve el foco a la fila', async () => {
    const user = userEvent.setup();
    const { view, drawer } = await openDrawer([
      cartInput('dumplings', 1),
      pizza('mopt-ponzu', 'Ponzu', 'sin picante'),
      cartInput('california-roll', 1),
    ]);
    await within(drawer).findByText('+ Ponzu');
    // Dumplings (sin extras ni nota) no tiene «Editar»; la pizza sí.
    expect(within(drawer).getAllByRole('button', { name: /^Editar / })).toHaveLength(1);
    await user.click(within(drawer).getByRole('button', { name: 'Editar Sushi Pizza' }));

    const sheet = await screen.findByRole('dialog', { name: 'Sushi Pizza' });
    expect(screen.getByRole('dialog', { name: 'Tu pedido' })).toBeInTheDocument(); // el cajón sigue
    const salsa = await within(sheet).findByRole('group', { name: /Salsa/ });
    // precargada con la selección y la nota de la línea
    expect(within(salsa).getByRole('radio', { name: /Ponzu/ })).toBeChecked();
    expect(within(sheet).getByLabelText('Observaciones')).toHaveValue('sin picante');
    await user.click(within(salsa).getByRole('radio', { name: /Mayo spicy/ }));
    await user.click(within(sheet).getByRole('button', { name: /Guardar cambios/ }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sushi Pizza' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Tu pedido' })).toBeInTheDocument();
    // misma posición (no se mueve al final) y selección nueva
    const { lines } = view.api().cart;
    expect(lines.map((l) => l.productId)).toEqual(['dumplings', 'sushi-pizza', 'california-roll']);
    expect(lines[1]?.selections).toEqual([
      { groupId: 'mgroup-salsa', optionId: 'mopt-mayo-spicy', quantity: 1 },
    ]);
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    // el foco vuelve a la fila editada (su botón de origen ya no existe: la configuración cambió)
    await waitFor(() => {
      const row = drawer.querySelector(`[data-line-id="${lines[1]!.lineId}"]`);
      expect(row).toHaveFocus();
    });
  });

  it('editar hasta coincidir con otra línea las unifica y lo dice', async () => {
    const user = userEvent.setup();
    const { view, drawer } = await openDrawer([
      pizza('mopt-ponzu', 'Ponzu'),
      pizza('mopt-mayo-spicy', 'Mayo spicy'),
    ]);
    await within(drawer).findByText('+ Mayo spicy');
    await user.click(within(drawer).getAllByRole('button', { name: 'Editar Sushi Pizza' })[1]!);
    const sheet = await screen.findByRole('dialog', { name: 'Sushi Pizza' });
    const salsa = await within(sheet).findByRole('group', { name: /Salsa/ });
    await user.click(within(salsa).getByRole('radio', { name: /Ponzu/ }));
    await user.click(within(sheet).getByRole('button', { name: /Guardar cambios/ }));
    await waitFor(() => expect(view.api().cart.lines).toHaveLength(1));
    expect(view.api().cart.lines[0]?.quantity).toBe(2);
    expect(await screen.findByText(/se unificó con otra línea igual/)).toBeInTheDocument();
  });
});
