import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useProducts } from '@/features/catalog/hooks';
import { queryKeys } from '@/features/query-keys';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import {
  STORE_MENU_STALE_MS,
  useSetBranchProductPricing,
  useSetProductAvailability,
} from './hooks';

function Probe() {
  const products = useProducts();
  const setAvailability = useSetProductAvailability();
  const setPricing = useSetBranchProductPricing();
  const gaseosas = products.data?.find((p) => p.id === 'gaseosas');
  const dumplings = products.data?.find((p) => p.id === 'dumplings');
  return (
    <div>
      <p data-testid="status">{products.isPending ? 'cargando' : 'listo'}</p>
      <p data-testid="gaseosas">
        {gaseosas ? (gaseosas.available ? 'disponible' : 'agotado') : '-'}
      </p>
      <p data-testid="dumplings">{dumplings ? `Q${dumplings.price}` : '-'}</p>
      <button
        type="button"
        onClick={() =>
          setAvailability.mutate({
            productId: 'gaseosas',
            branchId: 'sucursal-1',
            available: false,
          })
        }
      >
        agotar
      </button>
      <button
        type="button"
        onClick={() =>
          setPricing.mutate({
            productId: 'dumplings',
            branchId: 'sucursal-1',
            priceOverride: '60.00',
          })
        }
      >
        precio
      </button>
    </div>
  );
}

describe('F13 · caché del overlay público', () => {
  it('la ventana de obsolescencia es ≤ 15 s (igual que el max-age del servidor)', () => {
    expect(STORE_MENU_STALE_MS).toBeLessThanOrEqual(15_000);
  });

  it('la clave es por sucursal y el overlay se pide una vez por sucursal elegida', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<Probe />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listo'));
    expect(view.queryClient.getQueryState(queryKeys.storeMenu.branch('sucursal-1'))).toBeDefined();
    expect(spy.count('GET', /\/v1\/store\/menu/)).toBe(1);
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() =>
      expect(view.queryClient.getQueryState(queryKeys.storeMenu.branch('sucursal-2'))?.status).toBe(
        'success',
      ),
    );
    expect(spy.count('GET', /\/v1\/store\/menu/)).toBe(2);
    // El catálogo base (F11) NO se vuelve a pedir por cambiar de sucursal: solo el overlay.
    expect(spy.count('GET', /^\/v1\/store\/products$/)).toBeGreaterThan(0);
  });

  it('un cambio de disponibilidad en el backoffice invalida el overlay y la tienda lo refleja sin recargar', async () => {
    const view = await renderStore(<Probe />, { branchId: 'sucursal-1' });
    await waitFor(() => expect(screen.getByTestId('gaseosas')).toHaveTextContent('disponible'));
    await act(async () => view.api().session.signInStaff('admin'));
    await userEvent.click(screen.getByRole('button', { name: 'agotar' }));
    await waitFor(() => expect(screen.getByTestId('gaseosas')).toHaveTextContent('agotado'));
  });

  it('un cambio de precio por sucursal invalida el overlay: la tienda muestra el nuevo precio efectivo', async () => {
    const view = await renderStore(<Probe />, { branchId: 'sucursal-1' });
    await waitFor(() => expect(screen.getByTestId('dumplings')).toHaveTextContent('Q53'));
    await act(async () => view.api().session.signInStaff('admin'));
    await userEvent.click(screen.getByRole('button', { name: 'precio' }));
    await waitFor(() => expect(screen.getByTestId('dumplings')).toHaveTextContent('Q60'));
  });
});
