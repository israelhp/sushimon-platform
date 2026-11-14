import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@/services/auth';
import { staffFromContext } from './staff-session-bridge';

const BRANCH = '11111111-1111-4111-8111-111111111111';
const base: AuthContext = {
  authUserId: '00000000-0000-4000-8000-000000000001',
  email: 'ana@sushimon.test',
  provider: 'google',
  isCustomer: false,
  aal: 'aal2',
  staffAuthorized: true,
  mfaRequired: false,
  access: 'GRANTED',
  backofficeAccess: true,
  staff: {
    staffId: '00000000-0000-4000-8000-000000000002',
    fullName: 'Ana',
    assignments: [{ role: 'kitchen', branchId: BRANCH }],
    permissions: ['orders.read', 'orders.prepare'],
    allBranches: false,
    branchIds: [BRANCH],
    grants: {
      'orders.read': { allBranches: false, branchIds: [BRANCH] },
      'orders.prepare': { allBranches: false, branchIds: [BRANCH] },
    },
    branches: [{ id: BRANCH, name: 'Zona 4', code: 'zona-4' }],
  },
};

describe('staffFromContext', () => {
  it('toma el rol de mayor jerarquía y los grants y sucursales del servidor', () => {
    const ctx: AuthContext = {
      ...base,
      staff: {
        ...base.staff!,
        assignments: [
          { role: 'kitchen', branchId: BRANCH },
          { role: 'manager', branchId: BRANCH },
        ],
      },
    };
    expect(staffFromContext(ctx)).toMatchObject({
      role: 'manager',
      name: 'Ana',
      grants: base.staff!.grants,
      branches: [{ id: BRANCH }],
    });
  });

  it('administrador global: grants con allBranches', () => {
    const ctx: AuthContext = {
      ...base,
      staff: {
        ...base.staff!,
        assignments: [{ role: 'admin', branchId: null }],
        allBranches: true,
        branchIds: [],
        grants: { 'staff.read': { allBranches: true, branchIds: [] } },
      },
    };
    expect(staffFromContext(ctx)).toMatchObject({
      role: 'admin',
      grants: { 'staff.read': { allBranches: true } },
    });
  });

  it('sin acceso al backoffice no hay personal (denegar por defecto)', () => {
    expect(staffFromContext({ ...base, backofficeAccess: false, staff: null })).toBeNull();
    expect(staffFromContext({ ...base, backofficeAccess: false })).toBeNull();
  });

  it('personal en aal1 (MFA_REQUIRED) no se adopta aunque llegara un contexto de personal', () => {
    expect(
      staffFromContext({ ...base, aal: 'aal1', mfaRequired: true, access: 'MFA_REQUIRED' }),
    ).toBeNull();
    expect(staffFromContext({ ...base, access: 'NOT_STAFF' })).toBeNull();
  });
});
