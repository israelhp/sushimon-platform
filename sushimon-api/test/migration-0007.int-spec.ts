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
 * Migración 0007 (geografía, zonas propias y settings logísticos, F09) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0007_test`), con 0001..0007 aplicadas en orden. Mismo patrón y misma omisión explícita que
 * migration-0005/0006.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de
 * Supabase real se omite y se avisa por consola.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0007_test';
const MIGRATIONS = [
  '0001_create_app_schema',
  '0002_identity_staff',
  '0003_branches_management',
  '0004_audit_events_append_only',
  '0005_staff_rbac',
  '0006_branch_hours_closures',
  '0007_delivery_geography_coverage',
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');

const ZONE = `INSERT INTO app.delivery_zones (branch_id, municipality_id, zone_label, zone_key, base_fee)
  VALUES ($1,$2,$3,$4,$5)`;
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!url)(
  'Migración 0007: geografía, delivery_zones y settings (base desechable)',
  () => {
    let scratch = '';
    let plain = false;
    let a = '';
    let b = '';
    let mun = '';
    let mun2 = '';

    beforeAll(async () => {
      plain = !(await withClient(url as string, hasRealSupabaseAuth));
      scratch = withDatabase(url as string, SCRATCH);
      if (!plain) {
        console.warn(
          '[migration-0007.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0007 NO se probó.',
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
        const m = await c.query<{ id: string }>(
          `SELECT id FROM app.municipalities WHERE name IN ('Mixco','Villa Nueva') ORDER BY name`,
        );
        mun = m.rows[0]?.id as string; // Mixco
        mun2 = m.rows[1]?.id as string; // Villa Nueva
      });
    });
    afterAll(async () => {
      if (!plain) return;
      await withClient(url as string, async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      });
    });

    /** Ejecuta en una conexión propia; devuelve el nombre de la restricción violada (o null si pasó). */
    const attempt = (sql: string, params: unknown[] = []) =>
      withClient(scratch, async (c) => {
        try {
          await c.query(sql, params);
          return null;
        } catch (e) {
          const err = e as pg.DatabaseError;
          return err.constraint ?? err.code ?? String(err);
        }
      });

    describe('seed (D9)', () => {
      it('siembra 22 departamentos y 17 municipios del departamento de Guatemala', async (ctx) => {
        if (!plain) ctx.skip();
        const r = await withClient(scratch, (c) =>
          c.query<{ d: number; m: number; mg: number; others: number }>(
            `SELECT (SELECT count(*)::int FROM app.departments) AS d,
                  (SELECT count(*)::int FROM app.municipalities) AS m,
                  (SELECT count(*)::int FROM app.municipalities mu JOIN app.departments de ON de.id = mu.department_id
                    WHERE de.name = 'Guatemala') AS mg,
                  (SELECT count(*)::int FROM app.municipalities mu JOIN app.departments de ON de.id = mu.department_id
                    WHERE de.name <> 'Guatemala') AS others`,
          ),
        );
        expect(r.rows[0]).toEqual({ d: 22, m: 17, mg: 17, others: 0 });
      });

      it('el seed es idempotente: reejecutar solo la parte de INSERT no cambia filas ni ids', async (ctx) => {
        if (!plain) ctx.skip();
        const sql = migrationSql('0007_delivery_geography_coverage');
        const seed = sql.slice(sql.indexOf('INSERT INTO "app"."departments"'));
        expect(seed).toContain('ON CONFLICT');
        const snapshot = () =>
          withClient(scratch, (c) =>
            c.query(
              `SELECT 'd' AS t, id, name FROM app.departments
             UNION ALL SELECT 'm', id, name FROM app.municipalities ORDER BY t, name`,
            ),
          );
        const before = await snapshot();
        await withClient(scratch, (c) => c.query(seed));
        await withClient(scratch, (c) => c.query(seed));
        const after = await snapshot();
        expect(after.rows).toEqual(before.rows);
        expect(after.rowCount).toBe(39);
      });

      it('respeta unicidad de catálogos y rechaza nombres vacíos o con espacios en los bordes', async (ctx) => {
        if (!plain) ctx.skip();
        expect(await attempt(`INSERT INTO app.departments (name) VALUES ('Guatemala')`)).toBe(
          'departments_name_key',
        );
        expect(await attempt(`INSERT INTO app.departments (name) VALUES (' X ')`)).toBe(
          'departments_name_valid',
        );
        expect(
          await attempt(
            `INSERT INTO app.municipalities (department_id, name) SELECT id, 'Mixco' FROM app.departments WHERE name = 'Guatemala'`,
          ),
        ).toBe('municipalities_department_id_name_key');
        expect(
          await attempt(`INSERT INTO app.municipalities (department_id, name) VALUES ($1, 'X')`, [
            NIL,
          ]),
        ).toBe('municipalities_department_id_fkey');
      });
    });

    describe('delivery_zones', () => {
      it('acepta cobertura general (NULL/key vacía), zonas con etiqueta y defaults', async (ctx) => {
        if (!plain) ctx.skip();
        expect(await attempt(ZONE, [a, mun, null, '', '15.00'])).toBeNull();
        expect(await attempt(ZONE, [a, mun, 'Zona 4', 'zona 4', '20.50'])).toBeNull();
        expect(await attempt(ZONE, [a, mun, 'Zona Ñandú', 'zona nandu', '0'])).toBeNull();
        expect(await attempt(ZONE, [b, mun, null, '', '15.00'])).toBeNull();
        const r = await withClient(scratch, (c) =>
          c.query(
            `INSERT INTO app.delivery_zones (branch_id, municipality_id) VALUES ($1,$2)
           RETURNING active, version, base_fee::text AS fee, created_at IS NOT NULL AS c, updated_at IS NOT NULL AS u, zone_key`,
            [a, mun2],
          ),
        );
        expect(r.rows[0]).toEqual({
          active: true,
          version: 1,
          fee: '0.00',
          c: true,
          u: true,
          zone_key: '',
        });
      });

      it('UNIQUE (branch, municipality, zone_key): dos generales o dos claves iguales => 23505 con el nombre esperado', async (ctx) => {
        if (!plain) ctx.skip();
        const u = 'delivery_zones_branch_municipality_zone_key';
        expect(await attempt(ZONE, [a, mun, null, '', '1.00'])).toBe(u);
        expect(await attempt(ZONE, [a, mun, 'ZONA 4', 'zona 4', '1.00'])).toBe(u);
        // otra sucursal u otro municipio: permitido
        expect(await attempt(ZONE, [b, mun, 'Zona 4', 'zona 4', '1.00'])).toBeNull();
        expect(await attempt(ZONE, [a, mun2, 'Zona 4', 'zona 4', '1.00'])).toBeNull();
      });

      it('la unicidad rige también para zonas inactivas (no se crea otra: se reactiva)', async (ctx) => {
        if (!plain) ctx.skip();
        await withClient(scratch, (c) =>
          c.query(
            `UPDATE app.delivery_zones SET active = false WHERE branch_id = $1 AND municipality_id = $2 AND zone_key = 'zona 4'`,
            [a, mun],
          ),
        );
        expect(await attempt(ZONE, [a, mun, 'Zona 4', 'zona 4', '1.00'])).toBe(
          'delivery_zones_branch_municipality_zone_key',
        );
      });

      it('carrera de duplicados: de dos inserts concurrentes gana uno y el otro recibe 23505', async (ctx) => {
        if (!plain) ctx.skip();
        const results = await Promise.all([
          attempt(ZONE, [b, mun2, 'Zona 9', 'zona 9', '5.00']),
          attempt(ZONE, [b, mun2, 'Zona 9', 'zona 9', '6.00']),
        ]);
        expect(results.filter((x) => x === null)).toHaveLength(1);
        expect(
          results.filter((x) => x === 'delivery_zones_branch_municipality_zone_key'),
        ).toHaveLength(1);
      });

      it('CHECK de tarifa: 0 y 99999.99 válidos; negativa, 100000 y más de 2 decimales rechazadas', async (ctx) => {
        if (!plain) ctx.skip();
        const c = 'delivery_zones_base_fee_range';
        expect(await attempt(ZONE, [a, mun, 'Max', 'max', '99999.99'])).toBeNull();
        expect(await attempt(ZONE, [a, mun, 'Neg', 'neg', '-0.01'])).toBe(c);
        expect(await attempt(ZONE, [a, mun, 'Over', 'over', '100000.00'])).toBe(c);
        // 99999.995 se redondea a 100000.00 al convertir a numeric(12,2) => rechazada por el CHECK
        expect(await attempt(ZONE, [a, mun, 'Round', 'round', '99999.995'])).toBe(c);
        // 15.001 se redondea a 15.00 (la API rechaza más de 2 decimales antes de llegar aquí)
        const r = await withClient(scratch, (cl) =>
          cl.query(`SELECT '15.001'::numeric(12,2)::text AS v`),
        );
        expect(r.rows[0]).toEqual({ v: '15.00' });
      });

      it('CHECK de coherencia etiqueta/clave', async (ctx) => {
        if (!plain) ctx.skip();
        const c = 'delivery_zones_label_key_coherent';
        expect(await attempt(ZONE, [a, mun2, null, 'x', '1'])).toBe(c);
        expect(await attempt(ZONE, [a, mun2, 'Zona 1', '', '1'])).toBe(c);
      });

      it('CHECK de etiqueta: sin espacios en bordes, 1..60 caracteres', async (ctx) => {
        if (!plain) ctx.skip();
        const c = 'delivery_zones_label_valid';
        expect(await attempt(ZONE, [a, mun2, ' Zona 1', 'zona 1', '1'])).toBe(c);
        expect(await attempt(ZONE, [a, mun2, 'x'.repeat(61), 'x'.repeat(61), '1'])).toBe(c);
        expect(await attempt(ZONE, [a, mun2, 'x'.repeat(60), 'x'.repeat(60), '1'])).toBeNull();
      });

      it('CHECK de clave normalizada: minúsculas, sin bordes con espacio y sin espacios consecutivos', async (ctx) => {
        if (!plain) ctx.skip();
        const c = 'delivery_zones_key_normalized';
        expect(await attempt(ZONE, [a, mun2, 'Zona 1', 'Zona 1', '1'])).toBe(c);
        expect(await attempt(ZONE, [a, mun2, 'Zona 1', 'zona 1 ', '1'])).toBe(c);
        expect(await attempt(ZONE, [a, mun2, 'Zona  1', 'zona  1', '1'])).toBe(c);
      });

      it('CHECK de version >= 1', async (ctx) => {
        if (!plain) ctx.skip();
        expect(
          await attempt(
            `UPDATE app.delivery_zones SET version = 0 WHERE branch_id = $1 AND municipality_id = $2 AND zone_key = ''`,
            [a, mun],
          ),
        ).toBe('delivery_zones_version_positive');
      });

      it('control de versión optimista: UPDATE ... WHERE version = $v afecta 0 filas con versión obsoleta', async (ctx) => {
        if (!plain) ctx.skip();
        const upd = (v: number) =>
          withClient(scratch, (c) =>
            c.query(
              `UPDATE app.delivery_zones SET base_fee = '18.00', version = version + 1, updated_at = now()
             WHERE branch_id = $1 AND municipality_id = $2 AND zone_key = '' AND version = $3`,
              [a, mun, v],
            ),
          );
        expect((await upd(1)).rowCount).toBe(1);
        expect((await upd(1)).rowCount).toBe(0);
        expect((await upd(2)).rowCount).toBe(1);
      });

      it('FKs RESTRICT: sucursal/municipio inexistentes rechazados y no se pueden borrar con zonas', async (ctx) => {
        if (!plain) ctx.skip();
        expect(await attempt(ZONE, [NIL, mun, null, '', '1'])).toBe(
          'delivery_zones_branch_id_fkey',
        );
        expect(await attempt(ZONE, [a, NIL, null, '', '1'])).toBe(
          'delivery_zones_municipality_id_fkey',
        );
        expect(await attempt('DELETE FROM app.branches WHERE id = $1', [a])).toMatch(
          /delivery_zones_branch_id_fkey|branch_.*_fkey/,
        );
        expect(await attempt('DELETE FROM app.municipalities WHERE id = $1', [mun])).toBe(
          'delivery_zones_municipality_id_fkey',
        );
        expect(await attempt(`DELETE FROM app.departments WHERE name = 'Guatemala'`)).toBe(
          'municipalities_department_id_fkey',
        );
      });

      it('la consulta de cobertura es acotada por la clave del UNIQUE (plan sin Seq Scan con datos y estadísticas)', async (ctx) => {
        if (!plain) ctx.skip();
        const plan = await withClient(scratch, async (c) => {
          await c.query(
            `INSERT INTO app.delivery_zones (branch_id, municipality_id, zone_label, zone_key, base_fee)
           SELECT $1, $2, 'z' || g, 'z' || g, 1 FROM generate_series(1, 500) g`,
            [b, mun],
          );
          await c.query('ANALYZE app.delivery_zones');
          await c.query('SET enable_seqscan = off');
          const r = await c.query<{ 'QUERY PLAN': string }>(
            `EXPLAIN SELECT id FROM app.delivery_zones
           WHERE branch_id = $1 AND municipality_id = $2 AND active AND zone_key IN ('z7', '')`,
            [b, mun],
          );
          return r.rows.map((x) => x['QUERY PLAN']).join('\n');
        });
        expect(plan).toContain('delivery_zones_branch_municipality_zone_key');
        expect(plan).not.toContain('Seq Scan');
      });
    });

    describe('branch_delivery_settings', () => {
      it('aplica defaults (zonas propias apagadas, PedidosYa encendido) y es 1:1 con la sucursal', async (ctx) => {
        if (!plain) ctx.skip();
        expect(
          await attempt('INSERT INTO app.branch_delivery_settings (branch_id) VALUES ($1)', [a]),
        ).toBeNull();
        const r = await withClient(scratch, (c) =>
          c.query(
            `SELECT own_delivery_zones_enabled AS own, pedidosya_enabled AS py FROM app.branch_delivery_settings WHERE branch_id = $1`,
            [a],
          ),
        );
        expect(r.rows[0]).toEqual({ own: false, py: true });
        expect(
          await attempt('INSERT INTO app.branch_delivery_settings (branch_id) VALUES ($1)', [a]),
        ).toBe('branch_delivery_settings_pkey');
      });

      it('upsert por branch_id (primer PATCH) y concurrencia sin duplicados', async (ctx) => {
        if (!plain) ctx.skip();
        const up = (own: boolean) =>
          attempt(
            `INSERT INTO app.branch_delivery_settings (branch_id, own_delivery_zones_enabled)
           VALUES ($1, $2)
           ON CONFLICT (branch_id) DO UPDATE SET own_delivery_zones_enabled = EXCLUDED.own_delivery_zones_enabled, updated_at = now()`,
            [b, own],
          );
        expect(await Promise.all([up(true), up(false)])).toEqual([null, null]);
        const n = await withClient(scratch, (c) =>
          c.query(
            `SELECT count(*)::int AS n FROM app.branch_delivery_settings WHERE branch_id = $1`,
            [b],
          ),
        );
        expect(n.rows[0]).toEqual({ n: 1 });
      });

      it('rechaza sucursales inexistentes y bloquea el borrado de sucursales con settings', async (ctx) => {
        if (!plain) ctx.skip();
        expect(
          await attempt('INSERT INTO app.branch_delivery_settings (branch_id) VALUES ($1)', [NIL]),
        ).toBe('branch_delivery_settings_branch_id_fkey');
        expect(await attempt('DELETE FROM app.branches WHERE id = $1', [b])).toMatch(/_fkey$/);
      });
    });

    it('las cuatro tablas tienen RLS habilitado', async (ctx) => {
      if (!plain) ctx.skip();
      const rls = await withClient(scratch, (c) =>
        c.query<{ relname: string; relrowsecurity: boolean }>(
          `SELECT relname, relrowsecurity FROM pg_class
         WHERE relnamespace = 'app'::regnamespace
           AND relname IN ('departments','municipalities','delivery_zones','branch_delivery_settings')
         ORDER BY relname`,
        ),
      );
      expect(rls.rows).toEqual([
        { relname: 'branch_delivery_settings', relrowsecurity: true },
        { relname: 'delivery_zones', relrowsecurity: true },
        { relname: 'departments', relrowsecurity: true },
        { relname: 'municipalities', relrowsecurity: true },
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
          '[migration-0007.int-spec] REVOKE no verificado: los roles anon/authenticated no existen en este PostgreSQL plano.',
        );
        ctx.skip();
      }
      for (const { rolname } of roles.rows) {
        const res = await withClient(scratch, (c) =>
          c.query<{ t: string; ok: boolean }>(
            `SELECT t, has_table_privilege($1, t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ok
           FROM unnest(ARRAY['app.departments','app.municipalities','app.delivery_zones','app.branch_delivery_settings']) AS t`,
            [rolname],
          ),
        );
        expect(res.rows.map((r) => r.ok)).toEqual([false, false, false, false]);
      }
    });
  },
);
