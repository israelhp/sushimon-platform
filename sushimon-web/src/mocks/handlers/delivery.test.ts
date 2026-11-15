import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { DeliveryCoverageCheckResponse } from '@/lib/data-access/models';
import * as coverage from '@/services/delivery-coverage';
import * as zones from '@/services/delivery-zones';
import * as locations from '@/services/locations';
import { createHarness } from '../testing';

async function fail(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};
const GUATEMALA = 'mun-guatemala-guatemala';
const MIXCO = 'mun-guatemala-mixco';
const PALENCIA = 'mun-guatemala-palencia';
const check = (
  h: ReturnType<typeof createHarness>,
  branchId: string,
  municipalityId: string,
  zone?: string | null,
) => coverage.checkDeliveryCoverage(h.client, { branchId, municipalityId, zone });

describe('F09 catálogos geográficos (coherentes con el seed real)', () => {
  it('22 departamentos ordenados por la API sin distinguir acentos', async () => {
    const { client } = createHarness();
    const deps = await locations.listDepartments(client);
    expect(deps).toHaveLength(22);
    const names = deps.map((d) => d.name);
    expect(names.slice(0, 3)).toEqual(['Alta Verapaz', 'Baja Verapaz', 'Chimaltenango']);
    // «Petén» ordena como «Peten» (entre Jutiapa y Quetzaltenango) y «Quiché» antes de «Retalhuleu»
    expect(names.indexOf('Petén')).toBeGreaterThan(names.indexOf('Jutiapa'));
    expect(names.indexOf('Petén')).toBeLessThan(names.indexOf('Quetzaltenango'));
  });

  it('17 municipios del departamento de Guatemala; el resto devuelve [] (pendiente de fuente oficial)', async () => {
    const { client } = createHarness();
    const muni = await locations.listMunicipalities(client, 'dep-guatemala');
    expect(muni).toHaveLength(17);
    expect(muni.map((m) => m.name)).toContain('San Pedro Sacatepéquez');
    expect(muni.every((m) => m.departmentId === 'dep-guatemala')).toBe(true);
    expect(await locations.listMunicipalities(client, 'dep-escuintla')).toEqual([]);
  });

  it('departmentId ausente => 400; inexistente => 404 DEPARTMENT_NOT_FOUND', async () => {
    const { client } = createHarness();
    expect((await fail(locations.listMunicipalities(client, ''))).status).toBe(400);
    const e = await fail(locations.listMunicipalities(client, 'dep-x'));
    expect([e.status, e.businessCode]).toEqual([404, 'DEPARTMENT_NOT_FOUND']);
  });

  it('el catálogo no cambia con las mutaciones (nunca se invalida)', async () => {
    const h = admin();
    const before = await locations.listMunicipalities(h.client, 'dep-guatemala');
    await zones.createAdminDeliveryZone(h.client, {
      branchId: 'sucursal-2',
      municipalityId: MIXCO,
      baseFee: '10',
      active: true,
    });
    expect(await locations.listMunicipalities(h.client, 'dep-guatemala')).toEqual(before);
  });
});

describe('F09 zonas: listado, filtros y paginación', () => {
  it('lista con paginación del servidor (20 por página) y total del alcance', async () => {
    const h = admin();
    const p1 = await zones.listAdminDeliveryZones(h.client, {});
    expect(p1).toMatchObject({ page: 1, pageSize: 20, total: 65 });
    expect(p1.items).toHaveLength(20);
    const p4 = await zones.listAdminDeliveryZones(h.client, { page: 4 });
    expect(p4.items).toHaveLength(5);
  });

  it('filtra por sucursal, municipio, estado y texto (sin acentos ni mayúsculas)', async () => {
    const h = admin();
    const s3 = await zones.listAdminDeliveryZones(h.client, {
      branchId: 'sucursal-3',
      pageSize: 100,
    });
    expect(s3.total).toBe(20);
    expect(s3.items.every((z) => z.branchId === 'sucursal-3')).toBe(true);
    const mixco = await zones.listAdminDeliveryZones(h.client, { municipalityId: MIXCO });
    expect(mixco.items.map((z) => z.branchId).sort()).toEqual(['sucursal-1', 'sucursal-3']);
    expect(mixco.items.every((z) => z.zoneLabel === null)).toBe(true);
    const q = await zones.listAdminDeliveryZones(h.client, {
      branchId: 'sucursal-1',
      q: 'ZONA 1',
      pageSize: 100,
    });
    expect(q.items.every((z) => z.zoneLabel?.toLowerCase().includes('zona 1'))).toBe(true);
    expect(q.items.some((z) => z.zoneLabel === 'Zona 10')).toBe(true);
    expect((await zones.listAdminDeliveryZones(h.client, { active: false })).total).toBe(0);
  });

  it('ordena por municipio con la cobertura general primero, por tarifa y por alta', async () => {
    const h = admin();
    const byMuni = await zones.listAdminDeliveryZones(h.client, {
      branchId: 'sucursal-1',
      pageSize: 100,
    });
    // Guatemala (zonas) antes de Mixco/Santa Catarina Pinula/Villa Nueva (sin acentos, alfabético)
    expect(byMuni.items[0]!.municipalityName).toBe('Guatemala');
    const fees = (
      await zones.listAdminDeliveryZones(h.client, {
        branchId: 'sucursal-1',
        sort: 'baseFee',
        order: 'desc',
        pageSize: 100,
      })
    ).items.map((z) => z.baseFee);
    expect(fees[0]).toBe('30.00');
    expect(fees.at(-1)).toBe('15.00');
  });

  it('parámetros inválidos => 400; sucursal ajena o inexistente => 404', async () => {
    const h = admin();
    for (const bad of [{ page: 0 }, { pageSize: 101 }] as const) {
      expect((await fail(zones.listAdminDeliveryZones(h.client, bad))).status).toBe(400);
    }
    expect((await fail(zones.listAdminDeliveryZones(h.client, { branchId: 'nope' }))).status).toBe(
      404,
    );
  });

  it('manager: sin filtro solo ve las zonas de su sucursal; con la de otra => 404', async () => {
    const h = createHarness();
    h.asStaff('manager', 'u2'); // manager de sucursal-1
    const list = await zones.listAdminDeliveryZones(h.client, { pageSize: 100 });
    expect(list.items.every((z) => z.branchId === 'sucursal-1')).toBe(true);
    expect(
      (await fail(zones.listAdminDeliveryZones(h.client, { branchId: 'sucursal-2' }))).status,
    ).toBe(404);
  });
});

describe('F09 zonas: alta, normalización y unicidad', () => {
  it('normaliza etiqueta y tarifa (string decimal) y devuelve versión 1', async () => {
    const h = admin();
    const z = await zones.createAdminDeliveryZone(h.client, {
      branchId: 'sucursal-2',
      municipalityId: MIXCO,
      zoneLabel: '  Colonia   El Álamo ',
      baseFee: '12.5',
      active: true,
    });
    expect(z).toMatchObject({
      zoneLabel: 'Colonia El Álamo',
      baseFee: '12.50',
      version: 1,
      active: true,
      currency: 'GTQ',
      municipalityName: 'Mixco',
      departmentName: 'Guatemala',
    });
    expect(typeof z.baseFee).toBe('string');
  });

  it('409 duplicado por etiqueta normalizada (sin acentos ni mayúsculas), incluso INACTIVA', async () => {
    const h = admin();
    const base = { branchId: 'sucursal-2', municipalityId: MIXCO, baseFee: '10', active: true };
    const first = await zones.createAdminDeliveryZone(h.client, { ...base, zoneLabel: 'Álamo' });
    const dup = await fail(
      zones.createAdminDeliveryZone(h.client, { ...base, zoneLabel: ' alamo ' }),
    );
    expect([dup.status, dup.businessCode]).toEqual([409, 'DELIVERY_ZONE_DUPLICATE']);
    expect(dup.violations?.[0]).toMatchObject({
      path: `deliveryZones/${first.id}`,
      code: 'DUPLICATE_ZONE',
    });
    await zones.updateAdminDeliveryZoneStatus(h.client, first.id, { active: false });
    expect(
      (await fail(zones.createAdminDeliveryZone(h.client, { ...base, zoneLabel: 'ALAMO' }))).status,
    ).toBe(409);
  });

  it('solo UNA cobertura general por (sucursal, municipio); «Zona 4», «4» y «04» son distintas', async () => {
    const h = admin();
    const base = { branchId: 'sucursal-2', municipalityId: PALENCIA, baseFee: '10', active: true };
    await zones.createAdminDeliveryZone(h.client, base);
    expect(
      (await fail(zones.createAdminDeliveryZone(h.client, { ...base, zoneLabel: '   ' }))).status,
    ).toBe(409);
    for (const label of ['Zona 4', '4', '04']) {
      await zones.createAdminDeliveryZone(h.client, { ...base, zoneLabel: label });
    }
  });

  it('400: número JSON, 3 decimales, propiedades desconocidas, etiqueta larga; 422 municipio; 404 sucursal', async () => {
    const h = admin();
    const ok = { branchId: 'sucursal-2', municipalityId: MIXCO, baseFee: '10', active: true };
    const create = (patch: object) =>
      fail(zones.createAdminDeliveryZone(h.client, { ...ok, ...patch } as never));
    expect((await create({ baseFee: 15 })).status).toBe(400);
    expect((await create({ baseFee: '15.001' })).status).toBe(400);
    expect((await create({ fee: '15' })).status).toBe(400);
    expect((await create({ zoneLabel: 'x'.repeat(61) })).status).toBe(400);
    const m = await create({ municipalityId: 'nope' });
    expect([m.status, m.businessCode, m.violations?.[0]?.path]).toEqual([
      422,
      'MUNICIPALITY_NOT_FOUND',
      'municipalityId',
    ]);
    expect((await create({ branchId: 'nope' })).status).toBe(404);
  });

  it('una sucursal INACTIVA admite zonas (se prepara antes de activar)', async () => {
    const h = admin();
    const z = await zones.createAdminDeliveryZone(h.client, {
      branchId: 'sucursal-4',
      municipalityId: MIXCO,
      baseFee: '0',
      active: true,
    });
    expect(z.baseFee).toBe('0.00'); // envío gratis es válido
  });
});

describe('F09 zonas: edición, versión y estado', () => {
  it('actualiza con expectedVersion y sube la versión; el conflicto es 409 DELIVERY_ZONE_VERSION_CONFLICT', async () => {
    const h = admin();
    const [first] = (await zones.listAdminDeliveryZones(h.client, { branchId: 'sucursal-1' }))
      .items;
    const z = await zones.updateAdminDeliveryZone(h.client, first!.id, {
      expectedVersion: 1,
      baseFee: '17',
    });
    expect(z).toMatchObject({ baseFee: '17.00', version: 2 });
    const e = await fail(
      zones.updateAdminDeliveryZone(h.client, first!.id, { expectedVersion: 1, baseFee: '18' }),
    );
    expect([e.status, e.businessCode]).toEqual([409, 'DELIVERY_ZONE_VERSION_CONFLICT']);
    expect((await zones.getAdminDeliveryZone(h.client, first!.id)).baseFee).toBe('17.00');
  });

  it('sin cambios reales => 200 sin subir la versión; sin campos o sin expectedVersion => 400', async () => {
    const h = admin();
    const [first] = (await zones.listAdminDeliveryZones(h.client, {})).items;
    const same = await zones.updateAdminDeliveryZone(h.client, first!.id, {
      expectedVersion: 1,
      baseFee: first!.baseFee,
    });
    expect(same.version).toBe(1);
    expect(
      (await fail(zones.updateAdminDeliveryZone(h.client, first!.id, { expectedVersion: 1 })))
        .status,
    ).toBe(400);
    expect(
      (await fail(zones.updateAdminDeliveryZone(h.client, first!.id, { baseFee: '1' } as never)))
        .status,
    ).toBe(400);
  });

  it('renombrar a una etiqueta existente => 409 duplicado; la sucursal y el municipio son inmutables (400)', async () => {
    const h = admin();
    const list = (
      await zones.listAdminDeliveryZones(h.client, {
        branchId: 'sucursal-1',
        municipalityId: GUATEMALA,
        pageSize: 100,
      })
    ).items;
    const a = list.find((z) => z.zoneLabel === 'Zona 1')!;
    const e = await fail(
      zones.updateAdminDeliveryZone(h.client, a.id, { expectedVersion: 1, zoneLabel: 'zona 10' }),
    );
    expect(e.businessCode).toBe('DELIVERY_ZONE_DUPLICATE');
    const immutable = await fail(
      zones.updateAdminDeliveryZone(h.client, a.id, { expectedVersion: 1, branchId: 'x' } as never),
    );
    expect(immutable.status).toBe(400);
  });

  it('el estado es idempotente (no sube la versión si no cambia) y un cambio real la sube; sin borrado', async () => {
    const h = admin();
    const [first] = (await zones.listAdminDeliveryZones(h.client, {})).items;
    const same = await zones.updateAdminDeliveryZoneStatus(h.client, first!.id, { active: true });
    expect(same.version).toBe(1);
    const off = await zones.updateAdminDeliveryZoneStatus(h.client, first!.id, {
      active: false,
      reason: 'Obra',
    });
    expect(off).toMatchObject({ active: false, version: 2 });
    expect(
      (await fail(zones.updateAdminDeliveryZoneStatus(h.client, first!.id, {} as never))).status,
    ).toBe(400);
  });
});

describe('F09 RBAC simulado: solo admin gestiona zonas y configuración', () => {
  it('manager y personal sin permiso => 403 al escribir; manager lee dentro de su alcance', async () => {
    const h = createHarness();
    h.asStaff('manager', 'u2');
    const [mine] = (await zones.listAdminDeliveryZones(h.client, {})).items;
    expect(
      (await fail(zones.updateAdminDeliveryZoneStatus(h.client, mine!.id, { active: false })))
        .status,
    ).toBe(403);
    expect(
      (
        await fail(
          zones.createAdminDeliveryZone(h.client, {
            branchId: 'sucursal-1',
            municipalityId: MIXCO,
            baseFee: '1',
            active: true,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fail(
          zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-1', {
            pedidosyaEnabled: false,
          }),
        )
      ).status,
    ).toBe(403);
    expect((await zones.getAdminBranchDeliverySettings(h.client, 'sucursal-1')).branchId).toBe(
      'sucursal-1',
    );
  });

  it('sin sesión => 401; sin alcance => 404 en detalle y configuración', async () => {
    const h = createHarness();
    expect((await fail(zones.listAdminDeliveryZones(h.client, {}))).status).toBe(401);
    h.asStaff('manager', 'u2');
    // zona-0030 pertenece a sucursal-2 (fuera del alcance de u2)
    expect((await fail(zones.getAdminDeliveryZone(h.client, 'zona-0030'))).status).toBe(404);
    expect((await fail(zones.getAdminBranchDeliverySettings(h.client, 'sucursal-2'))).status).toBe(
      404,
    );
  });
});

describe('F09 configuración por sucursal', () => {
  it('sin fila => valores por defecto con isDefault=true y updatedAt=null; PedidosYa BLOCKED_EXTERNAL', async () => {
    const h = admin();
    expect(await zones.getAdminBranchDeliverySettings(h.client, 'sucursal-4')).toEqual({
      branchId: 'sucursal-4',
      ownDeliveryZonesEnabled: false,
      pedidosyaEnabled: true,
      pedidosyaIntegrationStatus: 'BLOCKED_EXTERNAL',
      isDefault: true,
      updatedAt: null,
    });
  });

  it('el primer PATCH crea la fila (lazy upsert); sin cambios reales no escribe; PATCH vacío => 400', async () => {
    const h = admin();
    const noChange = await zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-4', {
      pedidosyaEnabled: true,
    });
    expect(noChange.isDefault).toBe(true);
    const saved = await zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-4', {
      ownDeliveryZonesEnabled: true,
    });
    expect(saved).toMatchObject({
      ownDeliveryZonesEnabled: true,
      pedidosyaEnabled: true,
      isDefault: false,
    });
    expect(saved.updatedAt).toBe('2026-11-11T20:25:00.000Z');
    expect(
      (await fail(zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-4', {}))).status,
    ).toBe(400);
    expect(
      (
        await fail(
          zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-4', { x: true } as never),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fail(
          zones.updateAdminBranchDeliverySettings(h.client, 'nope', { pedidosyaEnabled: false }),
        )
      ).status,
    ).toBe(404);
  });
});

describe('F09 cobertura: prioridad D8 y flag apagado', () => {
  it('zona específica > cobertura general; la tarifa sale de la zona (string)', async () => {
    const h = admin();
    await zones.createAdminDeliveryZone(h.client, {
      branchId: 'sucursal-1',
      municipalityId: MIXCO,
      zoneLabel: 'Zona 3',
      baseFee: '9',
      active: true,
    });
    const specific = await check(h, 'sucursal-1', MIXCO, 'zona 3');
    expect(specific.providers.OWN).toMatchObject({
      coverageStatus: 'AVAILABLE',
      matchedBy: 'ZONE',
      baseFee: '9.00',
    });
    const general = await check(h, 'sucursal-1', MIXCO, 'Zona 99');
    expect(general.providers.OWN).toMatchObject({ matchedBy: 'MUNICIPALITY', baseFee: '25.00' });
    expect((await check(h, 'sucursal-1', MIXCO)).providers.OWN.matchedBy).toBe('MUNICIPALITY');
  });

  it('una zona inactiva se ignora como si no existiera (no excluye); sin ninguna => NO_ZONE_COVERAGE', async () => {
    const h = admin();
    const [z10] = (
      await zones.listAdminDeliveryZones(h.client, { branchId: 'sucursal-1', q: 'zona 10' })
    ).items;
    await zones.updateAdminDeliveryZoneStatus(h.client, z10!.id, { active: false });
    const r = await check(h, 'sucursal-1', GUATEMALA, 'Zona 10');
    expect(r.providers.OWN).toMatchObject({
      coverageStatus: 'UNAVAILABLE',
      reason: 'NO_ZONE_COVERAGE',
      deliveryZoneId: null,
      baseFee: null,
    });
  });

  it('flag apagado => UNAVAILABLE + PROVIDER_DISABLED sin mirar zonas', async () => {
    const h = admin();
    await zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-1', {
      ownDeliveryZonesEnabled: false,
    });
    const r = await check(h, 'sucursal-1', GUATEMALA, 'Zona 10');
    expect(r.providers.OWN).toMatchObject({
      enabled: false,
      coverageStatus: 'UNAVAILABLE',
      reason: 'PROVIDER_DISABLED',
    });
  });

  it('errores: sucursal inactiva o inexistente 422 BRANCH_NOT_AVAILABLE; municipio 422; cuerpo con fee/total 400', async () => {
    const h = createHarness();
    for (const id of ['sucursal-4', 'nope']) {
      const e = await fail(check(h, id, GUATEMALA));
      expect([e.status, e.businessCode, e.violations?.[0]?.path]).toEqual([
        422,
        'BRANCH_NOT_AVAILABLE',
        'branchId',
      ]);
    }
    expect((await fail(check(h, 'sucursal-1', 'nope'))).businessCode).toBe(
      'MUNICIPALITY_NOT_FOUND',
    );
    const bad = await fail(
      coverage.checkDeliveryCoverage(h.client, {
        branchId: 'sucursal-1',
        municipalityId: GUATEMALA,
        fee: '0',
        total: 1,
      } as never),
    );
    expect(bad.status).toBe(400);
  });

  it('devuelve la zona normalizada y el reloj del servidor', async () => {
    const h = createHarness();
    const r = await check(h, 'sucursal-1', GUATEMALA, '  ZONA   10 ');
    expect(r.zone).toBe('ZONA 10');
    expect(r.checkedAt).toBe('2026-11-11T20:25:00.000Z');
    expect((await check(h, 'sucursal-1', GUATEMALA, '  ')).zone).toBeNull();
  });
});

/**
 * Escenarios A–G (spec 008): PedidosYa habilitado salvo que se indique. Con la integración bloqueada solo existen E, F y
 * G (y PedidosYa deshabilitado); A–D requieren el adaptador simulado (`MOCK`, `simulated=true`).
 */
describe('F09 elegibilidad: escenarios A–G', () => {
  type Eligibility = DeliveryCoverageCheckResponse['eligibility'];
  async function scenario(opts: {
    py: 'unknown' | 'available' | 'unavailable';
    own: 'off' | 'available' | 'unavailable';
    pyEnabled?: boolean;
  }) {
    const h = admin();
    await zones.updateAdminBranchDeliverySettings(h.client, 'sucursal-1', {
      ownDeliveryZonesEnabled: opts.own !== 'off',
      pedidosyaEnabled: opts.pyEnabled ?? true,
    });
    await zones.setPedidosyaCoverageScenario(h.client, opts.py);
    // Zona 10 está cubierta; Mixco-zona inexistente cae a la general; «Palencia» no tiene cobertura
    const r = await check(
      h,
      'sucursal-1',
      opts.own === 'unavailable' ? PALENCIA : GUATEMALA,
      opts.own === 'unavailable' ? null : 'Zona 10',
    );
    return r;
  }
  const el = (r: DeliveryCoverageCheckResponse): Eligibility => r.eligibility;

  it('A: PedidosYa disponible (simulado), propia apagada => CONFIRMED [PEDIDOSYA]', async () => {
    const r = await scenario({ py: 'available', own: 'off' });
    expect(el(r)).toEqual({
      status: 'CONFIRMED',
      confirmedProviders: ['PEDIDOSYA'],
      pendingProviders: [],
      simulated: true,
    });
    expect(r.providers.PEDIDOSYA.integrationStatus).toBe('MOCK');
  });
  it('B: ambos => CONFIRMED [PEDIDOSYA, OWN]', async () => {
    expect(el(await scenario({ py: 'available', own: 'available' }))).toMatchObject({
      status: 'CONFIRMED',
      confirmedProviders: ['PEDIDOSYA', 'OWN'],
      pendingProviders: [],
    });
  });
  it('C: PedidosYa no disponible + propia => CONFIRMED [OWN]', async () => {
    expect(el(await scenario({ py: 'unavailable', own: 'available' }))).toMatchObject({
      status: 'CONFIRMED',
      confirmedProviders: ['OWN'],
      pendingProviders: [],
    });
  });
  it('D: PedidosYa no disponible y propia apagada => NONE', async () => {
    expect(el(await scenario({ py: 'unavailable', own: 'off' }))).toMatchObject({
      status: 'NONE',
      confirmedProviders: [],
      pendingProviders: [],
    });
  });
  it('E: PedidosYa UNKNOWN y propia apagada => PENDING (hoy, sucursal con defaults)', async () => {
    const r = await scenario({ py: 'unknown', own: 'off' });
    expect(el(r)).toEqual({
      status: 'PENDING',
      confirmedProviders: [],
      pendingProviders: ['PEDIDOSYA'],
      simulated: false,
    });
    expect(r.providers.PEDIDOSYA).toMatchObject({
      coverageStatus: 'UNKNOWN',
      integrationStatus: 'BLOCKED_EXTERNAL',
      quoteStatus: 'NOT_AVAILABLE',
      reason: 'INTEGRATION_NOT_CONFIGURED',
    });
  });
  it('F: PedidosYa UNKNOWN + propia confirmada => CONFIRMED [OWN] con PedidosYa pendiente', async () => {
    expect(el(await scenario({ py: 'unknown', own: 'available' }))).toEqual({
      status: 'CONFIRMED',
      confirmedProviders: ['OWN'],
      pendingProviders: ['PEDIDOSYA'],
      simulated: false,
    });
  });
  it('G: PedidosYa UNKNOWN + propia sin zona => PENDING', async () => {
    expect(el(await scenario({ py: 'unknown', own: 'unavailable' }))).toMatchObject({
      status: 'PENDING',
      confirmedProviders: [],
      pendingProviders: ['PEDIDOSYA'],
    });
  });
  it('PedidosYa deshabilitado no entra en confirmados ni pendientes y no se consulta', async () => {
    const r = await scenario({ py: 'available', own: 'off', pyEnabled: false });
    expect(el(r)).toEqual({
      status: 'NONE',
      confirmedProviders: [],
      pendingProviders: [],
      simulated: false,
    });
    expect(r.providers.PEDIDOSYA).toMatchObject({
      enabled: false,
      coverageStatus: 'UNKNOWN',
      reason: 'PROVIDER_DISABLED',
    });
  });

  it('por defecto (sin tocar el selector) PedidosYa es SIEMPRE UNKNOWN + BLOCKED_EXTERNAL: nunca disponibilidad real', async () => {
    const h = createHarness();
    for (const branch of ['sucursal-1', 'sucursal-2', 'sucursal-3']) {
      for (const muni of [GUATEMALA, MIXCO, PALENCIA]) {
        const py = (await check(h, branch, muni, 'Zona 10')).providers.PEDIDOSYA;
        expect([py.coverageStatus, py.integrationStatus]).toEqual(['UNKNOWN', 'BLOCKED_EXTERNAL']);
      }
    }
  });

  it('el selector de simulación solo lo mueve personal con permiso de gestión', async () => {
    const h = createHarness();
    expect((await fail(zones.setPedidosyaCoverageScenario(h.client, 'available'))).status).toBe(
      401,
    );
    h.asStaff('manager', 'u2');
    expect((await fail(zones.setPedidosyaCoverageScenario(h.client, 'available'))).status).toBe(
      403,
    );
    h.asStaff('admin');
    expect((await fail(zones.setPedidosyaCoverageScenario(h.client, 'live' as never))).status).toBe(
      400,
    );
  });
});
