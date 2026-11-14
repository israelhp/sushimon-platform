import { AuditService, type AuditWriter } from './audit.service.js';

describe('AuditService', () => {
  it('escribe el evento con el diff recibido usando el cliente de la transacción', async () => {
    const create = vi.fn().mockResolvedValue({});
    await new AuditService().record({ auditEvent: { create } } as unknown as AuditWriter, {
      actorId: 'a',
      branchId: 'b',
      entityType: 'branch',
      entityId: 'e',
      action: 'branch.updated',
      oldValues: { name: 'A' },
      newValues: { name: 'B' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'a',
        branchId: 'b',
        entityType: 'branch',
        entityId: 'e',
        action: 'branch.updated',
        reason: null,
        oldValues: { name: 'A' },
        newValues: { name: 'B' },
      },
    });
  });

  it('omite old/new ausentes y deja actor nulo = sistema', async () => {
    const create = vi.fn().mockResolvedValue({});
    await new AuditService().record({ auditEvent: { create } } as unknown as AuditWriter, {
      actorId: null,
      entityType: 'branch',
      entityId: 'e',
      action: 'branch.created',
    });
    const { data } = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('oldValues');
    expect(data).toMatchObject({ actorId: null, branchId: null, reason: null });
  });
});
