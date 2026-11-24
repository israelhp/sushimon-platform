import type { PrismaService } from '../../database/prisma.service.js';
import { RiderActiveDeliveriesAdapter } from './rider-active-deliveries.adapter.js';
import { NoActiveDeliveriesAdapter } from './rider-active-deliveries.port.js';

type Sqlish = { sql?: string; strings?: readonly string[]; values?: unknown[] };
const textOf = (arg: unknown): string => {
  const s = arg as Sqlish;
  return (s.sql ?? s.strings?.join('?') ?? '').replace(/\s+/g, ' ');
};
const R1 = 'c0000000-0000-4000-8000-000000000001';
const R2 = 'c0000000-0000-4000-8000-000000000002';
const B1 = 'b0000000-0000-4000-8000-000000000001';

function make(rows: { rider_id: string }[] = []) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const $queryRaw = vi.fn((arg: unknown) => {
    queries.push({ sql: textOf(arg), values: (arg as Sqlish).values ?? [] });
    return Promise.resolve(rows);
  });
  const adapter = new RiderActiveDeliveriesAdapter({ $queryRaw } as unknown as PrismaService);
  return { adapter, queries, $queryRaw };
}

describe('RiderActiveDeliveriesAdapter (F28, R27/R28)', () => {
  it('R27 es `known = true` (el adaptador «sin entregas» siempre es known = false)', async () => {
    const { adapter } = make([]);
    expect((await adapter.findBusy({ riderIds: [R1] })).known).toBe(true);
    expect((await adapter.findBusy({ branchIds: null })).known).toBe(true);
    expect((await new NoActiveDeliveriesAdapter().findBusy()).known).toBe(false);
  });

  it('por riderIds: UNA sentencia sobre app.deliveries con assigned|picked_up|delivered y ids parametrizados', async () => {
    const { adapter, queries } = make([{ rider_id: R1 }]);
    const res = await adapter.findBusy({ riderIds: [R1, R2, R1] });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('FROM app.deliveries');
    expect(queries[0]?.sql).toContain("status IN ('assigned', 'picked_up', 'delivered')");
    expect(queries[0]?.sql).toContain('rider_id = ANY(');
    expect(queries[0]?.sql).not.toContain(R1);
    expect(queries[0]?.values).toEqual([[R1, R2]]);
    expect([...res.busyIds]).toEqual([R1]);
  });

  it('pending, returned y cancelled NO cuentan: la consulta solo pide los tres estados que ocupan', async () => {
    const { queries, adapter } = make([]);
    await adapter.findBusy({ riderIds: [R1] });
    for (const status of ['pending', 'returned', 'cancelled']) {
      expect(queries[0]?.sql).not.toContain(`'${status}'`);
    }
  });

  it('por branchIds: filtra por branch_id; null = todas; lista vacía = nadie (sin sentencia)', async () => {
    const a = make([{ rider_id: R2 }]);
    expect([...(await a.adapter.findBusy({ branchIds: [B1] })).busyIds]).toEqual([R2]);
    expect(a.queries[0]?.sql).toContain('branch_id = ANY(');
    expect(a.queries[0]?.values).toEqual([[B1]]);
    const all = make([]);
    await all.adapter.findBusy({ branchIds: null });
    expect(all.queries[0]?.sql).not.toContain('branch_id');
    const none = make([]);
    expect((await none.adapter.findBusy({ branchIds: [] })).busyIds.size).toBe(0);
    expect(none.$queryRaw).not.toHaveBeenCalled();
  });

  it('un id que no es UUID jamás está ocupado y NO llega al SQL (evita un 500 por ::uuid)', async () => {
    const { adapter, $queryRaw } = make([]);
    expect((await adapter.findBusy({ riderIds: ['no-uuid', ''] })).busyIds.size).toBe(0);
    expect((await adapter.findBusy({ riderIds: [] })).busyIds.size).toBe(0);
    expect((await adapter.findBusy({ branchIds: ['x'] })).busyIds.size).toBe(0);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('con `tx` usa el cliente de la transacción, no el del servicio', async () => {
    const { adapter, $queryRaw } = make([]);
    const txQuery = vi.fn(() => Promise.resolve([{ rider_id: R1 }]));
    const res = await adapter.findBusy({ riderIds: [R1] }, { $queryRaw: txQuery } as never);
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect($queryRaw).not.toHaveBeenCalled();
    expect(res.busyIds.has(R1)).toBe(true);
  });
});
