import { adminOrdersHarness, BRANCH_A } from '../../../test/support/admin-orders-harness.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import { FakeAdminOrdersRepo } from '../../../test/support/fake-admin-orders-repo.js';

const STAFF = '99999999-9999-4999-8999-999999999999';
const OTHER = '88888888-8888-4888-8888-888888888888';

const apply = (
  repo: FakeAdminOrdersRepo,
  svc: OrderTransitionsService,
  id: string,
  over: Partial<Parameters<OrderTransitionsService['apply']>[1]> = {},
) =>
  repo.transaction((tx) =>
    svc.apply(tx, {
      orderId: id,
      expectedStatus: 'pending',
      to: 'accepted',
      actor: { kind: 'staff', staffId: STAFF },
      auditAction: 'order.accepted',
      authorize: () => undefined,
      ...over,
    }),
  );

const code = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code;
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe('OrderTransitionsService (S: filas 15, 16, 19-23)', () => {
  it('éxito atómico: estado, UNA fila de historial (changed_at = updated_at) y UN evento de auditoría', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const out = await apply(repo, transitions, id);
    expect(out).toMatchObject({
      from: 'pending',
      to: 'accepted',
      replayed: false,
      appliedByMe: true,
    });
    const stored = repo.orders.get(id);
    expect(stored?.status).toBe('accepted');
    expect(out.at).toEqual(stored?.updatedAt);
    const events = repo.eventsOf(id);
    expect(events).toHaveLength(2); // creación + transición
    expect(events[1]).toMatchObject({
      oldStatus: 'pending',
      newStatus: 'accepted',
      changedBy: STAFF,
    });
    expect(events[1]?.changedAt).toEqual(stored?.updatedAt);
    expect(repo.audits).toEqual([
      expect.objectContaining({
        actorId: STAFF,
        branchId: BRANCH_A,
        entityType: 'order',
        entityId: id,
        action: 'order.accepted',
        oldValues: { status: 'pending', fulfillmentType: 'PICKUP' },
        newValues: { status: 'accepted', fulfillmentType: 'PICKUP' },
      }),
    ]);
  });

  it('fila 16 rollback: si falla la auditoría no cambia el estado ni queda historial', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    repo.failAudit = true;
    await expect(apply(repo, transitions, id)).rejects.toThrow('fallo de auditoría');
    expect(repo.orders.get(id)?.status).toBe('pending');
    expect(repo.eventsOf(id)).toHaveLength(1);
    expect(repo.audits).toHaveLength(0);
  });

  it('actor sistema (F28): changed_by y actor_id NULL', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    await apply(repo, transitions, id, { actor: { kind: 'system' } });
    expect(repo.eventsOf(id)[1]?.changedBy).toBeNull();
    expect(repo.audits[0]?.actorId).toBeNull();
  });

  it('inexistente => 404 ORDER_NOT_FOUND y nada escrito', async () => {
    const { repo, transitions } = adminOrdersHarness();
    expect(code(await err(apply(repo, transitions, 'c0000000-0000-4000-8000-0000000000ff')))).toBe(
      'ORDER_NOT_FOUND',
    );
    expect(repo.audits).toHaveLength(0);
  });

  it('fila 19: estado actual distinto y no repetición => 409 con current y nada escrito', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A, status: 'accepted' });
    const e = await err(apply(repo, transitions, id)); // expected=pending, to=accepted, pero el último evento es `pending` creación
    expect(code(e)).toBe('ORDER_STATE_CONFLICT');
    expect(
      (e as { getResponse: () => { extra: { current: { status: string } } } }).getResponse().extra
        .current.status,
    ).toBe('accepted');
    expect(repo.audits).toHaveLength(0);
    expect(repo.eventsOf(id)).toHaveLength(1);
  });

  it('fila 20: repetición del mismo actor => replayed, appliedByMe, sin segunda fila ni auditoría', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const first = await apply(repo, transitions, id);
    const second = await apply(repo, transitions, id);
    expect(second).toMatchObject({ replayed: true, appliedByMe: true, to: 'accepted' });
    expect(second.at).toEqual(first.at);
    expect(repo.eventsOf(id)).toHaveLength(2);
    expect(repo.audits).toHaveLength(1);
  });

  it('fila 21: repetición por OTRA persona => appliedByMe=false', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    await apply(repo, transitions, id);
    const second = await apply(repo, transitions, id, { actor: { kind: 'staff', staffId: OTHER } });
    expect(second).toMatchObject({ replayed: true, appliedByMe: false });
  });

  it('fila 22: cancelar dos veces con motivo distinto conserva el original y no escribe', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const base = { to: 'cancelled', auditAction: 'order.cancelled' };
    await apply(repo, transitions, id, { ...base, reason: 'Sin existencias' });
    const again = await apply(repo, transitions, id, { ...base, reason: 'Otro motivo' });
    expect(again.replayed).toBe(true);
    expect(repo.eventsOf(id)).toHaveLength(2);
    expect(repo.eventsOf(id)[1]?.reason).toBe('Sin existencias');
  });

  it('fila 23: historial inconsistente (último evento no coincide) => 409, nunca falsa repetición', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A, status: 'accepted' }); // el historial solo trae `pending` (creación)
    expect(code(await err(apply(repo, transitions, id)))).toBe('ORDER_STATE_CONFLICT');
  });

  it('la matriz se evalúa ANTES que la idempotencia: terminal => 422 con current', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A, status: 'cancelled' });
    const e = await err(
      apply(repo, transitions, id, { expectedStatus: 'cancelled', to: 'accepted' }),
    );
    expect(code(e)).toBe('ORDER_TRANSITION_INVALID');
    expect(
      (e as { getResponse: () => { violations: { code: string }[] } }).getResponse().violations[0]
        ?.code,
    ).toBe('ORDER_TERMINAL');
  });

  it('authorize es OBLIGATORIO: un llamador que lo omite falla antes de leer o escribir nada', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    await expect(
      repo.transaction((tx) =>
        transitions.apply(tx, {
          orderId: id,
          expectedStatus: 'pending',
          to: 'accepted',
          actor: { kind: 'system' },
          auditAction: 'order.accepted',
        } as unknown as Parameters<OrderTransitionsService['apply']>[1]),
      ),
    ).rejects.toThrow('authorize');
    expect(repo.calls).not.toContain('readOrder');
    expect(repo.orders.get(id)?.status).toBe('pending');
  });

  it('authorize se invoca tras leer el pedido y antes de escribir', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const boom = new Error('denegado');
    await expect(
      apply(repo, transitions, id, {
        authorize: () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
    expect(repo.calls).not.toContain('casAndRecord');
  });

  it('dos transacciones simultáneas (mismo actor): una escribe y la otra es repetición', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const [a, b] = await Promise.all([apply(repo, transitions, id), apply(repo, transitions, id)]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(repo.eventsOf(id)).toHaveLength(2);
    expect(repo.audits).toHaveLength(1);
  });

  it('dos actores con destinos distintos: una gana y la otra recibe 409 con current', async () => {
    const { repo, transitions } = adminOrdersHarness();
    const id = repo.seed({ branchId: BRANCH_A });
    const results = await Promise.all([
      err(apply(repo, transitions, id)),
      err(
        apply(repo, transitions, id, {
          to: 'rejected',
          auditAction: 'order.rejected',
          reason: 'sin stock',
          actor: { kind: 'staff', staffId: OTHER },
        }),
      ),
    ]);
    const failures = results.filter(Boolean);
    expect(failures).toHaveLength(1);
    expect(code(failures[0])).toBe('ORDER_STATE_CONFLICT');
    expect(repo.eventsOf(id)).toHaveLength(2);
    expect(['accepted', 'rejected']).toContain(repo.orders.get(id)?.status);
  });
});
