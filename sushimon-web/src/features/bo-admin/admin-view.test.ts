import { describe, expect, it } from 'vitest';
import type { Branch, StaffUser } from '@/lib/data-access/models';
import {
  activeAdminCount,
  emptyUserForm,
  isValidEmail,
  matchesUserSearch,
  toUserInput,
  toggled,
  userBranchLabel,
  validateUserForm,
  withRole,
} from './users-view';

const branch = (id: string, status: Branch['status']): Branch =>
  ({ id, name: id, status, radiusKm: 5 }) as Branch;

describe('usuarios', () => {
  it('valida el correo como el servidor', () => {
    expect(isValidEmail('ana@sushimon.gt')).toBe(true);
    expect(isValidEmail('ana@sushimon')).toBe(false);
    expect(isValidEmail('ana sushimon.gt')).toBe(false);
  });

  it('valida el formulario y devuelve el primer campo con error', () => {
    const base = emptyUserForm('sucursal-1');
    expect(validateUserForm({ ...base, name: 'Ana', email: 'ana@sushimon.gt' })).toBeNull();
    expect(validateUserForm(base)).toEqual({ fields: ['name', 'email'], reason: 'contact' });
    expect(
      validateUserForm({ ...base, name: 'Ana', email: 'ana@sushimon.gt', branchId: 'all' }),
    ).toEqual({
      fields: ['branchId'],
      reason: 'branch',
    });
    expect(
      validateUserForm({ ...withRole(base, 'admin', 'sucursal-1'), name: 'Ana', email: 'a@b.gt' }),
    ).toBeNull();
  });

  it('el cambio de rol reinicia permisos y sucursal', () => {
    const base = emptyUserForm('sucursal-2');
    const admin = withRole(base, 'admin', 'sucursal-2');
    expect(admin.branchId).toBe('all');
    expect(admin.permissions).toContain('users');
    const kitchen = withRole(admin, 'kitchen', 'sucursal-2');
    expect(kitchen.branchId).toBe('sucursal-2');
    expect(kitchen.permissions).toEqual(['orders.accept', 'orders.status']);
    expect(toUserInput({ ...admin, name: ' Ana ', email: ' a@b.gt ' })).toMatchObject({
      name: 'Ana',
      email: 'a@b.gt',
      branchId: null,
    });
  });

  it('alterna permisos, busca y etiqueta sucursales', () => {
    expect(toggled(['reports'], 'users')).toEqual(['reports', 'users']);
    expect(toggled(['reports', 'users'], 'users')).toEqual(['reports']);
    expect(matchesUserSearch({ name: 'Ana Pérez', email: 'ana@x.gt' }, 'PEREZ'.toLowerCase())).toBe(
      false,
    );
    expect(matchesUserSearch({ name: 'Ana Pérez', email: 'ana@x.gt' }, 'pérez')).toBe(true);
    expect(matchesUserSearch({ name: 'Ana', email: 'ana@x.gt' }, 'X.GT')).toBe(true);
    expect(userBranchLabel({ branchId: null }, [])).toBe('Todas');
    expect(userBranchLabel({ branchId: 'b' }, [branch('b', 'active')])).toBe('b');
    const users = [
      { role: 'admin', active: true },
      { role: 'admin', active: false },
      { role: 'manager', active: true },
    ] as StaffUser[];
    expect(activeAdminCount(users)).toBe(1);
  });
});
