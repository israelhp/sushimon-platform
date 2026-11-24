import type {
  AdminRider,
  AdminRiderPage,
  AdminRiderSummary,
  RiderAvailabilityFilter,
} from '@/lib/data-access/models';
import { can } from '@/lib/permissions';
import {
  RIDER_NAME_MAX,
  RIDER_PHONE_RE,
  RIDER_PLATE_RE,
  RIDER_REASON_MAX,
  RIDER_SEARCH_MAX,
  RIDER_VEHICLE_TYPES,
  collapseRiderName,
  maskRiderPhone,
  normalizeRiderPlate,
  riderNameKey,
  riderNameProblem,
  riderOperationalState,
} from '@/lib/rider-rules';
import { ADMIN_RIDER_SEEDS, type AdminRiderRecord } from '../fixtures/admin-riders';
import type { MockStore } from '../store';
import { problem } from './admin-orders';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F27 (spec 028) — Handlers SIMULADOS de `/v1/admin/riders*` con la FORMA REAL del contrato `admin-riders`. Mismas reglas que la
 * API: permiso por operación + alcance por sucursal, 404 uniforme fuera del alcance de `riders.read` (anti-IDOR), `expectedVersion`
 * obligatorio en la edición, estado/disponibilidad idempotentes, traslado deja NO disponible, `BUSY` imposible de fijar, teléfono
 * único (`+502` + 8 dígitos) y sin DELETE. Sin F28 no hay entregas: `busy=false` y `busyKnown=false` SIEMPRE (nunca se inventa
 * ocupación ni «libre»). SIMULACIÓN: nada de esto toca la base real ni confirma nada real.
 *
 * Fallos de prueba (`window.__sushimonMockFaults['<MÉTODO> /v1/admin/riders…']`): `rate-limited` (429 `RATE_LIMITED`), `busy`
 * (503 `RIDERS_BUSY`), `has-active-delivery` (409 `RIDER_HAS_ACTIVE_DELIVERY` en desactivar, `UNAVAILABLE` o traslado) y
 * `version-conflict` (otra persona editó justo antes: sube la versión del registro y el PATCH responde 409 con `current`).
 */

type Obj = Record<string, unknown>;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const PAGE_MAX = 10_000;

function ridersOf(req: Req): AdminRiderRecord[] {
  // Stores persistidos antes de F27 no traen la colección: se siembra al primer uso (determinista, según el escenario).
  req.store.adminRiders ??= req.scenario === 'empty' ? [] : structuredClone([...ADMIN_RIDER_SEEDS]);
  return req.store.adminRiders;
}

const branchNameOf = (store: MockStore, id: string) =>
  store.branches.find((b) => b.id === id)?.name ?? '';

function summaryOf(store: MockStore, r: AdminRiderRecord): AdminRiderSummary {
  return {
    id: r.id,
    branchId: r.branchId,
    branchName: branchNameOf(store, r.branchId),
    fullName: r.fullName,
    phoneMasked: maskRiderPhone(r.phone),
    vehicleType: r.vehicleType,
    active: r.active,
    availability: r.availability,
    // Sin F28 (adaptador «sin entregas»): la ocupación NO se conoce y `busy` no es una afirmación real.
    busy: false,
    busyKnown: false,
    operationalState: riderOperationalState(r.active, r.availability, false),
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const detailOf = (store: MockStore, r: AdminRiderRecord): AdminRider => ({
  ...summaryOf(store, r),
  phone: r.phone,
  licensePlate: r.licensePlate,
});

function guard(req: Req): void {
  if (req.fault === 'rate-limited') {
    problem(429, 'RATE_LIMITED', 'Demasiadas solicitudes; espera unos segundos', {}, 2);
  }
  if (req.fault === 'busy') {
    problem(503, 'RIDERS_BUSY', 'Hay mucha demanda; reintenta en unos segundos', {}, 1);
  }
}

const invalid = (details: string[]): never =>
  problem(400, undefined, 'Datos inválidos', { details });

const inScope = (
  actor: StaffActor,
  permission: 'riders.read' | 'riders.update',
  branchId: string,
) => can(actor.grants, permission, branchId);

/** Cuerpo como objeto con solo los campos permitidos (400 si no). */
function bodyOf(req: Req, allowed: readonly string[]): Obj {
  const raw = req.body;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    invalid(['Cuerpo de la solicitud inválido']);
  const input = raw as Obj;
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length) invalid(extra.map((k) => `${k} no está permitido`));
  return input;
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') return invalid(['fullName debe ser texto']);
  const problemFound = riderNameProblem(value);
  if (problemFound === 'length')
    invalid([`fullName debe tener entre 2 y ${RIDER_NAME_MAX} caracteres`]);
  if (problemFound === 'control') invalid(['fullName no admite caracteres de control']);
  return collapseRiderName(value);
}
function parsePhone(value: unknown): string {
  if (typeof value !== 'string' || !RIDER_PHONE_RE.test(value)) {
    return invalid(['phone debe ser +502 seguido de 8 dígitos']);
  }
  return value;
}
function parseVehicle(value: unknown): AdminRiderRecord['vehicleType'] {
  if (value === null) return null;
  if (typeof value === 'string' && (RIDER_VEHICLE_TYPES as readonly string[]).includes(value)) {
    return value as AdminRiderRecord['vehicleType'];
  }
  return invalid(['vehicleType no es un vehículo válido']);
}
function parsePlate(value: unknown): string | null {
  if (value === null) return null;
  const plate = typeof value === 'string' ? normalizeRiderPlate(value) : '';
  if (!RIDER_PLATE_RE.test(plate))
    return invalid(['licensePlate inválida (4 a 10 letras o dígitos)']);
  return plate;
}

const notFound = (): never => problem(404, 'RIDER_NOT_FOUND', 'Motorista no encontrado');
const forbiddenAction = (): never =>
  problem(403, 'RIDER_ACTION_FORBIDDEN', 'No tienes permiso para esta acción en esa sucursal');

/** Motorista visible (alcance de `riders.read`) o el mismo 404 de «no existe». */
function visibleRider(req: Req, actor: StaffActor): AdminRiderRecord {
  const found = ridersOf(req).find((r) => r.id === req.params.id);
  if (!found || !inScope(actor, 'riders.read', found.branchId)) notFound();
  return found as AdminRiderRecord;
}

function assertActiveBranch(req: Req, branchId: string): void {
  const branch = req.store.branches.find((b) => b.id === branchId);
  if (!branch || !branch.active) {
    problem(422, 'BRANCH_NOT_AVAILABLE', 'La sucursal no existe o no está activa');
  }
}

const phoneTaken = (req: Req, phone: string, exceptId?: string) =>
  ridersOf(req).some((r) => r.phone === phone && r.id !== exceptId);

const touch = (req: Req, r: AdminRiderRecord) => {
  r.version += 1;
  r.updatedAt = now(req).toISOString();
};

function intParam(req: Req, name: string, min: number, max: number): number | undefined {
  const raw = req.query.get(name);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) invalid([`${name} fuera de rango`]);
  return n;
}

/** GET /v1/admin/riders */
export const listAdminRiders: Handler = (req): AdminRiderPage => {
  guard(req);
  const actor = requireStaff(req, 'riders.read');
  const q = req.query.get('q');
  if (q !== null && [...q].length > RIDER_SEARCH_MAX) invalid(['q excede el máximo']);
  const key = q ? riderNameKey(q) : '';
  const branchId = req.query.get('branchId') || undefined;
  const activeRaw = req.query.get('active');
  if (activeRaw !== null && activeRaw !== '' && activeRaw !== 'true' && activeRaw !== 'false') {
    invalid(['active debe ser true o false']);
  }
  const availability = (req.query.get('availability') || undefined) as
    RiderAvailabilityFilter | undefined;
  if (availability && !['AVAILABLE', 'UNAVAILABLE', 'BUSY'].includes(availability)) {
    invalid(['availability inválida']);
  }
  const sort = req.query.get('sort') || 'fullName';
  if (!['fullName', 'createdAt', 'updatedAt'].includes(sort)) invalid(['sort inválido']);
  const order = req.query.get('order') || 'asc';
  if (order !== 'asc' && order !== 'desc') invalid(['order inválido']);
  const page = intParam(req, 'page', 1, PAGE_MAX) ?? 1;
  const pageSize = intParam(req, 'pageSize', 1, PAGE_SIZE_MAX) ?? PAGE_SIZE_DEFAULT;

  let rows = ridersOf(req).filter((r) => inScope(actor, 'riders.read', r.branchId));
  if (branchId) rows = rows.filter((r) => r.branchId === branchId);
  if (key) rows = rows.filter((r) => riderNameKey(r.fullName).includes(key));
  if (activeRaw === 'true' || activeRaw === 'false') {
    rows = rows.filter((r) => r.active === (activeRaw === 'true'));
  }
  if (availability === 'UNAVAILABLE') rows = rows.filter((r) => r.availability === 'UNAVAILABLE');
  // `AVAILABLE` = activo + disponible + NO ocupado (sin F28 nadie está ocupado); `BUSY` queda vacío mientras `busyKnown=false`.
  else if (availability === 'AVAILABLE') {
    rows = rows.filter((r) => r.active && r.availability === 'AVAILABLE');
  } else if (availability === 'BUSY') rows = [];

  const dir = order === 'desc' ? -1 : 1;
  const compare = (a: AdminRiderRecord, b: AdminRiderRecord): number => {
    const byField =
      sort === 'fullName'
        ? riderNameKey(a.fullName).localeCompare(riderNameKey(b.fullName), 'es')
        : String(a[sort as 'createdAt' | 'updatedAt']).localeCompare(
            String(b[sort as 'createdAt' | 'updatedAt']),
          );
    return byField * dir || a.id.localeCompare(b.id);
  };
  rows = [...rows].sort(compare);
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize).map((r) => summaryOf(req.store, r)),
    page,
    pageSize,
    total: rows.length,
  };
};

/** GET /v1/admin/riders/:id */
export const getAdminRider: Handler = (req): AdminRider => {
  guard(req);
  const actor = requireStaff(req, 'riders.read');
  return detailOf(req.store, visibleRider(req, actor));
};

/** POST /v1/admin/riders */
export const createAdminRider: Handler = (req): AdminRider => {
  guard(req);
  const actor = requireStaff(req, 'riders.create');
  const input = bodyOf(req, ['branchId', 'fullName', 'phone', 'vehicleType', 'licensePlate']);
  if (typeof input.branchId !== 'string' || !input.branchId) invalid(['branchId es obligatorio']);
  const fullName = parseName(input.fullName);
  const phone = parsePhone(input.phone);
  const vehicleType = input.vehicleType === undefined ? null : parseVehicle(input.vehicleType);
  const licensePlate = input.licensePlate === undefined ? null : parsePlate(input.licensePlate);
  const branchId = input.branchId as string;

  if (!can(actor.grants, 'riders.create', branchId)) forbiddenAction();
  assertActiveBranch(req, branchId);
  if (phoneTaken(req, phone)) {
    problem(409, 'RIDER_PHONE_TAKEN', 'Ese teléfono ya está registrado');
  }
  const riders = ridersOf(req);
  const next =
    riders.reduce((max, r) => Math.max(max, Number(/(\d+)$/.exec(r.id)?.[1] ?? 0)), 0) + 1;
  const at = now(req).toISOString();
  const record: AdminRiderRecord = {
    id: `rider-${next}`,
    branchId,
    fullName,
    phone,
    vehicleType,
    licensePlate,
    active: true,
    availability: 'UNAVAILABLE',
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  riders.push(record);
  return detailOf(req.store, record);
};

/** PATCH /v1/admin/riders/:id — edición parcial con `expectedVersion` y traslado (`branchId`). */
export const updateAdminRider: Handler = (req): AdminRider => {
  guard(req);
  const actor = requireStaff(req, 'riders.update');
  const input = bodyOf(req, [
    'expectedVersion',
    'fullName',
    'phone',
    'vehicleType',
    'licensePlate',
    'branchId',
  ]);
  const expected = input.expectedVersion;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
    invalid(['expectedVersion es obligatorio']);
  }
  const patch: Partial<AdminRiderRecord> = {};
  if (input.fullName !== undefined) patch.fullName = parseName(input.fullName);
  if (input.phone !== undefined) patch.phone = parsePhone(input.phone);
  if (input.vehicleType !== undefined) patch.vehicleType = parseVehicle(input.vehicleType);
  if (input.licensePlate !== undefined) patch.licensePlate = parsePlate(input.licensePlate);
  if (input.branchId !== undefined) {
    if (typeof input.branchId !== 'string' || !input.branchId) invalid(['branchId inválido']);
    patch.branchId = input.branchId as string;
  }
  if (Object.keys(patch).length === 0) invalid(['Indica al menos un campo a modificar']);

  const rider = visibleRider(req, actor);
  if (req.fault === 'version-conflict') touch(req, rider); // otra persona guardó justo antes
  if (!inScope(actor, 'riders.update', rider.branchId)) forbiddenAction();
  const transfer = patch.branchId !== undefined && patch.branchId !== rider.branchId;
  if (transfer) {
    if (!inScope(actor, 'riders.update', patch.branchId as string)) forbiddenAction();
    assertActiveBranch(req, patch.branchId as string);
  }
  if (rider.version !== expected) {
    problem(409, 'RIDER_VERSION_CONFLICT', 'El motorista cambió; recarga e inténtalo de nuevo', {
      current: rider.version,
    });
  }
  if (
    patch.phone !== undefined &&
    patch.phone !== rider.phone &&
    phoneTaken(req, patch.phone, rider.id)
  ) {
    problem(409, 'RIDER_PHONE_TAKEN', 'Ese teléfono ya está registrado');
  }
  const changed = (Object.keys(patch) as (keyof AdminRiderRecord)[]).filter(
    (k) => patch[k] !== rider[k],
  );
  if (changed.length === 0) return detailOf(req.store, rider); // sin cambio real: sin escribir ni subir versión
  if (transfer && req.fault === 'has-active-delivery') {
    problem(409, 'RIDER_HAS_ACTIVE_DELIVERY', 'El motorista tiene una entrega activa');
  }
  Object.assign(rider, patch);
  if (transfer) rider.availability = 'UNAVAILABLE'; // debe re-habilitarse en la nueva sucursal
  touch(req, rider);
  return detailOf(req.store, rider);
};

/** PATCH /v1/admin/riders/:id/status — idempotente, sin `expectedVersion`; desactivar lo deja NO disponible. */
export const updateAdminRiderStatus: Handler = (req): AdminRider => {
  guard(req);
  const actor = requireStaff(req, 'riders.update');
  const input = bodyOf(req, ['active', 'reason']);
  if (typeof input.active !== 'boolean') invalid(['active es obligatorio']);
  if (
    input.reason !== undefined &&
    (typeof input.reason !== 'string' || [...input.reason].length > RIDER_REASON_MAX)
  ) {
    invalid([`reason excede ${RIDER_REASON_MAX} caracteres`]);
  }
  const rider = visibleRider(req, actor);
  if (!inScope(actor, 'riders.update', rider.branchId)) forbiddenAction();
  if (rider.active === input.active) return detailOf(req.store, rider);
  if (!input.active && req.fault === 'has-active-delivery') {
    problem(409, 'RIDER_HAS_ACTIVE_DELIVERY', 'El motorista tiene una entrega activa');
  }
  rider.active = input.active as boolean;
  if (!rider.active) rider.availability = 'UNAVAILABLE'; // reactivar NO lo marca disponible
  touch(req, rider);
  return detailOf(req.store, rider);
};

/** PATCH /v1/admin/riders/:id/availability — idempotente; `BUSY` no existe (derivado de entregas, F28). */
export const updateAdminRiderAvailability: Handler = (req): AdminRider => {
  guard(req);
  const actor = requireStaff(req, 'riders.update');
  const input = bodyOf(req, ['availability']);
  if (input.availability !== 'AVAILABLE' && input.availability !== 'UNAVAILABLE') {
    invalid(['availability debe ser AVAILABLE o UNAVAILABLE']);
  }
  const rider = visibleRider(req, actor);
  if (!inScope(actor, 'riders.update', rider.branchId)) forbiddenAction();
  if (input.availability === 'AVAILABLE' && !rider.active) {
    problem(409, 'RIDER_INACTIVE', 'Un motorista inactivo no puede marcarse disponible');
  }
  if (rider.availability === input.availability) return detailOf(req.store, rider);
  if (input.availability === 'UNAVAILABLE' && req.fault === 'has-active-delivery') {
    problem(409, 'RIDER_HAS_ACTIVE_DELIVERY', 'El motorista tiene una entrega activa');
  }
  rider.availability = input.availability as AdminRiderRecord['availability'];
  touch(req, rider);
  return detailOf(req.store, rider);
};
