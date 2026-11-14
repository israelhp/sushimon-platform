import { ROLE_PERMISSIONS } from './staff-context.js';
import type { AssignmentRecord, StaffRecord } from '../../src/staff/staff.types.js';

export const BRANCH_A = '11111111-1111-4111-8111-111111111111';
export const BRANCH_B = '22222222-2222-4222-8222-222222222222';
export const BRANCH_C = '33333333-3333-4333-8333-333333333333';

export const ROLE_IDS: Record<string, string> = {
  admin: 'aaaaaaaa-0000-4000-8000-000000000001',
  manager: 'aaaaaaaa-0000-4000-8000-000000000002',
  kitchen: 'aaaaaaaa-0000-4000-8000-000000000003',
  staff: 'aaaaaaaa-0000-4000-8000-000000000004',
};

export const roleRecord = (code: string) => ({
  id: ROLE_IDS[code] as string,
  code,
  name: code,
  permissions: [...(ROLE_PERMISSIONS[code] as string[])].sort(),
});

let seq = 0;
export const assignmentRecord = (
  code: string,
  branchId: string | null,
  over: { active?: boolean; branchActive?: boolean } = {},
): AssignmentRecord => ({
  id: `bbbbbbbb-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  active: over.active ?? true,
  role: roleRecord(code),
  branch: branchId
    ? {
        id: branchId,
        name: `Sucursal ${branchId[0]}`,
        code: `s-${branchId[0]}`,
        active: over.branchActive ?? true,
      }
    : null,
});

export const staffRecord = (
  id: string,
  assignments: AssignmentRecord[],
  over: Partial<StaffRecord> = {},
): StaffRecord => ({
  id,
  fullName: `Empleado ${id.slice(0, 4)}`,
  email: `${id.slice(0, 4)}@sushimon.test`,
  active: true,
  linked: true,
  linkedAt: new Date('2026-02-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  createdBy: null,
  assignments,
  ...over,
});
