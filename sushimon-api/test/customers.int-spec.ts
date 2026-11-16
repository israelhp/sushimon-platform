import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../src/auth/auth.types.js';
import { AuditService } from '../src/audit/audit.service.js';
import { CustomerProfileService } from '../src/customers/customer-profile.service.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;

function principal(over: Partial<Principal> = {}): Principal {
  return {
    authUserId: randomUUID(),
    email: `${randomUUID().slice(0, 8)}@sushimon.test`,
    provider: 'google',
    googleOAuth: true,
    aal: 'aal1',
    displayName: 'Persona Prueba',
    avatarUrl: null,
    ...over,
  };
}

/**
 * F04 contra PostgreSQL real: idempotencia bajo concurrencia, actualización parcial y unicidad por identidad.
 * Requiere DATABASE_URL_TEST (base desechable o proyecto de pruebas). Sin ella se omite.
 */
describe.skipIf(!url)('Perfil de cliente contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let identity: IdentityService;
  let profiles: CustomerProfileService;
  const createdAuthIds = new Set<string>();

  const authUser = async (id: string) => {
    createdAuthIds.add(id);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [id]),
    );
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url, NODE_ENV: 'test' })),
    );
    identity = new IdentityService(prisma, new AuditService());
    profiles = new CustomerProfileService(prisma, identity);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await cleanupTestData(url as string, { authUserIds: createdAuthIds, branchIds: [] });
  });

  it('crear el perfil en paralelo produce una sola fila por identidad', async () => {
    const p = principal();
    await authUser(p.authUserId);

    await Promise.all(Array.from({ length: 6 }, () => identity.ensureCustomer(p)));

    const count = await prisma.customer.count({ where: { authUserId: p.authUserId } });
    expect(count).toBe(1);
  });

  it('PATCH parcial conserva los campos omitidos', async () => {
    const p = principal({ displayName: 'Ana López' });
    await authUser(p.authUserId);

    await profiles.updateProfile(p, { phone: '5555-9999' });
    const view = await profiles.updateProfile(p, { fullName: 'Ana Pérez' });

    expect(view.customer.fullName).toBe('Ana Pérez');
    expect(view.customer.phone).toBe('+50255559999');
  });

  it('la identidad no puede duplicarse: segunda fila con el mismo auth_user_id falla', async () => {
    const p = principal();
    await authUser(p.authUserId);
    await identity.ensureCustomer(p);

    await expect(
      prisma.customer.create({ data: { authUserId: p.authUserId, fullName: 'Duplicada' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('el nombre de Google solo inicializa el perfil, no sobrescribe el guardado', async () => {
    const p = principal({ displayName: 'Nombre Google' });
    await authUser(p.authUserId);
    await profiles.updateProfile(p, { fullName: 'Nombre Elegido' });

    const view = await profiles.getProfile({ ...p, displayName: 'Otro Nombre' });

    expect(view.customer.fullName).toBe('Nombre Elegido');
  });
});
