import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';

/**
 * Migración 0010 (REVOKE a PUBLIC/anon/authenticated, hallazgo M6) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0010_test`), con 0001..0010 aplicadas en orden. Mismo patrón y misma omisión explícita que
 * migration-0009.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase
 * real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0010_test';
const MIGRATIONS = [
  '0001_create_app_schema',
  '0002_identity_staff',
  '0003_branches_management',
  '0004_audit_events_append_only',
  '0005_staff_rbac',
  '0006_branch_hours_closures',
  '0007_delivery_geography_coverage',
  '0008_customer_addresses',
  '0009_customer_favorites',
  '0010_revoke_client_roles',
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');

const TABLES = [
  'branches',
  'customers',
  'staff_users',
  'roles',
  'permissions',
  'role_permissions',
  'staff_assignments',
  'audit_events',
];
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';

describe.skipIf(!url)('Migración 0010: REVOKE a roles de cliente (base desechable)', () => {
  let scratch = '';
  let plain = false;

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0010.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0010 NO se probó.',
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
    });
  });
  afterAll(async () => {
    if (!plain) return;
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    });
  });

  it('PUBLIC no conserva ningún privilegio sobre las 8 tablas (ACL sin entrada para PUBLIC)', async (ctx) => {
    if (!plain) ctx.skip();
    const res = await withClient(scratch, (c) =>
      c.query<{ relname: string; public_grants: number }>(
        `SELECT c.relname,
                (SELECT count(*)::int FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                  WHERE a.grantee = 0) AS public_grants
           FROM pg_class c
          WHERE c.relnamespace = 'app'::regnamespace AND c.relname = ANY($1::text[])
          ORDER BY c.relname`,
        [TABLES],
      ),
    );
    expect(res.rows.map((r) => r.relname)).toEqual([...TABLES].sort());
    for (const r of res.rows) expect(r.public_grants, r.relname).toBe(0);
  });

  it('RLS sigue habilitado en las 8 tablas (0010 no lo altera)', async (ctx) => {
    if (!plain) ctx.skip();
    const res = await withClient(scratch, (c) =>
      c.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class
          WHERE relnamespace = 'app'::regnamespace AND relname = ANY($1::text[]) ORDER BY relname`,
        [TABLES],
      ),
    );
    expect(res.rows).toHaveLength(TABLES.length);
    for (const r of res.rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it('es idempotente: aplicarla de nuevo no falla', async (ctx) => {
    if (!plain) ctx.skip();
    await withClient(scratch, (c) => c.query(migrationSql('0010_revoke_client_roles')));
  });

  it('anon/authenticated no tienen ningún privilegio sobre las 8 tablas (omitida si esos roles no existen)', async (ctx) => {
    if (!plain) ctx.skip();
    const roles = await withClient(scratch, (c) =>
      c.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
      ),
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0010.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen en este PostgreSQL plano.',
      );
      ctx.skip();
    }
    for (const { rolname } of roles.rows) {
      for (const table of TABLES) {
        const res = await withClient(scratch, (c) =>
          c.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
            rolname,
            `app.${table}`,
            PRIVS,
          ]),
        );
        expect(res.rows[0]?.ok, `${rolname} en ${table}`).toBe(false);
      }
    }
  });
});
