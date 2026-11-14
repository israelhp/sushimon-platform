import { ALL_PERMISSIONS, globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import {
  assignmentRecord,
  BRANCH_A,
  BRANCH_B,
  roleRecord,
  staffRecord,
} from '../../test/support/staff-fixtures.js';
import { staffHarness } from '../../test/support/staff-service-harness.js';

const ME = '99999999-9999-4999-8999-999999999999';
const T = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manager = (...branches: string[]) =>
  scopedStaff(roleRecord('manager').permissions, branches, { staffId: ME });

function seeded() {
  const h = staffHarness();
  h.repo.seed(
    staffRecord(T(1), [assignmentRecord('kitchen', BRANCH_A)], {
      fullName: 'Ana',
      email: 'ana@sushimon.test',
    }),
    staffRecord(T(2), [assignmentRecord('kitchen', BRANCH_B)], {
      fullName: 'Beto',
      email: 'beto@sushimon.test',
    }),
    staffRecord(
      T(3),
      [assignmentRecord('kitchen', BRANCH_A), assignmentRecord('kitchen', BRANCH_B)],
      { fullName: 'Carla', email: 'carla@sushimon.test', linked: false, linkedAt: null },
    ),
    staffRecord(T(4), [assignmentRecord('admin', null)], {
      fullName: 'Dora',
      email: 'dora@sushimon.test',
      active: false,
    }),
  );
  return h;
}

describe('StaffQueriesService', () => {
  it('el encargado de A solo ve a quien tiene alguna asignación en A (no ve admins ni la sucursal B)', async () => {
    const { queries } = seeded();
    const page = await queries.list(manager(BRANCH_A), {});
    expect(page.items.map((i) => i.fullName)).toEqual(['Ana', 'Carla']);
    expect(page.total).toBe(2);
  });

  it('manageable por fila: Ana sí; Carla (también en B) no', async () => {
    const { queries } = seeded();
    const { items } = await queries.list(manager(BRANCH_A), {});
    expect(items.map((i) => [i.fullName, i.manageable])).toEqual([
      ['Ana', true],
      ['Carla', false],
    ]);
  });

  it('el administrador global ve a todos, incluidos los inactivos y sin asignaciones visibles', async () => {
    const { queries } = seeded();
    const page = await queries.list(globalStaff(ALL_PERMISSIONS, { staffId: ME }), {});
    expect(page.total).toBe(4);
  });

  it('filtros: q, active, identityStatus, roleId, branchId, orden y paginación', async () => {
    const { queries } = seeded();
    const admin = globalStaff(ALL_PERMISSIONS, { staffId: ME });
    expect((await queries.list(admin, { q: 'BETO' })).items.map((i) => i.fullName)).toEqual([
      'Beto',
    ]);
    expect((await queries.list(admin, { active: false })).items.map((i) => i.fullName)).toEqual([
      'Dora',
    ]);
    expect(
      (await queries.list(admin, { identityStatus: 'PENDING_LINK' })).items.map((i) => i.fullName),
    ).toEqual(['Carla']);
    expect(
      (await queries.list(admin, { branchId: BRANCH_B })).items.map((i) => i.fullName),
    ).toEqual(['Beto', 'Carla']);
    expect(
      (await queries.list(admin, { roleId: roleRecord('admin').id })).items.map((i) => i.fullName),
    ).toEqual(['Dora']);
    const desc = await queries.list(admin, { sort: 'email', order: 'desc', pageSize: 2, page: 2 });
    expect(desc).toMatchObject({ page: 2, pageSize: 2, total: 4 });
    expect(desc.items.map((i) => i.fullName)).toEqual(['Beto', 'Ana']);
  });

  it('sin alcance de lectura: lista vacía sin consultar', async () => {
    const { queries, repo } = seeded();
    const spy = vi.spyOn(repo, 'listStaff');
    const none = scopedStaff(['staff.read'], []);
    await expect(queries.list(none, {})).resolves.toMatchObject({ items: [], total: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('detalle: dentro del alcance → vista sin authUserId; fuera de alcance o inexistente → 404 idéntico', async () => {
    const { queries } = seeded();
    const view = await queries.get(manager(BRANCH_A), T(1));
    expect(view).toMatchObject({ fullName: 'Ana', identityStatus: 'LINKED' });
    expect(Object.keys(view)).not.toContain('authUserId');
    const out = await queries
      .get(manager(BRANCH_A), T(2))
      .catch((e: { status: number; message: string }) => e);
    const missing = await queries
      .get(manager(BRANCH_A), T(99))
      .catch((e: { status: number; message: string }) => e);
    expect(out).toMatchObject({ status: 404 });
    expect((out as { message: string }).message).toBe((missing as { message: string }).message);
  });

  it('un administrador no es visible para un encargado (alcance global ≠ su sucursal)', async () => {
    const { queries } = seeded();
    await expect(queries.get(manager(BRANCH_A), T(4))).rejects.toMatchObject({ status: 404 });
  });
});
