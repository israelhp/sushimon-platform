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
  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
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
