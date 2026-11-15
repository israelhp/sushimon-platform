import type { HttpException } from '@nestjs/common';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { A, B, coverageHarness, INACTIVE, MISSING } from '../../test/support/coverage-harness.js';
import { MUN_MIXCO, MUN_MISSING, MUN_VN } from '../../test/support/fake-coverage-repo.js';

const MANAGER = globalStaff(['branches.read', 'branches.manage_delivery_zones']);
const READER = globalStaff(['branches.read']);

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const codeOf = (e: HttpException) => (e.getResponse() as { code?: string }).code;
const violations = (e: HttpException) =>
  (e.getResponse() as { violations?: { path: string; code: string }[] }).violations;

const create = (over: Record<string, unknown> = {}) => ({
  branchId: A,
  municipalityId: MUN_MIXCO,
  zoneLabel: 'Zona 4',
  baseFee: '15',
  ...over,
});

describe('DeliveryZonesService', () => {
  describe('create', () => {
    it('normaliza etiqueta y tarifa (string exacto), activa por defecto, version 1 y audita en la misma transacción', async () => {
      const h = coverageHarness();
      const z = await h.zones.create(MANAGER, create({ zoneLabel: '  Zona   4 ' }));
      expect(z).toMatchObject({
        branchId: A,
        municipalityName: 'Mixco',
        departmentName: 'Guatemala',
        zoneLabel: 'Zona 4',
        baseFee: '15.00',
        currency: 'GTQ',
        active: true,
        version: 1,
      });
      expect([...h.repo.zones.values()][0]?.zoneKey).toBe('zona 4');
      expect(h.repo.audit).toEqual([
        expect.objectContaining({
          action: 'delivery_zone.created',
          entityType: 'delivery_zone',
          entityId: z.id,
          branchId: A,
          actorId: MANAGER.staffId,
          newValues: {
            zoneLabel: 'Zona 4',
            municipalityId: MUN_MIXCO,
            baseFee: '15.00',
            active: true,
          },
        }),
      ]);
    });

    it('etiqueta null/ausente/en blanco = cobertura general (clave vacía); dos generales => 409', async () => {
      const h = coverageHarness();
      const g = await h.zones.create(MANAGER, create({ zoneLabel: null }));
      expect(g.zoneLabel).toBeNull();
      for (const zoneLabel of [undefined, '   ', null]) {
        const e = await failure(h.zones.create(MANAGER, create({ zoneLabel })));
        expect(e.getStatus()).toBe(409);
        expect(codeOf(e)).toBe('DELIVERY_ZONE_DUPLICATE');
        expect(violations(e)).toEqual([
          {
            path: `deliveryZones/${g.id}`,
            code: 'DUPLICATE_ZONE',
            message: expect.any(String) as string,
          },
        ]);
      }
    });

    it('duplicado equivalente (acentos, mayúsculas, espacios) o de una zona INACTIVA => 409; no se crea otra', async () => {
      const h = coverageHarness();
      const first = await h.zones.create(MANAGER, create({ zoneLabel: 'Zóna 4', active: false }));
      expect(first.active).toBe(false);
      const e = await failure(h.zones.create(MANAGER, create({ zoneLabel: ' ZONA   4' })));
      expect(codeOf(e)).toBe('DELIVERY_ZONE_DUPLICATE');
      expect(h.repo.zones.size).toBe(1);
      expect(h.repo.audit).toHaveLength(1);
    });

    it('la misma etiqueta en otro municipio o sucursal es válida; "Zona 4", "4" y "04" son distintas', async () => {
      const h = coverageHarness();
      await h.zones.create(MANAGER, create());
      await h.zones.create(MANAGER, create({ municipalityId: MUN_VN }));
      await h.zones.create(MANAGER, create({ branchId: B }));
      for (const zoneLabel of ['4', '04']) await h.zones.create(MANAGER, create({ zoneLabel }));
      expect(h.repo.zones.size).toBe(5);
    });

    it('carrera: el precheck no ve al ganador, la BD responde 23505 => 409 con la zona ganadora y sin auditoría', async () => {
      const h = coverageHarness();
      let winner = '';
      h.repo.beforeInsert = () => {
        h.repo.beforeInsert = null;
        winner = h.repo.commitConcurrently({
          branchId: A,
          municipalityId: MUN_MIXCO,
          zoneLabel: 'Zona 4',
          zoneKey: 'zona 4',
        }).id;
      };
      const e = await failure(h.zones.create(MANAGER, create()));
      expect(e.getStatus()).toBe(409);
      expect(codeOf(e)).toBe('DELIVERY_ZONE_DUPLICATE');
      expect(violations(e)?.[0]?.path).toBe(`deliveryZones/${winner}`);
      expect(h.repo.audit).toEqual([]);
    });

    it('municipio inexistente => 422 MUNICIPALITY_NOT_FOUND', async () => {
      const h = coverageHarness();
      const e = await failure(h.zones.create(MANAGER, create({ municipalityId: MUN_MISSING })));
      expect(e.getStatus()).toBe(422);
      expect(codeOf(e)).toBe('MUNICIPALITY_NOT_FOUND');
      expect(violations(e)?.[0]?.path).toBe('municipalityId');
    });

    it('sucursal inexistente, fuera de alcance o sin permiso de gestión => 404 idéntico; una INACTIVA sí admite zonas', async () => {
      const h = coverageHarness();
      const scoped = scopedStaff(['branches.read', 'branches.manage_delivery_zones'], [A]);
      const onlyRead = globalStaff(['branches.read']);
      const errors = [
        await failure(h.zones.create(MANAGER, create({ branchId: MISSING }))),
        await failure(h.zones.create(scoped, create({ branchId: B }))),
        await failure(h.zones.create(onlyRead, create())),
      ];
      expect(errors.map((e) => e.getStatus())).toEqual([404, 404, 404]);
      expect(new Set(errors.map((e) => JSON.stringify(e.getResponse()))).size).toBe(1);
      expect(h.repo.zones.size).toBe(0);
      await h.zones.create(MANAGER, create({ branchId: INACTIVE }));
      expect(h.repo.zones.size).toBe(1);
    });

    it('tarifa o etiqueta inválidas => 400 sin escribir', async () => {
      const h = coverageHarness();
      for (const over of [
        { baseFee: '15.001' },
        { baseFee: -1 },
        { baseFee: 15 },
        { zoneLabel: 'z'.repeat(61) },
      ]) {
        expect((await failure(h.zones.create(MANAGER, create(over)))).getStatus()).toBe(400);
      }
      expect(h.repo.zones.size).toBe(0);
    });

    it('un fallo posterior a la escritura revierte zona y auditoría (atomicidad)', async () => {
      const h = coverageHarness();
      const original = h.repo.insertZone.bind(h.repo);
      h.repo.insertZone = async (...args) => {
        const created = await original(...args);
        throw Object.assign(new Error('boom'), { code: '40001', createdId: created.id });
      };
      await failure(h.zones.create(MANAGER, create()));
      expect(h.repo.zones.size).toBe(0);
      expect(h.repo.audit).toEqual([]);
    });

    it('CHECK de BD (23514) => 400 genérico sin nombre de restricción', async () => {
      const h = coverageHarness();
      h.repo.failNextWriteWith = Object.assign(new Error('delivery_zones_base_fee_range'), {
        code: '23514',
      });
      const e = await failure(h.zones.create(MANAGER, create()));
      expect(e.getStatus()).toBe(400);
      expect(JSON.stringify(e.getResponse())).not.toContain('delivery_zones');
    });
  });

  describe('update', () => {
    const seed = async (h: ReturnType<typeof coverageHarness>) => h.zones.create(MANAGER, create());

    it('cambia tarifa y etiqueta, sube version, actualiza updatedAt y audita solo el diff real', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      const u = await h.zones.update(MANAGER, z.id, {
        expectedVersion: 1,
        baseFee: '17.5',
        zoneLabel: 'Zona 5',
      });
      expect(u).toMatchObject({ version: 2, baseFee: '17.50', zoneLabel: 'Zona 5' });
      expect(u.updatedAt).not.toBe(z.updatedAt);
      expect(h.repo.audit.at(-1)).toMatchObject({
        action: 'delivery_zone.updated',
        branchId: A,
        oldValues: { zoneLabel: 'Zona 4', baseFee: '15.00' },
        newValues: { zoneLabel: 'Zona 5', baseFee: '17.50' },
      });
      const only = await h.zones.update(MANAGER, z.id, { expectedVersion: 2, baseFee: '20' });
      expect(only.version).toBe(3);
      expect(h.repo.audit.at(-1)).toMatchObject({
        oldValues: { baseFee: '17.50' },
        newValues: { baseFee: '20.00' },
      });
      expect(h.repo.audit.at(-1)?.newValues).not.toHaveProperty('zoneLabel');
    });

    it('expectedVersion desfasada => 409 VERSION_CONFLICT sin guardar ni auditar', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      await h.zones.update(MANAGER, z.id, { expectedVersion: 1, baseFee: '20' });
      const stale = await failure(
        h.zones.update(MANAGER, z.id, { expectedVersion: 1, baseFee: '99' }),
      );
      expect(stale.getStatus()).toBe(409);
      expect(codeOf(stale)).toBe('DELIVERY_ZONE_VERSION_CONFLICT');
      expect(h.repo.zones.get(z.id)?.baseFee).toBe('20.00');
      expect(h.repo.audit).toHaveLength(2);
    });

    it('dos actualizaciones concurrentes con la misma versión: una gana, la otra recibe 409', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      const results = await Promise.allSettled([
        h.zones.update(MANAGER, z.id, { expectedVersion: 1, baseFee: '10' }),
        h.zones.update(MANAGER, z.id, { expectedVersion: 1, baseFee: '11' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(h.repo.zones.get(z.id)?.version).toBe(2);
    });

    it('sin cambios reales => 200, sin subir version, sin escribir ni auditar (etiqueta equivalente incluida)', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      const same = await h.zones.update(MANAGER, z.id, {
        expectedVersion: 1,
        baseFee: '15.00',
        zoneLabel: ' Zona   4 ',
      });
      expect(same).toEqual(z);
      expect(h.repo.audit).toHaveLength(1);
    });

    it('sin zoneLabel ni baseFee => 400; etiqueta null convierte la zona en general', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      expect(
        (await failure(h.zones.update(MANAGER, z.id, { expectedVersion: 1 }))).getStatus(),
      ).toBe(400);
      const g = await h.zones.update(MANAGER, z.id, { expectedVersion: 1, zoneLabel: null });
      expect(g.zoneLabel).toBeNull();
      expect([...h.repo.zones.values()][0]?.zoneKey).toBe('');
    });

    it('renombrar a una etiqueta existente (activa o inactiva) => 409 DELIVERY_ZONE_DUPLICATE con la existente', async () => {
      const h = coverageHarness();
      const a = await seed(h);
      const b = await h.zones.create(MANAGER, create({ zoneLabel: 'Zona 5', active: false }));
      const e = await failure(
        h.zones.update(MANAGER, a.id, { expectedVersion: 1, zoneLabel: 'zona 5' }),
      );
      expect(codeOf(e)).toBe('DELIVERY_ZONE_DUPLICATE');
      expect(violations(e)?.[0]?.path).toBe(`deliveryZones/${b.id}`);
    });

    it('cambiar solo mayúsculas/acentos de su propia etiqueta no es duplicado y sí es un cambio', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      const u = await h.zones.update(MANAGER, z.id, { expectedVersion: 1, zoneLabel: 'ZONA 4' });
      expect(u).toMatchObject({ zoneLabel: 'ZONA 4', version: 2 });
    });

    it('inexistente, otra sucursal o sin permiso de gestión => 404; no se aceptan cambios de sucursal/municipio (DTO)', async () => {
      const h = coverageHarness();
      const z = await seed(h);
      const scopedB = scopedStaff(['branches.read', 'branches.manage_delivery_zones'], [B]);
      for (const staff of [scopedB, READER]) {
        expect(
          (
            await failure(h.zones.update(staff, z.id, { expectedVersion: 1, baseFee: '1' }))
          ).getStatus(),
        ).toBe(404);
      }
      expect(
        (
          await failure(h.zones.update(MANAGER, MISSING, { expectedVersion: 1, baseFee: '1' }))
        ).getStatus(),
      ).toBe(404);
      expect(h.repo.zones.get(z.id)?.baseFee).toBe('15.00');
    });
  });

  describe('setStatus', () => {
    it('desactiva/activa con auditoría y reason; sube version; no borra', async () => {
      const h = coverageHarness();
      const z = await h.zones.create(MANAGER, create());
      const off = await h.zones.setStatus(MANAGER, z.id, {
        active: false,
        reason: ' Zona cerrada ',
      });
      expect(off).toMatchObject({ active: false, version: 2 });
      expect(h.repo.audit.at(-1)).toMatchObject({
        action: 'delivery_zone.status_changed',
        reason: 'Zona cerrada',
        oldValues: { active: true },
        newValues: { active: false },
      });
      const on = await h.zones.setStatus(MANAGER, z.id, { active: true });
      expect(on).toMatchObject({ active: true, version: 3 });
      expect(h.repo.zones.size).toBe(1);
    });

    it('idempotente: mismo valor => 200 sin escribir, sin version y sin auditar', async () => {
      const h = coverageHarness();
      const z = await h.zones.create(MANAGER, create());
      expect(await h.zones.setStatus(MANAGER, z.id, { active: true })).toEqual(z);
      expect(h.repo.audit).toHaveLength(1);
    });

    it('último gana, no usa expectedVersion; fuera de alcance => 404', async () => {
      const h = coverageHarness();
      const z = await h.zones.create(MANAGER, create());
      await h.zones.update(MANAGER, z.id, { expectedVersion: 1, baseFee: '2' });
      expect((await h.zones.setStatus(MANAGER, z.id, { active: false })).version).toBe(3);
      const other = scopedStaff(['branches.manage_delivery_zones'], [B]);
      expect((await failure(h.zones.setStatus(other, z.id, { active: true }))).getStatus()).toBe(
        404,
      );
    });
  });

  describe('lectura', () => {
    it('get: 404 inexistente, fuera de alcance o sin branches.read; la inactiva SÍ se consulta', async () => {
      const h = coverageHarness();
      const z = await h.zones.create(MANAGER, create());
      await h.zones.setStatus(MANAGER, z.id, { active: false });
      expect((await h.zones.get(READER, z.id)).active).toBe(false);
      expect((await failure(h.zones.get(globalStaff(['orders.read']), z.id))).getStatus()).toBe(
        404,
      );
      expect(
        (await failure(h.zones.get(scopedStaff(['branches.read'], [B]), z.id))).getStatus(),
      ).toBe(404);
      expect((await failure(h.zones.get(READER, MISSING))).getStatus()).toBe(404);
    });

    it('list: solo sus sucursales; branchId ajeno/inexistente => 404; sin alcance => vacío', async () => {
      const h = coverageHarness();
      await h.zones.create(MANAGER, create());
      await h.zones.create(MANAGER, create({ branchId: B }));
      const scopedA = scopedStaff(['branches.read'], [A]);
      expect((await h.zones.list(scopedA, {})).items.map((z) => z.branchId)).toEqual([A]);
      expect((await h.zones.list(READER, {})).total).toBe(2);
      expect((await failure(h.zones.list(scopedA, { branchId: B }))).getStatus()).toBe(404);
      expect((await failure(h.zones.list(READER, { branchId: MISSING }))).getStatus()).toBe(404);
      expect(await h.zones.list(globalStaff(['orders.read']), {})).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
      expect((await h.zones.list(scopedA, { branchId: A })).total).toBe(1);
    });

    it('list: filtros por municipio, departamento, estado y q (sin acentos/mayúsculas); paginación', async () => {
      const h = coverageHarness();
      await h.zones.create(MANAGER, create({ zoneLabel: null }));
      const z4 = await h.zones.create(MANAGER, create({ zoneLabel: 'Zóna 4' }));
      await h.zones.create(MANAGER, create({ municipalityId: MUN_VN, zoneLabel: 'Centro' }));
      await h.zones.setStatus(MANAGER, z4.id, { active: false });
      expect((await h.zones.list(READER, { municipalityId: MUN_VN })).total).toBe(1);
      expect((await h.zones.list(READER, { active: false })).items.map((z) => z.id)).toEqual([
        z4.id,
      ]);
      expect((await h.zones.list(READER, { q: 'ZONA' })).items.map((z) => z.id)).toEqual([z4.id]);
      const p1 = await h.zones.list(READER, { page: 1, pageSize: 2 });
      const p2 = await h.zones.list(READER, { page: 2, pageSize: 2 });
      expect([p1.items.length, p2.items.length, p1.total]).toEqual([2, 1, 3]);
      expect(p1.items[0]?.zoneLabel).toBeNull(); // la general va primero dentro del municipio
    });
  });
});
