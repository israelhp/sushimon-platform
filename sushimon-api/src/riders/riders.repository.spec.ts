import type { PrismaService } from '../database/prisma.service.js';
import { RidersRepository } from './riders.repository.js';
import type { RiderListFilter } from './riders.types.js';

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
  return {
    repo: new RidersRepository(prisma as unknown as PrismaService, { record: vi.fn() }),
    queries,
  };
}

const filter = (over: Partial<RiderListFilter> = {}): RiderListFilter => ({
  scope: null,
  busyIds: [],
  sort: 'fullName',
  order: 'asc',
  page: 1,
  pageSize: 20,
  ...over,
});

describe('RidersRepository (SQL parametrizado; se prueba contra PostgreSQL en test/riders.int-spec.ts)', () => {
  it('listado: 1 sentencia con count(*) OVER(), alcance y búsqueda por parámetros; sin teléfono ni placa en el filtro', async () => {
    const { repo, queries } = make([]);
    await repo.list(
      filter({
        scope: ['b1'],
        key: 'alvaro',
        active: true,
        availability: 'AVAILABLE',
        busyIds: ['x'],
      }),
    );
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q?.sql).toContain('count(*) OVER()');
    expect(q?.sql).toContain('r.branch_id = ANY(');
    expect(q?.sql).toContain('position(');
    expect(q?.sql).toContain('r.id <> ALL(');
    expect(q?.sql).toContain('ORDER BY r.name_key ASC, r.id ASC');
    expect(q?.sql).not.toContain('alvaro');
    // la búsqueda y el filtro NO tocan teléfono ni placa (P103)
    expect(q?.sql.split('WHERE')[1]).not.toMatch(/phone|license_plate/);
    expect(q?.values).toEqual(expect.arrayContaining(['alvaro', 20, 0]));
  });

  it('listado: `q` con %, _ y \\ viaja como parámetro y se compara con position(), nunca LIKE/ILIKE', async () => {
    const { repo, queries } = make([]);
    await repo.list(filter({ key: '50%_\\x' }));
    const q = queries[0];
    expect(q?.sql).toContain('position(');
    expect(q?.sql).not.toMatch(/\bI?LIKE\b|~|SIMILAR/i);
    expect(q?.sql).not.toContain('%');
    expect(q?.values).toContain('50%_\\x'); // sin escapar ni transformar: literal para position()
  });

  it('listado: orden de lista blanca y desempate por id; página vacía > 1 => +1 conteo', async () => {
    const { repo, queries } = make([]);
    await repo.list(filter({ sort: 'createdAt', order: 'desc', page: 3 }));
    expect(queries[0]?.sql).toContain('ORDER BY r.created_at DESC, r.id DESC');
    expect(queries).toHaveLength(2);
    expect(queries[1]?.sql).toContain('count(*)');
  });

  it('alcance vacío: no consulta; detalle fuera de alcance usa la misma sentencia que inexistente', async () => {
    const { repo, queries } = make([]);
    expect(await repo.list(filter({ scope: [] }))).toEqual({ rows: [], total: 0 });
    expect(await repo.findOne('id', [])).toBeNull();
    expect(queries).toHaveLength(0);
    await repo.findOne('id', ['b1']);
    await repo.findOne('id', null);
    expect(queries[0]?.sql).toContain('r.branch_id = ANY(');
  });

  it('transacción: lock_timeout primero; lectura con FOR UPDATE OF r solo si se pide', async () => {
    const { repo, queries } = make([]);
    await repo.transaction(async (tx) => {
      await tx.read('id', null, { lock: true, destBranchId: 'dest' });
      await tx.read('id', null);
    });
    expect(queries[0]?.sql).toContain('FOR UPDATE OF r');
    expect(queries[0]?.sql).toContain('dest_active');
    expect(queries[1]?.sql).not.toContain('FOR UPDATE');
  });

  it('escrituras: CAS por versión y rama; alta desde branches ACTIVAS; nada interpolado', async () => {
    const { repo, queries } = make([]);
    await repo.transaction(async (tx) => {
      await tx.update('id', 3, 'origen', { phone: '+50255509999', branchId: 'dest' });
      await tx.insert({
        branchId: 'b',
        fullName: 'Luis',
        nameKey: 'luis',
        phone: '+50255501122',
        vehicleType: null,
        licensePlate: null,
      });
      await tx.setActive('id', 'b', false);
      await tx.setAvailability('id', 'b', 'AVAILABLE');
    });
    const [upd, ins, act, avail] = queries.map((x) => x.sql);
    expect(upd).toMatch(
      /WHERE id = (\$\d+|\?)::uuid AND version = (\$\d+|\?)::int AND branch_id = /,
    );
    expect(upd).toContain('version = version + 1');
    expect(upd).toContain("availability = 'UNAVAILABLE'");
    expect(upd).not.toContain('+50255509999');
    expect(ins).toContain('b.active');
    expect(ins).not.toContain('+50255501122');
    expect(act).toContain('active IS DISTINCT FROM');
    expect(act).toContain('CASE WHEN');
    expect(avail).toContain("<> 'AVAILABLE' OR active");
    for (const sql of [upd, ins, act, avail]) expect(sql).not.toMatch(/DELETE/i);
  });

  it('elegibilidad: UNA sentencia de solo lectura (riders LEFT JOIN branch_delivery_settings)', async () => {
    const { repo, queries } = make([]);
    await repo.findEligibilityRow('r', 'b');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('LEFT JOIN app.branch_delivery_settings');
    expect(queries[0]?.sql).not.toMatch(/FOR UPDATE|UPDATE app|INSERT/);
  });
});
