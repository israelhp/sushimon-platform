import { DbGate } from '../../common/concurrency/db-gate.js';
import {
  adminOrdersHarness,
  BRANCH_A,
  BRANCH_B,
  NOW,
} from '../../../test/support/admin-orders-harness.js';
import { orderId } from '../../../test/support/fake-admin-orders-repo.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from '../../../test/support/staff-context.js';
import { ordersBusy } from '../orders-errors.js';
import { decodeCursor, encodeCursor } from './admin-orders-cursor.js';

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const body = (e: unknown) => (e as { getResponse: () => { code?: string } }).getResponse();
const status = (e: unknown) => (e as { getStatus: () => number }).getStatus();
const MANAGER = ROLE_PERMISSIONS['manager'] as string[];
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const BRANCH_GHOST = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('AdminOrdersQueryService (S)', () => {
  it('fila 5: alcance de lectura — el manager de A no lista, ve ni cuenta pedidos de B; admin global ve todo', async () => {
    const { repo, queries } = adminOrdersHarness();
    const a = repo.seed({ branchId: BRANCH_A, placedAt: hoursAgo(1) });
    const b = repo.seed({ branchId: BRANCH_B, placedAt: hoursAgo(1) });
    const mgr = scopedStaff(MANAGER, [BRANCH_A]);
    expect((await queries.list(mgr, {})).items.map((i) => i.id)).toEqual([a]);
    const board = await queries.board(mgr, {});
    expect(board.summary.pending).toBe(1);
    expect(board.columns[0]?.items.map((i) => i.id)).toEqual([a]);
    expect(board.columns[0]?.count).toBe(1);
    const all = await queries.list(globalStaff(MANAGER), {});
    expect(all.items.map((i) => i.id).sort()).toEqual([a, b].sort());
    // detalle: ajeno e inexistente => el mismo 404
    const foreign = await err(queries.detail(mgr, b));
    const missing = await err(queries.detail(mgr, orderId(999)));
    expect(status(foreign)).toBe(404);
    expect(body(foreign)).toEqual(body(missing));
    expect(body(foreign).code).toBe('ORDER_NOT_FOUND');
  });

  it('un alcance vacío devuelve vacío (nunca «todo»)', async () => {
    const { repo, queries } = adminOrdersHarness();
    repo.seed({ branchId: BRANCH_A });
    const none = scopedStaff(['orders.read'], []);
    expect((await queries.list(none, {})).items).toEqual([]);
    expect((await queries.board(none, {})).summary).toEqual({
      pending: 0,
      active: 0,
      oldestPendingAt: null,
    });
  });

  it('fila 6: branchId ajeno o inexistente => 404 BRANCH_NOT_FOUND (listado y tablero)', async () => {
    const { repo, queries } = adminOrdersHarness();
    repo.seed({ branchId: BRANCH_A });
    repo.seed({ branchId: BRANCH_B });
    const mgr = scopedStaff(MANAGER, [BRANCH_A]);
    for (const q of [{ branchId: BRANCH_B }, { branchId: BRANCH_GHOST }]) {
      expect(body(await err(queries.list(mgr, q))).code).toBe('BRANCH_NOT_FOUND');
      expect(body(await err(queries.board(mgr, q))).code).toBe('BRANCH_NOT_FOUND');
    }
    // alcance global: inexistente => 404; existente => ok
    const admin = globalStaff(MANAGER);
    expect(body(await err(queries.list(admin, { branchId: BRANCH_GHOST }))).code).toBe(
      'BRANCH_NOT_FOUND',
    );
    expect((await queries.list(admin, { branchId: BRANCH_B })).items).toHaveLength(1);
  });

  describe('fila 26: filtros', () => {
    it('status (csv), fulfillmentType, q por número y por nombre, from/to', async () => {
      const { repo, queries } = adminOrdersHarness();
      const p = repo.seed({ branchId: BRANCH_A, customerName: 'Ana Pérez', placedAt: hoursAgo(1) });
      const d = repo.seed({
        branchId: BRANCH_A,
        customerName: 'Luis_100%',
        status: 'accepted',
        fulfillmentType: 'DELIVERY',
        placedAt: hoursAgo(2),
      });
      const old = repo.seed({
        branchId: BRANCH_A,
        placedAt: new Date(NOW.getTime() - 20 * 86_400_000),
      });
      const staff = globalStaff(MANAGER);
      const ids = async (q: object) => (await queries.list(staff, q)).items.map((i) => i.id);
      expect(await ids({})).toEqual([p, d]); // ventana por defecto de 7 días
      expect(await ids({ status: ['accepted'] })).toEqual([d]);
      expect(await ids({ fulfillmentType: 'PICKUP' })).toEqual([p]);
      expect(await ids({ q: 'ana' })).toEqual([p]);
      expect(await ids({ q: '100%' })).toEqual([d]); // comodín literal
      expect(await ids({ q: '%' })).toEqual([d]);
      expect(await ids({ q: 'zzzz' })).toEqual([]);
      const num = repo.orders.get(p)?.orderNumber as bigint;
      expect(await ids({ q: String(num) })).toEqual([p]);
      expect(await ids({ q: `MON-${String(num).padStart(6, '0')}` })).toEqual([p]);
      expect(await ids({ from: hoursAgo(24 * 30).toISOString() })).toEqual([p, d, old]);
      expect(
        await ids({ from: hoursAgo(3).toISOString(), to: hoursAgo(1.5).toISOString() }),
      ).toEqual([d]);
    });

    it('fechas sin zona, rango > 92 días, to <= from => 400', async () => {
      const { queries } = adminOrdersHarness();
      const staff = globalStaff(MANAGER);
      const bad = (q: object) => err(queries.list(staff, q)).then(status);
      expect(await bad({ from: '2026-11-01T00:00:00' })).toBe(400);
      expect(await bad({ from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' })).toBe(400);
      expect(await bad({ from: '2026-11-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toBe(400);
      expect(await bad({ from: '2025-01-01T00:00:00Z' })).toBe(400); // sin `to`: hasta ahora
    });
  });

  describe('fila 27: keyset', () => {
    it('sin duplicados ni saltos aunque lleguen pedidos nuevos entre páginas; nextCursor null en la última', async () => {
      const { repo, queries } = adminOrdersHarness();
      const created = Array.from({ length: 5 }, (_, i) =>
        repo.seed({ branchId: BRANCH_A, placedAt: hoursAgo(10 - i) }),
      );
      const staff = globalStaff(MANAGER);
      const p1 = await queries.list(staff, { limit: 2 });
      expect(p1.items.map((i) => i.id)).toEqual([created[4], created[3]]);
      expect(p1.nextCursor).not.toBeNull();
      const fresh = repo.seed({ branchId: BRANCH_A, placedAt: hoursAgo(0.5) }); // llega entre páginas
      const p2 = await queries.list(staff, { limit: 2, cursor: p1.nextCursor as string });
      expect(p2.items.map((i) => i.id)).toEqual([created[2], created[1]]);
      const p3 = await queries.list(staff, { limit: 2, cursor: p2.nextCursor as string });
      expect(p3.items.map((i) => i.id)).toEqual([created[0]]);
      expect(p3.nextCursor).toBeNull();
      const seen = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
      expect(new Set(seen).size).toBe(5);
      expect(seen).not.toContain(fresh);
    });

    it('cursor alterado => 400 ORDER_CURSOR_INVALID; un cursor ajeno no revela pedidos fuera del alcance', async () => {
      const { repo, queries } = adminOrdersHarness();
      repo.seed({ branchId: BRANCH_B, placedAt: hoursAgo(5) });
      const mgr = scopedStaff(MANAGER, [BRANCH_A]);
      for (const bad of [
        '!!!',
        'AAAA',
        Buffer.from('v1|x|y').toString('base64url'),
        Buffer.from('v2|2026-11-18T10:00:00.000000Z|' + orderId(1)).toString('base64url'),
      ]) {
        const e = await err(queries.list(mgr, { cursor: bad }));
        expect(status(e)).toBe(400);
        expect(body(e).code).toBe('ORDER_CURSOR_INVALID');
      }
      const foreign = encodeCursor({ placedAtKey: '2026-11-18T23:00:00.000000Z', id: orderId(7) });
      expect((await queries.list(mgr, { cursor: foreign })).items).toEqual([]);
      expect(decodeCursor(foreign)).toEqual({
        placedAtKey: '2026-11-18T23:00:00.000000Z',
        id: orderId(7),
      });
    });
  });

  it('cursor con fecha inexistente o fuera de rango => 400; un 22007/22008 de la BD => 400, nunca 500', async () => {
    const { repo, queries } = adminOrdersHarness();
    const staff = globalStaff(MANAGER);
    const enc = (key: string) => Buffer.from(`v1|${key}|${orderId(1)}`).toString('base64url');
    for (const key of [
      '2023-02-31T10:00:00.000000Z',
      '0000-01-01T00:00:00.000000Z',
      '1999-12-31T23:59:59.000000Z',
      '2027-11-20T10:00:00.000000Z', // > ahora + 1 día (ahora = 2026-11-18)
      '2026-13-01T10:00:00.000000Z',
    ]) {
      const e = await err(queries.list(staff, { cursor: enc(key) }));
      expect([status(e), body(e).code], key).toEqual([400, 'ORDER_CURSOR_INVALID']);
    }
    expect(
      (await queries.list(staff, { cursor: enc('2026-11-18T10:00:00.123456Z') })).items,
    ).toEqual([]);
    for (const code of ['22007', '22008']) {
      repo.listFailWith = { code };
      const e = await err(queries.list(staff, {}));
      expect([status(e), body(e).code]).toEqual([400, 'ORDER_CURSOR_INVALID']);
    }
  });

  it('fila 28: tablero — 9 columnas en orden, count real > tarjetas con hasMore, activas antiguas visibles, terminales < 24 h', async () => {
    const { repo, queries } = adminOrdersHarness();
    const oldPending = repo.seed({
      branchId: BRANCH_A,
      placedAt: new Date(NOW.getTime() - 40 * 86_400_000),
    });
    for (let i = 0; i < 4; i += 1) repo.seed({ branchId: BRANCH_A, placedAt: hoursAgo(1 + i) });
    repo.seed({ branchId: BRANCH_A, status: 'cancelled', placedAt: hoursAgo(2) });
    repo.seed({ branchId: BRANCH_A, status: 'cancelled', placedAt: hoursAgo(30) });
    for (let i = 0; i < 12; i += 1)
      repo.seed({ branchId: BRANCH_A, status: 'picked_up', placedAt: hoursAgo(1 + i / 10) });
    const board = await queries.board(globalStaff(MANAGER), { limit: 3 });
    expect(board.columns.map((c) => c.status)).toEqual([
      'pending',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'delivered',
      'picked_up',
      'rejected',
      'cancelled',
    ]);
    const pending = board.columns[0];
    expect(pending?.count).toBe(5);
    expect(pending?.items).toHaveLength(3);
    expect(pending?.hasMore).toBe(true);
    expect(pending?.items[0]?.id).toBe(oldPending); // la más antigua primero
    expect(board.summary).toMatchObject({
      pending: 5,
      active: 5,
      oldestPendingAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
    });
    const pickedUp = board.columns[6];
    expect(pickedUp?.count).toBe(12);
    expect(pickedUp?.items).toHaveLength(10);
    expect(pickedUp?.hasMore).toBe(true);
    expect(board.columns[8]?.count).toBe(1); // la cancelada de hace 30 h queda fuera
    expect(board).toMatchObject({
      branchId: null,
      terminalWindowHours: 24,
      pollAfterSeconds: 15,
      generatedAt: NOW.toISOString(),
    });
  });

  it('fila 30: detalle — snapshots, teléfono completo, sin correo, payment NOT_STARTED, historial con actor y truncamiento', async () => {
    const { repo, queries } = adminOrdersHarness();
    const id = repo.seed({
      branchId: BRANCH_A,
      fulfillmentType: 'DELIVERY',
      paymentMethodPreference: 'cash',
      customerPhone: '+50255551234',
      notes: 'sin wasabi',
    });
    const staffId = '99999999-9999-4999-8999-999999999999';
    repo.staffNames.set(staffId, 'Ana Admin');
    repo.history.push({
      orderId: id,
      oldStatus: 'pending',
      newStatus: 'accepted',
      changedBy: staffId,
      reason: null,
      changedAt: new Date(NOW.getTime() + 1),
    });
    const d = await queries.detail(globalStaff(MANAGER), id);
    expect(d.contact).toEqual({ fullName: 'Ana Pérez', phone: '+50255551234' });
    expect(d.payment).toEqual({ methodPreference: 'cash', status: 'NOT_STARTED' });
    expect(d.address).toMatchObject({ municipalityName: 'Guatemala' });
    expect(d.lines[0]).toMatchObject({
      productName: 'Roll Mon',
      modifiers: [{ name: 'Extra aguacate', extraPrice: '5.00' }],
    });
    expect(d.history.map((h) => [h.seq, h.status, h.previousStatus, h.actorName])).toEqual([
      [1, 'pending', null, null],
      [2, 'accepted', 'pending', 'Ana Admin'],
    ]);
    expect(d.historyTruncated).toBe(false);
    expect(JSON.stringify(d)).not.toMatch(/email|changedBy|changed_by/i);
    for (let i = 0; i < 60; i += 1)
      repo.history.push({
        orderId: id,
        oldStatus: 'x',
        newStatus: 'pending',
        changedBy: null,
        reason: null,
        changedAt: new Date(NOW.getTime() + 10 + i),
      });
    const t = await queries.detail(globalStaff(MANAGER), id);
    expect(t.history).toHaveLength(50);
    expect(t.historyTruncated).toBe(true);
  });

  it('availableActions por fila se calculan con los permisos EN LA SUCURSAL del pedido', async () => {
    const { repo, queries } = adminOrdersHarness();
    const a = repo.seed({ branchId: BRANCH_A });
    const kitchen = scopedStaff(ROLE_PERMISSIONS['kitchen'] as string[], [BRANCH_A]);
    const list = await queries.list(kitchen, {});
    expect(list.items.find((i) => i.id === a)?.availableActions).toEqual([
      { action: 'accept', enabled: true, disabledReason: null },
      { action: 'reject', enabled: true, disabledReason: null },
      { action: 'cancel', enabled: false, disabledReason: 'NO_PERMISSION' },
    ]);
  });

  it('fila 34: lecturas con rejectIfWaiting 2 (503 con 2 esperas en cola)', async () => {
    const gate = new DbGate(1, 8, 5_000, ordersBusy);
    const { repo, queries } = adminOrdersHarness({ gate });
    repo.seed({ branchId: BRANCH_A });
    let free!: () => void;
    const hold = gate.run(() => new Promise<void>((resolve) => (free = resolve)));
    const queued = [gate.run(() => Promise.resolve()), gate.run(() => Promise.resolve())];
    const e = await err(queries.list(globalStaff(MANAGER), {}));
    expect(status(e)).toBe(503);
    expect(body(e).code).toBe('ORDERS_BUSY');
    free();
    await hold;
    await Promise.all(queued);
  });
});
