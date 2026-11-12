import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service.js';
import { HealthController } from './health.controller.js';

function controllerWith(result: { ok: boolean; schemaApp: boolean }) {
  const prisma = { checkConnection: vi.fn().mockResolvedValue(result) };
  return new HealthController(prisma as unknown as PrismaService);
}

describe('HealthController', () => {
  it('liveness responde ok sin tocar la base de datos', () => {
    const prisma = { checkConnection: vi.fn() };
    const c = new HealthController(prisma as unknown as PrismaService);
    expect(c.getHealth()).toEqual({ status: 'ok' });
    expect(prisma.checkConnection).not.toHaveBeenCalled();
  });

  it('readiness ok cuando hay conexión y esquema app', async () => {
    await expect(controllerWith({ ok: true, schemaApp: true }).getReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', schemaApp: 'present' },
    });
  });

  it.each([
    { ok: false, schemaApp: false },
    { ok: true, schemaApp: false },
  ])('readiness 503 con %j', async (state) => {
    await expect(controllerWith(state).getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
