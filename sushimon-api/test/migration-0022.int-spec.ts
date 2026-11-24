import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';

/**
 * Migración 0022 (F28 entregas propias: app.deliveries, app.delivery_status_history, triggers, guarda en app.orders, RLS/REVOKE)
 * sobre una base DESECHABLE creada aquí (`sushimon_mig0022_test`): se aplican 0001..0022 en orden. Mismo patrón y misma omisión
 * explícita que migration-0019/0021.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de
 * Supabase real se omite y se avisa.
 *
 * ESTADO: se omite contra el Supabase compartido y corre solo en PostgreSQL plano desechable (la CI). Cubre spec 029 §3 y R02/R08/R38.
 * Los casos NULL existen por la lección de 0020: un CHECK no falla con NULL, así que cada CHECK se prueba con un valor inválido NO nulo.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0022_test';
const M0022 = '0022_own_deliveries';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const ALL = readdirSync(migrationsDir)
  .filter((d) => /^\d{4}_/.test(d) && d <= M0022)
  .sort();
const migrationSql = (name: string) =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const PRIV = { code: '42501' };
const RESTRICT = { code: '23001' };
/** `expect.stringContaining` tipado como cadena (evita `any` en los matchers anidados). */
const has = (text: string): string => expect.stringContaining(text) as string;

type Status = 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'returned' | 'cancelled';
const STATES: Status[] = ['pending', 'assigned', 'picked_up', 'delivered', 'returned', 'cancelled'];
/** Matriz de spec 029 §3.2 (tabla EXACTA): pares origen→destino válidos (más assigned→assigned con OTRO motorista). */
const ALLOWED = new Set([
  'pending>assigned',
  'assigned>pending',
  'assigned>assigned',
  'assigned>picked_up',
  'picked_up>delivered',
  'delivered>returned',
  'pending>cancelled',
  'assigned>cancelled',
  'cancelled>pending',
]);
/** Estado del pedido coherente con cada estado de la entrega (deliveries_order_coherence). */
const ORDER_FOR: Record<Status, string> = {
  pending: 'ready',
  assigned: 'ready',
  picked_up: 'on_the_way',
  delivered: 'delivered',
  returned: 'delivered',
  cancelled: 'ready',
};
/** Marcas que exige cada estado (deliveries_lifecycle_chk). */
const NEEDS: Record<
  Status,
  {
    rider: boolean;
    assigned: boolean;
    picked: boolean;
    delivered: boolean;
    returned: boolean;
    cancelled: boolean;
  }
> = {
  pending: {
    rider: false,
    assigned: false,
    picked: false,
    delivered: false,
    returned: false,
    cancelled: false,
  },
  assigned: {
    rider: true,
    assigned: true,
    picked: false,
    delivered: false,
    returned: false,
    cancelled: false,
  },
  picked_up: {
    rider: true,
    assigned: true,
    picked: true,
    delivered: false,
    returned: false,
    cancelled: false,
  },
  delivered: {
    rider: true,
    assigned: true,
    picked: true,
    delivered: true,
    returned: false,
    cancelled: false,
  },
  returned: {
    rider: true,
    assigned: true,
    picked: true,
    delivered: true,
    returned: true,
    cancelled: false,
  },
  cancelled: {
    rider: false,
    assigned: false,
    picked: false,
    delivered: false,
    returned: false,
    cancelled: true,
  },
};
const PATH: Record<Status, Status[]> = {
  pending: [],
  assigned: ['assigned'],
  picked_up: ['assigned', 'picked_up'],
  delivered: ['assigned', 'picked_up', 'delivered'],
  returned: ['assigned', 'picked_up', 'delivered', 'returned'],
  cancelled: ['cancelled'],
};

describe.skipIf(!url)('Migración 0022: entregas propias (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let branchId = '';
  let branch2Id = '';
  let seq = 0;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const tx = <T>(fn: (c: pg.Client) => Promise<T>) =>
    withClient(scratch, async (c) => {
      await c.query('BEGIN');
      try {
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });

  /** Pedido válido (DELIVERY/OWN por defecto, con su dirección: el constraint trigger de 0018 la exige al confirmar). */
  const newOrder = (o: Record<string, unknown> = {}) =>
    tx(async (c) => {
      const row = {
        id: randomUUID(),
        branch_id: branchId,
        customer_name: 'Ana Pérez',
        customer_phone: '+50255551234',
        fulfillment_type: 'DELIVERY',
        delivery_provider: 'OWN',
        subtotal: '100.00',
        total: '100.00',
        status: 'ready',
        ...o,
      };
      const cols = Object.keys(row);
      await c.query(
        `INSERT INTO app.orders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        Object.values(row),
      );
      if (row.fulfillment_type === 'DELIVERY') {
        await c.query(
          `INSERT INTO app.order_addresses (order_id, municipality_name, address_line) VALUES ($1, 'Guatemala', 'Calle 1')`,
          [row.id],
        );
      }
      return row.id;
    });
  const newRider = async (o: Record<string, unknown> = {}) => {
    const row = {
      branch_id: branchId,
      full_name: 'Juan Pérez',
      name_key: 'juan perez',
      phone: `+502${String(70000000 + ++seq)}`,
      ...o,
    };
    const cols = Object.keys(row);
    const r = await q<{ id: string }>(
      `INSERT INTO app.riders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return r.rows[0]?.id as string;
  };
  const insertDelivery = (
    orderId: string,
    branch = branchId,
    extra: Record<string, unknown> = {},
  ) => {
    const row = { order_id: orderId, branch_id: branch, ...extra };
    const cols = Object.keys(row);
    return q<{ id: string }>(
      `INSERT INTO app.deliveries (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
  };
  const patch = (id: string, sets: Record<string, unknown>, c?: pg.Client) => {
    const keys = Object.keys(sets);
    const sql = `UPDATE app.deliveries SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`;
    return c ? c.query(sql, [id, ...Object.values(sets)]) : q(sql, [id, ...Object.values(sets)]);
  };
  /**
   * UPDATE de la entrega `id` hacia `to` en una transacción que ajusta el pedido al estado coherente (como hace la API con
   * OrderTransitionsService). Conserva las marcas existentes (COALESCE) y pone las que el destino exige; `riderId` solo se usa
   * si hace falta un motorista nuevo.
   */
  const moveTo = (
    id: string,
    orderId: string,
    to: Status,
    riderId: string | null,
    orderStatus?: string,
  ) =>
    tx(async (c) => {
      const want = orderStatus ?? ORDER_FOR[to];
      const cur = await c.query<{ status: string }>(`SELECT status FROM app.orders WHERE id = $1`, [
        orderId,
      ]);
      if (cur.rows[0]?.status !== want)
        await c.query(`UPDATE app.orders SET status = $2, updated_at = now() WHERE id = $1`, [
          orderId,
          want,
        ]);
      const n = NEEDS[to];
      await c.query(
        `UPDATE app.deliveries SET status = $2, version = version + 1, updated_at = clock_timestamp(),
                rider_id = ${n.rider ? 'COALESCE(rider_id, $3::uuid)' : 'NULL'},
                assigned_at = ${n.assigned ? 'COALESCE(assigned_at, clock_timestamp())' : 'NULL'},
                picked_up_at = ${n.picked ? 'COALESCE(picked_up_at, clock_timestamp())' : 'NULL'},
                delivered_at = ${n.delivered ? 'COALESCE(delivered_at, clock_timestamp())' : 'NULL'},
                returned_at = ${n.returned ? 'COALESCE(returned_at, clock_timestamp())' : 'NULL'},
                cancelled_at = ${n.cancelled ? 'COALESCE(cancelled_at, clock_timestamp())' : 'NULL'}
          WHERE id = $1`,
        n.rider ? [id, to, riderId] : [id, to],
      );
    });
  /** Entrega llevada por caminos válidos hasta `status` (cada paso en su transacción coherente). */
  const makeDelivery = async (
    status: Status,
    o: { riderId?: string; orderStatus?: string } = {},
  ) => {
    const orderId = await newOrder({ status: o.orderStatus ?? 'ready' });
    const id = (await insertDelivery(orderId)).rows[0]?.id as string;
    const riderId = o.riderId ?? (await newRider());
    for (const step of PATH[status]) await moveTo(id, orderId, step, riderId);
    return { id, orderId, riderId };
  };
  const statusOf = async (id: string) =>
    (
      await q<{ status: string; version: number }>(
        `SELECT status, version FROM app.deliveries WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const setOrderStatus = (orderId: string, status: string) =>
    q(`UPDATE app.orders SET status = $2, updated_at = now() WHERE id = $1`, [orderId, status]);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0022.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0022 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of ALL) await c.query(migrationSql(m));
      const br = await c.query<{ id: string }>(
        `INSERT INTO app.branches (code, name, address, active) VALUES
           ('suc-0022','B','dir',true), ('suc-0022b','B2','dir',true) RETURNING id`,
      );
      branchId = br.rows[0]?.id as string;
      branch2Id = br.rows[1]?.id as string;
    });
  });
  afterAll(async () => {
    if (!plain) return;
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    });
  });
  beforeEach((ctx) => {
    if (!plain) ctx.skip();
  });
  afterEach(async () => {
    if (!plain) return;
    await tx(async (c) => {
      await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
      await c.query('DELETE FROM app.delivery_status_history');
      await c.query('DELETE FROM app.deliveries');
      await c.query('DELETE FROM app.riders');
      await c.query('DELETE FROM app.order_addresses');
      await c.query('DELETE FROM app.orders');
    });
  });

  describe('estructura y relanzado', () => {
    it('crea las dos tablas con defaults pending, version 1 y sin tocar role_permissions', async () => {
      const orderId = await newOrder();
      const id = (await insertDelivery(orderId)).rows[0]?.id as string;
      const r = await q(`SELECT * FROM app.deliveries WHERE id = $1`, [id]);
      expect(r.rows[0]).toMatchObject({
        status: 'pending',
        version: 1,
        branch_id: branchId,
        rider_id: null,
        assigned_at: null,
        delivery_notes: null,
      });
      const t = await q<{ t: string }>(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('deliveries','delivery_status_history') ORDER BY 1`,
      );
      expect(t.rows.map((x) => x.t)).toEqual(['deliveries', 'delivery_status_history']);
    });

    it('reaplicar 0022 es inocuo (relanzable), conserva filas y no duplica triggers', async () => {
      const orderId = await newOrder();
      const id = (await insertDelivery(orderId)).rows[0]?.id as string;
      await q(migrationSql(M0022));
      expect((await q('SELECT 1 FROM app.deliveries WHERE id = $1', [id])).rowCount).toBe(1);
      const trg = await q<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
           ('deliveries_guard','deliveries_order_coherence','delivery_status_history_append_only','orders_open_delivery_guard',
            'orders_open_delivery_identity_guard','orders_delivery_coherence')
         ORDER BY 1`,
      );
      expect(trg.rows.map((x) => x.tgname)).toEqual([
        'deliveries_guard',
        'deliveries_order_coherence',
        'delivery_status_history_append_only',
        'orders_delivery_coherence',
        'orders_open_delivery_guard',
        'orders_open_delivery_identity_guard',
      ]);
    });

    it.each([
      ['app.deliveries', 'deliveries_lifecycle_chk', 'deliveries'],
      ['app.delivery_status_history', 'delivery_status_history_chk', 'delivery_status_history'],
    ])('la guarda inicial rechaza %s de definición ajena sin modificarla', async (table, con) => {
      await withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`ALTER TABLE ${table} DROP CONSTRAINT ${con}`);
          await expect(c.query(migrationSql(M0022))).rejects.toThrow(new RegExp(con));
        } finally {
          await c.query('ROLLBACK');
        }
      });
    });

    it('no añade columnas ni cambia las restricciones de app.orders (solo triggers)', async () => {
      const trg = await q<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'app.orders'::regclass AND NOT tgisinternal ORDER BY 1`,
      );
      expect(trg.rows.map((x) => x.tgname)).toContain('orders_immutable_fields');
      expect(trg.rows.map((x) => x.tgname)).toContain('orders_open_delivery_guard');
      expect(trg.rows.map((x) => x.tgname)).toContain('orders_open_delivery_identity_guard');
      expect(trg.rows.map((x) => x.tgname)).toContain('orders_delivery_coherence');
    });
  });

  describe('CHECK y UNIQUE', () => {
    it('UNIQUE(order_id): segunda entrega del mismo pedido => 23505', async () => {
      const orderId = await newOrder();
      await insertDelivery(orderId);
      await expect(insertDelivery(orderId)).rejects.toMatchObject(UNIQUE);
    });

    it('deliveries_status_chk: estado fuera del catálogo (no nulo) falla; el trigger exige nacer pending', async () => {
      await expect(
        insertDelivery(await newOrder(), branchId, { status: 'lost' }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        insertDelivery(await newOrder(), branchId, { status: 'assigned' }),
      ).rejects.toMatchObject(CHECK);
    });

    it('deliveries_version_chk y nacer con version <> 1', async () => {
      await expect(
        insertDelivery(await newOrder(), branchId, { version: 0 }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        insertDelivery(await newOrder(), branchId, { version: 2 }),
      ).rejects.toMatchObject(CHECK);
    });

    it('deliveries_notes_chk: 280 pasa, 281 falla', async () => {
      await expect(
        insertDelivery(await newOrder(), branchId, { delivery_notes: 'x'.repeat(280) }),
      ).resolves.toBeDefined();
      await expect(
        insertDelivery(await newOrder(), branchId, { delivery_notes: 'x'.repeat(281) }),
      ).rejects.toMatchObject(CHECK);
    });

    it('deliveries_lifecycle_chk: pending con motorista o con marcas falla (INSERT)', async () => {
      const rider = await newRider();
      await expect(
        insertDelivery(await newOrder(), branchId, { rider_id: rider }),
      ).rejects.toMatchObject(CHECK);
      for (const col of [
        'assigned_at',
        'picked_up_at',
        'delivered_at',
        'returned_at',
        'cancelled_at',
      ]) {
        await expect(
          insertDelivery(await newOrder(), branchId, { [col]: new Date().toISOString() }),
        ).rejects.toMatchObject(CHECK);
      }
    });

    it.each(STATES.filter((s) => s !== 'pending'))(
      'deliveries_lifecycle_chk: en %s, quitar o añadir una marca/motorista falla (UPDATE directo, trigger de grafo deshabilitado)',
      async (state) => {
        const { id } = await makeDelivery(state);
        const n = NEEDS[state];
        const cols: Array<[string, boolean]> = [
          ['rider_id', n.rider],
          ['assigned_at', n.assigned],
          ['picked_up_at', n.picked],
          ['delivered_at', n.delivered],
          ['returned_at', n.returned],
          ['cancelled_at', n.cancelled],
        ];
        // La prueba aísla el CHECK: se desactiva SOLO el trigger de guarda dentro de una transacción que se revierte.
        for (const [col, required] of cols) {
          await withClient(scratch, async (c) => {
            await c.query('BEGIN');
            try {
              await c.query('ALTER TABLE app.deliveries DISABLE TRIGGER deliveries_guard');
              await c.query('SET CONSTRAINTS ALL IMMEDIATE');
              const rider = await newRider({ phone: `+502${String(70000000 + ++seq)}` });
              const value = required ? null : col === 'rider_id' ? rider : new Date().toISOString();
              await expect(
                c.query(`UPDATE app.deliveries SET ${col} = $2 WHERE id = $1`, [id, value]),
              ).rejects.toMatchObject(CHECK);
            } finally {
              await c.query('ROLLBACK');
            }
          });
        }
      },
    );

    it('deliveries_order_times_chk: marcas fuera de orden fallan; NULL pasa', async () => {
      const { id } = await makeDelivery('delivered');
      await withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('ALTER TABLE app.deliveries DISABLE TRIGGER deliveries_guard');
          await expect(
            c.query(
              `UPDATE app.deliveries SET delivered_at = picked_up_at - interval '1 minute' WHERE id = $1`,
              [id],
            ),
          ).rejects.toMatchObject(CHECK);
        } finally {
          await c.query('ROLLBACK');
        }
      });
    });

    it('FK order_id/branch_id/rider_id existen con ON DELETE RESTRICT', async () => {
      const r = await q<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype FROM pg_constraint WHERE contype = 'f' AND conrelid IN
           ('app.deliveries'::regclass, 'app.delivery_status_history'::regclass) ORDER BY 1`,
      );
      expect(r.rows.map((x) => x.conname)).toEqual([
        'deliveries_branch_id_fkey',
        'deliveries_order_id_fkey',
        'deliveries_rider_id_fkey',
        'delivery_status_history_delivery_id_fkey',
        'delivery_status_history_rider_id_fkey',
      ]);
      expect(r.rows.every((x) => x.confdeltype === 'r')).toBe(true);
      await expect(insertDelivery(randomUUID())).rejects.toMatchObject(CHECK); // el trigger responde antes que la FK
    });
  });

  describe('trigger deliveries_guard: pedido', () => {
    it('rechaza pedido PICKUP, PEDIDOSYA, de otra sucursal o inexistente (23514)', async () => {
      await expect(
        insertDelivery(await newOrder({ fulfillment_type: 'PICKUP', delivery_provider: null })),
      ).rejects.toMatchObject(CHECK);
      await expect(
        insertDelivery(await newOrder({ delivery_provider: 'PEDIDOSYA' })),
      ).rejects.toMatchObject(CHECK);
      await expect(insertDelivery(await newOrder(), branch2Id)).rejects.toMatchObject(CHECK);
      await expect(insertDelivery(randomUUID())).rejects.toMatchObject(CHECK);
    });
  });

  describe('trigger deliveries_guard: motorista y doble asignación', () => {
    it('motorista inactivo o de otra sucursal rechazado al asignar (23514)', async () => {
      const orderId = await newOrder();
      const id = (await insertDelivery(orderId)).rows[0]?.id as string;
      const inactive = await newRider({ active: false });
      const other = await newRider({ branch_id: branch2Id });
      await expect(moveTo(id, orderId, 'assigned', inactive)).rejects.toMatchObject(CHECK);
      await expect(moveTo(id, orderId, 'assigned', other)).rejects.toMatchObject(CHECK);
      await expect(moveTo(id, orderId, 'assigned', await newRider())).resolves.toBeUndefined();
    });

    it('una entrega activa por motorista: la segunda asignación falla con 23505 (índice parcial)', async () => {
      const rider = await newRider();
      await makeDelivery('assigned', { riderId: rider });
      const o2 = await newOrder();
      const d2 = (await insertDelivery(o2)).rows[0]?.id as string;
      await expect(moveTo(d2, o2, 'assigned', rider)).rejects.toMatchObject(UNIQUE);
    });

    it.each(['assigned', 'picked_up', 'delivered'] as Status[])(
      'el motorista con entrega %s sigue ocupado; returned/cancelled/pending NO cuentan',
      async (busy) => {
        const rider = await newRider();
        const first = await makeDelivery(busy, { riderId: rider });
        const o2 = await newOrder();
        const d2 = (await insertDelivery(o2)).rows[0]?.id as string;
        await expect(moveTo(d2, o2, 'assigned', rider)).rejects.toMatchObject(UNIQUE);
        // Al liberar al motorista (cancelar o registrar el retorno) la siguiente asignación sí entra.
        if (busy === 'assigned') await moveTo(first.id, first.orderId, 'cancelled', null);
        else {
          if (busy === 'picked_up') await moveTo(first.id, first.orderId, 'delivered', rider);
          await moveTo(first.id, first.orderId, 'returned', rider);
        }
        await expect(moveTo(d2, o2, 'assigned', rider)).resolves.toBeUndefined();
      },
    );

    it('el retorno (returned) y la cancelación liberan al motorista', async () => {
      const rider = await newRider();
      const a = await makeDelivery('returned', { riderId: rider });
      const b = await makeDelivery('assigned', { riderId: rider });
      expect(a.riderId).toBe(rider);
      await moveTo(b.id, b.orderId, 'cancelled', null);
      const c = await makeDelivery('assigned', { riderId: rider });
      expect((await statusOf(c.id))?.status).toBe('assigned');
    });

    it('reasignar (assigned → assigned con OTRO motorista): el anterior queda libre', async () => {
      const r1 = await newRider();
      const r2 = await newRider();
      const d = await makeDelivery('assigned', { riderId: r1 });
      await tx(async (c) => {
        await c.query(
          `UPDATE app.deliveries SET rider_id = $2, assigned_at = clock_timestamp(), version = version + 1 WHERE id = $1`,
          [d.id, r2],
        );
      });
      await makeDelivery('assigned', { riderId: r1 }); // r1 libre otra vez
      await expect(
        tx((c) => c.query(`UPDATE app.deliveries SET version = version + 1 WHERE id = $1`, [d.id])),
      ).rejects.toMatchObject(CHECK); // mismo motorista: no es una reasignación
    });

    it('el motorista no cambia en picked_up/delivered/returned', async () => {
      const d = await makeDelivery('picked_up');
      const other = await newRider();
      await expect(patch(d.id, { rider_id: other, version: 99 })).rejects.toMatchObject(CHECK);
      await expect(
        tx((c) =>
          c.query(`UPDATE app.deliveries SET rider_id = $2, version = version + 1 WHERE id = $1`, [
            d.id,
            other,
          ]),
        ),
      ).rejects.toMatchObject(CHECK);
    });

    it('concurrencia: dos entregas asignadas a la vez al mismo motorista => una gana y la otra recibe 23505', async () => {
      const rider = await newRider();
      const mk = async () => {
        const orderId = await newOrder();
        const id = (await insertDelivery(orderId)).rows[0]?.id as string;
        return { orderId, id };
      };
      const [a, b] = [await mk(), await mk()];
      const res = await Promise.allSettled([
        moveTo(a.id, a.orderId, 'assigned', rider),
        moveTo(b.id, b.orderId, 'assigned', rider),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toMatchObject(UNIQUE);
    });
  });

  describe('trigger deliveries_guard: grafo de estados (barrido R02)', () => {
    const pairs = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));
    it.each(pairs)('%s → %s', async (from, to) => {
      const d = await makeDelivery(from);
      const fresh = await newRider(); // para asignar/reasignar con un motorista distinto
      const expected = ALLOWED.has(`${from}>${to}`);
      // Reasignar exige OTRO motorista: se fuerza desde SQL (COALESCE conservaría el actual)
      if (from === 'assigned' && to === 'assigned') {
        await expect(
          tx((c) =>
            c.query(
              `UPDATE app.deliveries SET rider_id = $2, assigned_at = clock_timestamp(), version = version + 1 WHERE id = $1`,
              [d.id, fresh],
            ),
          ),
        ).resolves.toBeDefined();
        return;
      }
      const attempt = moveTo(d.id, d.orderId, to, fresh);
      if (expected) {
        await expect(attempt).resolves.toBeUndefined();
        expect((await statusOf(d.id))?.status).toBe(to);
      } else {
        await expect(attempt).rejects.toMatchObject(CHECK);
        expect((await statusOf(d.id))?.status).toBe(from);
      }
    });

    it('assigned → assigned con el MISMO motorista es rechazado', async () => {
      const d = await makeDelivery('assigned');
      await expect(
        tx((c) =>
          c.query(
            `UPDATE app.deliveries SET assigned_at = clock_timestamp(), version = version + 1 WHERE id = $1`,
            [d.id],
          ),
        ),
      ).rejects.toMatchObject(CHECK);
    });

    it('reabrir (cancelled → pending) limpia cancelled_at y vuelve a ser asignable', async () => {
      const d = await makeDelivery('cancelled');
      await moveTo(d.id, d.orderId, 'pending', null);
      const row = (
        await q(`SELECT status, cancelled_at, version FROM app.deliveries WHERE id = $1`, [d.id])
      ).rows[0];
      expect(row).toMatchObject({ status: 'pending', cancelled_at: null });
      await moveTo(d.id, d.orderId, 'assigned', await newRider());
    });

    it('todo UPDATE debe subir version en exactamente 1 (sin subir, +2, retroceder)', async () => {
      const d = await makeDelivery('pending');
      await expect(patch(d.id, { delivery_notes: 'x' })).rejects.toMatchObject(CHECK);
      await expect(patch(d.id, { version: 1 })).rejects.toMatchObject(CHECK);
      await expect(patch(d.id, { version: 3 })).rejects.toMatchObject(CHECK);
    });

    it('id, order_id, branch_id y created_at son inmutables (42501)', async () => {
      const d = await makeDelivery('pending');
      await expect(patch(d.id, { id: randomUUID(), version: 2 })).rejects.toMatchObject(PRIV);
      await expect(patch(d.id, { order_id: await newOrder(), version: 2 })).rejects.toMatchObject(
        PRIV,
      );
      await expect(patch(d.id, { branch_id: branch2Id, version: 2 })).rejects.toMatchObject(PRIV);
      await expect(
        patch(d.id, { created_at: '2001-01-01T00:00:00Z', version: 2 }),
      ).rejects.toMatchObject(PRIV);
    });

    it('las marcas ya establecidas no se reescriben', async () => {
      const p = await makeDelivery('picked_up');
      await expect(
        tx(async (c) => {
          await c.query(`UPDATE app.orders SET status = 'delivered' WHERE id = $1`, [p.orderId]);
          await c.query(
            `UPDATE app.deliveries SET status = 'delivered', version = version + 1, delivered_at = clock_timestamp(),
                    picked_up_at = picked_up_at - interval '1 second' WHERE id = $1`,
            [p.id],
          );
        }),
      ).rejects.toThrow(/marcas de tiempo ya establecidas/);
    });

    it('DELETE rechazado (42501) y permitido solo con app.allow_order_cleanup = on', async () => {
      const d = await makeDelivery('pending');
      await expect(q('DELETE FROM app.deliveries WHERE id = $1', [d.id])).rejects.toMatchObject(
        PRIV,
      );
      await expect(
        tx(async (c) => {
          await c.query("SET LOCAL app.allow_order_cleanup = 'off'");
          await c.query('DELETE FROM app.deliveries WHERE id = $1', [d.id]);
        }),
      ).rejects.toMatchObject(PRIV);
      await tx(async (c) => {
        await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
        await c.query('DELETE FROM app.deliveries WHERE id = $1', [d.id]);
      });
      expect((await q('SELECT 1 FROM app.deliveries WHERE id = $1', [d.id])).rowCount).toBe(0);
    });
  });

  describe('coherencia diferida entrega ↔ pedido', () => {
    it('entrega picked_up con pedido aún ready => falla en COMMIT (23514)', async () => {
      const d = await makeDelivery('assigned');
      await expect(
        tx((c) =>
          c.query(
            `UPDATE app.deliveries SET status = 'picked_up', version = version + 1, picked_up_at = clock_timestamp() WHERE id = $1`,
            [d.id],
          ),
        ),
      ).rejects.toMatchObject(CHECK);
      expect((await statusOf(d.id))?.status).toBe('assigned');
    });

    it('mismo cambio con el pedido pasado a on_the_way en la MISMA transacción => OK (todo o nada)', async () => {
      const d = await makeDelivery('assigned');
      await moveTo(d.id, d.orderId, 'picked_up', null);
      expect((await statusOf(d.id))?.status).toBe('picked_up');
    });

    it('crear entrega con pedido pending, picked_up/delivered o terminal => falla en COMMIT', async () => {
      for (const st of ['pending', 'on_the_way', 'delivered', 'cancelled', 'rejected']) {
        await expect(insertDelivery(await newOrder({ status: st }))).rejects.toMatchObject(CHECK);
      }
      for (const st of ['accepted', 'preparing', 'ready']) {
        await expect(insertDelivery(await newOrder({ status: st }))).resolves.toBeDefined();
      }
    });

    it('varios cambios en una transacción se evalúan contra el estado FINAL (no versiones superadas)', async () => {
      const orderId = await newOrder({ status: 'preparing' });
      const rider = await newRider();
      await tx(async (c) => {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO app.deliveries (order_id, branch_id) VALUES ($1, $2) RETURNING id`,
            [orderId, branchId],
          )
        ).rows[0]?.id as string;
        await c.query(
          `UPDATE app.deliveries SET status = 'assigned', rider_id = $2, assigned_at = clock_timestamp(), version = 2 WHERE id = $1`,
          [id, rider],
        );
        await c.query(`UPDATE app.orders SET status = 'ready' WHERE id = $1`, [orderId]);
      });
    });

    it('cancelar entrega con pedido on_the_way/delivered es incoherente', async () => {
      const d = await makeDelivery('assigned');
      await expect(moveTo(d.id, d.orderId, 'cancelled', null, 'on_the_way')).rejects.toMatchObject(
        CHECK,
      );
      // Orden correcto (como la política de spec §6.3): primero la entrega, luego el pedido, en la misma transacción.
      await tx(async (c) => {
        await c.query(
          `UPDATE app.deliveries SET status = 'cancelled', version = version + 1, rider_id = NULL, assigned_at = NULL,
                  cancelled_at = clock_timestamp() WHERE id = $1`,
          [d.id],
        );
        await c.query(`UPDATE app.orders SET status = 'cancelled' WHERE id = $1`, [d.orderId]);
      });
      expect((await statusOf(d.id))?.status).toBe('cancelled');
    });
  });

  describe('guarda en app.orders (orders_open_delivery_guard)', () => {
    it.each(['pending', 'assigned', 'picked_up'] as Status[])(
      'cancelar o rechazar un pedido con entrega %s => 23001 sin cambiar el pedido',
      async (state) => {
        const d = await makeDelivery(state);
        const before = (
          await q<{ status: string }>('SELECT status FROM app.orders WHERE id = $1', [d.orderId])
        ).rows[0]?.status;
        await expect(setOrderStatus(d.orderId, 'cancelled')).rejects.toMatchObject(RESTRICT);
        await expect(setOrderStatus(d.orderId, 'rejected')).rejects.toMatchObject(RESTRICT);
        expect(
          (await q<{ status: string }>('SELECT status FROM app.orders WHERE id = $1', [d.orderId]))
            .rows[0]?.status,
        ).toBe(before);
      },
    );

    it('el mensaje del trigger es ORDER_HAS_ACTIVE_DELIVERY (la API lo traduce)', async () => {
      const d = await makeDelivery('assigned');
      await expect(setOrderStatus(d.orderId, 'cancelled')).rejects.toThrow(
        /ORDER_HAS_ACTIVE_DELIVERY/,
      );
    });

    it('con entrega cancelled o sin entrega el pedido SÍ puede cancelarse; con returned no lo bloquea la guarda de cancelación (lo rechaza la coherencia S3a, 23514)', async () => {
      const cancelledDelivery = await makeDelivery('cancelled');
      await expect(setOrderStatus(cancelledDelivery.orderId, 'cancelled')).resolves.toBeDefined();
      const returned = await makeDelivery('returned');
      // `orders_open_delivery_guard` (23001) no interviene con una entrega `returned`; el pedido ya está `delivered` y volverlo a
      // `cancelled` deja la entrega incoherente (S3a): 23514, no 23001.
      await expect(setOrderStatus(returned.orderId, 'cancelled')).rejects.toMatchObject({
        ...CHECK,
        message: has('orders_delivery_coherence'),
      });
      const noDelivery = await newOrder();
      await expect(setOrderStatus(noDelivery, 'cancelled')).resolves.toBeDefined();
    });

    it('otras transiciones del pedido con entrega abierta no se bloquean (el trigger solo mira cancelled/rejected)', async () => {
      const d = await makeDelivery('assigned', { orderStatus: 'accepted' });
      await expect(setOrderStatus(d.orderId, 'preparing')).resolves.toBeDefined();
    });

    it('un UPDATE de orders que no cambia status no dispara la guarda', async () => {
      const d = await makeDelivery('assigned');
      await expect(
        q(`UPDATE app.orders SET notes = 'x', updated_at = now() WHERE id = $1`, [d.orderId]),
      ).resolves.toBeDefined();
    });

    it('concurrencia: crear la entrega vs cancelar el pedido => nunca queda entrega abierta sobre pedido cancelado', async () => {
      // Orden A: la entrega se crea primero (transacción abierta) y el pedido intenta cancelarse => espera y falla con 23001.
      const o1 = await newOrder();
      await withClient(scratch, async (c1) => {
        await c1.query('BEGIN');
        await c1.query(`INSERT INTO app.deliveries (order_id, branch_id) VALUES ($1, $2)`, [
          o1,
          branchId,
        ]);
        let settled = false;
        const cancelling = setOrderStatus(o1, 'cancelled').then(
          () => {
            settled = true;
            return 'ok';
          },
          (e: { code?: string }) => {
            settled = true;
            return e.code;
          },
        );
        await sleep(400);
        expect(settled, 'la cancelación debe esperar a la transacción de la entrega').toBe(false);
        await c1.query('COMMIT');
        expect(await cancelling).toBe('23001');
      });
      // Orden B: el pedido se cancela primero (transacción abierta) y la entrega intenta crearse => espera y falla (incoherente).
      const o2 = await newOrder();
      await withClient(scratch, async (c1) => {
        await c1.query('BEGIN');
        await c1.query(`UPDATE app.orders SET status = 'cancelled' WHERE id = $1`, [o2]);
        let settled = false;
        const creating = insertDelivery(o2).then(
          () => {
            settled = true;
            return 'ok';
          },
          (e: { code?: string }) => {
            settled = true;
            return e.code;
          },
        );
        await sleep(400);
        expect(settled, 'la creación debe esperar a la cancelación del pedido').toBe(false);
        await c1.query('COMMIT');
        expect(await creating).toBe('23514');
      });
      expect((await q('SELECT 1 FROM app.deliveries WHERE order_id = $1', [o2])).rowCount).toBe(0);
    });
  });

  describe('S3a coherencia diferida desde el PEDIDO (orders_delivery_coherence)', () => {
    it('cambiar el estado del pedido SIN mover la entrega falla en COMMIT (23514) y no cambia nada', async () => {
      const d = await makeDelivery('assigned');
      await expect(setOrderStatus(d.orderId, 'on_the_way')).rejects.toMatchObject(CHECK);
      await expect(setOrderStatus(d.orderId, 'delivered')).rejects.toMatchObject(CHECK);
      const o = await q<{ status: string }>('SELECT status FROM app.orders WHERE id = $1', [
        d.orderId,
      ]);
      expect(o.rows[0]?.status).toBe('ready');
    });

    it('picked_up con el pedido devuelto a ready => falla; delivered/returned con el pedido on_the_way => falla', async () => {
      const picked = await makeDelivery('picked_up');
      await expect(setOrderStatus(picked.orderId, 'ready')).rejects.toMatchObject(CHECK);
      const delivered = await makeDelivery('delivered');
      await expect(setOrderStatus(delivered.orderId, 'on_the_way')).rejects.toMatchObject(CHECK);
      const returned = await makeDelivery('returned');
      await expect(setOrderStatus(returned.orderId, 'ready')).rejects.toMatchObject(CHECK);
    });

    it('mensaje con el NOMBRE del trigger (la API clasifica por nombre) y CONSTRAINT informado', async () => {
      const d = await makeDelivery('assigned');
      await expect(setOrderStatus(d.orderId, 'on_the_way')).rejects.toMatchObject({
        code: '23514',
        message: has('orders_delivery_coherence'),
        constraint: 'orders_delivery_coherence',
      });
    });

    it('el cambio coherente en la MISMA transacción (entrega y pedido) pasa; varios cambios se evalúan contra el estado FINAL', async () => {
      const d = await makeDelivery('assigned');
      await moveTo(d.id, d.orderId, 'picked_up', null);
      // pedido y entrega cambian en la MISMA transacción (cualquier orden de sentencias): se evalúa el estado FINAL
      await tx(async (c) => {
        await c.query(`UPDATE app.orders SET status = 'delivered' WHERE id = $1`, [d.orderId]);
        await c.query(
          `UPDATE app.deliveries SET status = 'delivered', version = version + 1, delivered_at = clock_timestamp() WHERE id = $1`,
          [d.id],
        );
      });
      expect((await statusOf(d.id))?.status).toBe('delivered');
    });

    it('sin entrega, o con pedido PICKUP, el cambio de estado del pedido no se ve afectado', async () => {
      const own = await newOrder({ status: 'ready' });
      await expect(setOrderStatus(own, 'on_the_way')).resolves.toBeDefined();
      const pickup = await newOrder({
        fulfillment_type: 'PICKUP',
        delivery_provider: null,
        status: 'ready',
      });
      await expect(setOrderStatus(pickup, 'picked_up')).resolves.toBeDefined();
    });

    it('con entrega cancelled el pedido puede cancelarse, pero NO pasar a on_the_way/delivered', async () => {
      const d = await makeDelivery('cancelled');
      await expect(setOrderStatus(d.orderId, 'on_the_way')).rejects.toMatchObject(CHECK);
      await expect(setOrderStatus(d.orderId, 'cancelled')).resolves.toBeDefined();
    });
  });

  describe('S3b identidad del pedido con entrega abierta (orders_open_delivery_identity_guard)', () => {
    /**
     * `orders_immutable_fields` (0018) ya hace inmutables sucursal, modalidad y proveedor, y dispara ANTES (orden alfabético): el
     * guard nuevo es DEFENSA EN PROFUNDIDAD. Para probarlo de verdad se desactiva ese trigger dentro de una transacción y se revierte.
     */
    const withoutImmutable = async (fn: (c: pg.Client) => Promise<void>) =>
      withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('ALTER TABLE app.orders DISABLE TRIGGER orders_immutable_fields');
          await fn(c);
        } finally {
          await c.query('ROLLBACK');
        }
      });

    it.each(['pending', 'assigned', 'picked_up', 'delivered'] as const)(
      'entrega %s: no cambian branch_id, fulfillment_type ni delivery_provider (23001)',
      async (status) => {
        const d = await makeDelivery(status);
        for (const [col, value] of [
          ['branch_id', branch2Id],
          ['fulfillment_type', 'PICKUP'],
          ['delivery_provider', 'PEDIDOSYA'],
        ] as const) {
          // una transacción por columna: el error deja la transacción abortada y se revierte entera
          await withoutImmutable(async (c) => {
            await expect(
              c.query(`UPDATE app.orders SET ${col} = $2 WHERE id = $1`, [d.orderId, value]),
            ).rejects.toMatchObject({
              ...RESTRICT,
              message: has('orders_open_delivery_identity_guard'),
            });
          });
        }
      },
    );

    it('con entrega returned o cancelled, o sin entrega, el guard NO bloquea (queda la inmutabilidad de 0018)', async () => {
      for (const status of ['returned', 'cancelled'] as const) {
        const d = await makeDelivery(status);
        await withoutImmutable(async (c) => {
          await c.query(`UPDATE app.orders SET delivery_provider = 'PEDIDOSYA' WHERE id = $1`, [
            d.orderId,
          ]);
        });
      }
      const alone = await newOrder();
      await withoutImmutable(async (c) => {
        await c.query(`UPDATE app.orders SET delivery_provider = 'PEDIDOSYA' WHERE id = $1`, [
          alone,
        ]);
      });
    });

    it('con el trigger de 0018 activo la modificación ya se rechaza (42501)', async () => {
      const d = await makeDelivery('assigned');
      await expect(
        q(`UPDATE app.orders SET delivery_provider = 'PEDIDOSYA' WHERE id = $1`, [d.orderId]),
      ).rejects.toMatchObject(PRIV);
    });
  });

  describe('S3c pedido despachable al crear, reabrir y asignar (deliveries_guard)', () => {
    it('INSERT con el pedido pending, on_the_way, delivered, cancelled o rejected => 23514 YA en la sentencia (no en COMMIT)', async () => {
      for (const st of ['pending', 'on_the_way', 'delivered', 'cancelled', 'rejected']) {
        const orderId = await newOrder({ status: st });
        await expect(insertDelivery(orderId)).rejects.toMatchObject({
          ...CHECK,
          message: has('deliveries_guard'),
        });
      }
    });

    it('asignar y reabrir exigen accepted|preparing|ready en la misma transacción; recoger/entregar/retornar/cancelar NO', async () => {
      const d = await makeDelivery('assigned');
      const rider = await newRider();
      // asignar/reasignar con el pedido ya en on_the_way (sin pasar por la API): rechazado por la guarda
      await withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`UPDATE app.orders SET status = 'on_the_way' WHERE id = $1`, [d.orderId]);
          await expect(
            c.query(
              `UPDATE app.deliveries SET rider_id = $2, assigned_at = clock_timestamp(), version = version + 1 WHERE id = $1`,
              [d.id, rider],
            ),
          ).rejects.toMatchObject(CHECK);
        } finally {
          await c.query('ROLLBACK');
        }
      });
      // la recogida (assigned → picked_up) con el pedido on_the_way SÍ pasa
      await moveTo(d.id, d.orderId, 'picked_up', null);
      expect((await statusOf(d.id))?.status).toBe('picked_up');
      await moveTo(d.id, d.orderId, 'delivered', null);
      await moveTo(d.id, d.orderId, 'returned', null);
      expect((await statusOf(d.id))?.status).toBe('returned');
      // cancelar una entrega con el pedido ya cancelado/rechazado en la misma transacción
      const c2 = await makeDelivery('assigned');
      await tx(async (c) => {
        await c.query(
          `UPDATE app.deliveries SET status = 'cancelled', version = version + 1, rider_id = NULL, assigned_at = NULL,
                  cancelled_at = clock_timestamp() WHERE id = $1`,
          [c2.id],
        );
        await c.query(`UPDATE app.orders SET status = 'cancelled' WHERE id = $1`, [c2.orderId]);
      });
      // reabrir con el pedido cancelado => 23514 inmediato
      await expect(
        tx((c) =>
          c.query(
            `UPDATE app.deliveries SET status = 'pending', version = version + 1, cancelled_at = NULL WHERE id = $1`,
            [c2.id],
          ),
        ),
      ).rejects.toMatchObject({ ...CHECK, message: has('deliveries_guard') });
    });
  });

  describe('S4 mensajes con el nombre del trigger y de la restricción', () => {
    it('23505/23514 de restricciones llevan su nombre en el mensaje; los triggers informan CONSTRAINT = su nombre', async () => {
      const a = await makeDelivery('assigned');
      const second = await newOrder();
      const secondId = (await insertDelivery(second)).rows[0]?.id as string;
      await expect(
        patch(secondId, {
          status: 'assigned',
          version: 2,
          rider_id: a.riderId,
          assigned_at: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({
        ...UNIQUE,
        message: has('deliveries_one_active_per_rider_idx'),
      });
      await expect(insertDelivery(a.orderId)).rejects.toMatchObject({
        ...UNIQUE,
        message: has('deliveries_order_id_key'),
      });
      await expect(patch(a.id, { status: 'assigned' })).rejects.toMatchObject({
        ...CHECK,
        constraint: 'deliveries_guard',
      });
      await expect(setOrderStatus(a.orderId, 'cancelled')).rejects.toMatchObject({
        ...RESTRICT,
        constraint: 'orders_open_delivery_guard',
      });
    });
  });

  describe('delivery_status_history (solo-añadir)', () => {
    const addEvent = (deliveryId: string, o: Record<string, unknown> = {}) => {
      const row = { delivery_id: deliveryId, status: 'pending', event: 'created', ...o };
      const cols = Object.keys(row);
      return q<{ id: string }>(
        `INSERT INTO app.delivery_status_history (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        Object.values(row),
      );
    };

    it('CHECK: status, old_status y event fuera de catálogo y reason > 500 fallan; los 9 eventos válidos pasan', async () => {
      const d = await makeDelivery('pending');
      await expect(addEvent(d.id, { status: 'lost' })).rejects.toMatchObject(CHECK);
      await expect(addEvent(d.id, { old_status: 'lost' })).rejects.toMatchObject(CHECK);
      await expect(addEvent(d.id, { event: 'dispatched' })).rejects.toMatchObject(CHECK);
      await expect(addEvent(d.id, { reason: 'x'.repeat(501) })).rejects.toMatchObject(CHECK);
      await expect(addEvent(d.id, { reason: 'x'.repeat(500) })).resolves.toBeDefined();
      for (const ev of [
        'created',
        'reopened',
        'rider_assigned',
        'rider_reassigned',
        'rider_unassigned',
        'picked_up',
        'delivered',
        'returned',
        'cancelled',
      ])
        await expect(addEvent(d.id, { event: ev })).resolves.toBeDefined();
    });

    it('FK: entrega y motorista inexistentes (23503)', async () => {
      const d = await makeDelivery('pending');
      await expect(addEvent(randomUUID())).rejects.toMatchObject(FK);
      await expect(addEvent(d.id, { rider_id: randomUUID() })).rejects.toMatchObject(FK);
    });

    it('changed_by NO tiene FK (acepta un UUID cualquiera y NULL)', async () => {
      const d = await makeDelivery('pending');
      await expect(addEvent(d.id, { changed_by: randomUUID() })).resolves.toBeDefined();
      await expect(addEvent(d.id, { changed_by: null })).resolves.toBeDefined();
    });

    it('UPDATE y DELETE rechazados (42501); DELETE permitido solo con app.allow_order_cleanup = on', async () => {
      const d = await makeDelivery('pending');
      const id = (await addEvent(d.id)).rows[0]?.id as string;
      await expect(
        q(`UPDATE app.delivery_status_history SET reason = 'x' WHERE id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(`DELETE FROM app.delivery_status_history WHERE id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await tx(async (c) => {
        await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
        await c.query(`DELETE FROM app.delivery_status_history WHERE id = $1`, [id]);
      });
      expect(
        (await q(`SELECT 1 FROM app.delivery_status_history WHERE id = $1`, [id])).rowCount,
      ).toBe(0);
    });

    it('la entrega con historial no se puede borrar de la base (FK RESTRICT) sin limpiar el historial antes', async () => {
      const d = await makeDelivery('pending');
      await addEvent(d.id);
      await expect(
        tx(async (c) => {
          await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
          await c.query('DELETE FROM app.deliveries WHERE id = $1', [d.id]);
        }),
      ).rejects.toMatchObject(FK);
    });
  });

  describe('índices', () => {
    it('existen los índices esperados; el de «una activa por motorista» es ÚNICO y PARCIAL', async () => {
      const r = await q<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'app'
           AND tablename IN ('deliveries', 'delivery_status_history') ORDER BY 1`,
      );
      const by = Object.fromEntries(r.rows.map((x) => [x.indexname, x.indexdef]));
      expect(Object.keys(by).sort()).toEqual([
        'deliveries_branch_status_created_idx',
        'deliveries_one_active_per_rider_idx',
        'deliveries_order_id_key',
        'deliveries_pkey',
        'deliveries_rider_idx',
        'delivery_status_history_delivery_idx',
        'delivery_status_history_pkey',
        'delivery_status_history_rider_idx',
      ]);
      expect(by['deliveries_one_active_per_rider_idx']).toMatch(/UNIQUE INDEX/);
      expect(by['deliveries_one_active_per_rider_idx']).toMatch(/\(rider_id\)/);
      expect(by['deliveries_one_active_per_rider_idx']).toMatch(
        /WHERE .*status.*assigned.*picked_up.*delivered/s,
      );
      expect(by['deliveries_branch_status_created_idx']).toMatch(
        /\(branch_id, status, created_at DESC, id DESC\)/,
      );
      expect(by['deliveries_rider_idx']).toMatch(/WHERE .*rider_id IS NOT NULL/s);
      expect(by['delivery_status_history_delivery_idx']).toMatch(/\(delivery_id, changed_at, id\)/);
    });
  });

  describe('RLS y privilegios', () => {
    const tables = ['deliveries', 'delivery_status_history'];
    const functions = [
      'delivery_status_history_append_only()',
      'deliveries_guard()',
      'deliveries_order_coherence()',
      'orders_open_delivery_guard()',
      'orders_open_delivery_identity_guard()',
      'orders_delivery_coherence()',
      'delivery_order_coherent(text, text)',
    ];
    it('RLS habilitada sin ninguna política en ambas tablas', async () => {
      for (const t of tables) {
        const r = await q<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`,
          [`app.${t}`],
        );
        expect(r.rows[0]?.relrowsecurity, t).toBe(true);
        expect(
          (await q(`SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = $1`, [t]))
            .rowCount,
        ).toBe(0);
      }
    });

    it('PUBLIC, anon y authenticated no tienen privilegios sobre las tablas ni EXECUTE sobre las funciones', async () => {
      for (const role of ['anon', 'authenticated']) {
        if (!(await q(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role])).rowCount) continue;
        for (const t of tables)
          for (const priv of [
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER',
          ]) {
            const r = await q<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
              role,
              `app.${t}`,
              priv,
            ]);
            expect(r.rows[0]?.ok, `${role} ${t} ${priv}`).toBe(false);
          }
        for (const f of functions) {
          const r = await q<{ ok: boolean }>(
            `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
            [role, `app.${f}`],
          );
          expect(r.rows[0]?.ok, `${role} EXECUTE ${f}`).toBe(false);
        }
      }
      for (const t of tables) {
        const acl = await q<{ relacl: string | null }>(
          `SELECT relacl::text FROM pg_class WHERE oid = $1::regclass`,
          [`app.${t}`],
        );
        expect(acl.rows[0]?.relacl ?? '', t).not.toMatch(/(^|[{,])=/); // sin entrada de PUBLIC
      }
      for (const f of functions) {
        const acl = await q<{ proacl: string | null }>(
          `SELECT proacl::text FROM pg_proc WHERE oid = $1::regprocedure`,
          [`app.${f}`],
        );
        expect(acl.rows[0]?.proacl ?? '', f).not.toMatch(/(^|[{,])=/);
      }
    });
  });
});
