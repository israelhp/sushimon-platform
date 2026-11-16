import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { CartDrawer } from './CartDrawer';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

async function openCart(
  lines: { id: string; qty: number; note?: string }[],
  scenario?: 'error',
  branchId?: string,
) {
  const view = await renderStore(<CartDrawer />, { scenario, branchId });
  await act(async () => {
    for (const l of lines) view.api().cart.add(l.id, l.qty, l.note);
    view.api().shell.openCart();
  });
  return view;
}

describe('CartDrawer', () => {
  it('muestra el estado vacío con enlace al menú', async () => {
    const view = await openCart([]);
    const dialog = await screen.findByRole('dialog', { name: 'Tu pedido' });
    expect(within(dialog).getByText('Tu pedido está vacío')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Ir al menú' })).toHaveAttribute(
      'href',
      '/menu',
    );
    expect(within(dialog).queryByText('Total de tu pedido')).not.toBeInTheDocument();
    view.unmount();
  });

  it('F13: usa el precio EFECTIVO de la sucursal elegida (no el de otra) para líneas y total', async () => {
    await openCart([{ id: 'dynamita-roll', qty: 2 }], undefined, 'sucursal-2');
    const dialog = await screen.findByRole('dialog', { name: 'Tu pedido' });
    expect(await within(dialog).findByText('Q86 × 2 = Q172')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Q82/)).not.toBeInTheDocument();
  });

  it('lista las líneas con precio × cantidad, nota y subtotal', async () => {
    await openCart([
      { id: 'california-roll', qty: 2 },
      { id: 'dumplings', qty: 1, note: 'Sin ajonjolí' },
    ]);
    const dialog = await screen.findByRole('dialog', { name: 'Tu pedido' });
    expect(await within(dialog).findByText('Q57 × 2 = Q114')).toBeInTheDocument();
    expect(within(dialog).getByText('Q53 × 1 = Q53')).toBeInTheDocument();
    expect(within(dialog).getByText('Nota: Sin ajonjolí')).toBeInTheDocument();
    // 2×57 + 53 = 167
    expect(within(dialog).getByText('Q167')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Continuar/ })).toHaveAttribute(
      'href',
      '/checkout',
    );
    expect(within(dialog).getByText('3 productos')).toBeInTheDocument();
  });

  it('incrementa, disminuye, elimina y vacía el pedido', async () => {
    const user = userEvent.setup();
    const view = await openCart([
      { id: 'california-roll', qty: 1 },
      { id: 'dumplings', qty: 1 },
    ]);
    const dialog = await screen.findByRole('dialog', { name: 'Tu pedido' });
    await within(dialog).findByText('Q57 × 1 = Q57');

    await user.click(
      within(dialog).getByRole('button', { name: 'Agregar uno de California Roll' }),
    );
    expect(await within(dialog).findByText('Q57 × 2 = Q114')).toBeInTheDocument();
    expect(within(dialog).getByText('Q167')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Quitar uno de California Roll' }));
    expect(await within(dialog).findByText('Q57 × 1 = Q57')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Eliminar Dumplings' }));
    expect(within(dialog).queryByText('Dumplings')).not.toBeInTheDocument();
    expect(view.api().cart.lines).toHaveLength(1);
    expect(within(dialog).getByText('Q57', { selector: 'strong' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Vaciar pedido' }));
    expect(view.api().cart.lines).toHaveLength(0);
    expect(await within(dialog).findByText('Tu pedido está vacío')).toBeInTheDocument();
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
    const dialog = await screen.findByRole('dialog', { name: 'Tu pedido' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(view.api().shell.cartOpen).toBe(false);
    expect(trigger).toHaveFocus();
  });

  it('muestra el error del catálogo con reintento', async () => {
    await openCart([{ id: 'california-roll', qty: 1 }], 'error');
    const dialog = await screen.findByRole('dialog', { name: 'Tu pedido' });
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
