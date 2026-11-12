import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../src/database/prisma.service.js';
import { validateEnv, type Env } from '../src/config/env.js';

const url = process.env['DATABASE_URL_TEST'];

describe.skipIf(!url)('PrismaService contra PostgreSQL real', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    // Aplica las migraciones versionadas (crean el esquema `app`) con el CLI de Prisma.
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      env: { ...process.env, DIRECT_URL: url },
    });
    const config = new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url }));
    prisma = new PrismaService(config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('conecta y encuentra el esquema app', async () => {
    await expect(prisma.checkConnection()).resolves.toEqual({ ok: true, schemaApp: true });
  });

  it('la migración es idempotente', () => {
    expect(() =>
      execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
        stdio: 'pipe',
        env: { ...process.env, DIRECT_URL: url },
      }),
    ).not.toThrow();
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
});
