import type { HttpException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { deliveriesHarness, NOW } from '../../test/support/deliveries-harness.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from '../../test/support/staff-context.js';
import type { ListAdminDeliveriesQuery } from './dto/deliveries-requests.dto.js';

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const info = (e: unknown) => {
  const x = e as HttpException;
  return {
    status: x.getStatus(),
    code: (x.getResponse() as { code?: string }).code,
    raw: JSON.stringify(x.getResponse()),
  };
};
const ALL = ROLE_PERMISSIONS['admin'] as string[];
const admin = () => globalStaff(ALL);
const manager = (b: string) => scopedStaff(ROLE_PERMISSIONS['manager'] as string[], [b]);
const reader = (b: string) => scopedStaff(ROLE_PERMISSIONS['staff'] as string[], [b]);
const q = (over: Partial<ListAdminDeliveriesQuery> = {}): ListAdminDeliveriesQuery => over;

describe('DeliveriesQueriesService (S)', () => {
  let h: ReturnType<typeof deliveriesHarness>;
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    h = deliveriesHarness();
  });
  afterEach(() => vi.restoreAllMocks());

  const seed = (
    status: Parameters<typeof h.repo.seedDelivery>[0]['status'] = 'pending',
    over: { branchId?: string; riderId?: string | null; orderStatus?: string } = {},
  ) => {
    const o = h.repo.seedOrder({
      branchId: over.branchId ?? h.branchA,
      status: over.orderStatus ?? 'ready',
    });
    return h.repo.seedDelivery({ orderId: o.id, status, riderId: over.riderId ?? null });
  };
  const rider = (branchId = h.branchA) => h.riders.seed({ branchId, availability: 'AVAILABLE' });

  describe('R36 listado', () => {
    it('por defecto solo los ABIERTOS (sin ventana de fechas); terminales fuera', async () => {
      const r = rider();
      const old = seed('delivered', { riderId: r.id });
      old.createdAt = new Date('2025-01-01T00:00:00Z'); // muy antigua: sigue abierta, se muestra
      const open = [seed('pending'), seed('assigned', { riderId: rider().id }), old];
      seed('returned', { riderId: rider().id });
      seed('cancelled');
      const page = await h.queries.list(admin(), q());
      expect(page.items.map((i) => i.id).sort()).toEqual(open.map((d) => d.id).sort());
      expect(page.nextCursor).toBeNull();
      expect(page.generatedAt).toBe(NOW.toISOString());
    });

    it('`status` filtra (incl. delivered = esperando retorno); `from/to` solo acotan returned|cancelled', async () => {
      const recent = seed('cancelled');
      const stale = seed('cancelled');
      stale.createdAt = new Date(NOW.getTime() - 20 * 86_400_000); // fuera de la ventana por omisión (7 días)
      const waiting = seed('delivered', { riderId: rider().id });
      expect(
        (await h.queries.list(admin(), q({ status: ['delivered'] }))).items.map((i) => i.id),
      ).toEqual([waiting.id]);
      expect(
        (await h.queries.list(admin(), q({ status: ['cancelled'] }))).items.map((i) => i.id),
      ).toEqual([recent.id]);
      // un `from` explícito más antiguo incluye la antigua; un `to` anterior a la reciente la excluye
      const wide = await h.queries.list(
        admin(),
        q({
          status: ['cancelled'],
          from: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
        }),
      );
      expect(wide.items.map((i) => i.id).sort()).toEqual([recent.id, stale.id].sort());
      const bounded = await h.queries.list(
        admin(),
        q({
          status: ['cancelled'],
          from: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
          to: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
        }),
      );
      expect(bounded.items.map((i) => i.id)).toEqual([stale.id]);
      // los abiertos IGNORAN from/to
      const open = seed('pending');
      open.createdAt = new Date(NOW.getTime() - 40 * 86_400_000);
      const withRange = await h.queries.list(
        admin(),
        q({ status: ['pending'], from: new Date(NOW.getTime() - 1000).toISOString() }),
      );
      expect(withRange.items.map((i) => i.id)).toContain(open.id);
    });

    it.each([
      [{ from: '2026-11-18T10:00:00Z', to: '2026-11-18T09:00:00Z' }],
      [{ from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }],
      [{ from: '2026-01-01T00:00:00Z' }],
      [{ from: 'ayer' }],
    ])('rango inválido %j => 400', async (range) => {
      const e = info(await err(h.queries.list(admin(), q(range))));
      expect(e.status).toBe(400);
    });

    it('filtro riderId; riderId inexistente => lista vacía', async () => {
      const r = rider();
      const mine = seed('assigned', { riderId: r.id });
      seed('assigned', { riderId: rider().id });
      expect((await h.queries.list(admin(), q({ riderId: r.id }))).items.map((i) => i.id)).toEqual([
        mine.id,
      ]);
      expect(
        (await h.queries.list(admin(), q({ riderId: 'c0000000-0000-4000-8000-0000000000ee' })))
          .items,
      ).toEqual([]);
    });

    it('orden fijo created_at DESC, id DESC y paginación por cursor sin repetir ni saltar', async () => {
      const created = [seed(), seed(), seed(), seed(), seed()];
      const first = await h.queries.list(admin(), q({ limit: 2 }));
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await h.queries.list(
        admin(),
        q({ limit: 2, cursor: first.nextCursor as string }),
      );
      const third = await h.queries.list(
        admin(),
        q({ limit: 2, cursor: second.nextCursor as string }),
      );
      const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id);
      expect(ids).toEqual([...created].reverse().map((d) => d.id));
      expect(third.nextCursor).toBeNull();
      expect(third.items).toHaveLength(1);
    });

    it('cursor alterado => 400 DELIVERY_CURSOR_INVALID; cursor de OTRA consulta (otro estado) => 400', async () => {
      seed();
      seed();
      const page = await h.queries.list(admin(), q({ limit: 1 }));
      const cursor = page.nextCursor as string;
      expect(info(await err(h.queries.list(admin(), q({ cursor: `${cursor}x` })))).code).toBe(
        'DELIVERY_CURSOR_INVALID',
      );
      expect(info(await err(h.queries.list(admin(), q({ cursor: 'basura' })))).code).toBe(
        'DELIVERY_CURSOR_INVALID',
      );
      expect(
        info(await err(h.queries.list(admin(), q({ cursor, status: ['delivered'] })))).code,
      ).toBe('DELIVERY_CURSOR_INVALID');
    });

    it('un 22008 de la BD (cursor fuera de rango) => 400, nunca 500', async () => {
      h.repo.listFailWith = { meta: { code: '22008' } };
      expect(info(await err(h.queries.list(admin(), q()))).code).toBe('DELIVERY_CURSOR_INVALID');
    });

    it('R24 alcance: nunca filas ajenas; branchId ajeno => 404 BRANCH_NOT_FOUND; global con sucursal inexistente => 404', async () => {
      const mine = seed('pending');
      seed('pending', { branchId: h.branchB });
      const m = manager(h.branchA);
      expect((await h.queries.list(m, q())).items.map((i) => i.id)).toEqual([mine.id]);
      expect(info(await err(h.queries.list(m, q({ branchId: h.branchB })))).code).toBe(
        'BRANCH_NOT_FOUND',
      );
      expect((await h.queries.list(admin(), q({ branchId: h.branchB }))).items).toHaveLength(1);
      const ghost = 'c0000000-0000-4000-8000-0000000000ff';
      expect(info(await err(h.queries.list(admin(), q({ branchId: ghost })))).code).toBe(
        'BRANCH_NOT_FOUND',
      );
      // sucursal real pero sin entregas => página vacía (200), no 404
      const empty = h.repo.addBranch('Vacía');
      expect((await h.queries.list(admin(), q({ branchId: empty }))).items).toEqual([]);
      // alcance vacío => sin filas ni consulta
      const nobody = scopedStaff(['deliveries.read'], []);
      expect((await h.queries.list(nobody, q())).items).toEqual([]);
    });

    it('R25 el listado NO lleva teléfono ni dirección del cliente, ni placa/teléfono completo/sucursal del motorista', async () => {
      const r = rider();
      seed('assigned', { riderId: r.id });
      const page = await h.queries.list(admin(), q());
      const dump = JSON.stringify(page);
      for (const secret of [
        'CLIENTE-SECRETO',
        '+50255559999',
        'DIRECCION-SECRETA',
        'REFERENCIA-SECRETA',
        r.phone,
      ]) {
        expect(dump).not.toContain(secret);
      }
      expect(page.items[0]).not.toHaveProperty('customer');
      expect(page.items[0]).not.toHaveProperty('address');
      expect(page.items[0]).toMatchObject({
        municipalityName: 'Guatemala',
        zone: 'Zona 10',
        riderOccupied: true,
        rider: { id: r.id, fullName: r.fullName },
      });
      expect(page.items[0]?.rider).not.toHaveProperty('licensePlate');
      expect(page.items[0]?.rider).not.toHaveProperty('branchId');
    });

    it('availableActions por personal y sucursal de la entrega (staff solo lee: NO_PERMISSION)', async () => {
      seed('assigned', { riderId: rider().id, orderStatus: 'preparing' });
      const full = (await h.queries.list(admin(), q())).items[0]?.availableActions;
      expect(full?.find((a) => a.action === 'mark_picked_up')).toEqual({
        action: 'mark_picked_up',
        enabled: false,
        disabledReason: 'ORDER_NOT_READY',
      });
      const ro = (await h.queries.list(reader(h.branchA), q())).items[0]?.availableActions;
      expect(ro?.every((a) => !a.enabled && a.disabledReason === 'NO_PERMISSION')).toBe(true);
    });
  });

  describe('R25 detalle', () => {
    it('abierta + orders.read => contacto, dirección, pedido e historial cronológico', async () => {
      const r = rider();
      const d = seed('assigned', { riderId: r.id });
      h.repo.staffNames.set('66666666-6666-4666-8666-666666666666', 'Marta');
      h.repo.history.at(-1)!.changedBy = '66666666-6666-4666-8666-666666666666';
      const res = await h.queries.detail(admin(), d.id);
      expect(res.contactVisible).toBe(true);
      expect(res.customer).toEqual({ name: 'CLIENTE-SECRETO', phone: '+50255559999' });
      expect(res.address).toEqual({
        municipalityName: 'Guatemala',
        zone: 'Zona 10',
        addressLine: 'DIRECCION-SECRETA 5a Av 10-10',
        referenceNote: 'REFERENCIA-SECRETA',
      });
      expect(res.order).toMatchObject({ id: d.orderId, status: 'ready', deliveryProvider: 'OWN' });
      expect(res.history.map((e) => e.event)).toEqual(['created', 'rider_assigned']);
      expect(res.history[1]).toMatchObject({
        riderId: r.id,
        riderName: r.fullName,
        actorName: 'Marta',
      });
      expect(res.historyTruncated).toBe(false);
      const dump = JSON.stringify(res);
      expect(dump).not.toContain(r.phone);
      expect(res.rider?.phoneMasked).toMatch(/\*{4}/);
    });

    it('sin orders.read => contactVisible=false y customer/address null', async () => {
      const d = seed('pending');
      const noOrders = scopedStaff(['deliveries.read'], [h.branchA]);
      const res = await h.queries.detail(noOrders, d.id);
      expect(res).toMatchObject({ contactVisible: false, customer: null, address: null });
      expect(JSON.stringify(res)).not.toContain('SECRETO');
    });

    it.each(['delivered', 'returned', 'cancelled'] as const)(
      '%s => contactVisible=false aunque tenga orders.read (S7: solo pending|assigned|picked_up)',
      async (status) => {
        const d = seed(status, { riderId: status === 'cancelled' ? null : rider().id });
        const res = await h.queries.detail(admin(), d.id);
        expect(res).toMatchObject({ contactVisible: false, customer: null, address: null });
        expect(JSON.stringify(res)).not.toContain('SECRETO');
      },
    );

    it('S1/S8: `reason` y `actorName` del historial solo con deliveries.update en la sucursal de la entrega (si no, null)', async () => {
      const d = seed('pending');
      const actor = '66666666-6666-4666-8666-666666666666';
      h.repo.staffNames.set(actor, 'Marta');
      const last = h.repo.history.at(-1)!;
      last.changedBy = actor;
      last.reason = 'cliente ausente dos veces';
      const full = await h.queries.detail(admin(), d.id);
      expect(full.history.at(-1)).toMatchObject({
        reason: 'cliente ausente dos veces',
        actorName: 'Marta',
      });
      // solo lectura (staff) o `deliveries.update` en OTRA sucursal: ni motivo ni nombre
      const readOnly = reader(h.branchA);
      const mixed = scopedStaff(['deliveries.read'], [h.branchA]);
      mixed.grants['deliveries.update'] = { allBranches: false, branchIds: [h.branchB] };
      for (const staff of [readOnly, mixed]) {
        const res = await h.queries.detail(staff, d.id);
        expect(res.history.every((e) => e.reason === null && e.actorName === null)).toBe(true);
        const dump = JSON.stringify(res);
        expect(dump).not.toContain('cliente ausente');
        expect(dump).not.toContain('Marta');
      }
      const withUpdate = await h.queries.detail(manager(h.branchA), d.id);
      expect(withUpdate.history.at(-1)).toMatchObject({ reason: 'cliente ausente dos veces' });
    });

    it('orders.read solo en OTRA sucursal => sin contacto', async () => {
      const d = seed('pending');
      const mixed = scopedStaff(['deliveries.read'], [h.branchA]);
      mixed.grants['orders.read'] = { allBranches: false, branchIds: [h.branchB] };
      expect((await h.queries.detail(mixed, d.id)).contactVisible).toBe(false);
    });

    it('historial truncado a 50 eventos, cronológico', async () => {
      const d = seed('pending');
      for (let i = 0; i < 60; i += 1) {
        h.repo.history.push({
          deliveryId: d.id,
          oldStatus: 'pending',
          status: 'pending',
          event: 'rider_unassigned',
          riderId: null,
          reason: `r${i}`,
          changedBy: null,
          changedAt: new Date(NOW.getTime() + i * 1000),
        });
      }
      const res = await h.queries.detail(admin(), d.id);
      expect(res.history).toHaveLength(50);
      expect(res.historyTruncated).toBe(true);
      expect(res.history.at(-1)?.reason).toBe('r59');
    });

    it('R24 entrega ajena o inexistente => el MISMO 404 DELIVERY_NOT_FOUND', async () => {
      const theirs = seed('pending', { branchId: h.branchB });
      const a = info(await err(h.queries.detail(manager(h.branchA), theirs.id)));
      const b = info(
        await err(h.queries.detail(manager(h.branchA), 'c0000000-0000-4000-8000-0000000000ab')),
      );
      expect([a.status, a.code]).toEqual([404, 'DELIVERY_NOT_FOUND']);
      expect(a.raw).toBe(b.raw);
    });
  });
});
