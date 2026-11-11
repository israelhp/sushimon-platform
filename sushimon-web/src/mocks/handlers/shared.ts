import type { MockHandler, MockRequest } from '@/lib/data-access/mock-client';
import type { Order, StaffPermission, StaffUser } from '@/lib/data-access/models';
import { localDate } from '@/lib/time';
import { fail, isAwaitingPayment } from '../domain';
import { generateDayOrders } from '../factories/history';
import type { CustomerAccount, MockContext, MockStore } from '../store';

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

/**
 * Personal autenticado (sesión de demostración) con el permiso pedido. Se usa el usuario guardado
 * en el store (rol, sucursal, permisos y activo), no lo que diga la sesión.
 */
export function requireStaff(req: Req, permission?: StaffPermission): StaffUser {
  const session = req.context.session.staff;
  if (!session) fail(401, 'Inicia sesión en el backoffice');
  const user = req.store.staff.find((u) => u.id === session.userId);
  if (!user || !user.active) fail(401, 'Usuario interno inactivo o inexistente');
  if (permission && !user.permissions.includes(permission)) {
    fail(403, 'No tienes permiso para esta acción');
  }
  return user;
}

/** Sucursales visibles para el usuario (admin: todas; resto: la suya). */
export function staffBranchIds(store: MockStore, user: StaffUser): string[] {
  const active = store.branches.filter((b) => b.status === 'active').map((b) => b.id);
  return user.branchId === null ? active : active.filter((id) => id === user.branchId);
}

/** Filtro `branchId` de la consulta respetando el alcance del usuario (403 si se sale). */
export function scopedBranchIds(req: Req, user: StaffUser): string[] {
  const allowed = staffBranchIds(req.store, user);
  const requested = req.query.get('branchId');
  if (!requested || requested === 'all') return allowed;
  if (!allowed.includes(requested)) fail(403, 'Sin acceso a esa sucursal');
  return [requested];
}

export function assertOrderInScope(user: StaffUser, order: Order) {
  if (user.branchId !== null && order.branchId !== user.branchId) {
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
