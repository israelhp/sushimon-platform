import { HttpException, Logger } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import type { IdentityService } from '../identity/identity.service.js';
import { FakeBusyPort, FakeRidersRepo } from '../../test/support/fake-riders-repo.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { RidersCommandsService } from './riders-commands.service.js';
import { ridersBusy } from './riders-errors.js';
import { RidersQueriesService } from './riders-queries.service.js';

const ALL = ['riders.read', 'riders.create', 'riders.update'];
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const info = (e: unknown) => {
  const x = e as HttpException;
  const body = x.getResponse() as { code?: string; extra?: { current?: number } };
  return { status: x.getStatus(), code: body.code, current: body.extra?.current };
};

describe('Servicios de motoristas (F27)', () => {
  let repo: FakeRidersRepo;
  let port: FakeBusyPort;
  let commands: RidersCommandsService;
  let queries: RidersQueriesService;
  let a: string;
  let b: string;
  const admin = () => globalStaff(ALL);

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    repo = new FakeRidersRepo();
    port = new FakeBusyPort();
    a = repo.addBranch('Centro');
    b = repo.addBranch('Zona 10');
    const auth = new AuthorizationService({} as IdentityService);
    const gate = new DbGate(4, 8, 500, ridersBusy);
    commands = new RidersCommandsService(repo.asRepository(), auth, port, gate);
    queries = new RidersQueriesService(repo.asRepository(), auth, port, gate);
  });

  const create = (staff = admin(), over: Record<string, unknown> = {}) =>
    commands.create(staff, {
      branchId: a,
      fullName: '  Luis   Pérez ',
      phone: '+50255501122',
      licensePlate: 'm-123abc',
      ...over,
    });

  describe('alta', () => {
    it('crea activo, UNAVAILABLE, v1 y audita sin PII (R03/R29)', async () => {
      const staff = admin();
      const r = await create(staff);
      expect(r).toMatchObject({
        active: true,
        availability: 'UNAVAILABLE',
        version: 1,
        fullName: 'Luis Pérez',
        licensePlate: 'M123ABC',
        operationalState: 'UNAVAILABLE',
        busy: false,
        busyKnown: false,
        branchName: 'Centro',
      });
      expect(repo.audits).toHaveLength(1);
      const ev = repo.audits[0];
      expect(ev).toMatchObject({
        action: 'rider.created',
        entityType: 'rider',
        entityId: r.id,
        branchId: a,
        actorId: staff.staffId,
        newValues: { branchId: a, vehicleType: null, active: true, availability: 'UNAVAILABLE' },
      });
      const dump = JSON.stringify(ev);
      for (const pii of ['Luis', 'Pérez', '5550', 'M123ABC']) expect(dump).not.toContain(pii);
    });

    it('teléfono repetido (cualquier sucursal/estado) => 409 sin revelar', async () => {
      await create();
      const e = info(await err(create(admin(), { branchId: b })));
      expect(e).toMatchObject({ status: 409, code: 'RIDER_PHONE_TAKEN' });
    });

    it('sucursal fuera del alcance => 403; inactiva o inexistente => 422', async () => {
      const staffB = scopedStaff(ALL, [b]);
      expect(info(await err(create(staffB)))).toMatchObject({
        status: 403,
        code: 'RIDER_ACTION_FORBIDDEN',
      });
      const dead = repo.addBranch('Cerrada', false);
      expect(info(await err(create(admin(), { branchId: dead })))).toMatchObject({
        status: 422,
        code: 'BRANCH_NOT_AVAILABLE',
      });
      expect(
        info(await err(create(admin(), { branchId: '99999999-9999-4999-8999-999999999999' }))),
      ).toMatchObject({ status: 422 });
    });

    it('un fallo de auditoría revierte el alta (atomicidad)', async () => {
      repo.failAudit = true;
      expect(await err(create())).not.toBeNull();
      expect(repo.riders.size).toBe(0);
    });
  });

  describe('edición y traslado', () => {
    it('versión correcta => v+1 y rider.updated con solo nombres de campo (R13)', async () => {
      const r = await create();
      const out = await commands.update(admin(), r.id, {
        expectedVersion: 1,
        fullName: 'Luis Alberto',
        vehicleType: 'CAR',
      });
      expect(out.version).toBe(2);
      expect(out.fullName).toBe('Luis Alberto');
      const ev = repo.audits.at(-1);
      expect(ev).toMatchObject({
        action: 'rider.updated',
        newValues: { changedFields: ['fullName', 'vehicleType'] },
      });
      expect(JSON.stringify(ev)).not.toContain('Alberto');
    });

    it('versión vieja => 409 con current; sin cambios => 200 sin subir versión ni auditar', async () => {
      const r = await create();
      await commands.update(admin(), r.id, { expectedVersion: 1, vehicleType: 'CAR' });
      const stale = info(
        await err(commands.update(admin(), r.id, { expectedVersion: 1, vehicleType: 'BICYCLE' })),
      );
      expect(stale).toMatchObject({ status: 409, code: 'RIDER_VERSION_CONFLICT', current: 2 });
      const audits = repo.audits.length;
      const same = await commands.update(admin(), r.id, {
        expectedVersion: 2,
        fullName: 'Luis   Pérez',
        vehicleType: 'CAR',
      });
      expect(same.version).toBe(2);
      expect(repo.audits).toHaveLength(audits);
    });

    it('null borra vehículo y placa (R15)', async () => {
      const r = await create(admin(), { vehicleType: 'CAR' });
      const out = await commands.update(admin(), r.id, {
        expectedVersion: 1,
        vehicleType: null,
        licensePlate: null,
      });
      expect(out).toMatchObject({ vehicleType: null, licensePlate: null });
    });

    it('teléfono repetido en edición => 409 y nada cambia', async () => {
      await create();
      const other = await create(admin(), { phone: '+50255509999' });
      const e = info(
        await err(
          commands.update(admin(), other.id, { expectedVersion: 1, phone: '+50255501122' }),
        ),
      );
      expect(e).toMatchObject({ status: 409, code: 'RIDER_PHONE_TAKEN' });
      expect(repo.riders.get(other.id)?.version).toBe(1);
    });

    it('traslado: mismo id, UNAVAILABLE y dos eventos (updated + branch_changed) (R17)', async () => {
      const r = await create();
      await commands.setAvailability(admin(), r.id, { availability: 'AVAILABLE' });
      const out = await commands.update(admin(), r.id, {
        expectedVersion: 2,
        branchId: b,
        fullName: 'Otro Nombre',
      });
      expect(out).toMatchObject({ id: r.id, branchId: b, availability: 'UNAVAILABLE', version: 3 });
      expect(repo.riders.size).toBe(1);
      const actions = repo.audits.map((x) => x.action);
      expect(actions.slice(-2)).toEqual(['rider.updated', 'rider.branch_changed']);
      expect(repo.audits.at(-1)).toMatchObject({
        branchId: b,
        oldValues: { branchId: a },
        newValues: { branchId: b, availability: 'UNAVAILABLE' },
      });
      expect(repo.calls).toContain('read:lock');
    });

    it('traslado exige riders.update en origen Y destino (R18)', async () => {
      const r = await create();
      const onlyA = scopedStaff(ALL, [a]);
      expect(
        info(await err(commands.update(onlyA, r.id, { expectedVersion: 1, branchId: b }))),
      ).toMatchObject({ status: 403, code: 'RIDER_ACTION_FORBIDDEN' });
      const onlyB = scopedStaff(ALL, [b]);
      // origen fuera del alcance de lectura => 404 uniforme
      expect(
        info(await err(commands.update(onlyB, r.id, { expectedVersion: 1, branchId: b }))),
      ).toMatchObject({ status: 404, code: 'RIDER_NOT_FOUND' });
      // lee en A pero solo actualiza en B
      const mixed = scopedStaff(['riders.read'], [a, b]);
      mixed.grants['riders.update'] = { allBranches: false, branchIds: [b] };
      expect(
        info(await err(commands.update(mixed, r.id, { expectedVersion: 1, branchId: b }))),
      ).toMatchObject({ status: 403, code: 'RIDER_ACTION_FORBIDDEN' });
      expect(repo.riders.get(r.id)?.branchId).toBe(a);
    });

    it('destino inactivo/inexistente => 422 (antes que el 409 de versión)', async () => {
      const r = await create();
      const dead = repo.addBranch('Cerrada', false);
      expect(
        info(await err(commands.update(admin(), r.id, { expectedVersion: 9, branchId: dead }))),
      ).toMatchObject({ status: 422, code: 'BRANCH_NOT_AVAILABLE' });
    });

    it('traslado con entrega activa (puerto known) => 409 sin cambios (R19)', async () => {
      const r = await create();
      port.known = true;
      port.busyIds.add(r.id);
      const e = info(
        await err(commands.update(admin(), r.id, { expectedVersion: 1, branchId: b })),
      );
      expect(e).toMatchObject({ status: 409, code: 'RIDER_HAS_ACTIVE_DELIVERY' });
      expect(repo.riders.get(r.id)).toMatchObject({ branchId: a, version: 1 });
    });
  });

  describe('estado y disponibilidad', () => {
    it('desactivar fuerza UNAVAILABLE; reactivar no lo deja disponible; repetir no audita (R20)', async () => {
      const r = await create();
      await commands.setAvailability(admin(), r.id, { availability: 'AVAILABLE' });
      const off = await commands.setStatus(admin(), r.id, { active: false, reason: ' baja ' });
      expect(off).toMatchObject({
        active: false,
        availability: 'UNAVAILABLE',
        operationalState: 'INACTIVE',
      });
      expect(repo.audits.at(-1)).toMatchObject({
        action: 'rider.deactivated',
        oldValues: { active: true },
        newValues: { active: false, availability: 'UNAVAILABLE', hasReason: true, reasonLength: 4 },
      });
      const n = repo.audits.length;
      const again = await commands.setStatus(admin(), r.id, { active: false });
      expect(again.version).toBe(off.version);
      expect(repo.audits).toHaveLength(n);
      const on = await commands.setStatus(admin(), r.id, { active: true });
      expect(on).toMatchObject({ active: true, availability: 'UNAVAILABLE' });
      expect(repo.audits.at(-1)?.action).toBe('rider.activated');
    });

    it('desactivar con entrega activa => 409; sin entrega => 200 (R21)', async () => {
      const r = await create();
      port.known = true;
      port.busyIds.add(r.id);
      expect(info(await err(commands.setStatus(admin(), r.id, { active: false })))).toMatchObject({
        status: 409,
        code: 'RIDER_HAS_ACTIVE_DELIVERY',
      });
      port.busyIds.clear();
      expect((await commands.setStatus(admin(), r.id, { active: false })).active).toBe(false);
    });

    it('disponibilidad: idempotente, inactivo => 409, UNAVAILABLE con entrega => 409 (R22/R23)', async () => {
      const r = await create();
      const on = await commands.setAvailability(admin(), r.id, { availability: 'AVAILABLE' });
      expect(on).toMatchObject({
        availability: 'AVAILABLE',
        operationalState: 'AVAILABLE',
        version: 2,
      });
      const n = repo.audits.length;
      const same = await commands.setAvailability(admin(), r.id, { availability: 'AVAILABLE' });
      expect(same.version).toBe(2);
      expect(repo.audits).toHaveLength(n);
      port.known = true;
      port.busyIds.add(r.id);
      expect(
        info(await err(commands.setAvailability(admin(), r.id, { availability: 'UNAVAILABLE' }))),
      ).toMatchObject({ status: 409, code: 'RIDER_HAS_ACTIVE_DELIVERY' });
      port.busyIds.clear();
      await commands.setStatus(admin(), r.id, { active: false });
      expect(
        info(await err(commands.setAvailability(admin(), r.id, { availability: 'AVAILABLE' }))),
      ).toMatchObject({ status: 409, code: 'RIDER_INACTIVE' });
      expect(repo.audits.at(-1)).toMatchObject({ action: 'rider.deactivated' });
    });

    it('fuera de alcance => 404 uniforme; con lectura pero sin update => 403 (R08/R09)', async () => {
      const r = await create();
      const missing = info(
        await err(
          commands.setStatus(admin(), '99999999-9999-4999-8999-999999999999', { active: false }),
        ),
      );
      const foreign = info(
        await err(commands.setStatus(scopedStaff(ALL, [b]), r.id, { active: false })),
      );
      expect(foreign).toEqual(missing);
      expect(missing).toMatchObject({ status: 404, code: 'RIDER_NOT_FOUND' });
      const reader = scopedStaff(['riders.read'], [a]);
      expect(info(await err(commands.setStatus(reader, r.id, { active: false })))).toMatchObject({
        status: 403,
        code: 'RIDER_ACTION_FORBIDDEN',
      });
    });

    it('gate saturado / bloqueo de BD => 503 RIDERS_BUSY', async () => {
      const r = await create();
      repo.failWith = Object.assign(new Error('lock'), { code: '55P03' });
      expect(info(await err(commands.setStatus(admin(), r.id, { active: false })))).toMatchObject({
        status: 503,
        code: 'RIDERS_BUSY',
      });
    });
  });

  describe('lecturas', () => {
    const phones = ['+50255500001', '+50255500002', '+50255500003'];
    const seedThree = async () => {
      const x = await create(admin(), { fullName: 'Álvaro Gómez', phone: phones[0] });
      const y = await create(admin(), { fullName: 'Beatriz Díaz', phone: phones[1], branchId: b });
      const z = await create(admin(), { fullName: 'Carlos Ruiz', phone: phones[2] });
      await commands.setAvailability(admin(), x.id, { availability: 'AVAILABLE' });
      await commands.setStatus(admin(), z.id, { active: false });
      return { x, y, z };
    };

    it('teléfono enmascarado, sin placa, orden por nombre y paginación (R10/R12)', async () => {
      const { x, y, z } = await seedThree();
      const page = await queries.list(admin(), { pageSize: 2 });
      expect(page).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(page.items.map((i) => i.id)).toEqual([x.id, y.id]);
      const dump = JSON.stringify(page);
      expect(dump).toContain('+502****0001');
      expect(dump).not.toContain('+50255500001');
      expect(dump).not.toContain('licensePlate');
      expect(page.items[0]).not.toHaveProperty('phone');
      const p2 = await queries.list(admin(), { pageSize: 2, page: 2 });
      expect(p2.items.map((i) => i.id)).toEqual([z.id]);
      const beyond = await queries.list(admin(), { pageSize: 2, page: 9 });
      expect(beyond).toMatchObject({ items: [], total: 3 });
      const desc = await queries.list(admin(), { order: 'desc' });
      expect(desc.items.map((i) => i.id)).toEqual([z.id, y.id, x.id]);
    });

    it('filtros: q sin acentos, branchId, active y availability', async () => {
      const { x, y, z } = await seedThree();
      const ids = async (q: Parameters<typeof queries.list>[1]) =>
        (await queries.list(admin(), q)).items.map((i) => i.id);
      expect(await ids({ q: 'ALVARO' })).toEqual([x.id]);
      expect(await ids({ q: '5550' })).toEqual([]); // no busca por teléfono (P103)
      expect(await ids({ branchId: b })).toEqual([y.id]);
      expect(await ids({ active: false })).toEqual([z.id]);
      expect(await ids({ availability: 'AVAILABLE' })).toEqual([x.id]);
      expect(await ids({ availability: 'UNAVAILABLE' })).toEqual([y.id, z.id]);
      expect(await ids({ availability: 'BUSY' })).toEqual([]); // busyKnown=false: nadie ocupado (R24)
    });

    it('alcance: solo su sucursal; branchId ajeno => página vacía; sin alcance => vacío (R11)', async () => {
      const { x, z } = await seedThree();
      const onlyA = scopedStaff(['riders.read'], [a]);
      expect((await queries.list(onlyA, {})).items.map((i) => i.id)).toEqual([x.id, z.id]);
      expect(await queries.list(onlyA, { branchId: b })).toMatchObject({ items: [], total: 0 });
      expect(await queries.list(scopedStaff(['riders.read'], []), {})).toMatchObject({ total: 0 });
    });

    it('con el puerto conocido: busy y operationalState BUSY; filtros BUSY/AVAILABLE (R25)', async () => {
      const { x } = await seedThree();
      port.known = true;
      port.busyIds.add(x.id);
      const all = await queries.list(admin(), {});
      expect(all.items.find((i) => i.id === x.id)).toMatchObject({
        busy: true,
        busyKnown: true,
        operationalState: 'BUSY',
      });
      expect(
        (await queries.list(admin(), { availability: 'BUSY' })).items.map((i) => i.id),
      ).toEqual([x.id]);
      expect((await queries.list(admin(), { availability: 'AVAILABLE' })).items).toEqual([]);
      expect((await queries.get(admin(), x.id)).busy).toBe(true);
    });

    it('detalle: teléfono completo y placa; 404 uniforme fuera de alcance (R08/R12)', async () => {
      const r = await create();
      const detail = await queries.get(scopedStaff(['riders.read'], [a]), r.id);
      expect(detail).toMatchObject({ phone: '+50255501122', licensePlate: 'M123ABC' });
      const foreign = info(await err(queries.get(scopedStaff(['riders.read'], [b]), r.id)));
      const missing = info(await err(queries.get(admin(), '99999999-9999-4999-8999-999999999999')));
      expect(foreign).toEqual(missing);
      expect(missing).toMatchObject({ status: 404, code: 'RIDER_NOT_FOUND' });
    });

    it('presupuesto: listado y detalle = 1 sentencia; el puerto por defecto no consulta SQL (R32)', async () => {
      const r = await create();
      repo.calls.length = 0;
      await queries.list(admin(), {});
      await queries.get(admin(), r.id);
      expect(repo.calls).toEqual(['list', 'findOne']);
    });
  });
});
