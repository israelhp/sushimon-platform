import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { ensureAuthStub, migrate, TEST_URL, withClient, withDatabase } from './support/db.js';

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
    prisma = new PrismaService(new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url })));
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

  it('siembra 3 roles y 10 permisos con la matriz del prototipo', async () => {
    const perms = await prisma.rolePermission.findMany({
      include: { role: true, permission: true },
    });
    const by = (role: string) =>
      perms
        .filter((p) => p.role.code === role)
        .map((p) => p.permission.code)
        .sort();
    expect(by('admin')).toHaveLength(10);
    expect(by('manager')).toEqual([
      'dashboard',
      'orders.accept',
      'orders.dispatch',
      'orders.status',
      'products.availability',
      'reports',
    ]);
    expect(by('kitchen')).toEqual(['orders.accept', 'orders.status']);
  });

  it('sin esquema auth (PostgreSQL plano) la migración se aplica sin las FK a auth.users', async () => {
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
