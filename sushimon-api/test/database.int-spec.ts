import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service.js';
import { validateEnv, type Env } from '../src/config/env.js';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  migrate,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from './support/staff-context.js';

const url = TEST_URL;
const TABLES = [
  'branches',
  'customers',
  'staff_users',
  'roles',
  'permissions',
  'role_permissions',
  'staff_assignments',
];

describe.skipIf(!url)('PrismaService y migraciones contra PostgreSQL real', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url, NODE_ENV: 'test' })),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('conecta y encuentra el esquema app', async () => {
    await expect(prisma.checkConnection()).resolves.toEqual({ ok: true, schemaApp: true });
  });

  it('las migraciones son idempotentes', () => {
    expect(() => migrate(url as string)).not.toThrow();
  });

  it('informa ok=false (sin lanzar) si la conexión falla', async () => {
    const bad = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({
          DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/none',
          DB_CONNECTION_TIMEOUT_MS: '500',
        }),
      ),
    );
    await expect(bad.checkConnection()).resolves.toEqual({ ok: false, schemaApp: false });
    await bad.$disconnect();
  });

  it('crea las tablas de identidad con RLS activado (denegar por defecto)', async () => {
    const rows = await withClient(
      url as string,
      async (c) =>
        (
          await c.query<{ relname: string; rls: boolean }>(
            `SELECT c.relname, c.relrowsecurity AS rls FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'app' AND c.relname = ANY($1)`,
            [TABLES],
          )
        ).rows,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    expect(rows.every((r) => r.rls)).toBe(true);
  });

  it('0005: siembra 4 roles y 43 permisos granulares; la matriz remapeada coincide con la spec 006', async () => {
    const roles = await prisma.role.findMany({ select: { code: true, isSystem: true } });
    expect(roles.map((r) => r.code).sort()).toEqual(['admin', 'kitchen', 'manager', 'staff']);
    expect(roles.filter((r) => r.isSystem).map((r) => r.code)).toEqual(['admin']);
    expect(await prisma.permission.count()).toBe(ALL_PERMISSIONS.length);

    const perms = await prisma.rolePermission.findMany({
      include: { role: true, permission: true },
    });
    const by = (role: string) =>
      perms
        .filter((p) => p.role.code === role)
        .map((p) => p.permission.code)
        .sort();
    // admin contiene TODO el catálogo (invariante que cada migración futura debe mantener).
    expect(by('admin')).toEqual([...ALL_PERMISSIONS].sort());
    for (const role of ['manager', 'kitchen', 'staff']) {
      expect(by(role), role).toEqual([...(ROLE_PERMISSIONS[role] as string[])].sort());
    }
  });

  it('0005: los 9 permisos gruesos retirados ya no existen (orders.accept se conserva en el catálogo nuevo)', async () => {
    const coarse = [
      'dashboard',
      'orders.status',
      'orders.dispatch',
      'products.edit',
      'products.availability',
      'promotions',
      'branches',
      'users',
      'reports',
    ];
    expect(await prisma.permission.count({ where: { code: { in: coarse } } })).toBe(0);
  });

  it('0005: roles.is_system y columnas de staff_users (created_at, linked_at, created_by) existen', async () => {
    const cols = await withClient(
      url as string,
      async (c) =>
        (
          await c.query<{ table_name: string; column_name: string; is_nullable: string }>(
            `SELECT table_name, column_name, is_nullable FROM information_schema.columns
             WHERE table_schema = 'app' AND (
               (table_name = 'roles' AND column_name = 'is_system') OR
               (table_name = 'staff_users' AND column_name IN ('created_at','linked_at','created_by')))`,
          )
        ).rows,
    );
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`).sort()).toEqual([
      'roles.is_system',
      'staff_users.created_at',
      'staff_users.created_by',
      'staff_users.linked_at',
    ]);
  });

  it('sin esquema auth (PostgreSQL plano) la migración se aplica sin las FK a auth.users', async (ctx) => {
    // Crea y borra una base de datos aparte: solo tiene sentido en un PostgreSQL desechable, no en Supabase.
    if (await withClient(url as string, hasRealSupabaseAuth)) ctx.skip();
    const plain = withDatabase(url as string, 'sushimon_plain_test');
    const dropPlain = (c: import('pg').Client) =>
      c.query('DROP DATABASE IF EXISTS sushimon_plain_test');
    await withClient(url as string, async (c) => {
      await dropPlain(c);
      await c.query('CREATE DATABASE sushimon_plain_test');
    });
    try {
      migrate(plain);
      const fks = await withClient(plain, async (c) => {
        const res = await c.query<{ conname: string }>(
          `SELECT conname FROM pg_constraint WHERE conname IN
             ('customers_auth_user_id_fkey','staff_users_auth_user_id_fkey')`,
        );
        return res.rows;
      });
      expect(fks).toHaveLength(0);
    } finally {
      await withClient(url as string, dropPlain);
    }
  });
});
