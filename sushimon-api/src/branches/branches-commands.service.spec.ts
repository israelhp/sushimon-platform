import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { BranchesCommandsService } from './branches-commands.service.js';
import type { BranchScopeService } from './branch-scope.service.js';
import type { BranchesRepository } from './branches.repository.js';
import type { AdminBranchView } from './branches.types.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const stored: AdminBranchView = {
  id: ID,
  code: 'zona-10',
  name: 'Zona 10',
  address: 'Av. 1',
  phone: null,
  latitude: null,
  longitude: null,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staff = (over: Partial<StaffContext> = {}): StaffContext => ({
  staffId: 'staff-1',
  fullName: 'Ana',
  assignments: [],
  permissions: ['branches'],
  allBranches: true,
  branchIds: [],
  ...over,
});

function setup(current: AdminBranchView | null = stored) {
  const tx = { auditEvent: { create: vi.fn().mockResolvedValue({}) } };
  const repo = {
    transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    insert: vi.fn((_tx: unknown, data: object) => Promise.resolve({ ...stored, ...data })),
    findAdminForUpdate: vi.fn().mockResolvedValue(current),
    update: vi.fn((_tx: unknown, _id: string, data: object) =>
      Promise.resolve({ ...current, ...data } as AdminBranchView),
    ),
  };
  // El alcance lo calcula BranchScopeService (probado aparte): aquí se deriva de la prueba.
  const scopes = {
    resolve: (s: StaffContext) =>
      Promise.resolve({ allBranches: s.allBranches, branchIds: s.branchIds }),
  };
  const service = new BranchesCommandsService(
    repo as unknown as BranchesRepository,
    new AuditService(),
    scopes as unknown as BranchScopeService,
  );
  return { service, repo, tx };
}
const audited = (tx: { auditEvent: { create: ReturnType<typeof vi.fn> } }) =>
  tx.auditEvent.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

describe('BranchesCommandsService.create', () => {
  const input = { code: ' Zona-11 ', name: 'Zona 11', address: 'Av. 2' };

  it('crea normalizando y audita branch.created en la misma transacción', async () => {
    const { service, repo, tx } = setup();
    const res = await service.create(staff(), input);
    expect(repo.insert).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ code: 'zona-11', active: true }),
    );
    expect(res.code).toBe('zona-11');
    const [event] = audited(tx);
    expect(event).toMatchObject({
      actorId: 'staff-1',
      entityType: 'branch',
      action: 'branch.created',
      newValues: expect.objectContaining({ code: 'zona-11' }) as unknown,
    });
  });

  it('sin alcance global → 403 y no escribe', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(staff({ allBranches: false, branchIds: [ID] }), input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('código duplicado (P2002) → 409', async () => {
    const { service, repo } = setup();
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(service.create(staff(), input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('otros errores de BD se propagan (500), no se enmascaran como 409', async () => {
    const { service, repo } = setup();
    repo.insert.mockRejectedValueOnce(new Error('boom'));
    await expect(service.create(staff(), input)).rejects.toThrow('boom');
  });

  it('código inválido → 400 sin tocar la BD', async () => {
    const { service, repo } = setup();
    await expect(service.create(staff(), { ...input, code: '   ' })).rejects.toThrow();
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});

describe('BranchesCommandsService.update', () => {
  it('actualiza y audita solo el diff real (old/new)', async () => {
    const { service, repo, tx } = setup();
    await service.update(staff(), ID, { name: ' Nuevo ', address: 'Av. 1' });
    expect(repo.update).toHaveBeenCalledWith(tx, ID, { name: 'Nuevo' });
    expect(audited(tx)).toEqual([
      expect.objectContaining({
        action: 'branch.updated',
        branchId: ID,
        oldValues: { name: 'Zona 10' },
        newValues: { name: 'Nuevo' },
      }),
    ]);
  });

  it('sin cambios reales: devuelve la actual, sin escribir ni auditar', async () => {
    const { service, repo, tx } = setup();
    await expect(service.update(staff(), ID, { name: 'Zona 10' })).resolves.toEqual(stored);
    expect(repo.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('PATCH con un solo campo de coordenadas sin par almacenado → 400', async () => {
    const { service, repo } = setup();
    await expect(service.update(staff(), ID, { latitude: 10 })).rejects.toMatchObject({
      response: { message: [expect.stringMatching(/juntas/)] },
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('borra teléfono y coordenadas con null', async () => {
    const { service, repo } = setup({ ...stored, phone: '22223333', latitude: 1, longitude: 2 });
    await service.update(staff(), ID, { phone: null, latitude: null, longitude: null });
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), ID, {
      phone: null,
      latitude: null,
      longitude: null,
    });
  });

  it('inexistente → 404; fuera de alcance → 404 sin consultar la BD', async () => {
    await expect(setup(null).service.update(staff(), ID, { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const { service, repo } = setup();
    await expect(
      service.update(staff({ allBranches: false, branchIds: [OTHER] }), ID, { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});

describe('BranchesCommandsService.changeStatus', () => {
  it('desactiva con motivo y audita branch.deactivated con reason', async () => {
    const { service, repo, tx } = setup();
    const res = await service.changeStatus(staff(), ID, { active: false, reason: 'Remodelación' });
    expect(res.active).toBe(false);
    expect(repo.update).toHaveBeenCalledWith(tx, ID, { active: false });
    expect(audited(tx)).toEqual([
      expect.objectContaining({
        action: 'branch.deactivated',
        reason: 'Remodelación',
        oldValues: { active: true },
        newValues: { active: false },
      }),
    ]);
  });

  it('activa (motivo opcional) y audita branch.activated', async () => {
    const { service, tx } = setup({ ...stored, active: false });
    await service.changeStatus(staff(), ID, { active: true });
    expect(audited(tx)[0]).toMatchObject({ action: 'branch.activated', reason: null });
  });

  it('desactivar sin motivo → 400 sin escribir', async () => {
    const { service, repo } = setup();
    await expect(service.changeStatus(staff(), ID, { active: false })).rejects.toMatchObject({
      response: { message: [expect.stringMatching(/reason/)] },
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('idempotente: mismo estado no escribe ni audita', async () => {
    const { service, repo, tx } = setup();
    await expect(service.changeStatus(staff(), ID, { active: true })).resolves.toEqual(stored);
    expect(repo.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('inexistente o fuera de alcance → 404', async () => {
    await expect(
      setup(null).service.changeStatus(staff(), ID, { active: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup().service.changeStatus(staff({ allBranches: false, branchIds: [OTHER] }), ID, {
        active: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('si la auditoría falla, el error se propaga (la transacción revierte el cambio)', async () => {
    const { service, tx } = setup();
    tx.auditEvent.create.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.changeStatus(staff(), ID, { active: false, reason: 'x' })).rejects.toThrow(
      'audit down',
    );
  });
});

describe('BranchesCommandsService · errores de BD y bloqueo', () => {
  const input = { code: 'zona-11', name: 'Zona 11', address: 'Av. 2' };

  it('un CHECK violado (23514) se traduce a 400 genérico, no 500', async () => {
    const { service, repo } = setup();
    repo.insert.mockRejectedValueOnce(Object.assign(new Error('check'), { code: 'P2004' }));
    await expect(service.create(staff(), input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('UNIQUE de otra restricción no se disfraza de 409', async () => {
    const { service, repo } = setup();
    const err = Object.assign(new Error('u'), { code: 'P2002', meta: { target: ['otra_col'] } });
    repo.insert.mockRejectedValueOnce(err);
    await expect(service.create(staff(), input)).rejects.toBe(err);
  });

  it('update/status leen la fila bloqueada dentro de la transacción y validan el par sobre ese valor', async () => {
    const { service, repo, tx } = setup({ ...stored, latitude: 1, longitude: 2 });
    await service.update(staff(), ID, { latitude: null }).catch(() => undefined);
    expect(repo.findAdminForUpdate).toHaveBeenCalledWith(tx, ID);
    expect(repo.update).not.toHaveBeenCalled(); // par incompleto sobre el valor bloqueado → 400
  });

  it('un CHECK en update también da 400', async () => {
    const { service, repo } = setup();
    repo.update.mockRejectedValueOnce(Object.assign(new Error('c'), { code: '23514' }));
    await expect(service.update(staff(), ID, { name: 'Otro' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
