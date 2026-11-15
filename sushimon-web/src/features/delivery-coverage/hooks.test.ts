import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDeliveryZone } from '@/lib/data-access/models';
import { queryKeys } from '../query-keys';
import { invalidateAfterSettings, invalidateAfterZone } from './hooks';

const zone = { id: 'z1', branchId: 'sucursal-1' } as AdminDeliveryZone;

function spyClient() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const keys = () => spy.mock.calls.map(([filters]) => filters?.queryKey);
  return { client, keys };
}

describe('claves TanStack de F09 (jerárquicas)', () => {
  it('catálogos, zonas, configuración y cobertura', () => {
    expect(queryKeys.locations.departments()).toEqual(['locations', 'departments']);
    expect(queryKeys.locations.municipalities('d1')).toEqual(['locations', 'municipalities', 'd1']);
    expect(queryKeys.deliveryZones.admin({ page: 2 })).toEqual([
      'deliveryZones',
      'admin',
      { page: 2 },
    ]);
    expect(queryKeys.deliveryZones.detail('z1')).toEqual(['deliveryZones', 'detail', 'z1']);
    expect(queryKeys.deliverySettings.branch('b1')).toEqual(['deliverySettings', 'branch', 'b1']);
    expect(queryKeys.deliveryCoverage.check('b1', 'm1', 'Zona 10')).toEqual([
      'deliveryCoverage',
      'b1',
      'm1',
      'Zona 10',
    ]);
    expect(queryKeys.deliveryCoverage.check('b1', 'm1', null)).toEqual([
      'deliveryCoverage',
      'b1',
      'm1',
      '',
    ]);
  });

  it('la clave de una comprobación cuelga del prefijo de su sucursal (invalidación por sucursal)', () => {
    const prefix = queryKeys.deliveryCoverage.branch('b1');
    expect(queryKeys.deliveryCoverage.check('b1', 'm', 'Zona 1').slice(0, prefix.length)).toEqual([
      ...prefix,
    ]);
    expect(
      queryKeys.deliveryCoverage.check('b2', 'm', 'Zona 1').slice(0, prefix.length),
    ).not.toEqual([...prefix]);
    // el prefijo de las listas admin cubre cualquier combinación de filtros
    const lists = queryKeys.deliveryZones.adminLists;
    expect(queryKeys.deliveryZones.admin({ q: 'x', page: 3 }).slice(0, lists.length)).toEqual([
      ...lists,
    ]);
  });
});

describe('invalidación quirúrgica', () => {
  it('guardar una zona: listas admin, ese detalle y la cobertura de ESA sucursal; nunca catálogos ni otras sucursales', async () => {
    const { client, keys } = spyClient();
    await invalidateAfterZone(client, zone);
    expect(keys()).toEqual([
      queryKeys.deliveryZones.adminLists,
      queryKeys.deliveryZones.detail('z1'),
      queryKeys.deliveryCoverage.branch('sucursal-1'),
    ]);
    for (const key of keys()) expect(key?.[0]).not.toBe('locations');
  });

  it('cambiar la configuración: la de esa sucursal y su cobertura; no las zonas ni los catálogos', async () => {
    const { client, keys } = spyClient();
    await invalidateAfterSettings(client, 'sucursal-2');
    expect(keys()).toEqual([
      queryKeys.deliverySettings.branch('sucursal-2'),
      queryKeys.deliveryCoverage.branch('sucursal-2'),
    ]);
  });
});
