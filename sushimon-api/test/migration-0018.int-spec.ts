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
 * Migración 0018 (F20 pedidos: orders, order_addresses, order_items, order_item_modifiers, order_promotions,
 * order_status_history, order_access_tokens, order_idempotency_keys) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0018_test`), con 0001..0017 aplicadas en orden y luego 0018. Mismo patrón y misma omisión explícita que
 * migration-0016/0017.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase
 * real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0018_test';
const M0018 = '0018_orders';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const BEFORE = readdirSync(migrationsDir)
  .filter((d) => /^\d{4}_/.test(d) && d < M0018)
  .sort();
const migrationSql = (name: string) =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const PRIV = { code: '42501' };
const GENERATED_ALWAYS = { code: '428C9' };
const TABLES = [
  'orders',
  'order_addresses',
  'order_items',
  'order_item_modifiers',
  'order_promotions',
  'order_status_history',
  'order_access_tokens',
  'order_idempotency_keys',
];
const hash32 = (n: number) => Buffer.alloc(32, n);
const STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

describe.skipIf(!url)('Migración 0018: pedidos (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let seq = 0;
  let branchId = '';
  let productId = '';
  let modifierId = '';
  let promotionId = '';

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const count = async (table: string) =>
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${table}`)).rows[0]?.n;

  /** Ejecuta `fn` en UNA transacción (COMMIT si resuelve, ROLLBACK si rechaza: se propaga el error original). */
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

  const orderRow = (o: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    branch_id: branchId,
    customer_name: 'Ana Pérez',
    customer_phone: '+50255551234',
    fulfillment_type: 'PICKUP',
    subtotal: '100.00',
    total: '100.00',
    ...o,
  });
  const insertOrder = async (c: pg.Client, o: Record<string, unknown> = {}) => {
    const row = orderRow(o);
    const cols = Object.keys(row);
    const r = await c.query<{ id: string; order_number: string }>(
      `INSERT INTO app.orders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
       RETURNING id, order_number`,
      Object.values(row),
    );
    return r.rows[0] as { id: string; order_number: string };
  };
  const insertAddress = (c: pg.Client, orderId: string, o: Record<string, unknown> = {}) => {
    const row = {
      order_id: orderId,
      municipality_name: 'Guatemala',
      address_line: '6a Av 1-23',
      ...o,
    };
    const cols = Object.keys(row);
    return c.query(
      `INSERT INTO app.order_addresses (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
  };
  /** Pedido PICKUP válido (autocommit). `o` sobrescribe columnas. */
  const pickup = (o: Record<string, unknown> = {}) => withClient(scratch, (c) => insertOrder(c, o));
  /** Pedido DELIVERY válido con su dirección en la misma transacción. */
  const delivery = (o: Record<string, unknown> = {}) =>
    tx(async (c) => {
      const ord = await insertOrder(c, {
        fulfillment_type: 'DELIVERY',
        delivery_provider: 'OWN',
        delivery_fee: '15.00',
        total: '115.00',
        ...o,
      });
      await insertAddress(c, ord.id);
      return ord;
    });
  const item = async (orderId: string, o: Record<string, unknown> = {}) => {
    const row = {
      order_id: orderId,
      line_no: 1,
      product_id: productId,
      product_name: 'Roll',
      quantity: 2,
      unit_price: '50.00',
      ...o,
    };
    const cols = Object.keys(row);
    return (
      await q<{ id: string }>(
        `INSERT INTO app.order_items (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        Object.values(row),
      )
    ).rows[0]?.id as string;
  };
  const history = (orderId: string, o: Record<string, unknown> = {}) => {
    const row = { order_id: orderId, old_status: null, new_status: 'pending', ...o };
    const cols = Object.keys(row);
    return q(
      `INSERT INTO app.order_status_history (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
  };
  const token = (orderId: string, o: Record<string, unknown> = {}) => {
    const row = {
      order_id: orderId,
      token_hash: hash32(++seq),
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
      ...o,
    };
    const cols = Object.keys(row);
    return q(
      `INSERT INTO app.order_access_tokens (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
  };
  const idemRow = (orderId: string, o: Record<string, unknown> = {}) => ({
    scope: 'guest',
    key_hash: hash32(++seq),
    request_hash: hash32(200),
    order_id: orderId,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    ...o,
  });
  const idem = (c: pg.Client, orderId: string, o: Record<string, unknown> = {}) => {
    const row = idemRow(orderId, o);
    const cols = Object.keys(row);
    return c.query(
      `INSERT INTO app.order_idempotency_keys (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0018.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0018 NO se probó.',
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
      await c.query(migrationSql(M0018));
      const cat = await c.query<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ('cat-0018','Cat') RETURNING id`,
      );
      const prod = await c.query<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id) VALUES ('p-0018','p',50,$1) RETURNING id`,
        [cat.rows[0]?.id],
      );
      productId = prod.rows[0]?.id as string;
      const grp = await c.query<{ id: string }>(
        `INSERT INTO app.modifier_groups (name) VALUES ('Grupo') RETURNING id`,
      );
      const mod = await c.query<{ id: string }>(
        `INSERT INTO app.modifiers (group_id, name, extra_price) VALUES ($1,'Extra',5) RETURNING id`,
        [grp.rows[0]?.id],
      );
      modifierId = mod.rows[0]?.id as string;
      const promo = await c.query<{ id: string }>(
        `INSERT INTO app.promotions (name, kind, value, starts_at, ends_at)
         VALUES ('Promo','PERCENT',10,'2026-01-01T00:00:00Z','2026-12-31T00:00:00Z') RETURNING id`,
      );
      promotionId = promo.rows[0]?.id as string;
      const br = await c.query<{ id: string }>(
        `INSERT INTO app.branches (code, name, address) VALUES ('suc-0018','B','dir') RETURNING id`,
      );
      branchId = br.rows[0]?.id as string;
    });
  });
  afterAll(async () => {
    if (!plain) return;
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    });
  });
  beforeEach(async (ctx) => {
    if (!plain) {
      ctx.skip();
      return;
    }
    // Limpieza: los snapshots son inmutables; el DELETE solo se permite con la excepción controlada de pruebas.
    await tx(async (c) => {
      await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
      for (const t of [
        'order_idempotency_keys',
        'order_access_tokens',
        'order_status_history',
        'order_item_modifiers',
        'order_items',
        'order_promotions',
        'order_addresses',
        'orders',
      ]) {
        await c.query(`DELETE FROM app.${t}`);
      }
    });
  });

  it('es idempotente: reaplicarla no falla ni duplica índices, restricciones, triggers ni permisos', async () => {
    const snapshot = async () =>
      (
        await q<{ n: number }>(
          `SELECT (SELECT count(*) FROM pg_indexes WHERE schemaname='app' AND tablename = ANY($1))
                + (SELECT count(*) FROM pg_constraint WHERE conrelid = ANY($2::regclass[]))
                + (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = ANY($2::regclass[])) AS n`,
          [TABLES, TABLES.map((t) => `app.${t}`)],
        )
      ).rows[0]?.n;
    const before = await snapshot();
    await withClient(scratch, (c) => c.query(migrationSql(M0018)));
    expect(await snapshot()).toBe(before);
  });

  it('la guarda falla con claridad si una tabla existe con otra definición', async () => {
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`ALTER TABLE app.orders DROP CONSTRAINT orders_total_chk`);
        await expect(c.query(migrationSql(M0018))).rejects.toThrow(/orders_total_chk/);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });

  describe('orders: IDENTITY de order_number', () => {
    it('INSERT sin order_number asigna números crecientes desde >= 1001', async () => {
      const a = await pickup();
      const b = await pickup();
      expect(Number(a.order_number)).toBeGreaterThanOrEqual(1001);
      expect(Number(b.order_number)).toBeGreaterThan(Number(a.order_number));
    });

    it('no se puede fijar manualmente (GENERATED ALWAYS) ni cambiar con UPDATE', async () => {
      const row = orderRow({ order_number: 5 });
      const cols = Object.keys(row);
      await expect(
        q(
          `INSERT INTO app.orders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(row),
        ),
      ).rejects.toMatchObject(GENERATED_ALWAYS);
      await pickup();
      await expect(q(`UPDATE app.orders SET order_number = 9`)).rejects.toMatchObject(
        GENERATED_ALWAYS,
      );
    });

    it('UNIQUE: la restricción existe y la secuencia es de tipo identity', async () => {
      const r = await q<{ attidentity: string }>(
        `SELECT attidentity FROM pg_attribute WHERE attrelid = 'app.orders'::regclass AND attname = 'order_number'`,
      );
      expect(r.rows[0]?.attidentity).toBe('a');
      const u = await q(
        `SELECT 1 FROM pg_constraint WHERE conrelid='app.orders'::regclass AND conname='orders_order_number_key' AND contype='u'`,
      );
      expect(u.rowCount).toBe(1);
    });

    it('una transacción revertida consume número (no contiguo) y no deja filas', async () => {
      const first = await pickup();
      await expect(
        tx(async (c) => {
          await insertOrder(c);
          throw new Error('fallo simulado');
        }),
      ).rejects.toThrow('fallo simulado');
      const next = await pickup();
      expect(Number(next.order_number)).toBeGreaterThan(Number(first.order_number) + 1);
      expect(await count('orders')).toBe(2);
    });
  });

  describe('orders: CHECK', () => {
    it('defaults: status pending, GTQ, importes en 0, fechas, sin proveedor ni preferencia de pago', async () => {
      const o = await pickup();
      const r = await q<Record<string, unknown>>(`SELECT * FROM app.orders WHERE id=$1`, [o.id]);
      expect(r.rows[0]).toMatchObject({
        status: 'pending',
        currency: 'GTQ',
        extras_total: '0.00',
        discount_total: '0.00',
        delivery_fee: '0.00',
        delivery_provider: null,
        payment_method_preference: null,
        scheduled_for: null,
        customer_id: null,
      });
      expect(r.rows[0]?.['placed_at']).toBeInstanceOf(Date);
      expect(r.rows[0]?.['updated_at']).toBeInstanceOf(Date);
    });

    it('fulfillment_type solo PICKUP|DELIVERY', async () => {
      for (const v of ['pickup', 'DINE_IN', '']) {
        await expect(pickup({ fulfillment_type: v }), v).rejects.toMatchObject(CHECK);
      }
      await pickup({ fulfillment_type: 'PICKUP' });
      await delivery();
    });

    it('delivery_provider solo OWN|PEDIDOSYA y coherente con la modalidad', async () => {
      await expect(pickup({ delivery_provider: 'UBER' })).rejects.toMatchObject(CHECK);
      // PICKUP con proveedor o con tarifa.
      await expect(pickup({ delivery_provider: 'OWN' })).rejects.toMatchObject(CHECK);
      await expect(pickup({ delivery_fee: '5.00', total: '105.00' })).rejects.toMatchObject(CHECK);
      // DELIVERY sin proveedor.
      await expect(
        tx(async (c) => {
          const o = await insertOrder(c, { fulfillment_type: 'DELIVERY' });
          await insertAddress(c, o.id);
        }),
      ).rejects.toMatchObject(CHECK);
      await delivery({ delivery_provider: 'OWN' });
      await delivery({ delivery_provider: 'PEDIDOSYA' });
    });

    it('catálogo cerrado de estados en orders', async () => {
      for (const v of ['received', 'PENDING', 'paid', '']) {
        await expect(pickup({ status: v }), v).rejects.toMatchObject(CHECK);
      }
      for (const v of STATUSES) await pickup({ status: v });
    });

    it('importes >= 0, extras y descuento <= subtotal', async () => {
      await expect(pickup({ subtotal: '-1.00', total: '-1.00' })).rejects.toMatchObject(CHECK);
      await expect(pickup({ discount_total: '-1.00', total: '101.00' })).rejects.toMatchObject(
        CHECK,
      );
      await expect(pickup({ extras_total: '-1.00' })).rejects.toMatchObject(CHECK);
      await expect(pickup({ extras_total: '100.01' })).rejects.toMatchObject(CHECK);
      await expect(pickup({ discount_total: '100.01', total: '-0.01' })).rejects.toMatchObject(
        CHECK,
      );
      await pickup({ extras_total: '100.00' });
      await pickup({ discount_total: '100.00', total: '0.00' });
      await pickup({ subtotal: '0.00', total: '0.00' });
    });

    it('total = subtotal - discount_total + delivery_fee', async () => {
      await expect(pickup({ total: '99.99' })).rejects.toMatchObject(CHECK);
      await expect(pickup({ discount_total: '10.00', total: '100.00' })).rejects.toMatchObject(
        CHECK,
      );
      await pickup({ discount_total: '10.00', total: '90.00' });
      await expect(delivery({ total: '100.00' })).rejects.toMatchObject(CHECK);
      await delivery({ delivery_fee: '25.50', total: '125.50' });
      await delivery({ discount_total: '20.00', delivery_fee: '15.00', total: '95.00' });
    });

    it('moneda solo GTQ', async () => {
      await expect(pickup({ currency: 'USD' })).rejects.toMatchObject(CHECK);
      await pickup({ currency: 'GTQ' });
    });

    it('preferencia de pago: cash|bank_transfer|NULL', async () => {
      for (const v of ['card', 'CASH', '']) {
        await expect(pickup({ payment_method_preference: v }), v).rejects.toMatchObject(CHECK);
      }
      await pickup({ payment_method_preference: 'cash' });
      await pickup({ payment_method_preference: 'bank_transfer' });
      await pickup({ payment_method_preference: null });
    });

    it('contacto: nombre 1..120 no vacío, teléfono +502XXXXXXXX, correo <= 254', async () => {
      for (const v of ['', '   ', 'x'.repeat(121)]) {
        await expect(pickup({ customer_name: v }), `nombre ${v.length}`).rejects.toMatchObject(
          CHECK,
        );
      }
      await pickup({ customer_name: 'x'.repeat(120) });
      for (const v of [
        '55551234',
        '+50155551234',
        '+5025555123',
        '+502555512345',
        '+502 5555 1234',
        '+50255a51234',
        '',
      ]) {
        await expect(pickup({ customer_phone: v }), v).rejects.toMatchObject(CHECK);
      }
      await pickup({ customer_phone: '+50222334455' });
      const local = 'a'.repeat(250);
      await expect(pickup({ customer_email: `${local}@example.com` })).rejects.toMatchObject(CHECK);
      await pickup({ customer_email: 'ana@example.com' });
      await pickup({ customer_email: null });
    });

    it('notas <= 280 caracteres', async () => {
      await expect(pickup({ notes: 'x'.repeat(281) })).rejects.toMatchObject(CHECK);
      await pickup({ notes: 'x'.repeat(280) });
      await pickup({ notes: null });
    });
  });

  describe('orders: FK', () => {
    it('branch_id RESTRICT: sucursal inexistente rechazada y no se borra una sucursal con pedidos', async () => {
      await expect(pickup({ branch_id: randomUUID() })).rejects.toMatchObject(FK);
      const br = (
        await q<{ id: string }>(
          `INSERT INTO app.branches (code, name, address) VALUES ('suc-fk','B','d') RETURNING id`,
        )
      ).rows[0]?.id as string;
      await pickup({ branch_id: br });
      await expect(q(`DELETE FROM app.branches WHERE id=$1`, [br])).rejects.toMatchObject(FK);
    });

    it('customer_id SET NULL: borrar al cliente conserva el pedido (invitado = NULL)', async () => {
      const cust = (
        await q<{ id: string }>(
          `INSERT INTO app.customers (full_name) VALUES ('Cliente') RETURNING id`,
        )
      ).rows[0]?.id as string;
      await expect(pickup({ customer_id: randomUUID() })).rejects.toMatchObject(FK);
      const o = await pickup({ customer_id: cust });
      await q(`DELETE FROM app.customers WHERE id=$1`, [cust]);
      const r = await q<{ customer_id: string | null }>(
        `SELECT customer_id FROM app.orders WHERE id=$1`,
        [o.id],
      );
      expect(r.rows[0]?.customer_id).toBeNull();
    });

    it('catálogo RESTRICT: producto, opción y promoción en uso no se pueden borrar', async () => {
      const o = await pickup();
      const itemId = await item(o.id);
      await q(
        `INSERT INTO app.order_item_modifiers (order_item_id, modifier_id, modifier_name, unit_extra_price)
         VALUES ($1,$2,'Extra',5)`,
        [itemId, modifierId],
      );
      await q(
        `INSERT INTO app.order_promotions (order_id, promotion_id, promotion_name, amount) VALUES ($1,$2,'Promo',10)`,
        [o.id, promotionId],
      );
      await expect(q(`DELETE FROM app.products WHERE id=$1`, [productId])).rejects.toMatchObject(
        FK,
      );
      await expect(q(`DELETE FROM app.modifiers WHERE id=$1`, [modifierId])).rejects.toMatchObject(
        FK,
      );
      await expect(
        q(`DELETE FROM app.promotions WHERE id=$1`, [promotionId]),
      ).rejects.toMatchObject(FK);
      // FK a destinos inexistentes.
      await expect(item(o.id, { line_no: 2, product_id: randomUUID() })).rejects.toMatchObject(FK);
      await expect(item(randomUUID(), { line_no: 3 })).rejects.toMatchObject(FK);
    });

    it('un pedido con hijas no se puede borrar (RESTRICT)', async () => {
      const o = await pickup();
      await history(o.id);
      await expect(q(`DELETE FROM app.orders WHERE id=$1`, [o.id])).rejects.toMatchObject(FK);
    });
  });

  describe('order_items y order_item_modifiers: CHECK', () => {
    it('cantidad 1..99, importes >= 0, descuento <= precio × cantidad, UNIQUE (order_id, line_no)', async () => {
      const o = await pickup();
      await expect(item(o.id, { quantity: 0 })).rejects.toMatchObject(CHECK);
      await expect(item(o.id, { quantity: 100 })).rejects.toMatchObject(CHECK);
      await expect(item(o.id, { unit_price: '-0.01' })).rejects.toMatchObject(CHECK);
      await expect(item(o.id, { extras_per_unit: '-0.01' })).rejects.toMatchObject(CHECK);
      await expect(item(o.id, { line_discount: '-0.01' })).rejects.toMatchObject(CHECK);
      await expect(item(o.id, { line_discount: '100.01' })).rejects.toMatchObject(CHECK);
      await expect(item(o.id, { product_name: null })).rejects.toMatchObject({ code: '23502' });
      await item(o.id, { line_no: 1, quantity: 1 });
      await item(o.id, { line_no: 2, quantity: 99 });
      await item(o.id, { line_no: 3, line_discount: '100.00' });
      await expect(item(o.id, { line_no: 3 })).rejects.toMatchObject(UNIQUE);
      // El mismo line_no es válido en otro pedido.
      await item((await pickup()).id, { line_no: 1 });
    });

    it('modificadores: cantidad >= 1 y precio >= 0', async () => {
      const itemId = await item((await pickup()).id);
      const mod = (o: Record<string, unknown>) =>
        q(
          `INSERT INTO app.order_item_modifiers (order_item_id, modifier_id, modifier_name, quantity, unit_extra_price)
           VALUES ($1,$2,'Extra',$3,$4)`,
          [itemId, modifierId, o['quantity'] ?? 1, o['price'] ?? '5.00'],
        );
      await expect(mod({ quantity: 0 })).rejects.toMatchObject(CHECK);
      await expect(mod({ price: '-0.01' })).rejects.toMatchObject(CHECK);
      await mod({ quantity: 1, price: '0.00' });
      await mod({ quantity: 3 });
      // modifier_id es nullable (referencia informativa).
      await q(
        `INSERT INTO app.order_item_modifiers (order_item_id, modifier_name, unit_extra_price) VALUES ($1,'Sin ref',1)`,
        [itemId],
      );
    });
  });

  describe('order_promotions, order_addresses, order_status_history: CHECK', () => {
    it('promociones: monto > 0 y PK (order_id, promotion_id)', async () => {
      const o = await pickup();
      const promo = (amount: string) =>
        q(
          `INSERT INTO app.order_promotions (order_id, promotion_id, promotion_name, amount) VALUES ($1,$2,'Promo',$3)`,
          [o.id, promotionId, amount],
        );
      await expect(promo('0.00')).rejects.toMatchObject(CHECK);
      await expect(promo('-1.00')).rejects.toMatchObject(CHECK);
      await promo('10.00');
      await expect(promo('5.00')).rejects.toMatchObject(UNIQUE);
    });

    it('dirección: address_line no vacía y <= 200; una sola por pedido', async () => {
      for (const v of ['', '   ', 'x'.repeat(201)]) {
        await expect(
          tx(async (c) => {
            const o = await insertOrder(c, {
              fulfillment_type: 'DELIVERY',
              delivery_provider: 'OWN',
              total: '100.00',
            });
            await insertAddress(c, o.id, { address_line: v });
          }),
          `línea ${v.length}`,
        ).rejects.toMatchObject(CHECK);
      }
      const o = await delivery();
      await expect(withClient(scratch, (c) => insertAddress(c, o.id))).rejects.toMatchObject(
        UNIQUE,
      );
    });

    it('historial: catálogo de estados, old_status opcional, motivo <= 500', async () => {
      const o = await pickup();
      await expect(history(o.id, { new_status: 'received' })).rejects.toMatchObject(CHECK);
      await expect(history(o.id, { old_status: 'received' })).rejects.toMatchObject(CHECK);
      await expect(history(o.id, { reason: 'x'.repeat(501) })).rejects.toMatchObject(CHECK);
      await history(o.id, { old_status: null, new_status: 'pending' });
      await history(o.id, {
        old_status: 'pending',
        new_status: 'accepted',
        reason: 'x'.repeat(500),
      });
      for (const s of STATUSES) await history(o.id, { new_status: s });
    });
  });

  describe('triggers', () => {
    it('order_status_history es solo-añadir: UPDATE y DELETE rechazados', async () => {
      const o = await pickup();
      await history(o.id);
      await expect(q(`UPDATE app.order_status_history SET reason='x'`)).rejects.toMatchObject(PRIV);
      await expect(q(`DELETE FROM app.order_status_history`)).rejects.toMatchObject(PRIV);
      expect(await count('order_status_history')).toBe(1);
    });

    it('snapshots inmutables: items, modificadores, promociones y direcciones rechazan UPDATE y DELETE', async () => {
      const o = await delivery();
      const itemId = await item(o.id);
      await q(
        `INSERT INTO app.order_item_modifiers (order_item_id, modifier_id, modifier_name, unit_extra_price)
         VALUES ($1,$2,'Extra',5)`,
        [itemId, modifierId],
      );
      await q(
        `INSERT INTO app.order_promotions (order_id, promotion_id, promotion_name, amount) VALUES ($1,$2,'Promo',10)`,
        [o.id, promotionId],
      );
      const cases: Array<[string, string]> = [
        ['order_items', `SET product_name = 'otro'`],
        ['order_item_modifiers', `SET unit_extra_price = 0`],
        ['order_promotions', `SET amount = 1`],
        ['order_addresses', `SET address_line = 'otra'`],
      ];
      for (const [t, set] of cases) {
        await expect(q(`UPDATE app.${t} ${set}`), `UPDATE ${t}`).rejects.toMatchObject(PRIV);
        await expect(q(`DELETE FROM app.${t}`), `DELETE ${t}`).rejects.toMatchObject(PRIV);
        expect(await count(t), t).toBe(1);
      }
    });

    it('orders: importes, sucursal, modalidad, proveedor, moneda, número, id y placed_at inmutables', async () => {
      const o = await delivery();
      const br2 = (
        await q<{ id: string }>(
          `INSERT INTO app.branches (code, name, address) VALUES ('suc-imm','B','d') RETURNING id`,
        )
      ).rows[0]?.id as string;
      const attempts: Array<[string, unknown[]]> = [
        [`subtotal = 90, total = 105`, []],
        [`extras_total = 1`, []],
        [`discount_total = 1, total = 114`, []],
        [`delivery_fee = 0, total = 100`, []],
        [`total = 116, delivery_fee = 16`, []],
        [`branch_id = $1`, [br2]],
        [
          `fulfillment_type = 'PICKUP', delivery_provider = NULL, delivery_fee = 0, total = 100`,
          [],
        ],
        [`delivery_provider = 'PEDIDOSYA'`, []],
        [`placed_at = now() + interval '1 day'`, []],
        [`id = $1`, [randomUUID()]],
      ];
      for (const [set, params] of attempts) {
        await expect(
          q(`UPDATE app.orders SET ${set} WHERE id = '${o.id}'`, params),
          set,
        ).rejects.toMatchObject(PRIV);
      }
      const r = await q<{ total: string; branch_id: string }>(
        `SELECT total, branch_id FROM app.orders WHERE id=$1`,
        [o.id],
      );
      expect(r.rows[0]).toMatchObject({ total: '115.00', branch_id: branchId });
    });

    it('orders: contacto, customer_id, status, notes, updated_at y preferencia de pago sí se pueden actualizar', async () => {
      const o = await pickup();
      await q(
        `UPDATE app.orders SET status='accepted', notes='ok', updated_at=now(),
                customer_name='Otro', customer_phone='+50244556677', customer_email=NULL,
                payment_method_preference='cash', customer_id=NULL WHERE id=$1`,
        [o.id],
      );
      const r = await q<{ status: string; customer_name: string }>(
        `SELECT status, customer_name FROM app.orders WHERE id=$1`,
        [o.id],
      );
      expect(r.rows[0]).toMatchObject({ status: 'accepted', customer_name: 'Otro' });
      // El CHECK sigue rigiendo en el UPDATE.
      await expect(
        q(`UPDATE app.orders SET status='paid' WHERE id=$1`, [o.id]),
      ).rejects.toMatchObject(CHECK);
    });

    it('excepción de limpieza: DELETE de hijas solo con app.allow_order_cleanup = on en la transacción', async () => {
      const o = await pickup();
      await item(o.id);
      await history(o.id);
      await expect(q(`DELETE FROM app.order_items`)).rejects.toMatchObject(PRIV);
      await tx(async (c) => {
        await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
        await c.query(`DELETE FROM app.order_items`);
        await c.query(`DELETE FROM app.order_status_history`);
        await c.query(`DELETE FROM app.orders`);
      });
      // El UPDATE nunca se habilita.
      const p = await pickup();
      await history(p.id);
      await expect(
        tx(async (c) => {
          await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
          await c.query(`UPDATE app.order_status_history SET reason='x'`);
        }),
      ).rejects.toMatchObject(PRIV);
    });
  });

  describe('dirección: solo DELIVERY (constraint triggers aplazados)', () => {
    it('DELIVERY con dirección confirma; DELIVERY sin dirección falla al COMMIT', async () => {
      await delivery();
      await expect(
        withClient(scratch, (c) =>
          insertOrder(c, {
            fulfillment_type: 'DELIVERY',
            delivery_provider: 'OWN',
            delivery_fee: '15.00',
            total: '115.00',
          }),
        ),
      ).rejects.toMatchObject(CHECK);
      expect(await count('orders')).toBe(1);
    });

    it('la dirección puede insertarse después del pedido dentro de la misma transacción (aplazado)', async () => {
      await tx(async (c) => {
        const o = await insertOrder(c, {
          fulfillment_type: 'DELIVERY',
          delivery_provider: 'OWN',
          delivery_fee: '15.00',
          total: '115.00',
        });
        await c.query('SELECT 1');
        await insertAddress(c, o.id);
      });
      expect(await count('order_addresses')).toBe(1);
    });

    it('PICKUP con dirección falla al COMMIT; PICKUP sin dirección confirma', async () => {
      await pickup();
      await expect(
        tx(async (c) => {
          const o = await insertOrder(c);
          await insertAddress(c, o.id);
        }),
      ).rejects.toMatchObject(CHECK);
      expect(await count('orders')).toBe(1);
      expect(await count('order_addresses')).toBe(0);
    });

    it('con SET CONSTRAINTS IMMEDIATE el error es inmediato', async () => {
      await expect(
        tx(async (c) => {
          await c.query('SET CONSTRAINTS ALL IMMEDIATE');
          await insertOrder(c, {
            fulfillment_type: 'DELIVERY',
            delivery_provider: 'OWN',
            delivery_fee: '15.00',
            total: '115.00',
          });
        }),
      ).rejects.toMatchObject(CHECK);
    });
  });

  describe('order_idempotency_keys', () => {
    it('clave reclamada ANTES del pedido y pedido en la misma transacción: confirma', async () => {
      const orderId = randomUUID();
      await tx(async (c) => {
        await idem(c, orderId);
        await insertOrder(c, { id: orderId });
      });
      expect(await count('order_idempotency_keys')).toBe(1);
    });

    it('FK diferida: clave sin pedido al COMMIT falla (23503) y no deja la clave', async () => {
      await expect(tx((c) => idem(c, randomUUID()))).rejects.toMatchObject(FK);
      expect(await count('order_idempotency_keys')).toBe(0);
    });

    it('con SET CONSTRAINTS IMMEDIATE la FK se comprueba al instante', async () => {
      await expect(
        tx(async (c) => {
          await c.query('SET CONSTRAINTS ALL IMMEDIATE');
          await idem(c, randomUUID());
        }),
      ).rejects.toMatchObject(FK);
    });

    it('UNIQUE (scope, key_hash): misma clave y alcance rechazada; otro alcance o clave, aceptada', async () => {
      const o = await pickup();
      const key = hash32(77);
      const customerScope = `customer:${randomUUID()}`;
      await withClient(scratch, (c) => idem(c, o.id, { scope: 'guest', key_hash: key }));
      await expect(
        withClient(scratch, (c) => idem(c, o.id, { scope: 'guest', key_hash: key })),
      ).rejects.toMatchObject(UNIQUE);
      await withClient(scratch, (c) => idem(c, o.id, { scope: customerScope, key_hash: key }));
      await withClient(scratch, (c) => idem(c, o.id, { scope: 'guest', key_hash: hash32(78) }));
      await expect(
        withClient(scratch, (c) => idem(c, o.id, { scope: customerScope, key_hash: key })),
      ).rejects.toMatchObject(UNIQUE);
    });

    it('ON CONFLICT (scope, key_hash) DO NOTHING no devuelve fila al perdedor', async () => {
      const o = await pickup();
      const key = hash32(90);
      await withClient(scratch, (c) => idem(c, o.id, { key_hash: key }));
      const r = await q(
        `INSERT INTO app.order_idempotency_keys (scope, key_hash, request_hash, order_id, expires_at)
         VALUES ('guest', $1, $2, $3, now() + interval '1 day')
         ON CONFLICT (scope, key_hash) DO NOTHING RETURNING id`,
        [key, hash32(1), o.id],
      );
      expect(r.rowCount).toBe(0);
    });

    it('CHECK: scope, longitudes de hash y expiración', async () => {
      const o = await pickup();
      const run = (x: Record<string, unknown>) => withClient(scratch, (c) => idem(c, o.id, x));
      for (const scope of ['', 'GUEST', 'customer:abc', `customer:${'A'.repeat(36)}`, 'staff:x']) {
        await expect(run({ scope }), scope).rejects.toMatchObject(CHECK);
      }
      await expect(run({ key_hash: Buffer.alloc(31) })).rejects.toMatchObject(CHECK);
      await expect(run({ request_hash: Buffer.alloc(33) })).rejects.toMatchObject(CHECK);
      await expect(
        run({ expires_at: new Date(Date.now() - 86400_000).toISOString() }),
      ).rejects.toMatchObject(CHECK);
      await run({ scope: `customer:${randomUUID()}` });
    });

    it('FK RESTRICT: no se borra un pedido con clave', async () => {
      const o = await pickup();
      await withClient(scratch, (c) => idem(c, o.id));
      await expect(q(`DELETE FROM app.orders WHERE id=$1`, [o.id])).rejects.toMatchObject(FK);
    });
  });

  describe('order_access_tokens', () => {
    it('token_hash de 32 bytes, UNIQUE y vigencia posterior a la creación', async () => {
      const o = await pickup();
      await expect(token(o.id, { token_hash: Buffer.alloc(31) })).rejects.toMatchObject(CHECK);
      await expect(token(o.id, { token_hash: Buffer.alloc(33) })).rejects.toMatchObject(CHECK);
      await expect(
        token(o.id, { expires_at: new Date(Date.now() - 1000).toISOString() }),
      ).rejects.toMatchObject(CHECK);
      await token(o.id, { token_hash: hash32(5) });
      await expect(token(o.id, { token_hash: hash32(5) })).rejects.toMatchObject(UNIQUE);
      await expect(token(randomUUID())).rejects.toMatchObject(FK);
    });

    it('revocar (UPDATE revoked_at) está permitido', async () => {
      const o = await pickup();
      await token(o.id);
      await q(`UPDATE app.order_access_tokens SET revoked_at = now() WHERE order_id=$1`, [o.id]);
      expect(
        (await q(`SELECT 1 FROM app.order_access_tokens WHERE revoked_at IS NOT NULL`)).rowCount,
      ).toBe(1);
    });
  });

  it('rollback transaccional: un fallo a mitad de la creación no deja filas en ninguna tabla', async () => {
    await expect(
      tx(async (c) => {
        const o = await insertOrder(c);
        await c.query(
          `INSERT INTO app.order_items (order_id, line_no, product_id, product_name, quantity, unit_price)
           VALUES ($1,1,$2,'Roll',2,50)`,
          [o.id, productId],
        );
        await c.query(
          `INSERT INTO app.order_status_history (order_id, old_status, new_status) VALUES ($1,NULL,'pending')`,
          [o.id],
        );
        await idem(c, o.id);
        // Última sentencia inválida: toda la transacción debe revertir.
        await c.query(
          `INSERT INTO app.order_items (order_id, line_no, product_name, quantity, unit_price)
           VALUES ($1,2,'Malo',0,50)`,
          [o.id],
        );
      }),
    ).rejects.toMatchObject(CHECK);
    for (const t of TABLES) expect(await count(t), t).toBe(0);
  });

  it('creación completa coherente: pedido DELIVERY con líneas, modificadores, promoción, historial, token y clave', async () => {
    const orderId = randomUUID();
    await tx(async (c) => {
      await idem(c, orderId, { scope: `customer:${randomUUID()}` });
      // subtotal = (50 + 5) × 2 = 110; extras = 10; descuento 11; envío 15; total 114.
      await insertOrder(c, {
        id: orderId,
        fulfillment_type: 'DELIVERY',
        delivery_provider: 'OWN',
        subtotal: '110.00',
        extras_total: '10.00',
        discount_total: '11.00',
        delivery_fee: '15.00',
        total: '114.00',
        payment_method_preference: 'cash',
      });
      await insertAddress(c, orderId, { zone: 'Zona 10', reference_note: 'Portón negro' });
      const it = await c.query<{ id: string }>(
        `INSERT INTO app.order_items (order_id, line_no, product_id, product_name, quantity, unit_price, extras_per_unit, line_discount)
         VALUES ($1,1,$2,'Roll',2,50,5,11) RETURNING id`,
        [orderId, productId],
      );
      await c.query(
        `INSERT INTO app.order_item_modifiers (order_item_id, modifier_id, modifier_name, unit_extra_price)
         VALUES ($1,$2,'Extra',5)`,
        [it.rows[0]?.id, modifierId],
      );
      await c.query(
        `INSERT INTO app.order_promotions (order_id, promotion_id, promotion_name, amount) VALUES ($1,$2,'Promo',11)`,
        [orderId, promotionId],
      );
      await c.query(
        `INSERT INTO app.order_status_history (order_id, old_status, new_status) VALUES ($1,NULL,'pending')`,
        [orderId],
      );
      await c.query(
        `INSERT INTO app.order_access_tokens (order_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '14 days')`,
        [orderId, hash32(33)],
      );
    });
    for (const t of TABLES) expect(await count(t), t).toBe(1);
  });

  it('índices: existen (incluidos los parciales) y los filtros reales recorren índice (seqscan desactivado)', async () => {
    const defs = await q<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='app' AND tablename = ANY($1)`,
      [TABLES],
    );
    const idx = Object.fromEntries(defs.rows.map((r) => [r.indexname, r.indexdef]));
    for (const name of [
      'orders_branch_status_placed_idx',
      'orders_customer_placed_idx',
      'orders_phone_pending_idx',
      'order_items_order_idx',
      'order_item_modifiers_item_idx',
      'order_status_history_order_idx',
      'order_access_tokens_order_idx',
      'order_access_tokens_hash_key',
      'order_idempotency_keys_expires_idx',
      'order_idempotency_keys_scope_key',
      'order_idempotency_keys_order_idx',
    ]) {
      expect(idx[name], name).toBeDefined();
    }
    expect(idx['orders_branch_status_placed_idx']).toMatch(/placed_at DESC/);
    expect(idx['orders_customer_placed_idx']).toMatch(/WHERE \(?\(?customer_id IS NOT NULL/);
    expect(idx['orders_phone_pending_idx']).toMatch(/WHERE \(?\(?status = 'pending'/);
    expect(idx['order_access_tokens_order_idx']).toMatch(/WHERE \(?revoked_at IS NULL/);

    const cust = (
      await q<{ id: string }>(`INSERT INTO app.customers (full_name) VALUES ('C') RETURNING id`)
    ).rows[0]?.id as string;
    for (let i = 0; i < 20; i++) await pickup({ customer_id: i % 2 ? cust : null });
    const o = await pickup();
    await q(`ANALYZE app.orders`);
    await q(`ANALYZE app.order_items`);
    const explain = (sql: string, params: unknown[] = []) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    const re = /Index (Only )?Scan|Bitmap Index Scan/;
    expect(
      await explain(
        `SELECT id FROM app.orders WHERE branch_id=$1 AND status='pending' ORDER BY placed_at DESC LIMIT 20`,
        [branchId],
      ),
    ).toMatch(re);
    expect(
      await explain(
        `SELECT id FROM app.orders WHERE customer_id=$1 ORDER BY placed_at DESC LIMIT 20`,
        [cust],
      ),
    ).toMatch(re);
    expect(
      await explain(
        `SELECT count(*) FROM app.orders WHERE customer_phone=$1 AND status='pending'`,
        ['+50255551234'],
      ),
    ).toMatch(re);
    expect(await explain(`SELECT id FROM app.order_items WHERE order_id=$1`, [o.id])).toMatch(re);
  });

  it('comentarios documentan las columnas añadidas sobre el DBML', async () => {
    const r = await q<{ attname: string; d: string | null }>(
      `SELECT a.attname, col_description(a.attrelid, a.attnum) AS d FROM pg_attribute a
        WHERE a.attrelid = 'app.orders'::regclass AND a.attname IN ('delivery_provider','extras_total','payment_method_preference')`,
    );
    expect(r.rowCount).toBe(3);
    for (const row of r.rows) expect(row.d, row.attname).toMatch(/DBML/);
  });

  it('RLS habilitado, sin políticas y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    for (const t of TABLES) {
      const rls = await q<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [`app.${t}`],
      );
      expect(rls.rows[0]?.relrowsecurity, t).toBe(true);
      const pub = await q<{ n: number }>(
        `SELECT (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)::int AS n
           FROM pg_class c WHERE c.oid = $1::regclass`,
        [`app.${t}`],
      );
      expect(pub.rows[0]?.n, t).toBe(0);
      const pol = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='app' AND tablename=$1`,
        [t],
      );
      expect(pol.rows[0]?.n, t).toBe(0);
    }
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0018.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      for (const t of TABLES) {
        const r = await q<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
          rolname,
          `app.${t}`,
          PRIVS,
        ]);
        expect(r.rows[0]?.ok, `${rolname}.${t}`).toBe(false);
      }
    }
  });
});
