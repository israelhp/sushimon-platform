import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { writeDemoSession } from '@/lib/demo-session';
import { DataProvider } from '@/lib/data-access/provider';
import { demoStaffFromSeed } from '@/mocks/fixtures/staff';
import { createHarness } from '@/mocks/testing';
import { queryKeys } from '../query-keys';
import { DemoSessionProvider } from '../session/demo-session';
import {
  rolePermissionsInvalidationKeys,
  staffInvalidationKeys,
  useAdminContext,
  useAdminRoles,
  useAdminStaffList,
  useCreateStaff,
  useReplaceRolePermissions,
  useReplaceStaffAssignments,
  useSetStaffStatus,
  useUpdateStaff,
} from './hooks';

const SELF = 'u1';

beforeAll(() => {
  // Sesión de demostración del administrador (u1) antes de montar el proveedor.
  writeDemoSession({ customer: null, staff: demoStaffFromSeed(SELF) });
});

describe('claves jerárquicas', () => {
  it('lista y detalle de empleados cuelgan del mismo prefijo; roles igual', () => {
    expect(queryKeys.backoffice.staffList({ q: 'a' }).slice(0, 3)).toEqual([
      ...queryKeys.backoffice.staffLists,
    ]);
    expect(queryKeys.backoffice.staffDetail('x').slice(0, 2)).toEqual([
      ...queryKeys.backoffice.staff,
    ]);
    expect(queryKeys.backoffice.roleDetail('r').slice(0, 2)).toEqual([
      ...queryKeys.backoffice.roles,
    ]);
    expect(queryKeys.backoffice.roleLists.slice(0, 2)).toEqual([...queryKeys.backoffice.roles]);
    // Las sesiones se limpian por prefijo `backoffice`: todo cuelga de ahí.
    for (const key of [
      queryKeys.backoffice.adminContext,
      queryKeys.backoffice.permissions,
      queryKeys.backoffice.staff,
      queryKeys.backoffice.roles,
    ]) {
      expect(key[0]).toBe('backoffice');
    }
  });
});

describe('claves de invalidación', () => {
  it('crear: listas de empleados y de roles (conteo); sin detalle ni contexto', () => {
    expect(staffInvalidationKeys('create')).toEqual([
      queryKeys.backoffice.staffLists,
      queryKeys.backoffice.roleLists,
    ]);
  });

  it('editar: listas + detalle; contexto solo si es el propio empleado; sin roles', () => {
    expect(staffInvalidationKeys('update', 'u3', SELF)).toEqual([
      queryKeys.backoffice.staffLists,
      queryKeys.backoffice.staffDetail('u3'),
    ]);
    expect(staffInvalidationKeys('update', SELF, SELF)).toEqual([
      queryKeys.backoffice.staffLists,
      queryKeys.backoffice.staffDetail(SELF),
      queryKeys.backoffice.adminContext,
    ]);
  });

  it('estado y asignaciones: listas + detalle + roles; contexto si afecta al propio usuario', () => {
    for (const kind of ['status', 'assignments'] as const) {
      expect(staffInvalidationKeys(kind, 'u3', SELF)).toEqual([
        queryKeys.backoffice.staffLists,
        queryKeys.backoffice.staffDetail('u3'),
        queryKeys.backoffice.roleLists,
      ]);
      expect(staffInvalidationKeys(kind, SELF, SELF)).toContainEqual(
        queryKeys.backoffice.adminContext,
      );
      expect(staffInvalidationKeys(kind, 'u3', null)).not.toContainEqual(
        queryKeys.backoffice.adminContext,
      );
    }
  });

  it('permisos de rol: roles (lista y detalle), empleados y contexto', () => {
    expect(rolePermissionsInvalidationKeys('r1')).toEqual([
      queryKeys.backoffice.roleLists,
      queryKeys.backoffice.roleDetail('r1'),
      queryKeys.backoffice.staff,
      queryKeys.backoffice.adminContext,
    ]);
  });
});

function setup() {
  const h = createHarness();
  h.asStaff('admin');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataProvider client={h.client} queryClient={queryClient}>
      <DemoSessionProvider>{children}</DemoSessionProvider>
    </DataProvider>
  );
  return { h, spy, wrapper, queryClient };
}

const invalidated = (spy: ReturnType<typeof setup>['spy']) =>
  spy.mock.calls.map(([filters]) => filters?.queryKey);

const KITCHEN = 'role-kitchen';

describe('consultas', () => {
  it('lista de empleados, roles y contexto administrativo con la sesión de personal', async () => {
    const { wrapper } = setup();
    const list = renderHook(() => useAdminStaffList({ pageSize: 5 }), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data?.items).toHaveLength(5);
    const roles = renderHook(() => useAdminRoles(), { wrapper });
    await waitFor(() => expect(roles.result.current.isSuccess).toBe(true));
    expect(roles.result.current.data?.map((r) => r.code)).toContain('staff');
    const ctx = renderHook(() => useAdminContext(), { wrapper });
    await waitFor(() => expect(ctx.result.current.isSuccess).toBe(true));
    expect(ctx.result.current.data?.staff.grants['staff.read']?.allBranches).toBe(true);
  });
});

describe('mutaciones', () => {
  it('crear invalida listas de empleados y de roles', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useCreateStaff(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({
        fullName: 'Nuevo Empleado',
        email: 'nuevo@sushimon.gt',
        assignments: [{ roleId: KITCHEN, branchId: 'sucursal-1' }],
      }),
    );
    expect(invalidated(spy)).toEqual(staffInvalidationKeys('create'));
  });

  it('editar a otra persona no toca el contexto; editarse a sí mismo sí', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useUpdateStaff(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({ id: 'u3', input: { fullName: 'Karla R.' } }),
    );
    expect(invalidated(spy)).toEqual(staffInvalidationKeys('update', 'u3', SELF));
    spy.mockClear();
    await act(async () =>
      result.current.mutateAsync({ id: SELF, input: { fullName: 'Ana L. Pérez' } }),
    );
    expect(invalidated(spy)).toContainEqual(queryKeys.backoffice.adminContext);
  });

  it('cambiar estado invalida listas, detalle y roles', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useSetStaffStatus(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({ id: 'u3', input: { active: false, reason: 'Prueba' } }),
    );
    expect(invalidated(spy)).toEqual(staffInvalidationKeys('status', 'u3', SELF));
  });

  it('reemplazar asignaciones invalida listas, detalle y roles', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useReplaceStaffAssignments(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({
        id: 'u5',
        input: { assignments: [{ roleId: KITCHEN, branchId: 'sucursal-2' }] },
      }),
    );
    expect(invalidated(spy)).toEqual(staffInvalidationKeys('assignments', 'u5', SELF));
  });

  it('permisos de un rol: invalida roles, empleados y contexto', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useReplaceRolePermissions(), { wrapper });
    await act(async () =>
      result.current.mutateAsync({ id: KITCHEN, input: { permissions: ['orders.read'] } }),
    );
    expect(invalidated(spy)).toEqual(rolePermissionsInvalidationKeys(KITCHEN));
  });

  it('un error (409 correo duplicado) no invalida nada', async () => {
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useCreateStaff(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({
          fullName: 'Dup',
          email: 'ana.perez@sushimon.gt',
          assignments: [{ roleId: KITCHEN, branchId: 'sucursal-1' }],
        })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });
});
