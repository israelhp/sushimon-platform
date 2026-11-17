import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProductSheet } from '@/features/catalog/product-sheet-context';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { StoreOverlays } from './StoreShell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

function SheetProbe({ expose }: { expose: (open: (id: string) => void) => void }) {
  const { openProduct } = useProductSheet();
  expose((id) => openProduct(id, id));
  return null;
}

describe('overlays con carga perezosa (P3)', () => {
  it('el cajón NO existe hasta que se abre y se desmonta al cerrarlo', async () => {
    const view = await renderStore(<StoreOverlays />, { branchId: 'sucursal-1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => view.api().shell.openCart());
    expect(await screen.findByRole('dialog', { name: 'Tu pedido' })).toBeInTheDocument();
    await act(async () => view.api().shell.closeCart());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('la ficha solo se monta con un producto abierto', async () => {
    let open!: (id: string) => void;
    await renderStore(
      <>
        <SheetProbe expose={(fn) => (open = fn)} />
        <StoreOverlays />
      </>,
      { branchId: 'sucursal-1' },
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => open('dumplings'));
    expect(
      await screen.findByRole('dialog', { name: 'Dumplings' }, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('el guard de sucursal solo carga su diálogo cuando hay un desajuste real', async () => {
    const view = await renderStore(<StoreOverlays />, { branchId: 'sucursal-1' });
    await act(async () => view.api().cart.add(cartInput('dumplings', 1)));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Cambiaste de sucursal' }, { timeout: 4000 }),
    ).toBeInTheDocument();
  });
});
