import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from './staff-context.js';
import { ROLE_IDS } from './staff-fixtures.js';
import type {
  AssignmentInput,
  AssignmentRecord,
  RoleRecord,
  StaffRecord,
  StaffTx,
} from '../../src/staff/staff.types.js';
import type { StaffListFilter } from '../../src/staff/staff.repository.js';

export interface FakeBranch {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export interface AuditRow {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  reason: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

const dbError = (code: string, meta?: unknown) =>
  Object.assign(new Error(`db:${code}`), { code, ...(meta ? { meta } : {}) });

/**
 * Doble en memoria de `StaffRepository` para pruebas de servicio y e2e. Reproduce lo observable de la BD que
 * importa a las reglas: UNIQUE de correo, trigger «admin⇔global», atomicidad (rollback de datos Y de
 * auditoría si la transacción falla) y el orden de los candados. NO prueba SQL: eso lo hace la integración.
 */
export class FakeStaffRepo {
  staff = new Map<string, StaffRecord>();
  branches = new Map<string, FakeBranch>();
  roles = new Map<
    string,
    { id: string; code: string; name: string; isSystem: boolean; permissions: Set<string> }
  >();
  permissions = ALL_PERMISSIONS.map((code, i) => ({
    id: `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`,
    code,
    description: `Descripción de ${code}`,
  }));
  audit: AuditRow[] = [];
  /** Orden de operaciones relevantes (candados, transacciones) para asegurar la secuencia. */
  calls: string[] = [];
  /** Inyecta un fallo en la siguiente escritura con ese nombre (p. ej. 'insertStaff'). */
  failNext = new Map<string, unknown>();
  /** Se ejecuta una vez tras tomar el candado de administradores (para simular concurrencia). */
  onAdminLock?: () => void;
  /** Delegados extra del cliente `tx` (p. ej. `staffUser` para releer al actor dentro de la transacción). */
  txExtras: Record<string, unknown> = {};
  private nextId = 1;

  constructor() {
    for (const code of Object.keys(ROLE_IDS)) {
      this.roles.set(ROLE_IDS[code] as string, {
        id: ROLE_IDS[code] as string,
        code,
        name: code,
        isSystem: code === 'admin',
        permissions: new Set(ROLE_PERMISSIONS[code]),
      });
    }
  }

  seed(...records: StaffRecord[]): void {
    for (const r of records) this.staff.set(r.id, structuredClone(r));
  }

  private snapshot() {
    return {
      staff: structuredClone(this.staff),
      roles: structuredClone(this.roles),
      auditLength: this.audit.length,
    };
  }

  /**
   * Las transacciones se serializan (equivale a lo que garantiza el candado de administradores en PostgreSQL para
   * las mutaciones que lo toman; la prueba real de concurrencia vive en test/staff.int-spec.ts).
   */
  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(fn: (tx: StaffTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.runTransaction(fn));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runTransaction<T>(fn: (tx: StaffTx) => Promise<T>): Promise<T> {
    this.calls.push('tx:begin');
    const snap = this.snapshot();
    const pending: AuditRow[] = [];
    const tx = {
      ...this.txExtras,
      auditEvent: {
        create: (a: { data: AuditRow }) => {
          if (this.failNext.has('audit')) {
            const err = this.failNext.get('audit');
            this.failNext.delete('audit');
            return Promise.reject(err instanceof Error ? err : new Error(String(err)));
          }
          pending.push({ ...a.data, reason: a.data.reason ?? null });
          return Promise.resolve({});
        },
      },
    } as unknown as StaffTx;
    try {
      const result = await fn(tx);
      this.audit.push(...pending);
      this.calls.push('tx:commit');
      return result;
    } catch (error) {
      this.staff = snap.staff;
      this.roles = snap.roles;
      this.calls.push('tx:rollback');
      throw error;
    }
  }

  private maybeFail(op: string): void {
    if (this.failNext.has(op)) {
      const err = this.failNext.get(op);
      this.failNext.delete(op);
      throw err;
    }
  }

  lockAdminGuard(): Promise<void> {
    this.calls.push('lock:admin');
    const hook = this.onAdminLock;
    this.onAdminLock = undefined;
    hook?.();
    return Promise.resolve();
  }
  lockRolesShared(): Promise<void> {
    this.calls.push('lock:roles-share');
    return Promise.resolve();
  }
  lockStaff(_tx: StaffTx, id: string): Promise<boolean> {
    this.calls.push(`lock:staff`);
    return Promise.resolve(this.staff.has(id));
  }
  lockRole(_tx: StaffTx, id: string): Promise<boolean> {
    this.calls.push('lock:role');
    return Promise.resolve(this.roles.has(id));
  }

  /** `auth_user_id` simulado: determinista y distinto del id del empleado; null si no está vinculado. */
  authUserIdOf(id: string): string | null {
    return this.staff.get(id)?.linked ? `aaaaaaaa-1111-4111-8111-${id.slice(-12)}` : null;
  }

  findAuthUserId(_tx: StaffTx, id: string): Promise<string | null> {
    return Promise.resolve(this.authUserIdOf(id));
  }

  findStaff(id: string): Promise<StaffRecord | null> {
    const r = this.staff.get(id);
    return Promise.resolve(r ? structuredClone(r) : null);
  }

  listStaff(f: StaffListFilter): Promise<{ items: StaffRecord[]; total: number }> {
    const q = f.q?.trim().toLowerCase();
    let rows = [...this.staff.values()].filter((r) => {
      if (f.scope && !r.assignments.some((a) => a.branch && f.scope?.includes(a.branch.id)))
        return false;
      if (f.branchId && !r.assignments.some((a) => a.branch?.id === f.branchId)) return false;
      if (f.roleId && !r.assignments.some((a) => a.role.id === f.roleId)) return false;
      if (f.active !== undefined && r.active !== f.active) return false;
      if (f.identityStatus && r.linked !== (f.identityStatus === 'LINKED')) return false;
      if (q && !r.fullName.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q))
        return false;
      return true;
    });
    rows = rows.sort((x, y) => {
      const l =
        f.sort === 'createdAt' ? x.createdAt.toISOString() : String(x[f.sort]).toLowerCase();
      const r =
        f.sort === 'createdAt' ? y.createdAt.toISOString() : String(y[f.sort]).toLowerCase();
      return (l < r ? -1 : l > r ? 1 : 0) * (f.order === 'asc' ? 1 : -1);
    });
    const start = (f.page - 1) * f.pageSize;
    return Promise.resolve({
      items: structuredClone(rows.slice(start, start + f.pageSize)),
      total: rows.length,
    });
  }

  private expand(inputs: AssignmentInput[]): AssignmentRecord[] {
    return inputs.map((i) => {
      const role = this.roles.get(i.roleId);
      if (!role) throw dbError('P2003');
      const branch = i.branchId ? this.branches.get(i.branchId) : null;
      if (i.branchId && !branch) throw dbError('P2003');
      // Trigger de la 0005: «alcance global <=> rol admin».
      if ((i.branchId === null) !== (role.code === 'admin')) throw dbError('23514');
      return {
        id: `eeeeeeee-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`,
        active: true,
        role: {
          id: role.id,
          code: role.code,
          name: role.name,
          permissions: [...role.permissions].sort(),
        },
        branch: branch ? { ...branch } : null,
      };
    });
  }

  insertStaff(
    _tx: StaffTx,
    data: { fullName: string; email: string; createdBy: string; assignments: AssignmentInput[] },
  ): Promise<string> {
    this.maybeFail('insertStaff');
    if ([...this.staff.values()].some((s) => s.email === data.email)) {
      return Promise.reject(dbError('P2002', { target: ['email'] }));
    }
    const id = `ffffffff-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    const creator = this.staff.get(data.createdBy);
    this.staff.set(id, {
      id,
      fullName: data.fullName,
      email: data.email,
      active: true,
      linked: false,
      linkedAt: null,
      createdAt: new Date('2026-11-14T00:00:00Z'),
      createdBy: creator ? { id: creator.id, fullName: creator.fullName } : null,
      assignments: this.expand(data.assignments),
    });
    return Promise.resolve(id);
  }

  updateStaff(
    _tx: StaffTx,
    id: string,
    data: { fullName?: string; email?: string; active?: boolean },
  ): Promise<void> {
    this.maybeFail('updateStaff');
    const current = this.staff.get(id);
    if (!current) return Promise.reject(dbError('P2025'));
    if (data.email && [...this.staff.values()].some((s) => s.id !== id && s.email === data.email)) {
      return Promise.reject(dbError('P2002', { target: ['email'] }));
    }
    this.staff.set(id, { ...current, ...data });
    return Promise.resolve();
  }

  deleteAssignments(_tx: StaffTx, ids: string[]): Promise<void> {
    for (const s of this.staff.values()) {
      s.assignments = s.assignments.filter((a) => !ids.includes(a.id));
    }
    return Promise.resolve();
  }

  createAssignments(_tx: StaffTx, staffId: string, inputs: AssignmentInput[]): Promise<void> {
    this.maybeFail('createAssignments');
    const s = this.staff.get(staffId);
    if (!s) return Promise.reject(dbError('P2025'));
    s.assignments.push(...this.expand(inputs));
    return Promise.resolve();
  }

  countActiveLinkedGlobalAdmins(): Promise<number> {
    return Promise.resolve(
      [...this.staff.values()].filter(
        (s) =>
          s.active &&
          s.linked &&
          s.assignments.some((a) => a.active && a.branch === null && a.role.code === 'admin'),
      ).length,
    );
  }

  findRolesByIds(ids: string[]) {
    return Promise.resolve(
      ids.flatMap((id) => {
        const r = this.roles.get(id);
        return r
          ? [{ id: r.id, code: r.code, name: r.name, permissions: [...r.permissions].sort() }]
          : [];
      }),
    );
  }

  private toRole(r: {
    id: string;
    code: string;
    name: string;
    isSystem: boolean;
    permissions: Set<string>;
  }): RoleRecord {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      permissions: [...r.permissions]
        .sort()
        .map((code) => ({ code, description: `Descripción de ${code}` })),
      assignedStaffCount: [...this.staff.values()].filter(
        (s) => s.active && s.assignments.some((a) => a.active && a.role.id === r.id),
      ).length,
    };
  }

  listRoles(): Promise<RoleRecord[]> {
    return Promise.resolve([...this.roles.values()].map((r) => this.toRole(r)));
  }

  findRole(id: string): Promise<RoleRecord | null> {
    const r = this.roles.get(id);
    return Promise.resolve(r ? this.toRole(r) : null);
  }

  listPermissions() {
    return Promise.resolve(
      [...this.permissions]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((p) => ({ code: p.code, description: p.description })),
    );
  }

  findPermissionIds(_tx: StaffTx, codes: string[]): Promise<Map<string, string>> {
    return Promise.resolve(
      new Map(this.permissions.filter((p) => codes.includes(p.code)).map((p) => [p.code, p.id])),
    );
  }

  replaceRolePermissions(
    _tx: StaffTx,
    roleId: string,
    change: { removeCodes: string[]; addPermissionIds: string[] },
  ): Promise<void> {
    const role = this.roles.get(roleId);
    if (!role) return Promise.reject(dbError('P2025'));
    for (const c of change.removeCodes) role.permissions.delete(c);
    for (const id of change.addPermissionIds) {
      const p = this.permissions.find((x) => x.id === id);
      if (p) role.permissions.add(p.code);
    }
    // Los registros de empleados reflejan los permisos vigentes del rol.
    for (const s of this.staff.values()) {
      for (const a of s.assignments) {
        if (a.role.id === roleId) a.role.permissions = [...role.permissions].sort();
      }
    }
    return Promise.resolve();
  }

  staffIdsWithRole(_tx: StaffTx, roleId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.staff.values()]
        .filter((s) => s.active && s.assignments.some((a) => a.active && a.role.id === roleId))
        .map((s) => s.id)
        .sort(),
    );
  }
}
