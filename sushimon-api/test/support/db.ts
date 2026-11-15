import { execFileSync } from 'node:child_process';
import pg from 'pg';

export const TEST_URL = process.env['DATABASE_URL_TEST'];

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Aplica las migraciones versionadas con el CLI de Prisma (conexión directa). */
export function migrate(url: string): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: { ...process.env, DIRECT_URL: url },
  });
}

/** `auth.users` mínimo para PostgreSQL plano (en Supabase real/local ya existe y es el verdadero). */
export async function ensureAuthStub(client: pg.Client): Promise<void> {
  // En Supabase `auth.users` ya existe y `postgres` no puede crear objetos en ese esquema (ni con IF NOT EXISTS).
  const found = await client.query<{ oid: string | null }>(
    `SELECT to_regclass('auth.users') AS oid`,
  );
  if (found.rows[0]?.oid) return;
  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query('CREATE TABLE auth.users (id uuid PRIMARY KEY)');
}

/** ¿`auth.users` es la tabla real de Supabase (con sus columnas) y no el stub mínimo de PostgreSQL plano? */
export async function hasRealSupabaseAuth(client: pg.Client): Promise<boolean> {
  const res = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users'`,
  );
  return (res.rows[0]?.n ?? 0) > 1;
}

/**
 * Borra SOLO los datos que crean las pruebas (para poder ejecutarlas contra un proyecto Supabase de pruebas):
 * empleados con correo `@sushimon.test`, clientes/identidades creados por la prueba y sucursales de la prueba.
 * Las filas de `auth.users` solo se borran si las insertó la prueba y no tienen correo (nunca usuarios reales).
 */
export async function cleanupTestData(
  url: string,
  created: { authUserIds: Iterable<string>; branchIds: Iterable<string> },
): Promise<void> {
  const authIds = [...created.authUserIds];
  const branchIds = [...created.branchIds];
  await withClient(url, async (c) => {
    await c.query('BEGIN');
    try {
      // audit_events es solo-añadir (migración 0004): la limpieza de pruebas lo habilita SOLO en esta transacción.
      await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
      // Eventos de los empleados de prueba (como actor o como entidad) y de sus roles editados por la prueba.
      await c.query(
        `DELETE FROM app.audit_events WHERE actor_id IN
           (SELECT id FROM app.staff_users WHERE email LIKE '%@sushimon.test')
           OR entity_id IN (SELECT id FROM app.staff_users WHERE email LIKE '%@sushimon.test')`,
      );
      await c.query(
        `DELETE FROM app.staff_assignments WHERE staff_id IN
           (SELECT id FROM app.staff_users WHERE email LIKE '%@sushimon.test')`,
      );
      await c.query(`DELETE FROM app.staff_users WHERE email LIKE '%@sushimon.test'`);
      await c.query('DELETE FROM app.customers WHERE auth_user_id = ANY($1::uuid[])', [authIds]);
      // F08: horarios y cierres de las sucursales de la prueba (FK RESTRICT hacia branches).
      await c.query('DELETE FROM app.branch_closures WHERE branch_id = ANY($1::uuid[])', [
        branchIds,
      ]);
      await c.query('DELETE FROM app.branch_hours WHERE branch_id = ANY($1::uuid[])', [branchIds]);
      // F09: zonas propias y configuración logística de las sucursales de la prueba (FK RESTRICT hacia branches).
      // Los catálogos departments/municipalities son seed permanente de la migración 0007: NO se borran.
      await c.query('DELETE FROM app.delivery_zones WHERE branch_id = ANY($1::uuid[])', [
        branchIds,
      ]);
      await c.query('DELETE FROM app.branch_delivery_settings WHERE branch_id = ANY($1::uuid[])', [
        branchIds,
      ]);
      // La auditoría referencia la sucursal (FK RESTRICT): solo se borra la de las sucursales de la prueba.
      await c.query('DELETE FROM app.audit_events WHERE branch_id = ANY($1::uuid[])', [branchIds]);
      await c.query('DELETE FROM app.branches WHERE id = ANY($1::uuid[])', [branchIds]);
      // Supabase real: solo filas sin correo (las de la prueba). Stub de PostgreSQL plano: no tiene columna email.
      const realAuth = await hasRealSupabaseAuth(c);
      await c.query(
        `DELETE FROM auth.users WHERE id = ANY($1::uuid[])${realAuth ? ' AND email IS NULL' : ''}`,
        [authIds],
      );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  });
}

export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
