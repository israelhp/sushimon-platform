import { CategoriesRepository } from './categories.repository.js';
import type { PrismaService } from '../database/prisma.service.js';

describe('CategoriesRepository (transacción de escritura)', () => {
  it('abre la transacción con timeout 15 s y maxWait 5 s', async () => {
    const $transaction = vi.fn((fn: (t: unknown) => unknown) => fn({}));
    const repo = new CategoriesRepository({ $transaction } as unknown as PrismaService);
    await repo.transaction(() => Promise.resolve('ok'));
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15_000,
      maxWait: 5_000,
    });
  });

  it('lockHierarchy: SET LOCAL lock_timeout ANTES del advisory lock 1100110', async () => {
    const sql: string[] = [];
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray) => {
        sql.push(strings.join('?'));
        return Promise.resolve(0);
      }),
    };
    const repo = new CategoriesRepository({} as PrismaService);
    await repo.lockHierarchy(tx as never);
    expect(sql).toEqual(["SET LOCAL lock_timeout = '3s'", 'SELECT pg_advisory_xact_lock(1100110)']);
  });
});
