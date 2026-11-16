import type { PrismaService } from '../database/prisma.service.js';
import { ModifiersRepository } from './modifiers.repository.js';

describe('ModifiersRepository.transaction', () => {
  it('timeout 15 s, maxWait 5 s y READ COMMITTED explícito; lock_timeout local antes de la función', async () => {
    const sql: string[] = [];
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray) => {
        sql.push(strings.join('?'));
        return Promise.resolve(0);
      }),
    };
    const $transaction = vi.fn((fn: (t: unknown) => unknown) => fn(tx));
    const repo = new ModifiersRepository({ $transaction } as unknown as PrismaService);
    await repo.transaction(() => {
      sql.push('fn');
      return Promise.resolve('ok');
    });
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15_000,
      maxWait: 5_000,
      isolationLevel: 'ReadCommitted',
    });
    expect(sql).toEqual(["SET LOCAL lock_timeout = '3s'", 'fn']);
  });
});
