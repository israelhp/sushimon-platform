import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { paths } from '@/lib/data-access/paths';
import { withShortcuts, type DataClient } from '@/lib/data-access/types';
import { renderStore } from '@/test/store-providers';
import { CheckoutProvider } from './checkout-context';
import { useCheckoutData } from './use-checkout-data';

/**
 * Como en `DATA_SOURCE=http`: la API real NO tiene `/v1/demo/branches/operations` (vista rica solo-mock). Las sucursales
 * activas del checkout, su disponibilidad (F08) y la cobertura (F09) deben salir de la lista PÚBLICA (F07).
 */
const withoutDemoOperations = (base: DataClient): DataClient =>
  withShortcuts('http', async (path, options) => {
    if (path === paths.demoBranchOperations()) throw new ApiError(404, 'NOT_FOUND', 'sin ruta');
    return base.request(path, options);
  });

function Probe() {
  const data = useCheckoutData();
  return (
    <p data-testid="probe">
      {[
        `branches=${data.branches.map((b) => b.id).join(',')}`,
        `availability=${Object.keys(data.availability).length}`,
        `branch=${data.branchId ?? 'none'}`,
        `branchesQuery=${data.branchesQuery.status}`,
      ].join(' ')}
    </p>
  );
}

describe('useCheckoutData sin la vista operativa simulada', () => {
  it('toma sucursales activas y disponibilidad de la API pública (F07/F08)', async () => {
    const view = await renderStore(
      <CheckoutProvider>
        <Probe />
      </CheckoutProvider>,
      { wrapClient: withoutDemoOperations },
    );
    await act(async () => {
      view.api().mode.setMode({ type: 'delivery', branchId: 'sucursal-1', address: null });
    });
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent(/branchesQuery=success/),
    );
    const text = screen.getByTestId('probe').textContent ?? '';
    expect(text).toMatch(/branches=\S+/);
    expect(text).toMatch(/branch=sucursal-1/);
    await waitFor(() =>
      expect(screen.getByTestId('probe').textContent).not.toMatch(/availability=0/),
    );
  });
});
