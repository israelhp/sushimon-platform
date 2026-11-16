import { ConfigService } from '@nestjs/config';
import { Logger, type HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { DeliveryCoverageRepository } from '../src/delivery-coverage/delivery-coverage.repository.js';
import { DeliveryCoverageService } from '../src/delivery-coverage/delivery-coverage.service.js';
import { DeliverySettingsService } from '../src/delivery-coverage/delivery-settings.service.js';
import { DeliveryZonesService } from '../src/delivery-coverage/delivery-zones.service.js';
import { OwnDeliveryCoverageService } from '../src/delivery-coverage/own-delivery-coverage.service.js';
import { UnavailableIntegrationAdapter } from '../src/delivery-coverage/unavailable-integration.adapter.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { globalStaff, scopedStaff } from './support/staff-context.js';
import { cleanupTestData, ensureAuthStub, TEST_URL, withClient } from './support/db.js';

/**
 * F09 contra PostgreSQL REAL (DATABASE_URL_TEST). NO aplica migraciones: exige que la 0007 ya esté aplicada
 * (existe `app.delivery_zones`); si no, se omite con aviso. Datos de prueba: sucursales propias, limpiadas al final.
 */
const url = TEST_URL;
const ready = url
  ? await withClient(url, async (c) => {
      const r = await c.query<{ t: string | null }>(
        `SELECT to_regclass('app.delivery_zones') AS t`,
      );
      return r.rows[0]?.t != null;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[delivery-coverage.int-spec] OMITIDA: app.delivery_zones no existe en DATABASE_URL_TEST (migración 0007 sin aplicar). Se omite sin aplicar nada.',
  );
}

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const codeOf = (e: HttpException) => (e.getResponse() as { code?: string }).code;

describe.skipIf(!ready)('Zonas, settings y cobertura contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let zones: DeliveryZonesService;
  let settings: DeliverySettingsService;
  let coverage: DeliveryCoverageService;
  let mixco = '';
  const created = new Set<string>();
  const admin = globalStaff(['branches.read', 'branches.manage_delivery_zones']);
  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: {
        code: `t${randomUUID().slice(0, 8)}`,
        name: 'Sucursal F09',
        address: 'Zona 1',
        active,
      },
    });
    created.add(b.id);
    return b.id;
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    prisma = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url, NODE_ENV: 'test' })),
    );
    const repo = new DeliveryCoverageRepository(prisma);
    const authorization = new AuthorizationService({} as IdentityService);
    const branches = new BranchesQueryService(new BranchesRepository(prisma), authorization);
    const audit = new AuditService();
    const courier = new UnavailableIntegrationAdapter();
    zones = new DeliveryZonesService(repo, branches, authorization, audit);
    settings = new DeliverySettingsService(repo, branches, authorization, audit, courier);
    coverage = new DeliveryCoverageService(
      repo,
      new OwnDeliveryCoverageService(repo),
      courier,
      3000,
    );
    mixco = (await prisma.municipality.findFirstOrThrow({ where: { name: 'Mixco' } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupTestData(url as string, { authUserIds: [], branchIds: created });
    await prisma.$disconnect();
  });

  it('crea con tarifa exacta, normaliza clave y audita en la misma transacción', async () => {
    const branchId = await newBranch();
    const z = await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: ' Zóna  4 ',
      baseFee: '15.5',
    });
    expect(z).toMatchObject({ zoneLabel: 'Zóna 4', baseFee: '15.50', version: 1, active: true });
    const row = await prisma.deliveryZone.findUniqueOrThrow({ where: { id: z.id } });
    expect(row.zoneKey).toBe('zona 4');
    const events = await prisma.auditEvent.findMany({ where: { entityId: z.id, branchId } });
    expect(events.map((e) => e.action)).toEqual(['delivery_zone.created']);
  });

  it('dos generales y duplicados concurrentes => uno gana, el otro 409 (nunca 500); una sola fila', async () => {
    const branchId = await newBranch();
    const input = { branchId, municipalityId: mixco, zoneLabel: null, baseFee: '10' };
    const results = await Promise.allSettled([
      zones.create(admin, input),
      zones.create(admin, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(codeOf(rejected.reason as HttpException)).toBe('DELIVERY_ZONE_DUPLICATE');
    expect(await prisma.deliveryZone.count({ where: { branchId } })).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { branchId, action: 'delivery_zone.created' } }),
    ).toBe(1);
  });

  it('versión optimista: actualizaciones concurrentes con la misma versión => una gana, otra 409', async () => {
    const branchId = await newBranch();
    const z = await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: 'Z1',
      baseFee: '5',
    });
    const results = await Promise.allSettled([
      zones.update(admin, z.id, { expectedVersion: 1, baseFee: '6' }),
      zones.update(admin, z.id, { expectedVersion: 1, baseFee: '7' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(codeOf(lost.reason as HttpException)).toBe('DELIVERY_ZONE_VERSION_CONFLICT');
    expect((await prisma.deliveryZone.findUniqueOrThrow({ where: { id: z.id } })).version).toBe(2);
  });

  it('settings: upsert concurrente de flags distintos conserva ambos; defaults sin fila; sin cambios no audita', async () => {
    const branchId = await newBranch();
    expect(await settings.get(admin, branchId)).toMatchObject({ isDefault: true, updatedAt: null });
    await Promise.all([
      settings.update(admin, branchId, { ownDeliveryZonesEnabled: true }),
      settings.update(admin, branchId, { pedidosyaEnabled: false }),
    ]);
    expect(await settings.get(admin, branchId)).toMatchObject({
      ownDeliveryZonesEnabled: true,
      pedidosyaEnabled: false,
      isDefault: false,
    });
    await settings.update(admin, branchId, { ownDeliveryZonesEnabled: true });
    const n = await prisma.auditEvent.count({
      where: { branchId, action: 'branch_delivery_settings.updated' },
    });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
  });

  it('IDOR: personal de otra sucursal => 404 en lectura, edición y estado', async () => {
    const a = await newBranch();
    const b = await newBranch();
    const z = await zones.create(admin, {
      branchId: a,
      municipalityId: mixco,
      zoneLabel: 'X',
      baseFee: '1',
    });
    const other = scopedStaff(['branches.read', 'branches.manage_delivery_zones'], [b]);
    for (const run of [
      () => zones.get(other, z.id),
      () => zones.update(other, z.id, { expectedVersion: 1, baseFee: '2' }),
      () => zones.setStatus(other, z.id, { active: false }),
      () => settings.get(other, a),
    ]) {
      expect((await failure(run())).getStatus()).toBe(404);
    }
  });

  it('cobertura real: flag apagado no evalúa; específica > general; inactiva ignorada; tarifa exacta', async () => {
    const branchId = await newBranch();
    const general = await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: null,
      baseFee: '25',
    });
    const z4 = await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: 'Zona 4',
      baseFee: '12.3',
    });
    const off = await coverage.check({ branchId, municipalityId: mixco, zone: 'Zona 4' });
    expect(off.providers.OWN).toMatchObject({ enabled: false, reason: 'PROVIDER_DISABLED' });
    await settings.update(admin, branchId, { ownDeliveryZonesEnabled: true });
    const hit = await coverage.check({ branchId, municipalityId: mixco, zone: ' ZÓNA 4 ' });
    expect(hit.providers.OWN).toMatchObject({
      deliveryZoneId: z4.id,
      baseFee: '12.30',
      matchedBy: 'ZONE',
    });
    await zones.setStatus(admin, z4.id, { active: false });
    const fall = await coverage.check({ branchId, municipalityId: mixco, zone: 'Zona 4' });
    expect(fall.providers.OWN).toMatchObject({
      deliveryZoneId: general.id,
      matchedBy: 'MUNICIPALITY',
    });
    expect(fall.eligibility.status).toBe('CONFIRMED');
    expect(fall.providers.PEDIDOSYA).toMatchObject({
      coverageStatus: 'UNKNOWN',
      integrationStatus: 'BLOCKED_EXTERNAL',
    });
  });

  it('check: sucursal inactiva o inexistente => 422; municipio inexistente => 422', async () => {
    const inactive = await newBranch(false);
    const active = await newBranch();
    expect(
      codeOf(await failure(coverage.check({ branchId: inactive, municipalityId: mixco }))),
    ).toBe('BRANCH_NOT_AVAILABLE');
    expect(
      codeOf(await failure(coverage.check({ branchId: randomUUID(), municipalityId: mixco }))),
    ).toBe('BRANCH_NOT_AVAILABLE');
    expect(
      codeOf(await failure(coverage.check({ branchId: active, municipalityId: randomUUID() }))),
    ).toBe('MUNICIPALITY_NOT_FOUND');
  });

  it('q con comodines (%, _, \\) busca literalmente en BD real: no devuelve todo', async () => {
    const branchId = await newBranch();
    await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: 'Zona 4',
      baseFee: '1',
    });
    await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: 'Zona_5',
      baseFee: '1',
    });
    await zones.create(admin, { branchId, municipalityId: mixco, zoneLabel: '100%', baseFee: '1' });
    const total = async (q: string) => (await zones.list(admin, { branchId, q })).total;
    expect(await total('zona')).toBe(2);
    expect(await total('%')).toBe(1);
    expect(await total('_')).toBe(1);
    expect(await total('\\')).toBe(0);
    expect(await total('4')).toBe(1);
  });

  it('auditoría en BD real: sin PII y tarifa como string', async () => {
    const branchId = await newBranch();
    const z = await zones.create(admin, {
      branchId,
      municipalityId: mixco,
      zoneLabel: 'Aud',
      baseFee: '9',
    });
    await zones.update(admin, z.id, { expectedVersion: 1, baseFee: '10.5' });
    await zones.setStatus(admin, z.id, { active: false, reason: 'cierre temporal' });
    const events = await prisma.auditEvent.findMany({ where: { entityId: z.id, branchId } });
    expect(events.map((e) => e.action).sort()).toEqual([
      'delivery_zone.created',
      'delivery_zone.status_changed',
      'delivery_zone.updated',
    ]);
    for (const e of events) {
      for (const v of [e.oldValues, e.newValues] as (Record<string, unknown> | null)[]) {
        if (v && 'baseFee' in v) expect(typeof v['baseFee']).toBe('string');
      }
      expect(JSON.stringify([e.oldValues, e.newValues])).not.toMatch(/@|email|phone|token/i);
    }
  });

  it('check: sucursal inexistente e inactiva dan respuesta idéntica en BD real', async () => {
    const inactive = await newBranch(false);
    const a = await failure(coverage.check({ branchId: inactive, municipalityId: mixco }));
    const b = await failure(coverage.check({ branchId: randomUUID(), municipalityId: mixco }));
    expect(a.getResponse()).toEqual(b.getResponse());
  });

  it('catálogos sembrados: 22 departamentos y 17 municipios de Guatemala', async () => {
    expect(await prisma.department.count()).toBeGreaterThanOrEqual(22);
    const gt = await prisma.department.findUniqueOrThrow({ where: { name: 'Guatemala' } });
    expect(
      await prisma.municipality.count({ where: { departmentId: gt.id } }),
    ).toBeGreaterThanOrEqual(17);
  });
});
