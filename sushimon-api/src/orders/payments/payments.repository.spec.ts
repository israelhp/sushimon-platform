import type { PrismaService } from '../../database/prisma.service.js';
import { PaymentsRepository } from './payments.repository.js';

type Sqlish = { sql?: string; strings?: readonly string[]; values?: unknown[] };
const textOf = (arg: unknown): string => {
  const s = arg as Sqlish;
  return (s.sql ?? s.strings?.join('?') ?? '').replace(/\s+/g, ' ');
};

function make(rows: unknown[] = []) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const client = {
    $executeRawUnsafe: vi.fn(() => Promise.resolve(0)),
    $queryRaw: vi.fn((arg: unknown) => {
      queries.push({ sql: textOf(arg), values: (arg as Sqlish).values ?? [] });
      return Promise.resolve(rows);
    }),
  };
  const prisma = {
    ...client,
    $transaction: vi.fn((fn: (c: typeof client) => Promise<unknown>) => fn(client)),
  };
  const repo = new PaymentsRepository(prisma as unknown as PrismaService, { record: vi.fn() });
  return { repo, queries, client, prisma };
}

describe('PaymentsRepository (SQL parametrizado; se prueba contra PostgreSQL en test/payments.int-spec.ts)', () => {
  it('markPaid: UPDATE condicional (status pending + pedido no cerrado) + evento en UNA sentencia; NO toca orders', async () => {
    const { repo, queries } = make([{ received_at: new Date(), change: '15.00' }]);
    const out = await repo.transaction((tx) =>
      tx.markPaid({
        paymentId: 'p1',
        orderId: 'o1',
        tendered: '200.00',
        staffId: 's1',
        context: 'BRANCH',
        keyHash: Buffer.alloc(32, 1),
        requestHash: Buffer.alloc(32, 2),
      }),
    );
    expect(out?.change).toBe('15.00');
    expect(queries).toHaveLength(1);
    const sql = queries[0]?.sql ?? '';
    expect(sql).toContain("p.status = 'pending'");
    expect(sql).toContain("o.status NOT IN ('rejected', 'cancelled')");
    // carrera cobro vs cancelar/rechazar: el pedido se bloquea FOR SHARE (no FOR KEY SHARE) EN la misma sentencia
    expect(sql).toMatch(
      /FROM \(SELECT id, status FROM app\.orders WHERE id = (\$\d+|\?)::uuid FOR SHARE\) o/,
    );
    expect(sql).not.toContain('FOR KEY SHARE');
    expect(sql).not.toMatch(/FOR (NO KEY )?UPDATE/);
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain("'cash_received'");
    expect(sql).not.toMatch(/UPDATE app\.orders/i);
    expect(sql).not.toMatch(/orders SET/i);
    // nada del cliente interpolado: el importe, el empleado y los hashes viajan como parámetros
    expect(sql).not.toContain('200.00');
    expect(queries[0]?.values).toEqual(expect.arrayContaining(['200.00', 's1', 'p1']));
  });

  it('markPaid: 0 filas (carrera perdida) => null', async () => {
    const { repo } = make([]);
    expect(
      await repo.transaction((tx) =>
        tx.markPaid({
          paymentId: 'p1',
          orderId: 'o1',
          tendered: '200.00',
          staffId: 's1',
          context: 'BRANCH',
          keyHash: Buffer.alloc(32),
          requestHash: Buffer.alloc(32),
        }),
      ),
    ).toBeNull();
  });

  it('la transacción fija lock_timeout local ANTES de cualquier sentencia', async () => {
    const { repo, client } = make();
    await repo.transaction(() => Promise.resolve(null));
    expect(client.$executeRawUnsafe).toHaveBeenCalledWith("SET LOCAL lock_timeout = '2s'");
  });

  it('el alcance va EN SQL: lista vacía => null sin consulta; lista => ANY(...); global => TRUE', async () => {
    const empty = make();
    expect(await empty.repo.findForStaff('o1', [])).toBeNull();
    expect(await empty.repo.findHistory('o1', [])).toBeNull();
    expect(empty.queries).toHaveLength(0);

    const scoped = make();
    await scoped.repo.findForStaff('o1', ['b1']);
    expect(scoped.queries[0]?.sql).toContain('o.branch_id = ANY(');
    const global = make();
    await global.repo.findForStaff('o1', null);
    expect(global.queries[0]?.sql).toContain('AND TRUE');
  });

  it('lectura de pago y de historial: UNA sentencia cada una (LEFT JOIN, sin N+1)', async () => {
    const a = make();
    await a.repo.findForStaff('o1', null);
    expect(a.queries).toHaveLength(1);
    expect(a.queries[0]?.sql).toContain('LEFT JOIN app.payments');
    const b = make([{ id: 'o1', order_number: 1n, event_id: null }]);
    const h = await b.repo.findHistory('o1', null);
    expect(b.queries).toHaveLength(1);
    expect(h?.events).toEqual([]); // pedido visible sin eventos => historial vacío, no 404
  });

  it('hasPaidOnClosedOrder: una sentencia', async () => {
    const { repo, queries } = make([{ review: true }]);
    expect(await repo.hasPaidOnClosedOrder('o1')).toBe(true);
    expect(queries).toHaveLength(1);
  });
});
