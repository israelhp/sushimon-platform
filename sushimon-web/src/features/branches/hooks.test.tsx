import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/lib/data-access/provider';
import { createHarness } from '@/mocks/testing';
import { queryKeys } from '../query-keys';
import {
  branchInvalidationKeys,
  useCreateBranch,
  useSetBranchStatus,
  useUpdateBranch,
} from './hooks';

describe('claves de invalidación de sucursales', () => {
  it('crear: listas admin, lista pública y operación; sin detalle', () => {
    expect(branchInvalidationKeys('create')).toEqual([
      queryKeys.backoffice.adminBranchLists,
      queryKeys.store.publicBranches,
      queryKeys.store.branchOperations,
    ]);
  });

  it('actualizar: añade el detalle admin de esa sucursal', () => {
    expect(branchInvalidationKeys('update', 'b1')).toEqual([
      queryKeys.backoffice.adminBranchLists,
      queryKeys.store.publicBranches,
      queryKeys.store.branchOperations,
      queryKeys.backoffice.adminBranch('b1'),
    ]);
  });

  it('estado: además invalida las cotizaciones de envío; nunca toda la app', () => {
    const keys = branchInvalidationKeys('status', 'b1');
    expect(keys).toContainEqual(queryKeys.store.deliveryQuotes);
    expect(keys).not.toContainEqual([]);
    for (const kind of ['create', 'update', 'status'] as const) {
      for (const key of branchInvalidationKeys(kind, 'b1')) {
        expect(key.length, JSON.stringify(key)).toBeGreaterThanOrEqual(2);
        expect(['store', 'backoffice']).toContain(key[0]);
      }
    }
  });

  it('las claves son jerárquicas: el detalle público y las listas comparten prefijo', () => {
    expect(queryKeys.store.publicBranch('x').slice(0, 3)).toEqual([
      ...queryKeys.store.publicBranches,
    ]);
    expect(queryKeys.backoffice.adminBranches({ q: 'a' }).slice(0, 3)).toEqual([
      ...queryKeys.backoffice.adminBranchLists,
    ]);
    expect(queryKeys.backoffice.adminBranch('x').slice(0, 2)).toEqual([
      ...queryKeys.backoffice.branches,
    ]);
  });
});

function setup() {
  const h = createHarness();
  h.asStaff('admin');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataProvider client={h.client} queryClient={queryClient}>
      {children}
    </DataProvider>
  );
  return { h, spy, wrapper };
}

const invalidated = (spy: ReturnType<typeof setup>['spy']) =>
  spy.mock.calls.map(([filters]) => filters?.queryKey);

describe('mutaciones de sucursales', () => {
  it('crear invalida listas admin y pública (y nada más)', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useCreateBranch(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({
        code: 'nueva',
        name: 'Nueva',
        address: 'Calle 1',
        active: true,
      }),
    );
    expect(invalidated(spy)).toEqual(branchInvalidationKeys('create'));
  });

  it('actualizar invalida detalle y listas', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useUpdateBranch(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({ id: 'sucursal-1', input: { name: 'Otro nombre' } }),
    );
    expect(invalidated(spy)).toEqual(branchInvalidationKeys('update', 'sucursal-1'));
  });

  it('cambiar estado invalida públicas, admin y cotizaciones', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useSetBranchStatus(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({ id: 'sucursal-2', input: { active: false, reason: 'Prueba' } }),
    );
    expect(invalidated(spy)).toEqual(branchInvalidationKeys('status', 'sucursal-2'));
  });

  it('un error (409) no invalida nada', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useCreateBranch(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ code: 'sucursal-1', name: 'Dup', address: 'x', active: true })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });
});
