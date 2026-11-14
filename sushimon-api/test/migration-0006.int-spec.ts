import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';

/**
 * Migración 0006 (horarios y cierres de sucursal, F08) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0006_test`), con 0001..0006 aplicadas en orden. Mismo patrón y misma omisión explícita que
 * migration-0005.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`, con btree_gist disponible, que es
 * contrib estándar); si `auth.users` es la de Supabase real se omite y se avisa por consola.
 * Los mismos casos se validaron además en PGlite 0.4.3 en memoria (ver docs/database/README.md); PGlite no es
 * dependencia del paquete, por eso este archivo usa `pg` como el resto de pruebas de integración.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0006_test';
const MIGRATIONS = [
  '0001_create_app_schema',
  '0002_identity_staff',
  '0003_branches_management',
  '0004_audit_events_append_only',
  '0005_staff_rbac',
  '0006_branch_hours_closures',
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');

const HOUR =
  'INSERT INTO app.branch_hours (branch_id, weekday, opens_at, closes_at) VALUES ($1,$2,$3,$4)';
const CLOSURE =
  'INSERT INTO app.branch_closures (branch_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4)';
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!url)('Migración 0006: branch_hours y branch_closures (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let a = '';
  let b = '';

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0006.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0006 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of MIGRATIONS) await c.query(migrationSql(m));
      const ins = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO app.branches (code, name, address) VALUES ($1, $1, 'Dir') RETURNING id`,
            [code],
          )
        ).rows[0]?.id as string;
      a = await ins('zona-10');
      b = await ins('zona-11');
    });
  });
  afterAll(async () => {
    if (!plain) return;
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    });
  });

  /** Ejecuta en una conexión propia; devuelve el nombre de la restricción violada (o null si pasó). */
  const attempt = (sql: string, params: unknown[]) =>
    withClient(scratch, async (c) => {
      try {
        await c.query(sql, params);
        return null;
      } catch (e) {
        const err = e as pg.DatabaseError;
        return err.constraint ?? err.code ?? String(err);
      }
    });

  describe('branch_hours', () => {
    it('acepta intervalos, intervalos contiguos y closes_at = 24:00 (conservado como 24:00:00)', async (ctx) => {
      if (!plain) ctx.skip();
      expect(await attempt(HOUR, [a, 1, '11:00', '15:00'])).toBeNull();
      expect(await attempt(HOUR, [a, 1, '15:00', '24:00'])).toBeNull();
      const rows = await withClient(scratch, (c) =>
        c.query(
          `SELECT opens_at::text AS o, closes_at::text AS c FROM app.branch_hours
           WHERE branch_id = $1 AND weekday = 1 ORDER BY opens_at`,
          [a],
        ),
      );
      expect(rows.rows).toEqual([
        { o: '11:00:00', c: '15:00:00' },
        { o: '15:00:00', c: '24:00:00' },
      ]);
    });

    it('rechaza solapamientos en la misma sucursal y día, pero no en otra sucursal u otro día', async (ctx) => {
      if (!plain) ctx.skip();
      expect(await attempt(HOUR, [a, 1, '14:00', '16:00'])).toBe('branch_hours_no_overlap');
      expect(await attempt(HOUR, [a, 1, '10:00', '23:00'])).toBe('branch_hours_no_overlap');
      expect(await attempt(HOUR, [b, 1, '11:00', '15:00'])).toBeNull();
      expect(await attempt(HOUR, [a, 2, '11:00', '15:00'])).toBeNull();
    });

    it('rechaza solapes también en UPDATE', async (ctx) => {
      if (!plain) ctx.skip();
      const code = await attempt(
        `UPDATE app.branch_hours SET closes_at = '16:00' WHERE branch_id = $1 AND weekday = 1 AND opens_at = '11:00'`,
        [a],
      );
      expect(code).toBe('branch_hours_no_overlap');
    });

    it('rechaza weekday fuera de 1..7 (ISO)', async (ctx) => {
      if (!plain) ctx.skip();
      expect(await attempt(HOUR, [a, 0, '11:00', '12:00'])).toBe('branch_hours_weekday_iso');
      expect(await attempt(HOUR, [a, 8, '11:00', '12:00'])).toBe('branch_hours_weekday_iso');
      expect(await attempt(HOUR, [a, 7, '11:00', '12:00'])).toBeNull();
    });

    it('exige opens_at < closes_at estricto (sin cruce de medianoche ni opens 24:00)', async (ctx) => {
      if (!plain) ctx.skip();
      const code = 'branch_hours_opens_before_closes';
      expect(await attempt(HOUR, [a, 3, '11:00', '11:00'])).toBe(code);
      expect(await attempt(HOUR, [a, 3, '18:00', '02:00'])).toBe(code);
      expect(await attempt(HOUR, [a, 3, '24:00', '24:00'])).toBe(code);
    });

    it('exige minutos exactos y rechaza duplicados de PK y sucursales inexistentes', async (ctx) => {
      if (!plain) ctx.skip();
      expect(await attempt(HOUR, [a, 3, '11:00:30', '12:00'])).toBe(
        'branch_hours_minute_granularity',
      );
      expect(await attempt(HOUR, [a, 2, '11:00', '12:00'])).toBe('branch_hours_pkey');
      expect(await attempt(HOUR, [NIL, 3, '11:00', '12:00'])).toBe('branch_hours_branch_id_fkey');
    });
  });

  describe('branch_closures', () => {
    it('acepta cierres, genera id por defecto y admite cierres contiguos o de otra sucursal', async (ctx) => {
      if (!plain) ctx.skip();
      expect(
        await attempt(CLOSURE, [a, '2027-01-01T00:00:00Z', '2027-01-03T00:00:00Z', 'Mant']),
      ).toBeNull();
      expect(
        await attempt(CLOSURE, [a, '2027-01-03T00:00:00Z', '2027-01-04T00:00:00Z', null]),
      ).toBeNull();
      expect(
        await attempt(CLOSURE, [b, '2027-01-01T00:00:00Z', '2027-01-03T00:00:00Z', null]),
      ).toBeNull();
      const n = await withClient(scratch, (c) =>
        c.query('SELECT count(*)::int AS n FROM app.branch_closures WHERE id IS NOT NULL'),
      );
      expect(n.rows[0]).toEqual({ n: 3 });
    });

    it('rechaza solapamientos (parcial y contenido) en la misma sucursal', async (ctx) => {
      if (!plain) ctx.skip();
      const code = 'branch_closures_no_overlap';
      expect(
        await attempt(CLOSURE, [a, '2027-01-02T00:00:00Z', '2027-01-03T12:00:00Z', null]),
      ).toBe(code);
      expect(
        await attempt(CLOSURE, [a, '2027-01-01T06:00:00Z', '2027-01-01T08:00:00Z', null]),
      ).toBe(code);
    });

    it('exige ends_at > starts_at', async (ctx) => {
      if (!plain) ctx.skip();
      const code = 'branch_closures_ends_after_starts';
      expect(
        await attempt(CLOSURE, [a, '2028-01-01T00:00:00Z', '2028-01-01T00:00:00Z', null]),
      ).toBe(code);
      expect(
        await attempt(CLOSURE, [a, '2028-01-02T00:00:00Z', '2028-01-01T00:00:00Z', null]),
      ).toBe(code);
    });

    it('valida reason: NULL permitido, no vacío tras trim, máximo 200', async (ctx) => {
      if (!plain) ctx.skip();
      const code = 'branch_closures_reason_valid';
      expect(
        await attempt(CLOSURE, [a, '2029-01-01T00:00:00Z', '2029-01-02T00:00:00Z', '   ']),
      ).toBe(code);
      expect(
        await attempt(CLOSURE, [
          a,
          '2029-01-01T00:00:00Z',
          '2029-01-02T00:00:00Z',
          'x'.repeat(201),
        ]),
      ).toBe(code);
      expect(
        await attempt(CLOSURE, [
          a,
          '2029-01-01T00:00:00Z',
          '2029-01-02T00:00:00Z',
          'x'.repeat(200),
        ]),
      ).toBeNull();
      expect(
        await attempt(CLOSURE, [a, '2029-02-01T00:00:00Z', '2029-02-02T00:00:00Z', null]),
      ).toBeNull();
    });

    it('rechaza sucursales inexistentes', async (ctx) => {
      if (!plain) ctx.skip();
      expect(
        await attempt(CLOSURE, [NIL, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z', null]),
      ).toBe('branch_closures_branch_id_fkey');
    });
  });

  it('no se puede borrar una sucursal con horarios o cierres (RESTRICT) y ambas tablas tienen RLS', async (ctx) => {
    if (!plain) ctx.skip();
    expect(await attempt('DELETE FROM app.branches WHERE id = $1', [a])).toMatch(
      /branch_(hours|closures)_branch_id_fkey/,
    );
    const rls = await withClient(scratch, (c) =>
      c.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class
         WHERE relnamespace = 'app'::regnamespace AND relname IN ('branch_hours','branch_closures')
         ORDER BY relname`,
      ),
    );
    expect(rls.rows).toEqual([
      { relname: 'branch_closures', relrowsecurity: true },
      { relname: 'branch_hours', relrowsecurity: true },
    ]);
  });

  it('anon/authenticated no tienen ningún privilegio sobre las tablas (omitida si esos roles no existen)', async (ctx) => {
    if (!plain) ctx.skip();
    const roles = await withClient(scratch, (c) =>
      c.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
      ),
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0006.int-spec] REVOKE no verificado: los roles anon/authenticated no existen en este PostgreSQL plano.',
      );
      ctx.skip();
    }
    for (const { rolname } of roles.rows) {
      const res = await withClient(scratch, (c) =>
        c.query<{ t: string; ok: boolean }>(
          `SELECT t, has_table_privilege($1, t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ok
           FROM unnest(ARRAY['app.branch_hours','app.branch_closures']) AS t`,
          [rolname],
        ),
      );
      expect(res.rows.map((r) => r.ok)).toEqual([false, false]);
    }
  });
});
