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
 * Migración 0021 (F27 motoristas propios: app.riders, riders_guard, índices, RLS/REVOKE) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0021_test`): se aplican 0001..0021 en orden. Mismo patrón y misma omisión explícita que
 * migration-0016/0017/0018/0019.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de
 * Supabase real se omite y se avisa.
 *
 * ESTADO: se omite contra el Supabase compartido y corre solo en PostgreSQL plano desechable (la CI). Cubre spec 028 §2.2.
 * Los casos NULL (vehicle_type/license_plate nulos aceptados; columnas obligatorias nulas rechazadas por NOT NULL) existen
 * por la lección de 0020: un CHECK no falla con NULL, así que cada CHECK se prueba con valor inválido NO nulo.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0021_test';
const M0021 = '0021_own_riders';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const ALL = readdirSync(migrationsDir)
  .filter((d) => /^\d{4}_/.test(d) && d <= M0021)
  .sort();
const migrationSql = (name: string) =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const NOT_NULL = { code: '23502' };
const PRIV = { code: '42501' };

describe.skipIf(!url)('Migración 0021: motoristas propios (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let branchId = '';
  let branch2Id = '';
  let inactiveBranchId = '';
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

  const nextPhone = () => `+502${String(60000000 + ++seq)}`;
  const insertRider = (o: Record<string, unknown> = {}) => {
    const row = {
      branch_id: branchId,
      full_name: 'Juan Pérez',
      name_key: 'juan perez',
      phone: nextPhone(),
      ...o,
    };
    const cols = Object.keys(row);
    return q<{ id: string }>(
      `INSERT INTO app.riders (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
  };
  const newRider = async (o: Record<string, unknown> = {}) =>
    (await insertRider(o)).rows[0]?.id as string;
  const update = (id: string, sets: Record<string, unknown>) => {
    const keys = Object.keys(sets);
    return q(
      `UPDATE app.riders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...Object.values(sets)],
    );
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0021.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0021 NO se probó.',
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
           ('suc-0021','B','dir',true), ('suc-0021b','B2','dir',true), ('suc-0021x','Inactiva','dir',false) RETURNING id`,
      );
      branchId = br.rows[0]?.id as string;
      branch2Id = br.rows[1]?.id as string;
      inactiveBranchId = br.rows[2]?.id as string;
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
      await c.query('DELETE FROM app.riders');
    });
  });

  describe('estructura y relanzado', () => {
    it('crea app.riders con defaults UNAVAILABLE, version 1, active true', async () => {
      const id = await newRider();
      const r = await q<{
        availability: string;
        version: number;
        active: boolean;
        vehicle_type: null;
      }>(`SELECT availability, version, active, vehicle_type FROM app.riders WHERE id = $1`, [id]);
      expect(r.rows[0]).toEqual({
        availability: 'UNAVAILABLE',
        version: 1,
        active: true,
        vehicle_type: null,
      });
    });

    it('no crea deliveries ni toca role_permissions', async () => {
      const t = await q<{ t: string }>(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('deliveries','riders') ORDER BY 1`,
      );
      expect(t.rows.map((r) => r.t)).toEqual(['riders']);
    });

    it('reaplicar 0021 es inocuo (relanzable) y conserva las filas', async () => {
      const id = await newRider();
      await q(migrationSql(M0021));
      const r = await q(`SELECT 1 FROM app.riders WHERE id = $1`, [id]);
      expect(r.rowCount).toBe(1);
      const trg = await q(
        `SELECT 1 FROM pg_trigger WHERE tgname = 'riders_guard' AND tgrelid = 'app.riders'::regclass`,
      );
      expect(trg.rowCount).toBe(1);
    });

    it('la guarda inicial rechaza una app.riders de definición ajena sin modificarla', async () => {
      await withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('ALTER TABLE app.riders DROP CONSTRAINT riders_plate_chk');
          await expect(c.query(migrationSql(M0021))).rejects.toThrow(/riders_plate_chk/);
        } finally {
          await c.query('ROLLBACK');
        }
      });
    });
  });

  describe('CHECK', () => {
    it.each([
      ['sin prefijo', '55551234'],
      ['7 dígitos', '+5025555123'],
      ['9 dígitos', '+502555512345'],
      ['otro país', '+50355551234'],
      ['letras', '+502555512ab'],
      ['salto de línea final', '+50255551234\n'],
      ['vacío', ''],
    ])('riders_phone_chk rechaza teléfono %s', async (_n, phone) => {
      await expect(insertRider({ phone })).rejects.toMatchObject(CHECK);
    });
    it('riders_phone_chk acepta +502 + 8 dígitos y phone NULL lo rechaza NOT NULL', async () => {
      await expect(insertRider({ phone: '+50255551234' })).resolves.toBeDefined();
      await expect(insertRider({ phone: null })).rejects.toMatchObject(NOT_NULL);
    });

    it.each([
      ['1 carácter', 'A'],
      ['vacío', ''],
      ['solo espacios', '   '],
      ['espacio inicial', ' Juan'],
      ['espacio final', 'Juan '],
      ['control (tab)', 'Juan\tPérez'],
      ['81 caracteres', 'x'.repeat(81)],
    ])('riders_name_chk rechaza full_name %s', async (_n, full_name) => {
      await expect(insertRider({ full_name })).rejects.toMatchObject(CHECK);
    });
    it('riders_name_chk acepta 2 y 80 caracteres; rechaza name_key vacío o de espacios y NULL', async () => {
      await expect(insertRider({ full_name: 'Al' })).resolves.toBeDefined();
      await expect(insertRider({ full_name: 'x'.repeat(80) })).resolves.toBeDefined();
      await expect(insertRider({ name_key: '' })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ name_key: '   ' })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ name_key: null })).rejects.toMatchObject(NOT_NULL);
      await expect(insertRider({ full_name: null })).rejects.toMatchObject(NOT_NULL);
    });

    it('riders_vehicle_chk: NULL y los 4 valores válidos pasan; otro valor (no nulo) falla', async () => {
      await expect(insertRider({ vehicle_type: null })).resolves.toBeDefined();
      for (const v of ['MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT'])
        await expect(insertRider({ vehicle_type: v })).resolves.toBeDefined();
      for (const v of ['TRUCK', 'motorcycle', ''])
        await expect(insertRider({ vehicle_type: v })).rejects.toMatchObject(CHECK);
    });

    it('riders_plate_chk: NULL y A-Z0-9 de 4..10 pasan; minúsculas, guion, corta, larga o vacía fallan', async () => {
      await expect(insertRider({ license_plate: null })).resolves.toBeDefined();
      await expect(insertRider({ license_plate: 'M123ABC' })).resolves.toBeDefined();
      await expect(insertRider({ license_plate: 'ABCD' })).resolves.toBeDefined();
      await expect(insertRider({ license_plate: 'A'.repeat(10) })).resolves.toBeDefined();
      for (const p of ['m123abc', 'M-123ABC', 'ABC', 'A'.repeat(11), '', 'ABCD\n'])
        await expect(insertRider({ license_plate: p })).rejects.toMatchObject(CHECK);
    });

    it('riders_availability_chk: solo AVAILABLE|UNAVAILABLE (BUSY y vacío fallan; NULL falla NOT NULL)', async () => {
      await expect(insertRider({ availability: 'AVAILABLE' })).resolves.toBeDefined();
      await expect(insertRider({ availability: 'BUSY' })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ availability: 'available' })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ availability: '' })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ availability: null })).rejects.toMatchObject(NOT_NULL);
    });

    it('riders_inactive_unavailable_chk: inactivo+AVAILABLE falla en INSERT y UPDATE; activo→inactivo exige UNAVAILABLE', async () => {
      await expect(insertRider({ active: false, availability: 'AVAILABLE' })).rejects.toMatchObject(
        CHECK,
      );
      await expect(
        insertRider({ active: false, availability: 'UNAVAILABLE' }),
      ).resolves.toBeDefined();
      await expect(insertRider({ active: null })).rejects.toMatchObject(NOT_NULL);
      const id = await newRider({ availability: 'AVAILABLE' });
      await expect(update(id, { active: false, version: 2 })).rejects.toMatchObject(CHECK);
      await expect(
        update(id, { active: false, availability: 'UNAVAILABLE', version: 2 }),
      ).resolves.toBeDefined();
      await expect(update(id, { availability: 'AVAILABLE', version: 3 })).rejects.toMatchObject(
        CHECK,
      );
    });

    it('riders_version_chk: version 0 o negativa falla; NULL falla NOT NULL', async () => {
      await expect(insertRider({ version: 0 })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ version: -1 })).rejects.toMatchObject(CHECK);
      await expect(insertRider({ version: null })).rejects.toMatchObject(NOT_NULL);
    });
  });

  describe('UNIQUE y FK', () => {
    it('UNIQUE(phone) global, también entre sucursales (23505)', async () => {
      await newRider({ phone: '+50244440000' });
      await expect(insertRider({ phone: '+50244440000' })).rejects.toMatchObject(UNIQUE);
      await expect(
        insertRider({ phone: '+50244440000', branch_id: branch2Id }),
      ).rejects.toMatchObject(UNIQUE);
    });
    it('branch_id inexistente: el trigger lo rechaza antes de la FK (23514); la FK es RESTRICT al borrar la sucursal', async () => {
      await expect(insertRider({ branch_id: randomUUID() })).rejects.toMatchObject(CHECK);
      await newRider();
      await expect(q('DELETE FROM app.branches WHERE id = $1', [branchId])).rejects.toMatchObject(
        FK,
      );
    });
    it('la FK existe con ON DELETE RESTRICT', async () => {
      const r = await q<{ confdeltype: string }>(
        `SELECT confdeltype FROM pg_constraint WHERE conname = 'riders_branch_id_fkey' AND conrelid = 'app.riders'::regclass`,
      );
      expect(r.rows[0]?.confdeltype).toBe('r');
    });
  });

  describe('trigger riders_guard', () => {
    it('DELETE rechazado (42501) y permitido solo con app.allow_order_cleanup = on', async () => {
      const id = await newRider();
      await expect(q('DELETE FROM app.riders WHERE id = $1', [id])).rejects.toMatchObject(PRIV);
      await tx(async (c) => {
        await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
        await c.query('DELETE FROM app.riders WHERE id = $1', [id]);
      });
      expect((await q('SELECT 1 FROM app.riders WHERE id = $1', [id])).rowCount).toBe(0);
      const id2 = await newRider();
      await expect(
        tx(async (c) => {
          await c.query("SET LOCAL app.allow_order_cleanup = 'off'");
          await c.query('DELETE FROM app.riders WHERE id = $1', [id2]);
        }),
      ).rejects.toMatchObject(PRIV);
    });

    it('INSERT en sucursal inactiva rechazado (23514)', async () => {
      await expect(insertRider({ branch_id: inactiveBranchId })).rejects.toMatchObject(CHECK);
    });
    it('mover a sucursal inactiva rechazado; mover a activa permitido; editar sin mover en sucursal luego desactivada permitido', async () => {
      const id = await newRider();
      await expect(update(id, { branch_id: inactiveBranchId, version: 2 })).rejects.toMatchObject(
        CHECK,
      );
      await expect(update(id, { branch_id: branch2Id, version: 2 })).resolves.toBeDefined();
      await q('UPDATE app.branches SET active = false WHERE id = $1', [branch2Id]);
      try {
        await expect(update(id, { full_name: 'Juan P', version: 3 })).resolves.toBeDefined();
      } finally {
        await q('UPDATE app.branches SET active = true WHERE id = $1', [branch2Id]);
      }
    });

    it('todo UPDATE debe subir version en exactamente 1 (sin subir, +2, retroceder: 23514)', async () => {
      const id = await newRider();
      await expect(update(id, { full_name: 'Otro Nombre' })).rejects.toMatchObject(CHECK);
      await expect(update(id, { version: 1 })).rejects.toMatchObject(CHECK);
      await expect(update(id, { version: 3 })).rejects.toMatchObject(CHECK);
      await expect(update(id, { version: 2 })).resolves.toBeDefined();
      await expect(update(id, { version: 1 })).rejects.toMatchObject(CHECK);
      await expect(update(id, { version: 3 })).resolves.toBeDefined();
    });
    it('un UPDATE sin cambios reales tambien exige subir version', async () => {
      const id = await newRider();
      await expect(
        q('UPDATE app.riders SET full_name = full_name WHERE id = $1', [id]),
      ).rejects.toMatchObject(CHECK);
    });

    it('id y created_at inmutables (42501)', async () => {
      const id = await newRider();
      await expect(update(id, { id: randomUUID(), version: 2 })).rejects.toMatchObject(PRIV);
      await expect(
        update(id, { created_at: '2001-01-01T00:00:00Z', version: 2 }),
      ).rejects.toMatchObject(PRIV);
    });

    it('concurrencia: dos UPDATE simultáneos con la misma version previa: el CAS deja exactamente UNO', async () => {
      const id = await newRider();
      const cas = () =>
        withClient(scratch, async (c) => {
          const r = await c.query(
            `UPDATE app.riders SET availability = 'AVAILABLE', version = version + 1, updated_at = clock_timestamp()
              WHERE id = $1 AND version = 1`,
            [id],
          );
          return r.rowCount ?? 0;
        });
      const counts = await Promise.all([cas(), cas(), cas()]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
      expect(
        (await q<{ version: number }>('SELECT version FROM app.riders WHERE id = $1', [id])).rows[0]
          ?.version,
      ).toBe(2);
    });
  });

  describe('índices', () => {
    it('existen los 3 índices de listado y el de asignables es parcial; no hay índice extra de phone', async () => {
      const r = await q<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'riders' ORDER BY 1`,
      );
      const by = Object.fromEntries(r.rows.map((x) => [x.indexname, x.indexdef]));
      expect(Object.keys(by).sort()).toEqual([
        'riders_branch_assignable_idx',
        'riders_branch_name_idx',
        'riders_name_idx',
        'riders_phone_key',
        'riders_pkey',
      ]);
      expect(by['riders_branch_name_idx']).toMatch(/\(branch_id, name_key, id\)/);
      expect(by['riders_name_idx']).toMatch(/\(name_key, id\)/);
      expect(by['riders_branch_assignable_idx']).toMatch(/\(branch_id\)/);
      expect(by['riders_branch_assignable_idx']).toMatch(
        /WHERE .*active.*availability.*AVAILABLE/s,
      );
    });
  });

  describe('RLS y privilegios', () => {
    it('RLS habilitada sin ninguna política sobre app.riders', async () => {
      const r = await q<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'app.riders'::regclass`,
      );
      expect(r.rows[0]?.relrowsecurity).toBe(true);
      const p = await q(
        `SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'riders'`,
      );
      expect(p.rowCount).toBe(0);
    });
    it('PUBLIC, anon y authenticated no tienen privilegios sobre la tabla ni EXECUTE sobre riders_guard', async () => {
      const roles = ['anon', 'authenticated'];
      for (const role of roles) {
        const exists = await q(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
        if (!exists.rowCount) continue;
        for (const priv of [
          'SELECT',
          'INSERT',
          'UPDATE',
          'DELETE',
          'TRUNCATE',
          'REFERENCES',
          'TRIGGER',
        ]) {
          const r = await q<{ ok: boolean }>(
            `SELECT has_table_privilege($1, 'app.riders', $2) AS ok`,
            [role, priv],
          );
          expect(r.rows[0]?.ok, `${role} ${priv}`).toBe(false);
        }
        const f = await q<{ ok: boolean }>(
          `SELECT has_function_privilege($1, 'app.riders_guard()', 'EXECUTE') AS ok`,
          [role],
        );
        expect(f.rows[0]?.ok, `${role} EXECUTE`).toBe(false);
      }
      const acl = await q<{ relacl: string | null }>(
        `SELECT relacl::text FROM pg_class WHERE oid = 'app.riders'::regclass`,
      );
      expect(acl.rows[0]?.relacl ?? '').not.toMatch(/(^|[{,])=/); // sin entrada de PUBLIC (grantee vacío)
      const facl = await q<{ proacl: string | null }>(
        `SELECT proacl::text FROM pg_proc WHERE oid = 'app.riders_guard()'::regprocedure`,
      );
      expect(facl.rows[0]?.proacl ?? '').not.toMatch(/(^|[{,])=/);
    });
  });
});
