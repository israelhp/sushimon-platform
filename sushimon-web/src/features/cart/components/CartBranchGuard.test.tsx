import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { CartBranchGuard } from './CartBranchGuard';

async function setup(options: Parameters<typeof renderStore>[1] = {}) {
  const view = await renderStore(<CartBranchGuard />, { branchId: 'sucursal-1', ...options });
  await act(async () => {
    view
      .api()
      .cart.add([
        cartInput('dumplings', 1),
        cartInput('dynamita-roll', 2, '', { unitCents: 8200 }),
        cartInput('gaseosas', 1),
        cartInput('fantasma-roll', 1),
      ]);
  });
  return view;
}
const changeTo = (view: Awaited<ReturnType<typeof setup>>, branchId: string) =>
  act(async () => view.api().mode.update({ branchId }));

describe('CartBranchGuard · política de sucursal (#16 #17)', () => {
  it('con la misma sucursal no aparece nada', async () => {
    await setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra el plan por línea y NO cambia ni vacía el carrito hasta confirmar', async () => {
    const view = await setup();
    await changeTo(view, 'sucursal-2');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    // Listo: precio cambiado, agotado en la nueva, producto inexistente.
    expect(await within(dialog).findByText(/El precio cambió: Q82 → Q86/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Se quita: Agotado en esta sucursal/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Se quita: Este producto ya no está disponible/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Se mantiene')).toBeInTheDocument();
    expect(within(dialog).getByText(/Se quitarán 2 productos/)).toBeInTheDocument();
    // Hasta confirmar: la sucursal y las líneas siguen siendo las anteriores.
    expect(view.api().cart.branchId).toBe('sucursal-1');
    expect(view.api().cart.lines).toHaveLength(4);
  });

  it('«Conservar las válidas» deja solo las válidas con el precio vigente y el aviso de cambio', async () => {
    const user = userEvent.setup();
    const view = await setup();
    await changeTo(view, 'sucursal-2');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    await user.click(
      await within(dialog).findByRole('button', { name: 'Conservar las válidas (2)' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const { cart } = view.api();
    expect(cart.branchId).toBe('sucursal-2');
    expect(cart.lines.map((l) => l.productId).sort()).toEqual(['dumplings', 'dynamita-roll']);
    const dyn = cart.lines.find((l) => l.productId === 'dynamita-roll')!;
    expect(dyn.display).toMatchObject({ unitCents: 8600, priceChange: { fromCents: 8200 } });
    expect(dyn.quantity).toBe(2);
  });

  it('«Mantener» la sucursal anterior revierte el selector sin tocar el carrito', async () => {
    const user = userEvent.setup();
    const view = await setup();
    await changeTo(view, 'sucursal-2');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    await user.click(await within(dialog).findByRole('button', { name: /^Mantener / }));
    await waitFor(() => expect(view.api().mode.mode.branchId).toBe('sucursal-1'));
    expect(view.api().cart.lines).toHaveLength(4);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('«Vaciar y empezar» pide confirmación y solo entonces vacía', async () => {
    const user = userEvent.setup();
    const view = await setup();
    await changeTo(view, 'sucursal-2');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    await user.click(within(dialog).getByRole('button', { name: /^Vaciar y empezar en / }));
    expect(view.api().cart.lines).toHaveLength(4);
    await user.click(within(dialog).getByRole('button', { name: 'Sí, vaciar y empezar' }));
    expect(view.api().cart.lines).toHaveLength(0);
  });

  it('agregar con otra sucursal que la del carrito se rechaza (no se mezcla ni se vacía)', async () => {
    const view = await setup();
    let result: ReturnType<typeof view.api>['cart']['add'] extends (...a: never[]) => infer R
      ? R
      : never;
    await act(async () => {
      result = view.api().cart.add(cartInput('dumplings', 1, '', { branchId: 'sucursal-2' }));
    });
    expect(result!).toEqual({ ok: false, reason: 'BRANCH_MISMATCH' });
    expect(view.api().cart.lines).toHaveLength(4);
  });

  it('es un alertdialog; la segunda confirmación lleva el foco a la salida SEGURA y el botón destructivo se distingue', async () => {
    const user = userEvent.setup();
    const view = await setup();
    await changeTo(view, 'sucursal-2');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    await user.click(within(dialog).getByRole('button', { name: /^Vaciar y empezar en / }));
    const keep = within(dialog).getByRole('button', { name: 'Cancelar' });
    expect(keep).toHaveFocus();
    const destructive = within(dialog).getByRole('button', { name: 'Sí, vaciar y empezar' });
    expect(destructive.className).toContain('bg-danger');
    // la salida segura va antes que la destructiva
    expect(
      keep.compareDocumentPosition(destructive) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(keep);
    expect(view.api().cart.lines).toHaveLength(4);
  });

  it('si la sucursal anterior ya no existe: lo avisa, no ofrece «Mantener» y Esc no hace nada, pero hay salida (vaciar)', async () => {
    const user = userEvent.setup();
    const view = await setup({
      prepareStore: (store) => {
        store.branches.find((b) => b.id === 'sucursal-1')!.active = false;
      },
    });
    await changeTo(view, 'sucursal-2');
    const dialog = await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' });
    expect(within(dialog).getByText(/sucursal anterior ya no está disponible/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Mantener / })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Tu pedido es de —/)).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'Cambiaste de sucursal' })).toBeInTheDocument();
    expect(view.api().cart.lines).toHaveLength(4);
    await user.click(within(dialog).getByRole('button', { name: /^Vaciar y empezar en / }));
    await user.click(within(dialog).getByRole('button', { name: 'Sí, vaciar y empezar' }));
    expect(view.api().cart.lines).toHaveLength(0);
  });
});
