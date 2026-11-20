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
  // En Windows pnpm es un shim `pnpm.cmd`: execFileSync no lo ejecuta sin shell (ENOENT).
  const isWindows = process.platform === 'win32';
  execFileSync(isWindows ? 'pnpm.cmd' : 'pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: { ...process.env, DIRECT_URL: url },
    shell: isWindows,
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
  created: {
    authUserIds: Iterable<string>;
    branchIds: Iterable<string>;
    /** F11: productos sembrados por la prueba (sus imágenes y favoritos caen en cascada). */
    productIds?: Iterable<string>;
    /** F10/F11: categorías sembradas por la prueba (planas o ya sin hijas; se borran DESPUÉS de sus productos). */
    categoryIds?: Iterable<string>;
  },
): Promise<void> {
  const authIds = [...created.authUserIds];
  const branchIds = [...created.branchIds];
  const productIds = [...(created.productIds ?? [])];
  const categoryIds = [...(created.categoryIds ?? [])];
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
      // F06: favoritos del cliente (la FK es CASCADE, pero se borra explícito antes que los clientes).
      await c.query(
        'DELETE FROM app.customer_favorites WHERE customer_id IN (SELECT id FROM app.customers WHERE auth_user_id = ANY($1::uuid[]))',
        [authIds],
      );
      await c.query('DELETE FROM app.customers WHERE auth_user_id = ANY($1::uuid[])', [authIds]);
      // F13: precios/disponibilidad por sucursal de la prueba (FK RESTRICT hacia branches y products; van ANTES).
      const bp = await c.query<{ oid: string | null }>(
        `SELECT to_regclass('app.branch_products') AS oid`,
      );
      if (bp.rows[0]?.oid) {
        await c.query(
          'DELETE FROM app.branch_products WHERE branch_id = ANY($1::uuid[]) OR product_id = ANY($2::uuid[])',
          [branchIds, productIds],
        );
      }
      // F11: productos y categorías de la prueba (solo si la migración 0012/0011 está aplicada). Los favoritos y las
      // imágenes caen en cascada; las categorías tienen FK RESTRICT desde products, por eso van después.
      const catalog = await c.query<{ products: string | null; categories: string | null }>(
        `SELECT to_regclass('app.products') AS products, to_regclass('app.categories') AS categories`,
      );
      if (productIds.length > 0 && catalog.rows[0]?.products) {
        await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [
          productIds,
        ]);
        await c.query('DELETE FROM app.products WHERE id = ANY($1::uuid[])', [productIds]);
      }
      if (categoryIds.length > 0 && catalog.rows[0]?.categories) {
        await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [
          categoryIds,
        ]);
        // FK RESTRICT parent_id: hojas primero, repetido (máx. 3 niveles).
        for (let level = 0; level < 4; level += 1) {
          await c.query(
            `DELETE FROM app.categories k WHERE k.id = ANY($1::uuid[])
               AND NOT EXISTS (SELECT 1 FROM app.categories ch WHERE ch.parent_id = k.id)`,
            [categoryIds],
          );
        }
      }
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

/**
 * F24 (0019): borra los pagos y sus eventos de los pedidos dados ANTES de borrar los pedidos (FK RESTRICT). Exige estar dentro
 * de una transacción con `SET LOCAL app.allow_order_cleanup = 'on'` (los triggers de `payments` y `payment_events` lo exigen).
 * Si 0019 aún no está aplicada no hace nada. Solo para limpieza de datos `zz-` de las pruebas.
 */
export async function deletePaymentsOf(c: pg.Client, orderIds: string[]): Promise<void> {
  const found = await c.query<{ oid: string | null }>(`SELECT to_regclass('app.payments') AS oid`);
  if (!found.rows[0]?.oid) return;
  await c.query('DELETE FROM app.payment_events WHERE order_id = ANY($1::uuid[])', [orderIds]);
  await c.query('DELETE FROM app.payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
}

/**
 * F27 (0021): borra los motoristas de las sucursales dadas ANTES de borrar las sucursales (FK RESTRICT). `riders_guard` rechaza
 * `DELETE` salvo con `app.allow_order_cleanup = 'on'`: se habilita SOLO en esta transacción. Si 0021 aún no está aplicada no hace
 * nada. Solo para limpieza de datos de las pruebas (sucursales sembradas por ellas).
 */
export async function deleteRidersOf(c: pg.Client, branchIds: string[]): Promise<void> {
  const found = await c.query<{ oid: string | null }>(`SELECT to_regclass('app.riders') AS oid`);
  if (!found.rows[0]?.oid) return;
  await c.query('BEGIN');
  try {
    await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
    await c.query('DELETE FROM app.riders WHERE branch_id = ANY($1::uuid[])', [branchIds]);
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  }
}
