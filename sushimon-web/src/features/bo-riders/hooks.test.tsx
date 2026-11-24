import { useQueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/features/query-keys';
import type { AdminRiderPage } from '@/lib/data-access/models';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { useAdminRider, useAdminRiders, useCreateRider, useSetRiderAvailability } from './hooks';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/** F27 (spec 028 §12): claves por persona/filtros/id, invalidación tras mutar y reversión de la actualización optimista. */

beforeEach(() => {
  resetNavigationMock('/backoffice/motoristas');
  window.__sushimonMockRequests = [];
});
afterEach(() => {
  delete window.__sushimonMockFaults;
  delete window.__sushimonMockRequests;
});

type Ctx = {
  qc: ReturnType<typeof useQueryClient>;
  list: ReturnType<typeof useAdminRiders>;
  detail: ReturnType<typeof useAdminRider>;
  create: ReturnType<typeof useCreateRider>;
  availability: ReturnType<typeof useSetRiderAvailability>;
};
const holder: { current: Ctx | null } = { current: null };
const ctx = new Proxy({} as Ctx, {
  get: (_t, key) => (holder.current as Ctx)[key as keyof Ctx],
});

function Probe({ branchId }: { branchId?: string }) {
  const qc = useQueryClient();
  const list = useAdminRiders({ branchId, pageSize: 20 });
  const detail = useAdminRider('rider-1');
  const create = useCreateRider();
  const availability = useSetRiderAvailability();
  useEffect(() => {
    holder.current = { qc, list, detail, create, availability };
  });
  return <p>{list.data ? `total:${list.data.total}` : 'cargando'}</p>;
}

const renderProbe = (branchId?: string) =>
  renderBackoffice(<Probe branchId={branchId} />, { role: 'admin' });
const gets = () =>
  (window.__sushimonMockRequests ?? []).filter((r) => r.startsWith('GET /v1/admin/riders'));

describe('claves de consulta', () => {
  it('llevan la persona, los filtros y el id; no chocan con el despacho simulado', () => {
    const k = queryKeys.backoffice.adminRiders;
    expect(k.list('u1', { branchId: 'a' })).toEqual([
      'backoffice',
      'adminRiders',
      'u1',
      'list',
      { branchId: 'a' },
    ]);
    expect(k.list('u1', { branchId: 'a' })).not.toEqual(k.list('u1', { branchId: 'b' }));
    expect(k.list('u1', {})).not.toEqual(k.list('u2', {}));
    expect(k.detail('u1', 'r1')).toEqual(['backoffice', 'adminRiders', 'u1', 'detail', 'r1']);
    expect(k.list(null, {})[2]).toBe('anon');
    // `['backoffice','riders']` (despacho simulado) no es prefijo de las nuevas ni al revés.
    expect(k.all).not.toEqual(queryKeys.backoffice.riders());
    expect(k.list('u1', {}).slice(0, 2)).not.toEqual(['backoffice', 'riders']);
  });
});

describe('hooks de motoristas', () => {
  it('lista y detalle se piden con la sesión y quedan en caché bajo su clave', async () => {
    await renderProbe('sucursal-1');
    expect(await screen.findByText('total:3')).toBeVisible();
    await waitFor(() => expect(ctx.detail.data?.phone).toBe('+50255501001'));
    const staffKey = ctx.qc
      .getQueryCache()
      .findAll({ queryKey: queryKeys.backoffice.adminRiders.all })
      .map((q) => q.queryKey[2]);
    expect(new Set(staffKey).size).toBe(1);
    expect(staffKey[0]).not.toBe('anon');
    expect(gets().some((r) => r.includes('branchId=sucursal-1'))).toBe(true);
  });

  it('crear invalida las listas (refetch) y siembra el detalle del creado', async () => {
    await renderProbe();
    expect(await screen.findByText('total:7')).toBeVisible();
    const before = gets().length;
    await act(async () => {
      await ctx.create.mutateAsync({
        branchId: 'sucursal-1',
        fullName: 'Hook Nuevo',
        phone: '+50255507171',
      });
    });
    expect(await screen.findByText('total:8')).toBeVisible();
    expect(gets().length).toBeGreaterThan(before);
  });

  it('la disponibilidad es optimista y se REVIERTE si el servidor rechaza', async () => {
    await renderProbe();
    await screen.findByText('total:7');
    window.__sushimonMockFaults = {
      'PATCH /v1/admin/riders/rider-1/availability': ['has-active-delivery'],
    };
    // Se registra cada valor que toma la fila en la caché de listas: optimista primero, y de vuelta al real tras el error.
    const seen: string[] = [];
    const unsubscribe = ctx.qc.getQueryCache().subscribe(() => {
      for (const [, page] of ctx.qc.getQueriesData<AdminRiderPage>({
        queryKey: queryKeys.backoffice.adminRiders.all,
      })) {
        const value = page?.items?.find((r) => r.id === 'rider-1')?.availability;
        if (value && seen.at(-1) !== value) seen.push(value);
      }
    });
    await act(async () => {
      await ctx.availability
        .mutateAsync({ id: 'rider-1', availability: 'UNAVAILABLE' })
        .catch(() => undefined);
    });
    unsubscribe();
    await waitFor(() => expect(ctx.availability.isError).toBe(true));
    expect(seen).toContain('UNAVAILABLE'); // actualización optimista
    expect(seen.at(-1)).toBe('AVAILABLE'); // revertida (el servidor rechazó con 409)
    await waitFor(() =>
      expect(ctx.list.data?.items.find((r) => r.id === 'rider-1')?.availability).toBe('AVAILABLE'),
    );
  });
});
