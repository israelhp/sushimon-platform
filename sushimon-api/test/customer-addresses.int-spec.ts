import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../src/auth/auth.types.js';
import { AuditService } from '../src/audit/audit.service.js';
import { CustomerAddressesService } from '../src/customers/addresses/customer-addresses.service.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
 * F05 contra PostgreSQL real: índice único parcial de predeterminada, concurrencia por cliente, propiedad (IDOR) y
 * CHECKs de dominio. Requiere DATABASE_URL_TEST (base desechable o proyecto de pruebas). Sin ella se omite.
 * Nota: no se ejecuta en CI sin esa variable; ejecutar localmente con una base de pruebas antes de declarar F05 verificada.
 */
describe.skipIf(!url)('Direcciones de cliente contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let identity: IdentityService;
  let addresses: CustomerAddressesService;
  let municipalityId: string;
  const createdAuthIds = new Set<string>();

  const newCustomer = async (): Promise<Principal> => {
    const p = principal();
    createdAuthIds.add(p.authUserId);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [p.authUserId]),
    );
    return p;
  };

  const input = (over: Record<string, unknown> = {}) => ({
    label: 'Casa',
    municipalityId,
    addressLine: `Calle ${randomUUID().slice(0, 8)}`,
    zone: 'Zona 10',
    referenceNote: null,
    ...over,
  });

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url, NODE_ENV: 'test' })),
    );
    identity = new IdentityService(prisma, new AuditService());
    addresses = new CustomerAddressesService(prisma, identity, new AuditService());
    // El seed de F09 (migración 0007) carga municipios; si no hay ninguno, la base de pruebas no está lista.
    const m = await prisma.municipality.findFirst({ select: { id: true } });
    if (!m) throw new Error('La base de pruebas no tiene municipios (seed de F09)');
    municipalityId = m.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await cleanupTestData(url as string, { authUserIds: createdAuthIds, branchIds: [] });
  });

  it('la base impide dos predeterminadas para el mismo cliente (índice único parcial)', async () => {
    const p = await newCustomer();
    const cust = await identity.ensureCustomer(p);
    await prisma.customerAddress.create({
      data: {
        customerId: cust.id,
        municipalityId,
        label: 'A',
        addressLine: 'Uno',
        isDefault: true,
      },
    });
    await expect(
      prisma.customerAddress.create({
        data: {
          customerId: cust.id,
          municipalityId,
          label: 'B',
          addressLine: 'Dos',
          isDefault: true,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('solicitudes concurrentes de predeterminada dejan exactamente una', async () => {
    const p = await newCustomer();
    const made = await Promise.all(
      Array.from({ length: 4 }, () => addresses.create(p, input({ isDefault: true }))),
    );
    const ids = made.map((m) => m.id);
    await Promise.all(ids.map((id) => addresses.setDefault(p, id)));

    const { items } = await addresses.list(p);
    expect(items.filter((i) => i.isDefault)).toHaveLength(1);
  });

  it('creaciones concurrentes nunca superan el límite de 10 (invariante bajo saturación del pool)', async () => {
    // Pool por defecto de 3 conexiones: 14 peticiones simultáneas lo saturan. Algunas esperan y otras agotan
    // el tiempo de conexión (error transitorio, no de datos). Lo que debe cumplirse siempre: nunca más de 10,
    // cada rechazo es ADDRESS_LIMIT_REACHED o un fallo de conexión/transacción, y lo guardado coincide con lo
    // confirmado (ninguna escritura parcial ni fantasma).
    const p = await newCustomer();
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_, i) => addresses.create(p, input({ addressLine: `Dir ${i}` }))),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejections = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => {
        const e = r.reason as { response?: { code?: string }; message?: string };
        return e.response?.code ?? e.message ?? String(r.reason);
      });
    for (const reason of rejections) {
      expect(
        reason === 'ADDRESS_LIMIT_REACHED' || /timeout|transaction|connect/i.test(reason),
      ).toBe(true);
    }
    const { items } = await addresses.list(p);
    expect(items.length).toBeLessThanOrEqual(10);
    expect(items).toHaveLength(fulfilled);
    expect(fulfilled + rejections.length).toBe(14);
  });

  it('un cliente no puede leer, editar ni borrar la dirección de otro (IDOR)', async () => {
    const owner = await newCustomer();
    const intruder = await newCustomer();
    const dir = await addresses.create(owner, input());
    await expect(addresses.get(intruder, dir.id)).rejects.toMatchObject({ status: 404 });
    await expect(addresses.update(intruder, dir.id, { label: 'X' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(addresses.remove(intruder, dir.id)).rejects.toMatchObject({ status: 404 });
    const still = await addresses.get(owner, dir.id);
    expect(still.label).toBe('Casa');
  });

  it('CHECK de la base: etiqueta vacía y coordenadas incompletas se rechazan aunque se salte el servicio', async () => {
    const p = await newCustomer();
    const cust = await identity.ensureCustomer(p);
    await expect(
      prisma.customerAddress.create({
        data: { customerId: cust.id, municipalityId, label: '   ', addressLine: 'X' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.customerAddress.create({
        data: { customerId: cust.id, municipalityId, label: 'Y', addressLine: 'Z', latitude: 14.6 },
      }),
    ).rejects.toThrow();
  });

  it('borrar la predeterminada reasigna exactamente una predeterminada', async () => {
    const p = await newCustomer();
    const first = await addresses.create(p, input());
    await addresses.create(p, input());
    await addresses.remove(p, first.id);
    const { items } = await addresses.list(p);
    expect(items).toHaveLength(1);
    expect(items[0]!.isDefault).toBe(true);
  });
});
