import { DbGate } from '../../common/concurrency/db-gate.js';
import type { Principal } from '../../auth/auth.types.js';
import type { Clock } from '../../branch-schedule/clock.js';
import { decodeCursor, encodeCursor } from '../order-cursor.js';
import { ordersBusy } from '../orders-errors.js';
import type { ListMyOrdersQuery } from './dto/my-orders.dto.js';
import type { MyOrdersRepository } from './my-orders.repository.js';
import { MyOrdersService } from './my-orders.service.js';
import type { MyOrderRow, MyOrdersFilter } from './my-orders.types.js';

const NOW = new Date('2026-11-19T15:00:00.000Z');
const USER = '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11';
const principal = { authUserId: USER } as Principal;
const clock: Clock = { now: () => NOW };

const mkRow = (n: number, over: Partial<MyOrderRow> = {}): MyOrderRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  orderNumber: BigInt(1000 + n),
  status: 'pending',
  branchId: '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b',
  branchName: 'Zona 10',
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  total: '10.00',
  paymentMethodPreference: null,
  placedAt: new Date(NOW.getTime() - n * 60_000),
  updatedAt: NOW,
  itemCount: 1,
  placedAtKey: new Date(NOW.getTime() - n * 60_000).toISOString().replace('Z', '000Z'),
  ...over,
});

function setup(rows: MyOrderRow[] = [], gate = new DbGate(4, 8, 1_500, ordersBusy)) {
  const calls: MyOrdersFilter[] = [];
  const repo = {
    list: (f: MyOrdersFilter) => {
      calls.push(f);
      return Promise.resolve(rows.slice(0, f.limit + 1));
    },
  } as unknown as MyOrdersRepository;
  return { service: new MyOrdersService(repo, clock, gate), calls, gate };
}
const q = (over: Partial<ListMyOrdersQuery> = {}): ListMyOrdersQuery => over;
const code = async (p: Promise<unknown>) => {
  const e = (await p.then(
    () => null,
    (err: unknown) => err,
  )) as { status?: number; response?: { code?: string } } | null;
  return e ? { status: e.status, code: e.response?.code } : null;
};

describe('MyOrdersService.list (F23, spec 024 §4.1 y §6)', () => {
  it('propietario SOLO del sub del JWT; defecto limit 20; sin filtros => todo el historial', async () => {
    const { service, calls } = setup();
    const page = await service.list(principal, q());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      authUserId: USER,
      status: null,
      branchId: null,
      from: null,
      to: null,
      cursor: null,
      limit: 20,
    });
    expect(page).toEqual({ items: [], nextCursor: null, generatedAt: NOW.toISOString() });
  });

  it('limit+1: con más filas que el límite entrega `limit` ítems y un cursor que decodifica al último', async () => {
    const rows = [mkRow(1), mkRow(2), mkRow(3)];
    const { service } = setup(rows);
    const page = await service.list(principal, q({ limit: 2 }));
    expect(page.items.map((i) => i.orderNumber)).toEqual([1001, 1002]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor as string, NOW)).toEqual({
      placedAtKey: (rows[1] as MyOrderRow).placedAtKey,
      id: (rows[1] as MyOrderRow).id,
    });
  });

  it('última página: nextCursor null', async () => {
    const { service } = setup([mkRow(1), mkRow(2)]);
    expect((await service.list(principal, q({ limit: 2 }))).nextCursor).toBeNull();
  });

  it('pasa filtros de estado, sucursal y rango, y decodifica el cursor', async () => {
    const { service, calls } = setup();
    const cursor = encodeCursor({
      placedAtKey: '2026-11-18T10:00:00.123456Z',
      id: '7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c',
    });
    await service.list(
      principal,
      q({
        status: ['pending', 'accepted'],
        branchId: '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b',
        from: '2026-01-01T00:00:00Z',
        to: '2026-06-01T00:00:00Z',
        cursor,
        limit: 5,
      }),
    );
    expect(calls[0]).toMatchObject({
      status: ['pending', 'accepted'],
      branchId: '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-06-01T00:00:00Z'),
      cursor: { placedAtKey: '2026-11-18T10:00:00.123456Z' },
      limit: 5,
    });
  });

  it.each([
    ['to <= from', { from: '2026-06-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }],
    ['to < from', { from: '2026-06-02T00:00:00Z', to: '2026-06-01T00:00:00Z' }],
    ['rango > 366 días', { from: '2025-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }],
    ['fecha sin zona', { from: '2026-06-01T00:00:00' }],
  ])('%s => 400 y NO toca la BD', async (_n, query) => {
    const { service, calls } = setup();
    expect(await code(service.list(principal, q(query)))).toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  it('un rango de exactamente 366 días es válido; solo `from` o solo `to` no limitan', async () => {
    const { service } = setup();
    await service.list(principal, q({ from: '2025-11-18T00:00:00Z', to: '2026-11-19T00:00:00Z' }));
    await service.list(principal, q({ from: '2001-01-01T00:00:00Z' }));
    await service.list(principal, q({ to: '2030-01-01T00:00:00Z' }));
  });

  it('cursor inválido => 400 ORDER_CURSOR_INVALID sin tocar la BD', async () => {
    const { service, calls } = setup();
    expect(await code(service.list(principal, q({ cursor: 'zzz' })))).toEqual({
      status: 400,
      code: 'ORDER_CURSOR_INVALID',
    });
    expect(calls).toHaveLength(0);
  });

  it.each(['22007', '22008'])(
    'SQLSTATE %s de la BD con cursor => 400 ORDER_CURSOR_INVALID, nunca 500',
    async (sqlstate) => {
      const repo = {
        list: () => Promise.reject(Object.assign(new Error('fecha'), { code: sqlstate })),
      } as unknown as MyOrdersRepository;
      const service = new MyOrdersService(repo, clock, new DbGate(2, 4, 500, ordersBusy));
      const cursor = encodeCursor({
        placedAtKey: '2026-11-18T10:00:00.000000Z',
        id: '7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c',
      });
      expect(await code(service.list(principal, q({ cursor })))).toEqual({
        status: 400,
        code: 'ORDER_CURSOR_INVALID',
      });
    },
  );

  it('fallo reintentable de la BD => 503 ORDERS_BUSY (gate libera el cupo)', async () => {
    const gate = new DbGate(2, 4, 500, ordersBusy);
    const repo = {
      list: () => Promise.reject(Object.assign(new Error('pool'), { code: 'P2024' })),
    } as unknown as MyOrdersRepository;
    const service = new MyOrdersService(repo, clock, gate);
    expect(await code(service.list(principal, q()))).toEqual({ status: 503, code: 'ORDERS_BUSY' });
    expect(gate.inFlight).toBe(0);
  });

  it('gate saturado con 2 esperas => 503 ORDERS_BUSY al instante (rejectIfWaiting: 2)', async () => {
    const gate = new DbGate(1, 8, 5_000, ordersBusy);
    let release: () => void = () => undefined;
    const hold = gate.run(() => new Promise<void>((r) => (release = r)));
    const waiting = [gate.run(() => Promise.resolve()), gate.run(() => Promise.resolve())];
    const { service } = setup([], gate);
    expect(await code(service.list(principal, q()))).toEqual({ status: 503, code: 'ORDERS_BUSY' });
    release();
    await Promise.all([hold, ...waiting]);
    expect(gate.inFlight).toBe(0);
  });
});
