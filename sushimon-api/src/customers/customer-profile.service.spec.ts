import { BadRequestException } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import type { CustomerRecord } from '../identity/identity.service.js';
import { CustomerProfileService } from './customer-profile.service.js';

const AUTH_ID = '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11';
const ME: Principal = {
  authUserId: AUTH_ID,
  email: 'ana@sushimon.test',
  provider: 'google',
  googleOAuth: true,
  aal: 'aal1',
  displayName: 'Ana López',
  avatarUrl: 'https://lh3.googleusercontent.com/a/x=s96',
};

const row = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({
  id: 'c1',
  fullName: 'Ana López',
  email: 'ana@sushimon.test',
  phone: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  ...over,
});

function setup() {
  const update = vi.fn();
  const prisma = { customer: { update } };
  const identity = {
    ensureCustomer: vi.fn(() => Promise.resolve(row())),
    getStaffContext: vi.fn(() => Promise.resolve(null)),
  };
  const service = new CustomerProfileService(prisma as never, identity as never);
  return { service, update, identity };
}

const p2025 = () => Object.assign(new Error('not found'), { code: 'P2025' });

describe('CustomerProfileService.updateProfile', () => {
  it('actualiza solo los campos recibidos (no borra el nombre al enviar solo el teléfono)', async () => {
    const { service, update } = setup();
    update.mockResolvedValue(row({ phone: '+50255559999' }));

    await service.updateProfile(ME, { phone: '5555-9999' });

    expect(update).toHaveBeenCalledWith({
      where: { authUserId: AUTH_ID },
      data: { phone: '+50255559999' },
    });
  });

  it('normaliza el nombre antes de persistir y permite borrar el teléfono', async () => {
    const { service, update } = setup();
    update.mockResolvedValue(row());

    await service.updateProfile(ME, { fullName: '  Ana   López ', phone: null });

    expect(update).toHaveBeenCalledWith({
      where: { authUserId: AUTH_ID },
      data: { fullName: 'Ana López', phone: null },
    });
  });

  it('un PATCH sin campos no escribe en la base de datos', async () => {
    const { service, update, identity } = setup();

    const view = await service.updateProfile(ME, {});

    expect(update).not.toHaveBeenCalled();
    expect(identity.ensureCustomer).toHaveBeenCalledWith(ME);
    expect(view.authUserId).toBe(AUTH_ID);
  });

  it('rechaza datos inválidos con 400 y sin escribir', async () => {
    const { service, update } = setup();

    await expect(service.updateProfile(ME, { fullName: 'A' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('si el perfil no existe lo crea (idempotente) y aplica el cambio', async () => {
    const { service, update, identity } = setup();
    update.mockRejectedValueOnce(p2025()).mockResolvedValueOnce(row({ fullName: 'Ana Pérez' }));

    const view = await service.updateProfile(ME, { fullName: 'Ana Pérez' });

    expect(identity.ensureCustomer).toHaveBeenCalledWith(ME);
    expect(update).toHaveBeenCalledTimes(2);
    expect(view.customer.fullName).toBe('Ana Pérez');
  });

  it('propaga errores de base de datos distintos de "no existe" sin ocultarlos', async () => {
    const { service, update } = setup();
    update.mockRejectedValue(new Error('db caída'));

    await expect(service.updateProfile(ME, { phone: null })).rejects.toThrow('db caída');
  });

  it('la identidad y el correo vienen del principal, no del cuerpo', async () => {
    const { service, update } = setup();
    update.mockResolvedValue(row());

    const view = await service.updateProfile(ME, { fullName: 'Ana López' });

    expect(update.mock.calls[0]?.[0]).toMatchObject({ where: { authUserId: AUTH_ID } });
    expect(view.email).toBe('ana@sushimon.test');
    expect(view.authUserId).toBe(AUTH_ID);
  });
});

describe('CustomerProfileService.getStorefront', () => {
  it('devuelve secciones pendientes sin contadores y solo avatares válidos', async () => {
    const { service } = setup();

    const ctx = await service.getStorefront(ME);

    expect(ctx.pendingSections).toEqual(['favorites', 'orders']);
    expect(ctx.avatarUrl).toBe('https://lh3.googleusercontent.com/a/x=s96');
    expect(ctx.customer).toEqual({
      id: 'c1',
      fullName: 'Ana López',
      email: 'ana@sushimon.test',
      phone: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    expect(ctx.isStaff).toBe(false);
  });

  it('descarta un avatar que no es de Google', async () => {
    const { service } = setup();

    const ctx = await service.getStorefront({ ...ME, avatarUrl: 'https://evil.example/x.png' });

    expect(ctx.avatarUrl).toBeNull();
  });
});
