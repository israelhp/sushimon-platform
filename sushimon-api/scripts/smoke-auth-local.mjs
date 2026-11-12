// Prueba de humo LOCAL de autenticación: Supabase Auth local (JWT real ES256) + API compilada +
// PostgreSQL temporal en Docker con las migraciones del repo. No toca la base de datos de Supabase local
// ni ningún entorno remoto.
//
// Requisitos: `pnpm db:local:start` (Supabase local), Docker, `pnpm --filter sushimon-api build`.
// Uso: pnpm --filter sushimon-api smoke:auth:local
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(apiDir, '..');
const CONTAINER = 'sm-pg-smoke';
const DB_PORT = 55434;
const DB_URL = `postgresql://postgres:smoke@127.0.0.1:${DB_PORT}/postgres`;
const API_PORT = 3921;

const status = JSON.parse(
  execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { cwd: repoRoot }).toString(),
);
const AUTH = `${status.API_URL}/auth/v1`;
const email = `smoke-${Date.now()}@sushimon.test`;
const password = `Smoke-${Date.now()}-Aa1`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const sh = (args) => execFileSync('docker', args, { stdio: 'pipe' }).toString();
let api;
let db;
try {
  sh(['rm', '-f', CONTAINER]);
  sh([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    'POSTGRES_PASSWORD=smoke',
    '-p',
    `${DB_PORT}:5432`,
    'postgres:17-alpine',
  ]);
  for (let i = 0; i < 30; i++) {
    try {
      sh(['exec', CONTAINER, 'pg_isready', '-U', 'postgres']);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await new Promise((r) => setTimeout(r, 2000));

  // 1) Usuario real en Supabase Auth local y sesión (JWT firmado por Supabase).
  const created = await fetch(`${AUTH}/admin/users`, {
    method: 'POST',
    headers: {
      apikey: status.SECRET_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  check('usuario creado en Supabase Auth local', created.ok && Boolean(user.id));
  const sessionRes = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: status.PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const token = (await sessionRes.json()).access_token;
  const alg = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).alg;
  check('token real emitido por Supabase', Boolean(token), `alg=${alg}`);

  // 2) Esquema de la API en el PostgreSQL temporal (auth.users mínimo + migraciones SQL del repo).
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
  const migDir = join(apiDir, 'prisma', 'migrations');
  for (const d of readdirSync(migDir)
    .filter((n) => /^\d{4}_/.test(n))
    .sort()) {
    await db.query(readFileSync(join(migDir, d, 'migration.sql'), 'utf8'));
  }

  // 3) API real validando ese token contra el JWKS de Supabase.
  api = spawn('node', ['dist/main.js'], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      SUPABASE_URL: status.API_URL,
      DATABASE_URL: DB_URL,
      HEALTH_READY_TOKEN: 'token-smoke-1234567890',
    },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 3500));
  const call = (path, tok) =>
    fetch(`http://127.0.0.1:${API_PORT}${path}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });

  check('sin token → 401', (await call('/v1/me')).status === 401);
  check(
    'token manipulado → 401',
    (await call('/v1/me', `${token.slice(0, -4)}AAAA`)).status === 401,
  );
  const ctx = await call('/v1/auth/context', token);
  const ctxBody = await ctx.json();
  check(
    'GET /v1/auth/context con JWT real → 200',
    ctx.status === 200 && ctxBody.authUserId === user.id,
    `provider=${ctxBody.provider} backofficeAccess=${ctxBody.backofficeAccess}`,
  );
  const me = await call('/v1/me', token);
  const meBody = await me.json();
  check(
    'GET /v1/me crea el cliente → 200',
    me.status === 200 && Boolean(meBody.customer?.id) && meBody.isStaff === false,
    meBody.customer?.fullName,
  );
  const me2 = await (await call('/v1/me', token)).json();
  check('GET /v1/me es idempotente', me2.customer?.id === meBody.customer?.id);
  const row = await db.query(
    'SELECT count(*)::int AS n FROM app.customers WHERE auth_user_id = $1',
    [user.id],
  );
  check('una sola fila en app.customers', row.rows[0].n === 1);
  check(
    'cliente sin personal: backofficeAccess=false',
    ctxBody.backofficeAccess === false && ctxBody.staff === null,
  );

  // 4) Empleado preregistrado pero con sesión de contraseña (no Google): NO se vincula.
  const role = await db.query("SELECT id FROM app.roles WHERE code = 'admin'");
  const staff = await db.query(
    'INSERT INTO app.staff_users (full_name, email) VALUES ($1, $2) RETURNING id',
    ['Empleado Humo', email],
  );
  await db.query('INSERT INTO app.staff_assignments (staff_id, role_id) VALUES ($1, $2)', [
    staff.rows[0].id,
    role.rows[0].id,
  ]);
  const after = await (await call('/v1/auth/context', token)).json();
  check(
    'sesión por contraseña NO vincula al empleado (solo OAuth Google)',
    after.backofficeAccess === false,
  );
} finally {
  api?.kill();
  await db?.end().catch(() => undefined);
  try {
    sh(['rm', '-f', CONTAINER]);
  } catch {
    /* sin contenedor */
  }
}
console.log(results.every(Boolean) ? 'SMOKE OK' : 'SMOKE CON FALLOS');
process.exit(results.every(Boolean) ? 0 : 1);
