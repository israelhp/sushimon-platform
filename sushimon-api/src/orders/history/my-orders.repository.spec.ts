import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { MyOrdersRepository } from './my-orders.repository.js';
import type { MyOrdersFilter } from './my-orders.types.js';

const USER = '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11';
const base: MyOrdersFilter = {
  authUserId: USER,
  status: null,
  branchId: null,
  from: null,
  to: null,
  cursor: null,
  limit: 20,
};

function setup() {
  const calls: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: (sql: Prisma.Sql) => {
      calls.push(sql);
      return Promise.resolve([]);
    },
  } as unknown as PrismaService;
  return { repo: new MyOrdersRepository(prisma), calls };
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ');

describe('MyOrdersRepository.list: forma del SQL (F23, spec 024 §6)', () => {
  it('SIEMPRE filtra `o.customer_id IS NOT NULL` (elegible para el índice parcial) y une al cliente por auth_user_id', async () => {
    const { repo, calls } = setup();
    for (const f of [
      base,
      { ...base, status: ['pending'], branchId: USER, from: new Date(), to: new Date() },
      { ...base, cursor: { placedAtKey: '2026-11-18T10:00:00.123456Z', id: USER } },
    ]) {
      await repo.list(f);
    }
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const text = normalize(call.text);
      expect(text).toContain('WHERE o.customer_id IS NOT NULL');
      expect(text).toContain('JOIN app.customers c ON c.id = o.customer_id AND c.auth_user_id =');
      expect(text).toContain('ORDER BY o.placed_at DESC, o.id DESC');
      expect(text).toMatch(/LIMIT \$\d+$/);
      // nada del cliente se interpola: todo va como parámetro
      expect(text).not.toContain(USER);
    }
    expect(calls[2]?.values).toContain('2026-11-18T10:00:00.123456Z');
  });

  it('un `sub` que no es UUID no consulta la BD y devuelve vacío', async () => {
    const { repo, calls } = setup();
    expect(await repo.list({ ...base, authUserId: 'no-uuid' })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('limit + 1 para detectar la página siguiente', async () => {
    const { repo, calls } = setup();
    await repo.list({ ...base, limit: 50 });
    expect(calls[0]?.values).toContain(51);
  });
});
