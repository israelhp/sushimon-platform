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
 * Migración 0024 (pedidos solo a domicilio: `orders_delivery_only_chk`) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0024_test`): se aplican 0001..0023, se siembra un pedido PICKUP HISTÓRICO y solo entonces se aplica la 0024.
 * Mismo patrón y misma omisión explícita que migration-0022/0023.int-spec.ts: requiere PostgreSQL plano
 * (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0024_test';
const M0024 = '0024_orders_delivery_only';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const BEFORE = readdirSync(migrationsDir)
  .filter((d) => /^\d{4}_/.test(d) && d < M0024)
  .sort();
const migrationSql = (name: string) =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
const CONSTRAINT = 'orders_delivery_only_chk';
const DELIVERY_ONLY = { code: '23514', constraint: CONSTRAINT };

describe.skipIf(!url)('Migración 0024: pedidos solo a domicilio (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let branchId = '';
  let legacyId = '';
  let legacyPlacedAt = new Date(0);
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
  const insertOrder = async (c: pg.Client, o: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(),
      branch_id: branchId,
      customer_name: 'Ana Pérez',
      customer_phone: '+50255551234',
      fulfillment_type: 'PICKUP',
      subtotal: '100.00',
      total: '100.00',
      ...o,
    };
    const cols = Object.keys(row);
    await c.query(
      `INSERT INTO app.orders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
    return row.id;
  };
  /** INSERT de un PICKUP (placed_at = now() por defecto o el indicado). */
  const pickup = (o: Record<string, unknown> = {}) =>
    withClient(scratch, (c) => insertOrder(c, { customer_phone: `+5025555${1000 + ++seq}`, ...o }));
  /** DELIVERY válido con su dirección (el constraint trigger la exige al COMMIT). */
  const delivery = (o: Record<string, unknown> = {}) =>
    tx(async (c) => {
      const id = await insertOrder(c, {
        fulfillment_type: 'DELIVERY',
        delivery_provider: 'OWN',
        delivery_fee: '15.00',
        total: '115.00',
        ...o,
      });
      await c.query(
        `INSERT INTO app.order_addresses (order_id, municipality_name, address_line) VALUES ($1, 'Guatemala', '6a Av 1-23')`,
        [id],
      );
      return id;
    });
  const constraintDef = async () =>
    (
      await q<{ d: string; c: string | null }>(
        `SELECT pg_get_constraintdef(oid) AS d, obj_description(oid, 'pg_constraint') AS c FROM pg_constraint
          WHERE conrelid = 'app.orders'::regclass AND conname = $1`,
        [CONSTRAINT],
      )
    ).rows;

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0024.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0024 NO se probó.',
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
        `INSERT INTO app.branches (code, name, address) VALUES ('suc-0024','B','dir') RETURNING id`,
      );
      branchId = br.rows[0]?.id as string;
      // Pedido PICKUP en curso ANTES de la 0024 (legal entonces, con placed_at = now()).
      legacyId = await insertOrder(c, { customer_phone: '+50255550024', status: 'accepted' });
      legacyPlacedAt = (
        await c.query<{ p: Date }>(`SELECT placed_at AS p FROM app.orders WHERE id = $1`, [
          legacyId,
        ])
      ).rows[0]?.p as Date;
      // La migración se aplica con el PICKUP ya presente: debe validar (corte posterior a su placed_at).
      await c.query(migrationSql(M0024));
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

  it('la migración validó con un PICKUP previo y registra el corte (definición y COMMENT)', async () => {
    const rows = await constraintDef();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.d).toContain("fulfillment_type = 'DELIVERY'");
    expect(rows[0]?.d).toContain('placed_at <');
    expect(rows[0]?.c).toContain('0024');
    const v = await q<{ v: boolean }>(
      `SELECT convalidated AS v FROM pg_constraint WHERE conname = $1 AND conrelid = 'app.orders'::regclass`,
      [CONSTRAINT],
    );
    expect(v.rows[0]?.v).toBe(true);
    const cutoff = (
      await q<{ c: Date }>(
        `SELECT substring(pg_get_constraintdef(oid) FROM 'placed_at < ''([^'']+)''')::timestamptz AS c
           FROM pg_constraint WHERE conname = $1 AND conrelid = 'app.orders'::regclass`,
        [CONSTRAINT],
      )
    ).rows[0]?.c as Date;
    expect(cutoff.getTime()).toBeGreaterThan(legacyPlacedAt.getTime());
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('un PICKUP nuevo falla con 23514 y el nombre orders_delivery_only_chk', async () => {
    await expect(pickup()).rejects.toMatchObject(DELIVERY_ONLY);
    await expect(pickup({ placed_at: new Date(Date.now() + 86_400_000) })).rejects.toMatchObject(
      DELIVERY_ONLY,
    );
    // Un valor fuera del catálogo sigue rechazándose (23514; PostgreSQL evalúa los CHECK por orden de nombre, así que el
    // nombre reportado puede ser el de cualquiera de las dos restricciones).
    await expect(pickup({ fulfillment_type: 'pickup' })).rejects.toMatchObject({ code: '23514' });
  });

  it('un DELIVERY nuevo (OWN y PEDIDOSYA) con su dirección pasa', async () => {
    await expect(delivery()).resolves.toEqual(expect.any(String));
    await expect(delivery({ delivery_provider: 'PEDIDOSYA' })).resolves.toEqual(expect.any(String));
  });

  it('el PICKUP existente sigue siendo actualizable: cambio de estado y cancelación', async () => {
    await q(`UPDATE app.orders SET status = 'preparing' WHERE id = $1`, [legacyId]);
    await q(`UPDATE app.orders SET status = 'ready', notes = 'listo' WHERE id = $1`, [legacyId]);
    await q(`UPDATE app.orders SET status = 'picked_up' WHERE id = $1`, [legacyId]);
    const st = await q<{ status: string }>(`SELECT status FROM app.orders WHERE id = $1`, [
      legacyId,
    ]);
    expect(st.rows[0]?.status).toBe('picked_up');
    // Cancelación de otro PICKUP histórico (placed_at anterior al corte; modela un registro importado/en curso).
    const other = await pickup({ placed_at: new Date(legacyPlacedAt.getTime() - 60_000) });
    await q(`UPDATE app.orders SET status = 'cancelled' WHERE id = $1`, [other]);
    const c = await q<{ status: string }>(`SELECT status FROM app.orders WHERE id = $1`, [other]);
    expect(c.rows[0]?.status).toBe('cancelled');
    // placed_at sigue inmutable: la condición del CHECK de un PICKUP histórico nunca cambia.
    await expect(
      q(`UPDATE app.orders SET placed_at = now() WHERE id = $1`, [legacyId]),
    ).rejects.toThrow(/inmutables/);
  });

  it('conserva las demás restricciones de modalidad (orders_fulfillment_chk y coherencia de proveedor)', async () => {
    const names = await q<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'app.orders'::regclass AND conname LIKE 'orders\\_%chk'`,
    );
    const set = new Set(names.rows.map((r) => r.conname));
    for (const n of ['orders_fulfillment_chk', 'orders_provider_coherent_chk', CONSTRAINT]) {
      expect(set.has(n), n).toBe(true);
    }
    // PICKUP histórico con proveedor sigue siendo inválido por la regla previa (otra restricción).
    await expect(
      pickup({
        placed_at: new Date(legacyPlacedAt.getTime() - 120_000),
        delivery_provider: 'OWN',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'orders_provider_coherent_chk' });
  });

  it('marca scheduled_for como obsoleta (COMMENT) sin eliminarla', async () => {
    const r = await q<{ c: string | null }>(
      `SELECT col_description('app.orders'::regclass, attnum) AS c FROM pg_attribute
        WHERE attrelid = 'app.orders'::regclass AND attname = 'scheduled_for' AND NOT attisdropped`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.c).toContain('OBSOLETA');
  });

  it('es idempotente: reaplicarla no recrea ni cambia el corte, y sigue rechazando PICKUP nuevos', async () => {
    const before = await constraintDef();
    await withClient(scratch, (c) => c.query(migrationSql(M0024)));
    await withClient(scratch, (c) => c.query(migrationSql(M0024)));
    const after = await constraintDef();
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
    await expect(pickup()).rejects.toMatchObject(DELIVERY_ONLY);
  });

  it('aborta con mensaje claro si hay un PICKUP con placed_at futuro y la restricción no existe aún', async () => {
    await q(`ALTER TABLE app.orders DROP CONSTRAINT ${CONSTRAINT}`);
    const future = await pickup({ placed_at: new Date(Date.now() + 3_600_000) });
    await expect(withClient(scratch, (c) => c.query(migrationSql(M0024)))).rejects.toThrow(
      /pedidos no DELIVERY con placed_at >= corte/,
    );
    expect(await constraintDef()).toHaveLength(0);
    await q(`DELETE FROM app.orders WHERE id = $1`, [future]);
    await withClient(scratch, (c) => c.query(migrationSql(M0024))); // reaplicable tras corregir
    expect(await constraintDef()).toHaveLength(1);
  });
});
