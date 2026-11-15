import { Logger } from '@nestjs/common';
import { AuthAdminProviderError } from '../auth-admin/auth-admin.port.js';
import { ALL_PERMISSIONS, globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import {
  assignmentRecord,
  BRANCH_A,
  BRANCH_B,
  roleRecord,
  staffRecord,
} from '../../test/support/staff-fixtures.js';
import { actions, staffHarness } from '../../test/support/staff-service-harness.js';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const T1 = 'cccccccc-0000-4000-8000-000000000001'; // cocina en A (vinculado)
const T2 = 'cccccccc-0000-4000-8000-000000000002'; // cocina en B
const T_PENDING = 'cccccccc-0000-4000-8000-000000000003'; // sin vincular
const F1 = 'f0000000-0000-4000-8000-000000000001';
const F2 = 'f0000000-0000-4000-8000-000000000002';

const adminActor = () => globalStaff(ALL_PERMISSIONS, { staffId: ADMIN_ID });
const managerActor = () =>
  scopedStaff(roleRecord('manager').permissions, [BRANCH_A], { staffId: ADMIN_ID });

function setup() {
  const h = staffHarness();
  h.repo.seed(
    staffRecord(ADMIN_ID, [assignmentRecord('admin', null)]),
    staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)]),
    staffRecord(T2, [assignmentRecord('kitchen', BRANCH_B)]),
    staffRecord(T_PENDING, [assignmentRecord('kitchen', BRANCH_A)], {
      linked: false,
      linkedAt: null,
    }),
  );
  return h;
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('StaffMfaResetService.reset', () => {
  it('elimina todos los factores del auth_user del objetivo y audita staff.mfa_reset sin PII', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    const authUserId = repo.authUserIdOf(T1) as string;
    authAdmin.seed(authUserId, F1, F2);
    await expect(mfaReset.reset(adminActor(), T1)).resolves.toBeUndefined();
    expect(authAdmin.factors.get(authUserId)).toEqual([]);
    expect(actions(repo)).toEqual(['staff.mfa_reset']);
    expect(repo.audit[0]).toMatchObject({
      actorId: ADMIN_ID,
      entityType: 'staff_user',
      entityId: T1,
      newValues: { factorsRemoved: 2 },
    });
    const dump = JSON.stringify(repo.audit);
    expect(dump).not.toContain(authUserId);
    expect(dump).not.toContain('@');
  });

  it('idempotente: sin factores => éxito, 0 eliminados, audita igualmente', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    await mfaReset.reset(adminActor(), T1);
    expect(authAdmin.calls.filter((c) => c.startsWith('delete'))).toEqual([]);
    expect(repo.audit[0]).toMatchObject({
      action: 'staff.mfa_reset',
      newValues: { factorsRemoved: 0 },
    });
  });

  it('no usa el id del empleado como id de Auth (usa auth_user_id)', async () => {
    const { mfaReset, authAdmin } = setup();
    await mfaReset.reset(adminActor(), T1);
    expect(authAdmin.calls[0]).toMatch(/^list:aaaaaaaa-1111-4111-8111-/);
    expect(authAdmin.calls[0]).not.toContain(T1);
  });

  it('un encargado de sucursal (alcance no global) => 403 genérico, auditado, sin tocar el proveedor', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    await expect(mfaReset.reset(managerActor(), T1)).rejects.toMatchObject({
      status: 403,
      message: 'Acceso denegado',
    });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toMatchObject([
      { action: 'staff.denied_escalation', reason: 'mfa_reset_requires_global_scope' },
    ]);
  });

  it('a uno mismo => 403 genérico, auditado, sin tocar el proveedor', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    await expect(mfaReset.reset(adminActor(), ADMIN_ID)).rejects.toMatchObject({ status: 403 });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toMatchObject([
      { action: 'staff.denied_escalation', reason: 'self_modification' },
    ]);
  });

  it('actor revocado tras el guard HTTP => 403 sin llamar al proveedor', async () => {
    const { mfaReset, repo, authAdmin, revoked } = setup();
    revoked.add(ADMIN_ID);
    await expect(mfaReset.reset(adminActor(), T1)).rejects.toMatchObject({ status: 403 });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit[0]).toMatchObject({ reason: 'actor_no_longer_authorized' });
  });

  it('objetivo inexistente => 404 STAFF_NOT_FOUND', async () => {
    const { mfaReset, authAdmin } = setup();
    await expect(
      mfaReset.reset(adminActor(), 'cccccccc-0000-4000-8000-0000000000ff'),
    ).rejects.toMatchObject({ status: 404, response: { code: 'STAFF_NOT_FOUND' } });
    expect(authAdmin.calls).toEqual([]);
  });

  it('objetivo sin vincular => 409 STAFF_NOT_LINKED sin llamar al proveedor ni auditar', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    await expect(mfaReset.reset(adminActor(), T_PENDING)).rejects.toMatchObject({
      status: 409,
      response: { code: 'STAFF_NOT_LINKED' },
    });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toEqual([]);
  });

  it('sin clave de servicio (puerto no disponible) => 503 MFA_RESET_UNAVAILABLE y staff.mfa_reset_failed', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    authAdmin.unavailable = true;
    await expect(mfaReset.reset(adminActor(), T1)).rejects.toMatchObject({
      status: 503,
      response: { code: 'MFA_RESET_UNAVAILABLE' },
    });
    expect(repo.audit).toMatchObject([
      {
        action: 'staff.mfa_reset_failed',
        reason: 'unavailable',
        newValues: { factorsRemoved: 0 },
      },
    ]);
  });

  it('fallo del proveedor al listar => 502 MFA_RESET_FAILED, mensaje fijo y auditoría sin detalle', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    authAdmin.failList = new AuthAdminProviderError('http_status', 500);
    const error = await mfaReset.reset(adminActor(), T1).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, response: { code: 'MFA_RESET_FAILED' } });
    expect(JSON.stringify((error as { response: unknown }).response)).not.toContain('500');
    expect(repo.audit).toMatchObject([
      {
        action: 'staff.mfa_reset_failed',
        reason: 'http_status_500',
        newValues: { factorsRemoved: 0 },
      },
    ]);
  });

  it('fallo a mitad del borrado: cuenta los ya eliminados y un reintento termina (idempotente)', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    const authUserId = repo.authUserIdOf(T1) as string;
    authAdmin.seed(authUserId, F1, F2);
    authAdmin.failDelete = { error: new AuthAdminProviderError('timeout'), afterDeletes: 1 };
    await expect(mfaReset.reset(adminActor(), T1)).rejects.toMatchObject({ status: 502 });
    expect(repo.audit).toMatchObject([
      { action: 'staff.mfa_reset_failed', reason: 'timeout', newValues: { factorsRemoved: 1 } },
    ]);
    authAdmin.failDelete = undefined;
    await mfaReset.reset(adminActor(), T1);
    expect(authAdmin.factors.get(authUserId)).toEqual([]);
    expect(actions(repo)).toEqual(['staff.mfa_reset_failed', 'staff.mfa_reset']);
  });

  it('un error inesperado del proveedor también responde 502 y se audita como unexpected', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    authAdmin.listMfaFactors = () => Promise.reject(new Error('secret=abc123'));
    const error = await mfaReset.reset(adminActor(), T1).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502 });
    expect(JSON.stringify(repo.audit)).not.toContain('abc123');
    expect(repo.audit[0]).toMatchObject({ reason: 'unexpected' });
  });

  it('si la auditoría del fallo no se puede escribir, el cliente igual recibe el error del proveedor', async () => {
    const { mfaReset, repo, authAdmin } = setup();
    authAdmin.failList = new AuthAdminProviderError('network');
    repo.failNext.set('audit', new Error('db caída'));
    await expect(mfaReset.reset(adminActor(), T1)).rejects.toMatchObject({ status: 502 });
  });
});
