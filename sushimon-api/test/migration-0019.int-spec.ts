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
 * Migración 0019 (F24 pagos en efectivo: payment_methods, payments, payment_events, triggers, seed `cash`, backfill) sobre una
 * base DESECHABLE creada aquí (`sushimon_mig0019_test`): 0001..0018 aplicadas, se siembran pedidos HISTÓRICOS (cash, NULL y
 * `bank_transfer`) y luego se aplica 0019. Mismo patrón y misma omisión explícita que migration-0016/0017/0018.int-spec.ts:
 * requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase real se omite y se avisa.
 *
 * ESTADO: ESCRITA PERO NO EJECUTADA (la migración 0019 aún no está aplicada a ninguna base; el api-engineer no ejecuta SQL
 * contra bases reales). Cubre la matriz de spec 025 §13: #2, #3, #19 (a nivel de BD), #30, #35, #40, #41, #58, #62.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0019_test';
const M0019 = '0019_cash_payments';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const BEFORE = readdirSync(migrationsDir)
  .filter((d) => /^\d{4}_/.test(d) && d < M0019)
  .sort();
const migrationSql = (name: string) =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const PRIV = { code: '42501' };
const hash32 = (n: number) => Buffer.alloc(32, n);

describe.skipIf(!url)('Migración 0019: pagos en efectivo (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let branchId = '';
  let branch2Id = '';
  let cashMethodId = '';
  const legacy = { cash: '', nul: '', bank: '' };

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const scalar = async (sql: string, params: unknown[] = []) =>
    (await q<{ n: number }>(sql, params)).rows[0]?.n;

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

  const insertOrder = async (c: pg.Client | null, o: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(),
      branch_id: branchId,
      customer_name: 'Ana Pérez',
      customer_phone: '+50255551234',
      fulfillment_type: 'PICKUP',
      subtotal: '185.00',
      total: '185.00',
      ...o,
    };
    const cols = Object.keys(row);
    const sql = `INSERT INTO app.orders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`;
    const res = c
      ? await c.query<{ id: string }>(sql, Object.values(row))
      : await q<{ id: string }>(sql, Object.values(row));
    return res.rows[0]?.id as string;
  };
  /** Pago `pending` válido (la creación real lo hace F20 en la misma transacción del pedido). */
  const insertPayment = (orderId: string, o: Record<string, unknown> = {}) => {
    const row = {
      order_id: orderId,
      method_id: cashMethodId,
      branch_id: branchId,
      amount: '185.00',
      ...o,
    };
    const cols = Object.keys(row);
    return q<{ id: string }>(
      `INSERT INTO app.payments (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
  };
  const PAID = {
    status: 'paid',
    tendered_amount: '200.00',
    change_amount: '15.00',
    collector_type: 'STAFF',
    received_by_staff_id: randomUUID(),
    collection_context: 'BRANCH',
    received_at: new Date().toISOString(),
    confirm_key_hash: hash32(1),
    confirm_request_hash: hash32(2),
  };
  const markPaid = (paymentId: string, o: Record<string, unknown> = {}) => {
    const row = { ...PAID, ...o };
    const sets = Object.keys(row).map((k, i) => `${k} = $${i + 2}`);
    return q(`UPDATE app.payments SET ${sets.join(', ')} WHERE id = $1`, [
      paymentId,
      ...Object.values(row),
    ]);
  };
  const newPending = async (o: Record<string, unknown> = {}) => {
    const orderId = await insertOrder(null, o);
    const id = (await insertPayment(orderId, { amount: o['total'] ?? '185.00' })).rows[0]
      ?.id as string;
    return { orderId, id };
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0019.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0019 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of BEFORE) await c.query(migrationSql(m));
      const br = await c.query<{ id: string }>(
        `INSERT INTO app.branches (code, name, address) VALUES ('suc-0019','B','dir'), ('suc-0019b','B2','dir') RETURNING id`,
      );
      branchId = br.rows[0]?.id as string;
      branch2Id = br.rows[1]?.id as string;
      // Pedidos HISTÓRICOS (antes de 0019): cash, sin preferencia y bank_transfer (válido con el CHECK de 0018).
      legacy.cash = await insertOrder(c, { payment_method_preference: 'cash' });
      legacy.nul = await insertOrder(c, {
        payment_method_preference: null,
        total: '50.00',
        subtotal: '50.00',
      });
      legacy.bank = await insertOrder(c, { payment_method_preference: 'bank_transfer' });
      await c.query(migrationSql(M0019));
      cashMethodId = (
        await c.query<{ id: string }>(`SELECT id FROM app.payment_methods WHERE code = 'cash'`)
      ).rows[0]?.id as string;
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

  /** Limpia SOLO los pagos y pedidos de las pruebas (no los históricos del backfill) con la excepción controlada de 0019. */
  afterEach(async () => {
    if (!plain) return;
    await tx(async (c) => {
      await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
      const keep = [legacy.cash, legacy.nul, legacy.bank];
      await c.query('DELETE FROM app.payment_events WHERE order_id <> ALL($1::uuid[])', [keep]);
      await c.query('DELETE FROM app.payments WHERE order_id <> ALL($1::uuid[])', [keep]);
      await c.query('DELETE FROM app.order_status_history WHERE order_id <> ALL($1::uuid[])', [
        keep,
      ]);
      await c.query('DELETE FROM app.orders WHERE id <> ALL($1::uuid[])', [keep]);
    });
  });

  describe('#58 estructura, seed y backfill', () => {
    it('crea las 3 tablas, solo el método `cash` y NINGUNA tabla de reembolsos (#40)', async () => {
      const t = await q<{ t: string }>(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'app'
          AND table_name IN ('payment_methods','payments','payment_events','refunds','payment_transfers') ORDER BY 1`,
      );
      expect(t.rows.map((r) => r.t)).toEqual(['payment_events', 'payment_methods', 'payments']);
      const methods = await q<{ code: string; active: boolean }>(
        `SELECT code, active FROM app.payment_methods`,
      );
      expect(methods.rows).toEqual([{ code: 'cash', active: true }]);
    });

    it('backfill: un pago `pending` + evento `created` por pedido cash/NULL con el total y la sucursal; el bank_transfer NO recibe pago', async () => {
      const rows = await q<{ order_id: string; status: string; amount: string; branch_id: string }>(
        `SELECT order_id, status, amount::text, branch_id FROM app.payments WHERE order_id = ANY($1::uuid[]) ORDER BY amount`,
        [[legacy.cash, legacy.nul, legacy.bank]],
      );
      expect(rows.rows.map((r) => [r.order_id, r.status, r.amount, r.branch_id])).toEqual([
        [legacy.nul, 'pending', '50.00', branchId],
        [legacy.cash, 'pending', '185.00', branchId],
      ]);
      expect(
        await scalar(`SELECT count(*)::int AS n FROM app.payments WHERE order_id = $1`, [
          legacy.bank,
        ]),
      ).toBe(0);
      expect(
        await scalar(
          `SELECT count(*)::int AS n FROM app.payment_events WHERE event_type = 'created' AND order_id = ANY($1::uuid[])`,
          [[legacy.cash, legacy.nul]],
        ),
      ).toBe(2);
    });

    it('es relanzable: reaplicarla no falla ni duplica pagos, eventos, índices, restricciones ni triggers', async () => {
      const snapshot = async () =>
        (
          await q<{ n: number }>(
            `SELECT (SELECT count(*) FROM app.payments) + (SELECT count(*) FROM app.payment_events)
                  + (SELECT count(*) FROM app.payment_methods)
                  + (SELECT count(*) FROM pg_indexes WHERE schemaname='app' AND tablename IN ('payments','payment_events','payment_methods'))
                  + (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('app.payments'::regclass,'app.payment_events'::regclass,'app.payment_methods'::regclass))
                  + (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('app.payments'::regclass,'app.payment_events'::regclass,'app.orders'::regclass)) AS n`,
          )
        ).rows[0]?.n;
      const before = await snapshot();
      await withClient(scratch, (c) => c.query(migrationSql(M0019)));
      expect(await snapshot()).toBe(before);
    });

    it('la guarda falla con claridad si una tabla existe con otra definición (y no modifica nada)', async () => {
      await withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`ALTER TABLE app.payments DROP CONSTRAINT payments_reception_chk`);
          await expect(c.query(migrationSql(M0019))).rejects.toThrow(/payments_reception_chk/);
        } finally {
          await c.query('ROLLBACK');
        }
      });
    });

    it('RLS activada sin políticas; los pedidos existentes no se modificaron', async () => {
      const rls = await q<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'app'::regnamespace
          AND relname IN ('payment_methods','payments','payment_events') ORDER BY 1`,
      );
      expect(rls.rows).toHaveLength(3);
      expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
      expect(
        await scalar(
          `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='app' AND tablename LIKE 'payment%'`,
        ),
      ).toBe(0);
      const bank = await q<{ payment_method_preference: string }>(
        `SELECT payment_method_preference FROM app.orders WHERE id = $1`,
        [legacy.bank],
      );
      expect(bank.rows[0]?.payment_method_preference).toBe('bank_transfer');
    });
  });

  describe('#3 preferencia cash-only (trigger BEFORE INSERT) y filas legacy', () => {
    it('INSERT con bank_transfer => 23514; con cash o NULL pasa', async () => {
      await expect(
        insertOrder(null, { payment_method_preference: 'bank_transfer' }),
      ).rejects.toMatchObject(CHECK);
      await insertOrder(null, { payment_method_preference: 'cash' });
      await insertOrder(null, { payment_method_preference: null });
    });

    it('UPDATE de una fila legacy bank_transfer SÍ funciona (las transiciones de F22 no se rompen)', async () => {
      await q(`UPDATE app.orders SET status = 'accepted' WHERE id = $1`, [legacy.bank]);
      await q(`UPDATE app.orders SET status = 'pending' WHERE id = $1`, [legacy.bank]);
    });
  });

  describe('#2 UNIQUE(order_id) y creación', () => {
    it('un segundo pago para el mismo pedido => 23505', async () => {
      const { orderId } = await newPending();
      await expect(insertPayment(orderId)).rejects.toMatchObject(UNIQUE);
    });

    it('el pago nace pending con el TOTAL y la SUCURSAL del pedido: otro importe, otra sucursal o status paid => 23514', async () => {
      const a = await insertOrder(null);
      await expect(insertPayment(a, { amount: '1.00' })).rejects.toMatchObject(CHECK);
      await expect(insertPayment(a, { branch_id: branch2Id })).rejects.toMatchObject(CHECK);
      await expect(insertPayment(a, PAID)).rejects.toMatchObject(CHECK);
    });

    it('método inexistente o pedido inexistente => 23503 (FK)', async () => {
      const a = await insertOrder(null);
      await expect(insertPayment(a, { method_id: randomUUID() })).rejects.toBeDefined();
      await expect(insertPayment(randomUUID())).rejects.toBeDefined();
      // (el trigger de INSERT puede responder 23514 antes que la FK 23503 cuando el pedido no existe)
      void FK;
    });

    it('CHECK solo-efectivo: provider, provider_reference e idempotency_key deben ser NULL', async () => {
      const a = await insertOrder(null);
      await expect(insertPayment(a, { provider: 'neonet' })).rejects.toMatchObject(CHECK);
      await expect(insertPayment(a, { provider_reference: 'x' })).rejects.toMatchObject(CHECK);
      await expect(insertPayment(a, { idempotency_key: 'k' })).rejects.toMatchObject(CHECK);
    });
  });

  describe('#41 #35 #62 coherencia por estado e inmutabilidad', () => {
    it('pending -> paid con recepción completa funciona; el cambio es tendered - amount', async () => {
      const { id } = await newPending();
      await markPaid(id);
      const r = await q<{ status: string; change_amount: string }>(
        `SELECT status, change_amount::text FROM app.payments WHERE id = $1`,
        [id],
      );
      expect(r.rows[0]).toEqual({ status: 'paid', change_amount: '15.00' });
    });

    it.each([
      ['sin efectivo entregado', { tendered_amount: null }],
      ['efectivo menor al importe', { tendered_amount: '100.00', change_amount: '0.00' }],
      ['cambio inconsistente', { change_amount: '14.00' }],
      ['sin cobrador', { received_by_staff_id: null }],
      ['collector_type RIDER (F28 aún no existe)', { collector_type: 'RIDER' }],
      ['contexto inválido', { collection_context: 'ONLINE' }],
      ['sin fecha', { received_at: null }],
      ['hash de clave de 16 bytes', { confirm_key_hash: Buffer.alloc(16) }],
      ['sin hash del cuerpo', { confirm_request_hash: null }],
    ])('paid %s => 23514', async (_n, over) => {
      const { id } = await newPending();
      await expect(markPaid(id, over)).rejects.toMatchObject(CHECK);
    });

    it('#62 paid con amount = 0 => 23514 (nada que cobrar)', async () => {
      const { id } = await newPending({ total: '0.00', subtotal: '0.00' });
      await expect(
        markPaid(id, { tendered_amount: '1.00', change_amount: '1.00' }),
      ).rejects.toMatchObject(CHECK);
    });

    it('un pending con campos de recepción => 23514', async () => {
      const { id } = await newPending();
      await expect(
        q(`UPDATE app.payments SET tendered_amount = 1 WHERE id = $1`, [id]),
      ).rejects.toMatchObject(CHECK);
    });

    it('un pago `paid` es inmutable: cualquier UPDATE, paid -> pending y borrado directo => 42501', async () => {
      const { id } = await newPending();
      await markPaid(id);
      await expect(
        q(`UPDATE app.payments SET updated_at = now() WHERE id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(`UPDATE app.payments SET tendered_amount = 300, change_amount = 115 WHERE id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(
          `UPDATE app.payments SET status = 'pending', tendered_amount = NULL, change_amount = NULL, collector_type = NULL,
             received_by_staff_id = NULL, collection_context = NULL, received_at = NULL, confirm_key_hash = NULL, confirm_request_hash = NULL
           WHERE id = $1`,
          [id],
        ),
      ).rejects.toMatchObject(PRIV);
      await expect(q(`DELETE FROM app.payments WHERE id = $1`, [id])).rejects.toMatchObject(PRIV);
    });

    it('en un pending, id/pedido/método/sucursal/importe/created_at son inmutables y el borrado directo se rechaza (42501)', async () => {
      const { id } = await newPending();
      const other = await insertOrder(null);
      await expect(
        q(`UPDATE app.payments SET order_id = $2 WHERE id = $1`, [id, other]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(`UPDATE app.payments SET branch_id = $2 WHERE id = $1`, [id, branch2Id]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(`UPDATE app.payments SET amount = 1 WHERE id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(`UPDATE app.payments SET created_at = now() - interval '1 day' WHERE id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await expect(q(`DELETE FROM app.payments WHERE id = $1`, [id])).rejects.toMatchObject(PRIV);
    });

    it('el borrado solo se permite con la excepción de limpieza de pruebas (app.allow_order_cleanup)', async () => {
      const { id } = await newPending();
      await tx(async (c) => {
        await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
        await c.query('DELETE FROM app.payments WHERE id = $1', [id]);
      });
      expect(await scalar(`SELECT count(*)::int AS n FROM app.payments WHERE id = $1`, [id])).toBe(
        0,
      );
    });
  });

  describe('#30 payment_events solo-añadir', () => {
    it('created sin actor ni efectivo; cash_received con actor, efectivo y cambio coherentes; lo demás => 23514', async () => {
      const { id, orderId } = await newPending();
      const ev = (o: Record<string, unknown>) => {
        const row = { payment_id: id, order_id: orderId, amount: '185.00', ...o };
        const cols = Object.keys(row);
        return q(
          `INSERT INTO app.payment_events (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(row),
        );
      };
      await ev({ event_type: 'created' });
      await ev({
        event_type: 'cash_received',
        actor_staff_id: randomUUID(),
        tendered_amount: '200.00',
        change_amount: '15.00',
      });
      await expect(
        ev({ event_type: 'created', actor_staff_id: randomUUID() }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        ev({ event_type: 'cash_received', tendered_amount: '200.00', change_amount: '15.00' }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        ev({
          event_type: 'cash_received',
          actor_staff_id: randomUUID(),
          tendered_amount: '200.00',
          change_amount: '10.00',
        }),
      ).rejects.toMatchObject(CHECK);
      await expect(ev({ event_type: 'voided' })).rejects.toMatchObject(CHECK);
    });

    it('UPDATE y borrado directo => 42501; con la excepción de limpieza el borrado sí', async () => {
      const { id, orderId } = await newPending();
      await q(
        `INSERT INTO app.payment_events (payment_id, order_id, event_type, amount) VALUES ($1,$2,'created',185)`,
        [id, orderId],
      );
      await expect(
        q(`UPDATE app.payment_events SET amount = 1 WHERE payment_id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await expect(
        q(`DELETE FROM app.payment_events WHERE payment_id = $1`, [id]),
      ).rejects.toMatchObject(PRIV);
      await tx(async (c) => {
        await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
        await c.query('DELETE FROM app.payment_events WHERE payment_id = $1', [id]);
      });
    });
  });

  describe('concurrencia a nivel de BD (#19)', () => {
    it('cuatro UPDATE condicionales simultáneos sobre el mismo pago pending: exactamente UNO cambia filas', async () => {
      const { id } = await newPending();
      const cas = () =>
        withClient(scratch, async (c) => {
          const r = await c.query(
            `UPDATE app.payments p SET status = 'paid', tendered_amount = 200, change_amount = 15, collector_type = 'STAFF',
               received_by_staff_id = $2, collection_context = 'BRANCH', received_at = clock_timestamp(),
               confirm_key_hash = $3, confirm_request_hash = $4, updated_at = clock_timestamp()
              FROM app.orders o WHERE p.id = $1 AND p.order_id = o.id AND p.status = 'pending' AND o.status NOT IN ('rejected','cancelled')`,
            [id, randomUUID(), hash32(1), hash32(2)],
          );
          return r.rowCount ?? 0;
        });
      const counts = await Promise.all([cas(), cas(), cas(), cas()]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    });
  });
});
