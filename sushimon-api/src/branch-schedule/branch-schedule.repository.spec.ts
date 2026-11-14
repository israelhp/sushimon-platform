import type { PrismaService } from '../database/prisma.service.js';
import { BranchScheduleRepository, type ScheduleTx } from './branch-schedule.repository.js';

const A = '11111111-1111-4111-8111-111111111111';

describe('BranchScheduleRepository (SQL y parámetros)', () => {
  it('lockBranch: lock_timeout local y FOR NO KEY UPDATE (no FOR UPDATE)', async () => {
    const queryRaw = vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve([{ id: A, active: true, sql: strings.join('?') }]),
    );
    const executeRawUnsafe = vi.fn().mockResolvedValue(0);
    const tx = {
      $queryRaw: queryRaw,
      $executeRawUnsafe: executeRawUnsafe,
    } as unknown as ScheduleTx;
    const repo = new BranchScheduleRepository({} as PrismaService);
    await expect(repo.lockBranch(tx, A)).resolves.toMatchObject({ id: A });
    expect(executeRawUnsafe).toHaveBeenCalledWith("SET LOCAL lock_timeout = '2s'");
    const sql = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FOR NO KEY UPDATE');
    expect(sql).not.toMatch(/FOR UPDATE/);
    expect(executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[0] as number,
    );
  });

  it('transaction: maxWait y timeout cortos', async () => {
    const $transaction = vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn({})));
    const repo = new BranchScheduleRepository({ $transaction } as unknown as PrismaService);
    await repo.transaction(() => Promise.resolve(1));
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2000,
      timeout: 8000,
    });
  });

  it('loadSchedule: UNA consulta para N sucursales (ANY), convierte horas 24:00 y cierres bigint; vacío no consulta', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: A,
        active: true,
        hours: [{ weekday: 5, opensAt: '11:00:00', closesAt: '24:00:00' }],
        closures: [{ startsAt: '1795000000000', endsAt: 1795003600000 }],
      },
    ]);
    const repo = new BranchScheduleRepository({ $queryRaw: queryRaw } as unknown as PrismaService);
    const out = await repo.loadSchedule(
      [A, A],
      new Date('2026-11-16T18:00:00Z'),
      new Date('2026-11-30T18:00:00Z'),
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/ANY\(\?::uuid\[\]\)/);
    expect(sql).toContain('b.active');
    expect(out).toEqual([
      {
        branchId: A,
        active: true,
        hours: [{ weekday: 5, opensAt: '11:00', closesAt: '24:00' }],
        closures: [{ startsAt: 1795000000000, endsAt: 1795003600000 }],
      },
    ]);
    expect(await repo.loadSchedule([], new Date(), new Date())).toEqual([]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('loadSchedule con tx usa el cliente de la transacción, no el del pool', async () => {
    const pool = vi.fn().mockResolvedValue([]);
    const inTx = vi.fn().mockResolvedValue([]);
    const repo = new BranchScheduleRepository({ $queryRaw: pool } as unknown as PrismaService);
    await repo.loadSchedule([A], new Date(), new Date(), {
      tx: { $queryRaw: inTx } as unknown as ScheduleTx,
    });
    expect(inTx).toHaveBeenCalledTimes(1);
    expect(pool).not.toHaveBeenCalled();
  });

  it('listClosures: lecturas en paralelo sin $transaction; orden por inicio con desempate por id', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const $transaction = vi.fn();
    const repo = new BranchScheduleRepository({
      branchClosure: { findMany, count },
      $transaction,
    } as unknown as PrismaService);
    await repo.listClosures({ branchId: A, status: 'all', now: 0, page: 2, pageSize: 20 });
    expect($transaction).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
        skip: 20,
        take: 20,
      }),
    );
    expect(count).toHaveBeenCalledTimes(1);
  });
});
