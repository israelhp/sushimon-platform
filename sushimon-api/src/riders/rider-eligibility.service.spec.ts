import { FakeBusyPort, FakeRidersRepo } from '../../test/support/fake-riders-repo.js';
import { RiderEligibilityService } from './rider-eligibility.service.js';
import { NoActiveDeliveriesAdapter } from './ports/rider-active-deliveries.port.js';

describe('RiderEligibilityService (R26–R28)', () => {
  let repo: FakeRidersRepo;
  let port: FakeBusyPort;
  let svc: RiderEligibilityService;
  let branch: string;
  let other: string;

  beforeEach(() => {
    repo = new FakeRidersRepo();
    port = new FakeBusyPort();
    branch = repo.addBranch('Centro');
    other = repo.addBranch('Zona 10');
    repo.ownDelivery.set(branch, true);
    svc = new RiderEligibilityService(repo.asRepository(), port);
  });

  const ready = () => repo.seed({ branchId: branch, active: true, availability: 'AVAILABLE' });

  it('elegible: activo, disponible, misma sucursal, reparto propio habilitado', async () => {
    const r = ready();
    const e = await svc.evaluate({ riderId: r.id, branchId: branch });
    expect(e).toMatchObject({
      eligible: true,
      reasons: [],
      active: true,
      available: true,
      busy: false,
      busyKnown: false,
      riderBranchId: branch,
    });
  });

  it('NOT_FOUND cortocircuita', async () => {
    const e = await svc.evaluate({
      riderId: '00000000-0000-4000-8000-000000000000',
      branchId: branch,
    });
    expect(e.reasons).toEqual(['NOT_FOUND']);
    expect(e.eligible).toBe(false);
    expect(e.riderBranchId).toBeNull();
    expect(port.queries).toHaveLength(0);
  });

  it('INACTIVE (no duplica UNAVAILABLE)', async () => {
    const r = repo.seed({ branchId: branch, active: false, availability: 'UNAVAILABLE' });
    const e = await svc.evaluate({ riderId: r.id, branchId: branch });
    expect(e.reasons).toEqual(['INACTIVE']);
    expect(e.available).toBe(false);
  });

  it('UNAVAILABLE (activo no disponible)', async () => {
    const r = repo.seed({ branchId: branch, availability: 'UNAVAILABLE' });
    expect((await svc.evaluate({ riderId: r.id, branchId: branch })).reasons).toEqual([
      'UNAVAILABLE',
    ]);
  });

  it('WRONG_BRANCH: sucursal ajena al pedido (y reparto propio apagado en la del pedido)', async () => {
    const r = ready();
    const e = await svc.evaluate({ riderId: r.id, branchId: other });
    expect(e.reasons).toEqual(['WRONG_BRANCH', 'OWN_DELIVERY_DISABLED']);
    expect(e.riderBranchId).toBe(branch);
  });

  it('BUSY solo con el puerto conocido; busyKnown=false no añade BUSY', async () => {
    const r = ready();
    port.busyIds.add(r.id);
    const unknown = await svc.evaluate({ riderId: r.id, branchId: branch });
    expect(unknown).toMatchObject({ busy: false, busyKnown: false, eligible: true });
    port.known = true;
    const known = await svc.evaluate({ riderId: r.id, branchId: branch });
    expect(known).toMatchObject({
      busy: true,
      busyKnown: true,
      eligible: false,
      reasons: ['BUSY'],
    });
  });

  it('OWN_DELIVERY_DISABLED: bandera apagada y fila ausente; habilitada => elegible', async () => {
    const r = ready();
    repo.ownDelivery.set(branch, false);
    expect((await svc.evaluate({ riderId: r.id, branchId: branch })).reasons).toEqual([
      'OWN_DELIVERY_DISABLED',
    ]);
    repo.ownDelivery.delete(branch); // fila ausente = false
    expect((await svc.evaluate({ riderId: r.id, branchId: branch })).eligible).toBe(false);
    repo.ownDelivery.set(branch, true);
    expect((await svc.evaluate({ riderId: r.id, branchId: branch })).eligible).toBe(true);
  });

  it('combinación: orden estable de razones', async () => {
    const r = repo.seed({ branchId: branch, active: true, availability: 'UNAVAILABLE' });
    port.known = true;
    port.busyIds.add(r.id);
    const e = await svc.evaluate({ riderId: r.id, branchId: other });
    expect(e.reasons).toEqual(['WRONG_BRANCH', 'UNAVAILABLE', 'BUSY', 'OWN_DELIVERY_DISABLED']);
  });

  it('solo lectura: una sentencia y ninguna escritura ni candado (R28)', async () => {
    const r = ready();
    await svc.evaluate({ riderId: r.id, branchId: branch });
    expect(repo.calls).toEqual(['eligibility']);
    expect(repo.audits).toHaveLength(0);
    expect(repo.riders.get(r.id)?.version).toBe(1);
  });

  it('el adaptador por defecto no afirma nada y no consulta SQL (R24/R35)', async () => {
    const r = ready();
    const real = new RiderEligibilityService(repo.asRepository(), new NoActiveDeliveriesAdapter());
    expect(await new NoActiveDeliveriesAdapter().findBusy()).toEqual({
      known: false,
      busyIds: new Set(),
    });
    expect(await real.evaluate({ riderId: r.id, branchId: branch })).toMatchObject({
      busyKnown: false,
      busy: false,
    });
  });
});
