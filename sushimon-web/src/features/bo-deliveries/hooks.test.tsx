import { useQueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/features/query-keys';
import type { AdminDeliveryPage } from '@/lib/data-access/models';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import {
  useAdminDelivery,
  useAdminDeliveryList,
  useDeliveryCommand,
  useEligibleRiders,
} from './hooks';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/** F28 (spec 029 §13): claves por persona/filtros/id, invalidación tras CADA comando (incluso el fallido) y sin actualización optimista. */

beforeEach(() => {
  resetNavigationMock('/backoffice/entregas');
  window.__sushimonMockRequests = [];
});
afterEach(() => {
  delete window.__sushimonMockFaults;
  delete window.__sushimonMockRequests;
});

type Ctx = {
  qc: ReturnType<typeof useQueryClient>;
  list: ReturnType<typeof useAdminDeliveryList>;
  detail: ReturnType<typeof useAdminDelivery>;
  command: ReturnType<typeof useDeliveryCommand>;
  eligible: ReturnType<typeof useEligibleRiders>;
};
const holder: { current: Ctx | null } = { current: null };
const ctx = new Proxy({} as Ctx, { get: (_t, key) => (holder.current as Ctx)[key as keyof Ctx] });

function Probe({ branchId }: { branchId?: string }) {
  const qc = useQueryClient();
  const list = useAdminDeliveryList({ branchId, limit: 1 }, { poll: false });
  const detail = useAdminDelivery('delivery-2');
  const command = useDeliveryCommand();
  const eligible = useEligibleRiders('sucursal-1', null);
  useEffect(() => {
    holder.current = { qc, list, detail, command, eligible };
  });
  return <p>{list.data ? `items:${list.items.length}` : 'cargando'}</p>;
}
const renderProbe = (branchId?: string) =>
  renderBackoffice(<Probe branchId={branchId} />, { role: 'admin' });
const gets = (prefix = 'GET /v1/admin/deliveries') =>
  (window.__sushimonMockRequests ?? []).filter((r) => r.startsWith(prefix));

describe('claves de consulta', () => {
  it('llevan la persona, los filtros y el id; no chocan con el despacho simulado ni con motoristas', () => {
    const k = queryKeys.backoffice.adminDeliveries;
    expect(k.list('u1', { branchId: 'a' })).toEqual([
      'backoffice',
      'adminDeliveries',
      'u1',
      'list',
      { branchId: 'a' },
    ]);
    expect(k.detail('u1', 'd1')).toEqual(['backoffice', 'adminDeliveries', 'u1', 'detail', 'd1']);
    expect(k.list(null, {})[2]).toBe('anon');
    expect(k.list('u1', {})).not.toEqual(k.list('u2', {}));
    expect(k.all).not.toEqual(queryKeys.backoffice.adminRiders.all);
    expect(queryKeys.backoffice.deliveries({})[0]).toBe('orders');
  });
});

describe('lectura', () => {
  it('lista, detalle y motoristas elegibles (solo activos y disponibles de la sucursal)', async () => {
    await renderProbe();
    await screen.findByText('items:1');
    await waitFor(() => expect(ctx.detail.data?.id).toBe('delivery-2'));
    await waitFor(() => expect(ctx.eligible.riders.length).toBeGreaterThan(0));
    expect(ctx.eligible.riders.map((r) => r.id).sort()).toEqual(['rider-1', 'rider-3']);
    expect(gets('GET /v1/admin/riders').some((r) => /availability=AVAILABLE/.test(r))).toBe(true);
    expect(ctx.list.nextCursor).toEqual(expect.any(String));
  });

  it('«Cargar más» usa el cursor y suma sin repetir; reset descarta las páginas extra', async () => {
    await renderProbe();
    await screen.findByText('items:1');
    await act(async () => {
      await ctx.list.loadMore();
    });
    await waitFor(() => expect(ctx.list.items).toHaveLength(2));
    expect(new Set(ctx.list.items.map((d) => d.id)).size).toBe(2);
    expect(gets().some((r) => r.includes('cursor='))).toBe(true);
    act(() => ctx.list.reset());
    await waitFor(() => expect(ctx.list.items).toHaveLength(1));
  });
});

describe('comandos', () => {
  it('SIN actualización optimista: la caché no cambia hasta que el servidor responde; luego se invalida todo', async () => {
    await renderProbe();
    await screen.findByText('items:1');
    await waitFor(() => expect(ctx.detail.data).toBeTruthy());
    const detailKey = queryKeys.backoffice.adminDeliveries.detail(
      ctx.qc
        .getQueryCache()
        .getAll()
        .find((q) => q.queryKey[3] === 'detail')?.queryKey[2] as string,
      'delivery-2',
    );
    const before = ctx.qc.getQueryData<{ status: string }>(detailKey)?.status;
    expect(before).toBe('assigned');
    window.__sushimonMockRequests = [];
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = ctx.command.mutateAsync({
        kind: 'unassign',
        id: 'delivery-2',
        expectedVersion: 2,
      });
    });
    // Mientras la solicitud está en vuelo no se «adivina» el resultado.
    expect(ctx.qc.getQueryData<{ status: string }>(detailKey)?.status).toBe('assigned');
    await act(async () => {
      await pending;
    });
    await waitFor(() => expect(ctx.detail.data?.status).toBe('pending'));
    // Tras el comando se releyeron listas, detalle, pedidos (invalidados) y motoristas.
    await waitFor(() =>
      expect(gets('GET /v1/admin/deliveries/delivery-2').length).toBeGreaterThan(0),
    );
    expect(gets('GET /v1/admin/riders').length).toBeGreaterThan(0);
  });

  it('también tras un comando FALLIDO (409) se refresca y se aplica el current del servidor', async () => {
    await renderProbe();
    await screen.findByText('items:1');
    await waitFor(() => expect(ctx.detail.data).toBeTruthy());
    window.__sushimonMockFaults = {
      'POST /v1/admin/deliveries/delivery-2/cancel': ['version-conflict'],
    };
    window.__sushimonMockRequests = [];
    await act(async () => {
      await ctx.command
        .mutateAsync({ kind: 'cancel', id: 'delivery-2', expectedVersion: 2, reason: 'Prueba' })
        .catch(() => undefined);
    });
    await waitFor(() => expect(ctx.detail.data?.version).toBe(3));
    expect(gets('GET /v1/admin/deliveries/delivery-2').length).toBeGreaterThan(0);
  });

  it('el listado de otra sucursal tiene su propia clave (no se mezclan datos)', async () => {
    await renderProbe('sucursal-3');
    await screen.findByText('items:1');
    expect(ctx.list.items.map((d: AdminDeliveryPage['items'][number]) => d.branchId)).toEqual([
      'sucursal-3',
    ]);
  });
});
