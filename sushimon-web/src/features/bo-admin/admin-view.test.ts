import { describe, expect, it } from 'vitest';
import type { Branch, StaffUser } from '@/lib/data-access/models';
import {
  BRANCH_CAP,
  branchCapacity,
  branchStats,
  radiusLabel,
  validateBranchForm,
} from './branches-view';
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

describe('tope de 5 sucursales', () => {
  it('con 3 activas ofrece 2 espacios con las sucursales "próximamente"', () => {
    const all = [
      branch('1', 'active'),
      branch('2', 'active'),
      branch('3', 'active'),
      branch('4', 'coming_soon'),
      branch('5', 'coming_soon'),
    ];
    const cap = branchCapacity(all);
    expect(BRANCH_CAP).toBe(5);
    expect(cap).toMatchObject({ count: 3, cap: 5, full: false, unassignedSlots: 0 });
    expect(cap.slots.map((b) => b.id)).toEqual(['4', '5']);
  });

  it('con 5 activas queda lleno y sin espacios', () => {
    const all = ['1', '2', '3', '4', '5'].map((id) => branch(id, 'active'));
    expect(branchCapacity(all)).toMatchObject({
      count: 5,
      full: true,
      slots: [],
      unassignedSlots: 0,
    });
  });

  it('si faltan registros por activar, el espacio libre queda sin asignar (sin endpoint de alta)', () => {
    const cap = branchCapacity([branch('1', 'active'), branch('2', 'coming_soon')]);
    expect(cap.slots).toHaveLength(1);
    expect(cap.unassignedSlots).toBe(3);
  });

  it('radio y estadísticas', () => {
    expect(radiusLabel({ radiusKm: 4 })).toBe('Radio 4 km');
    expect(radiusLabel({ radiusKm: 0 })).toBe('—');
    expect(branchStats('1', [{ branchId: '1', orders: 3, sales: 90 }], undefined)).toEqual({
      orders: 3,
      sales: 90,
      active: 0,
    });
  });

  it('valida el formulario de sucursal', () => {
    const ok = {
      name: 'A',
      zoneLabel: '',
      address: 'Calle',
      phone: '',
      hoursLabel: '',
      radiusKm: '4',
    };
    expect(validateBranchForm(ok)).toEqual({});
    expect(
      Object.keys(validateBranchForm({ ...ok, name: ' ', address: '', radiusKm: '' })),
    ).toEqual(['name', 'address', 'radiusKm']);
    expect(validateBranchForm({ ...ok, radiusKm: '-1' }).radiusKm).toBeTruthy();
  });
});

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
