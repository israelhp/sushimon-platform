import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../query-keys';
import { invalidateBranchScopedQueries, isBranchAvailable } from './branch-selection';

describe('selección de sucursal', () => {
  const list = [{ id: 'a' }, { id: 'b' }];

  it('sin sucursal elegida o con una que sigue en la lista pública es válida', () => {
    expect(isBranchAvailable(null, list)).toBe(true);
    expect(isBranchAvailable('a', list)).toBe(true);
    expect(isBranchAvailable('z', list)).toBe(false);
    expect(isBranchAvailable('a', [])).toBe(false);
  });

  it('al cambiar de sucursal invalida catálogo y cotizaciones, no toda la app', async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await invalidateBranchScopedQueries(queryClient);
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      queryKeys.catalog.all,
      queryKeys.deliveryCoverage.all,
    ]);
  });
});
