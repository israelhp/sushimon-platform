import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../database/prisma.service.js';
import { DeliveriesRepository } from './deliveries.repository.js';
import type { DeliveryListFilter } from './deliveries.types.js';

type Sqlish = { sql?: string; strings?: readonly string[]; values?: unknown[] };
const textOf = (arg: unknown): string => {
  const s = arg as Sqlish;
  return (s.sql ?? s.strings?.join('?') ?? '').replace(/\s+/g, ' ');
};
const ID = 'c0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000001';

function make(rows: unknown[] = []) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const executed: string[] = [];
  const client = {
    $executeRawUnsafe: vi.fn((sql: string) => {
      executed.push(sql);
      return Promise.resolve(0);
    }),
    $queryRaw: vi.fn((arg: unknown, ...rest: unknown[]) => {
      // tagged template (strings, ...values) o `Prisma.sql`
      const first = arg as Sqlish;
      queries.push({
        sql: first.sql ?? first.strings?.join('?') ?? textOf(arg),
        values: first.values ?? rest,
      });
      queries[queries.length - 1]!.sql = queries[queries.length - 1]!.sql.replace(/\s+/g, ' ');
      return Promise.resolve(rows);
    }),
  };
  const prisma = {
    ...client,
    $transaction: vi.fn((fn: (c: typeof client) => Promise<unknown>) => fn(client)),
  };
  return {
    repo: new DeliveriesRepository(prisma as unknown as PrismaService, { record: vi.fn() }),
    queries,
    executed,
  };
}

const filter = (over: Partial<DeliveryListFilter> = {}): DeliveryListFilter => ({
  branchIds: null,
  statuses: ['pending', 'assigned'],
  riderId: null,
  from: new Date('2026-11-11T00:00:00Z'),
  to: null,
  cursor: null,
  limit: 25,
  ...over,
});

describe('DeliveriesRepository (SQL parametrizado; se prueba contra PostgreSQL en test/deliveries.int-spec.ts)', () => {
  it('listado: UNA sentencia con JOINs, alcance y filtros por parámetros, orden fijo y limit + 1', async () => {
    const { repo, queries } = make([]);
    await repo.list(
      filter({
        branchIds: [B],
        riderId: ID,
        cursor: { createdAtKey: '2026-11-18T10:00:00.000001Z', id: ID },
      }),
    );
    expect(queries).toHaveLength(1);
    const sql = queries[0]?.sql ?? '';
    expect(sql).toContain('FROM app.deliveries d JOIN app.orders o');
    expect(sql).toContain('LEFT JOIN app.order_addresses a');
    expect(sql).toContain('LEFT JOIN app.riders r');
    expect(sql).toContain('d.branch_id = ANY(');
    expect(sql).toContain('d.status = ANY(');
    expect(sql).toContain('d.rider_id = ');
    expect(sql).toContain('(d.created_at, d.id) < (');
    expect(sql).toContain('ORDER BY d.created_at DESC, d.id DESC');
    expect(sql).toContain('LIMIT ');
    expect(queries[0]?.values).toEqual(expect.arrayContaining([ID, 26]));
    expect(sql).not.toContain(ID);
    expect(sql).not.toContain(B);
  });

  it('listado: el teléfono del motorista se ENMASCARA en SQL y no hay teléfono/dirección del cliente ni placa', async () => {
    const { repo, queries } = make([]);
    await repo.list(filter());
    const sql = queries[0]?.sql ?? '';
    expect(sql).toContain("left(r.phone, 4) || '****' || right(r.phone, 4)");
    expect(sql).not.toMatch(
      /customer_phone|customer_name|address_line|reference_note|license_plate|r\.branch_id|delivery_notes/,
    );
  });

  it('listado: alcance vacío no consulta; global (null) no filtra por sucursal', async () => {
    const empty = make([]);
    expect(await empty.repo.list(filter({ branchIds: [] }))).toEqual([]);
    expect(empty.queries).toHaveLength(0);
    const global = make([]);
    await global.repo.list(filter());
    expect(global.queries[0]?.sql).not.toContain('d.branch_id = ANY(');
  });

  it('listado: el rango solo acota los terminales (los abiertos pasan siempre)', async () => {
    const { repo, queries } = make([]);
    await repo.list(filter({ to: new Date('2026-11-18T00:00:00Z') }));
    const sql = queries[0]?.sql ?? '';
    expect(sql).toMatch(
      /\(d\.status = ANY\(\?::text\[\]\) OR \(d\.created_at >= \? AND d\.created_at <= \?\)\)/,
    );
  });

  it('transacción: SET LOCAL lock_timeout como PRIMERA sentencia y bloqueos en el orden motorista → entrega → pedido', async () => {
    const { repo, queries, executed } = make([]);
    await repo.transaction(async (tx) => {
      await tx.lockRider(ID, [B]);
      await tx.readDeliveryLocked(ID);
      await tx.readDelivery(ID, [B], { lock: true });
    });
    expect(executed).toEqual(["SET LOCAL lock_timeout = '2s'"]);
    // `readDeliveryLocked` devuelve null sin fila de entrega: solo la 1.ª de sus sentencias corre (S9: dos sentencias explícitas).
    const [rider, locked, lockedByScope] = queries.map((q) => q.sql);
    // S2: el alcance de `riders.read` va EN el SQL del bloqueo.
    expect(rider).toMatch(
      /FROM app\.riders r WHERE r\.id = \?::uuid AND r\.branch_id = ANY\(\?::uuid\[\]\) FOR UPDATE/,
    );
    expect(locked).toMatch(/FROM app\.deliveries d JOIN app\.orders o/);
    expect(locked).toContain('FOR UPDATE OF d');
    expect(locked).not.toContain('FOR SHARE');
    expect(lockedByScope).toContain('FOR UPDATE OF d');
    expect(lockedByScope).not.toContain('FOR SHARE');
  });

  it('S9: la relectura bloqueada son DOS sentencias en orden explícito: entrega FOR UPDATE OF d y luego pedido FOR SHARE (estado vigente del pedido)', async () => {
    const deliveryRow = {
      id: ID,
      order_id: B,
      branch_id: B,
      branch_name: 'S',
      status: 'assigned',
      version: 2,
      rider_id: ID,
      assigned_at: new Date(),
      picked_up_at: null,
      delivered_at: null,
      returned_at: null,
      cancelled_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      order_status: 'ready',
      order_number: 1n,
      fulfillment_type: 'DELIVERY',
      delivery_provider: 'OWN',
      municipality_name: null,
      zone: null,
      rider_name: 'R',
      rider_vehicle_type: null,
      rider_phone_masked: null,
      last_event: null,
    };
    const orderRow = {
      status: 'cancelled',
      fulfillment_type: 'DELIVERY',
      delivery_provider: 'OWN',
    };
    const { repo, queries } = make([]);
    let n = 0;
    const raw = (
      repo as unknown as {
        prisma: {
          $queryRaw: { mockImplementation: (fn: (arg: unknown) => Promise<unknown[]>) => void };
        };
      }
    ).prisma;
    raw.$queryRaw.mockImplementation((arg: unknown) => {
      const text = (arg as Sqlish).sql ?? (arg as Sqlish).strings?.join('?') ?? '';
      queries.push({ sql: text.replace(/\s+/g, ' '), values: [] });
      n += 1;
      if (n === 1) return Promise.resolve([deliveryRow]);
      return Promise.resolve(n === 2 ? [{ last_event: null }] : [orderRow]);
    });
    const out = await repo.transaction((tx) => tx.readDeliveryLocked(ID));
    // entrega FOR UPDATE (sin subconsulta), su último evento en sentencia aparte (con `FOR UPDATE` la subconsulta saldría
    // obsoleta tras esperar un bloqueo; spec §23.1) y por último el pedido FOR SHARE
    expect(queries).toHaveLength(3);
    expect(queries[0]?.sql).toContain('FROM app.deliveries d');
    expect(queries[0]?.sql).toContain('FOR UPDATE OF d');
    expect(queries[0]?.sql).not.toContain('AS last_event');
    expect(queries[1]?.sql).toContain('AS last_event');
    expect(queries[1]?.sql).not.toContain('FOR UPDATE');
    expect(queries[2]?.sql).toMatch(/FROM app\.orders o WHERE o\.id = \?::uuid FOR SHARE/);
    // el estado del pedido sale de la SEGUNDA sentencia (bloqueada), no de la primera
    expect(out?.orderStatus).toBe('cancelled');
  });

  it('S2/P5: `lockRider` con alcance vacío NO consulta ni bloquea; la lectura sin bloqueo no trae el último evento', async () => {
    const { repo, queries } = make([]);
    await repo.transaction(async (tx) => {
      expect(await tx.lockRider(ID, [])).toBeNull();
      await tx.readDelivery(ID, [B]);
      await tx.readDelivery(ID, [B], { lock: true, lastEvent: true });
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).not.toContain('last_event');
    expect(queries[0]?.sql).not.toContain('FOR UPDATE');
    // con bloqueo el último evento NO va en la sentencia bloqueada (se lee aparte, ya con el candado)
    expect(queries[1]?.sql).toContain('FOR UPDATE');
    expect(queries[1]?.sql).not.toContain('AS last_event');
  });

  it('change: UNA sentencia (CAS por versión y estado + historial con el MISMO instante), valores parametrizados', async () => {
    const { repo, queries } = make([]);
    const out = await repo.transaction((tx) =>
      tx.change({
        id: ID,
        expectedVersion: 3,
        fromStatuses: ['pending', 'assigned'],
        change: { kind: 'assign', riderId: B },
        event: 'rider_assigned',
        oldStatus: 'pending',
        historyRiderId: B,
        reason: 'PII-NO-EN-SQL',
        changedBy: ID,
      }),
    );
    expect(out).toBeNull();
    expect(queries).toHaveLength(1);
    const sql = queries[0]?.sql ?? '';
    expect(sql).toContain('UPDATE app.deliveries SET');
    expect(sql).toContain('version = version + 1');
    expect(sql).toContain('AND version = ');
    expect(sql).toContain('AND status = ANY(');
    expect(sql).toContain('INSERT INTO app.delivery_status_history');
    expect(sql).toContain('updated_at FROM d');
    expect(sql).not.toContain('PII-NO-EN-SQL');
    expect(queries[0]?.values).toEqual(expect.arrayContaining([3, 'PII-NO-EN-SQL', ID, B]));
  });

  it('insert: ON CONFLICT (order_id) DO NOTHING + historial `created` en UNA sentencia', async () => {
    const { repo, queries } = make([]);
    expect(await repo.transaction((tx) => tx.insert(ID, B, ID))).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('ON CONFLICT (order_id) DO NOTHING');
    expect(queries[0]?.sql).toContain("'created'");
  });

  it('detalle: el contacto y la dirección se SELECCIONAN solo si abierta Y con orders.read (CASE WHEN en SQL); 2 sentencias', async () => {
    const { repo, queries } = make([]);
    expect(await repo.findDetail(ID, [B], [B], [B])).toBeNull();
    expect(queries).toHaveLength(1); // fila no visible => 1 sentencia y null
    const sql = queries[0]?.sql ?? '';
    expect(sql).toContain('CASE WHEN');
    expect(sql).toMatch(/CASE WHEN .+ THEN o\.customer_phone END/);
    expect(sql).toMatch(/THEN a\.address_line END/);
    expect(sql).toContain('d.branch_id = ANY(');
    expect(sql).not.toContain('delivery_notes');
  });

  it('detalle (S7): el contacto solo se selecciona en pending|assigned|picked_up (NO delivered)', async () => {
    const { repo, queries } = make([]);
    await repo.findDetail(ID, null, null, null);
    expect(queries[0]?.values).toEqual(
      expect.arrayContaining([['pending', 'assigned', 'picked_up']]),
    );
    expect(queries[0]?.values).not.toEqual(
      expect.arrayContaining([['pending', 'assigned', 'picked_up', 'delivered']]),
    );
  });

  it('detalle con alcance vacío no consulta', async () => {
    const { repo, queries } = make([]);
    expect(await repo.findDetail(ID, [], null, null)).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('invariante estática (R16): el módulo de entregas NO escribe `orders` ni `delivery_notes` por SQL', () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it.each(sources)('%s', (_name, text) => {
    expect(text).not.toMatch(/UPDATE\s+app\.orders/i);
    expect(text).not.toMatch(/INSERT\s+INTO\s+app\.orders\b/i);
    expect(text).not.toMatch(/DELETE\s+FROM\s+app\./i);
    expect(text).not.toMatch(/delivery_notes/);
    expect(text).not.toMatch(/\$queryRawUnsafe/);
    expect(text).not.toMatch(/\$executeRawUnsafe\(\s*`[^`]*\$\{(?!COMMAND_LOCK_TIMEOUT\})/);
  });

  it('las sentencias `$executeRawUnsafe` solo usan la constante COMMAND_LOCK_TIMEOUT', () => {
    const repo = sources.find(([n]) => n === 'deliveries.repository.ts')?.[1] ?? '';
    const matches = repo.match(/\$executeRawUnsafe\([^)]*\)/g) ?? [];
    expect(matches).toEqual([
      "$executeRawUnsafe(`SET LOCAL lock_timeout = '${COMMAND_LOCK_TIMEOUT}'`)",
    ]);
  });
});
