import type { MockHandler, MockRequest } from '@/lib/data-access/mock-client';
import type { GrantScope, Order, StaffPermission, StaffRole } from '@/lib/data-access/models';
import { can, type Grants } from '@/lib/permissions';
import { localDate } from '@/lib/time';
import { fail, isAwaitingPayment } from '../domain';
import { generateDayOrders } from '../factories/history';
import { computeGrants, primaryRole } from '../rbac';
import type { CustomerAccount, MockContext, MockStore, StaffRecord } from '../store';

export type Req = MockRequest<MockStore, MockContext>;
export type Handler = MockHandler<MockStore, MockContext>;

export const now = (req: Req) => req.context.clock.now();
export const today = (req: Req) => localDate(now(req));

/** Cuerpo como objeto (400 si no lo es). */
export function body<T extends object>(req: Req): Partial<T> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    fail(400, 'Cuerpo de la solicitud inválido');
  }
  return req.body as Partial<T>;
}

export const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function oneOf<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(400, `${field} inválido`);
  return value as T;
}

// ── Autorización simulada (en http la decide el servidor) ──────────────────────────────────

/** Empleado autenticado con sus permisos calculados (`grants`) desde el store, no desde la sesión. */
export interface StaffActor {
  record: StaffRecord;
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  grants: Grants;
  /** Alcance del permiso pedido (o la unión de todos si no se pidió ninguno). */
  scope: GrantScope;
}

export function grantsOf(store: MockStore, record: StaffRecord): Grants {
  return computeGrants(record, store.roles, store.branches);
}

export function unionScope(grants: Grants): GrantScope {
  const scopes = Object.values(grants);
  const allBranches = scopes.some((x) => x.allBranches);
  return {
    allBranches,
    branchIds: allBranches ? [] : [...new Set(scopes.flatMap((x) => x.branchIds))],
  };
}

export function rolesOf(store: MockStore, record: StaffRecord): StaffRole[] {
  return record.assignments
    .map((a) => store.roles.find((r) => r.id === a.roleId)?.code)
    .filter((c): c is StaffRole => Boolean(c));
}

/**
 * Personal autenticado (sesión de demostración) con el permiso pedido en ALGÚN alcance. 401 sin sesión o usuario
 * inexistente; 403 si está desactivado (la API revalida en cada solicitud) o le falta el permiso.
 */
export function requireStaff(req: Req, permission?: StaffPermission): StaffActor {
  const session = req.context.session.staff;
  if (!session) fail(401, 'Inicia sesión en el backoffice');
  const record = req.store.staff.find((u) => u.id === session.userId);
  if (!record) fail(401, 'Usuario interno inexistente');
  if (!record.active) fail(403, 'No tienes permiso para esta acción');
  const grants = grantsOf(req.store, record);
  if (permission && !can(grants, permission)) fail(403, 'No tienes permiso para esta acción');
  return {
    record,
    id: record.id,
    name: record.fullName,
    email: record.email,
    role: primaryRole(rolesOf(req.store, record)),
    grants,
    scope: permission ? (grants[permission] as GrantScope) : unionScope(grants),
  };
}

/** Sucursales activas visibles para el actor según su alcance. */
export function staffBranchIds(store: MockStore, actor: Pick<StaffActor, 'scope'>): string[] {
  const active = store.branches.filter((b) => b.status === 'active').map((b) => b.id);
  return actor.scope.allBranches
    ? active
    : active.filter((id) => actor.scope.branchIds.includes(id));
}

/** Filtro `branchId` de la consulta respetando el alcance del usuario (403 si se sale). */
export function scopedBranchIds(req: Req, user: StaffActor): string[] {
  const allowed = staffBranchIds(req.store, user);
  const requested = req.query.get('branchId');
  if (!requested || requested === 'all') return allowed;
  if (!allowed.includes(requested)) fail(403, 'Sin acceso a esa sucursal');
  return [requested];
}

export function assertOrderInScope(user: StaffActor, order: Order) {
  if (!user.scope.allBranches && !user.scope.branchIds.includes(order.branchId)) {
    // 404 para no revelar pedidos de otras sucursales.
    fail(404, 'Pedido no encontrado');
  }
}

export function requireCustomer(req: Req): CustomerAccount {
  const session = req.context.session.customer;
  if (!session) fail(401, 'Inicia sesión para continuar');
  const email = session.email.trim().toLowerCase();
  let account = req.store.accounts[email];
  if (!account) {
    // Primera vez: el servidor crearía el perfil vacío.
    account = {
      profile: { email, fullName: session.name, phone: '', defaultAddressId: null },
      addresses: [],
      favorites: [],
    };
    req.store.accounts[email] = account;
  }
  return account;
}

// ── Pedidos por día ───────────────────────────────────────────────────────────────────────

/**
 * Pedidos de un día para el backoffice: historial generado + pedidos vivos del store de esa fecha,
 * sin los que esperan pago con tarjeta (no llegan a la cocina).
 */
export function ordersForDay(req: Req, dateISO: string, branchIds: string[]): Order[] {
  const generated = req.store.historyEnabled ? generateDayOrders(dateISO, today(req)) : [];
  const live = req.store.orders.filter(
    (o) => localDate(new Date(o.createdAt)) === dateISO && !isAwaitingPayment(o),
  );
  return [...generated, ...live].filter((o) => branchIds.includes(o.branchId));
}
