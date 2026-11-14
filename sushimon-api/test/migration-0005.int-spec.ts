import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';

/**
 * Migración 0005 (RBAC granular) y script `staff:bootstrap` sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0005_test`): se aplican 0001..0004 a mano para poder sembrar casos previos a 0005.
 * Solo corre en un PostgreSQL plano de pruebas: nunca contra un proyecto Supabase real. OMISIÓN EXPLÍCITA: si
 * `auth.users` es el de Supabase (no el stub), los casos que crean bases se omiten Y se avisa por consola
 * (CREATE DATABASE no es posible/deseable allí); en ese caso la migración y el bootstrap NO quedan probados.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0005_test';
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const BEFORE = [
  '0001_create_app_schema',
  '0002_identity_staff',
  '0003_branches_management',
  '0004_audit_events_append_only',
];
const M0005 = '0005_staff_rbac';

describe.skipIf(!url)('Migración 0005 y bootstrap (base desechable)', () => {
  let scratch = '';
  let plain = false;

  const dropScratch = (c: pg.Client) => c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);

  const fresh = async (apply: string[]) => {
    await withClient(url as string, async (c) => {
      await dropScratch(c);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      // Una consulta simple con varias sentencias se ejecuta como UNA transacción implícita (igual que Prisma).
      for (const m of apply) await c.query(migrationSql(m));
    });
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0005.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0005 y staff:bootstrap NO se probaron.',
      );
    }
  });
  afterAll(async () => {
    if (!plain) return;
    await withClient(url as string, async (c) => {
      await dropScratch(c);
    });
  });

  const seedStaff = async (
    c: pg.Client,
    role: string,
    branchId: string | null,
    email = `${randomUUID().slice(0, 8)}@sushimon.test`,
  ) => {
    const staff = await c.query<{ id: string }>(
      `INSERT INTO app.staff_users (full_name, email) VALUES ('Prueba', $1) RETURNING id`,
      [email],
    );
    await c.query(
      `INSERT INTO app.staff_assignments (staff_id, role_id, branch_id)
       SELECT $1, id, $3 FROM app.roles WHERE code = $2`,
      [staff.rows[0]?.id, role, branchId],
    );
    return staff.rows[0]?.id as string;
  };

  it('aborta con mensaje claro si hay alcance global con un rol distinto de admin, y no deja NADA aplicado', async (ctx) => {
    if (!plain) ctx.skip();
    await fresh(BEFORE);
    await withClient(scratch, async (c) => {
      await seedStaff(c, 'kitchen', null); // violación: global sin ser admin
      await expect(c.query(migrationSql(M0005))).rejects.toThrow(/0005 abortada/);
      const cols = await c.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='roles' AND column_name='is_system'`,
      );
      expect(cols.rowCount).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM app.permissions')).rows[0]).toEqual({
        n: 10,
      });
    });
  });

  it('aborta si hay un admin con sucursal', async (ctx) => {
    if (!plain) ctx.skip();
    await fresh(BEFORE);
    await withClient(scratch, async (c) => {
      const branch = await c.query<{ id: string }>(
        `INSERT INTO app.branches (code, name, address) VALUES ('zona-10', 'Zona 10', 'Dir') RETURNING id`,
      );
      await seedStaff(c, 'admin', branch.rows[0]?.id as string);
      await expect(c.query(migrationSql(M0005))).rejects.toThrow(/0005 abortada/);
    });
  });

  it('remapea conservando las ediciones manuales previas, retira los gruesos y deja admin con el catálogo completo', async (ctx) => {
    if (!plain) ctx.skip();
    await fresh(BEFORE);
    await withClient(scratch, async (c) => {
      // Edición manual previa: a cocina se le había dado `products.edit`.
      await c.query(
        `INSERT INTO app.role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM app.roles r, app.permissions p WHERE r.code='kitchen' AND p.code='products.edit'`,
      );
      await seedStaff(c, 'admin', null);
      await c.query(migrationSql(M0005));
      const perms = async (role: string) =>
        (
          await c.query<{ code: string }>(
            `SELECT p.code FROM app.role_permissions rp JOIN app.roles r ON r.id = rp.role_id
             JOIN app.permissions p ON p.id = rp.permission_id WHERE r.code = $1 ORDER BY p.code`,
            [role],
          )
        ).rows.map((r) => r.code);
      expect(await perms('kitchen')).toEqual([
        'catalog.create',
        'catalog.read',
        'catalog.update',
        'orders.accept',
        'orders.complete',
        'orders.prepare',
        'orders.read',
        'orders.reject',
      ]);
      expect((await perms('admin')).length).toBe(43);
      expect((await c.query(`SELECT count(*)::int AS n FROM app.permissions`)).rows[0]).toEqual({
        n: 43,
      });
      expect(
        (
          await c.query(
            `SELECT count(*)::int AS n FROM app.permissions WHERE code IN ('branches','users','dashboard','reports')`,
          )
        ).rows[0],
      ).toEqual({ n: 0 });
      expect((await c.query(`SELECT code FROM app.roles WHERE is_system`)).rows).toEqual([
        { code: 'admin' },
      ]);
      expect((await c.query(`SELECT code FROM app.roles WHERE code='staff'`)).rowCount).toBe(1);
      // El trigger quedó activo.
      await expect(seedStaff(c, 'kitchen', null)).rejects.toThrow();
    });
  });

  describe('staff:bootstrap', () => {
    const host = (): string => new URL(scratch).hostname;
    const run = (args: string[], confirm = true) =>
      spawnSync(
        'pnpm',
        [
          'exec',
          'tsx',
          'scripts/bootstrap-admin.ts',
          ...args,
          ...(confirm ? [`--confirm-host=${host()}`] : []),
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          // Las URL se pasan EXPLÍCITAS para que el .env del paquete nunca decida el destino.
          env: { ...process.env, DATABASE_URL: scratch, DIRECT_URL: scratch },
        },
      );
    const q = <T extends object>(sql: string, params: unknown[] = []) =>
      withClient(scratch, async (c) => (await c.query<T>(sql, params)).rows);

    it('exige --yes, es idempotente, audita staff.bootstrapped (actor NULL) y protege si ya hay un administrador vinculado', async (ctx) => {
      if (!plain) ctx.skip();
      await fresh([...BEFORE, M0005]);
      const mail = `boot-${randomUUID().slice(0, 6)}@sushimon.test`;

      const noYes = run(['--email', mail, '--name', 'Primer Admin']);
      expect(noYes.status).toBe(2);
      expect(noYes.stdout).toContain(SCRATCH);
      expect(await q('SELECT 1 FROM app.staff_users')).toHaveLength(0);

      // --yes sin --confirm-host, o con un host distinto, también aborta (exit 2) sin escribir.
      expect(run(['--email', mail, '--name', 'Primer Admin', '--yes'], false).status).toBe(2);
      const wrongHost = spawnSync(
        'pnpm',
        [
          'exec',
          'tsx',
          'scripts/bootstrap-admin.ts',
          '--email',
          mail,
          '--name',
          'X',
          '--yes',
          '--confirm-host=otro.example',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: scratch, DIRECT_URL: scratch },
        },
      );
      expect(wrongHost.status).toBe(2);
      // Un valor que empieza por `--` no se consume como argumento.
      expect(run(['--email', '--yes', '--name', 'X']).status).toBe(2);
      expect(await q('SELECT 1 FROM app.staff_users')).toHaveLength(0);

      const first = run(['--email', mail, '--name', 'Primer Admin', '--yes']);
      expect(first.status, first.stderr).toBe(0);
      const rows = await q<{
        id: string;
        auth_user_id: string | null;
        created_by: string | null;
        linked_at: Date | null;
      }>('SELECT id, auth_user_id, created_by, linked_at FROM app.staff_users WHERE email = $1', [
        mail,
      ]);
      expect(rows[0]).toMatchObject({ auth_user_id: null, created_by: null, linked_at: null });
      const events = await q<{
        action: string;
        actor_id: string | null;
        new_values: Record<string, unknown>;
      }>(`SELECT action, actor_id, new_values FROM app.audit_events WHERE entity_id = $1`, [
        rows[0]?.id,
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'staff.bootstrapped', actor_id: null });
      expect(JSON.stringify(events[0])).not.toContain(mail);

      // Idempotente: el correo ya es administrador global activo → sin cambios ni nueva auditoría.
      const again = run(['--email', mail, '--name', 'Primer Admin', '--yes']);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain('Sin cambios');
      expect(await q('SELECT 1 FROM app.audit_events')).toHaveLength(1);

      // Con un administrador activo y VINCULADO, otro correo aborta (exit 3) salvo --allow-existing-admin.
      const authId = randomUUID();
      await withClient(scratch, async (c) => {
        await c.query('INSERT INTO auth.users (id) VALUES ($1)', [authId]);
        await c.query(
          'UPDATE app.staff_users SET auth_user_id = $1, linked_at = now() WHERE email = $2',
          [authId, mail],
        );
      });
      const other = `otro-${randomUUID().slice(0, 6)}@sushimon.test`;
      const blocked = run(['--email', other, '--name', 'Segundo', '--yes']);
      expect(blocked.status).toBe(3);
      expect(await q('SELECT 1 FROM app.staff_users WHERE email = $1', [other])).toHaveLength(0);
      const allowed = run([
        '--email',
        other,
        '--name',
        'Segundo',
        '--yes',
        '--allow-existing-admin',
      ]);
      expect(allowed.status, allowed.stderr).toBe(0);
      expect(await q('SELECT 1 FROM app.staff_users WHERE email = $1', [other])).toHaveLength(1);
    });
  });
});
