import type {
  AdminDeliveryZone,
  AdminDeliveryZonePage,
  BranchDeliverySettings,
  DeliveryCoverageCheckResponse,
  Department,
  Municipality,
} from '@/lib/data-access/models';
import {
  MONEY_INPUT_PATTERN,
  ZONE_LABEL_INPUT_MAX,
  normalizeMoney,
  normalizeZoneLabel,
  zoneKeyOf,
} from '@/lib/delivery-zone';
import { badRequest, fail, failCode } from '../domain';
import { checkCoverage, compareMoney, settingsOf, settingsView } from '../coverage';
import { DEPARTMENT_SEEDS, MUNICIPALITY_SEEDS, byLocationName } from '../fixtures/geography';
import type { BranchSeed } from '../fixtures/branches';
import type { MockStore } from '../store';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F09 — Geografía, zonas propias, configuración por sucursal y cobertura (spec 008). El mock EMULA al servidor:
 * 400 de forma (propiedades desconocidas, `baseFee` no decimal o número JSON, `zoneLabel` con control o > 60,
 * `expectedVersion` ausente, paginación fuera de rango), 404 fuera de alcance o inexistente, 409 `DELIVERY_ZONE_DUPLICATE`
 * (activa o inactiva) y `DELIVERY_ZONE_VERSION_CONFLICT`, 422 `MUNICIPALITY_NOT_FOUND`/`BRANCH_NOT_AVAILABLE`, normalización
 * D6, prioridad D8, no-op sin subir `version` y estados idempotentes. NO simula auditoría, cabeceras de caché ni UUID (los
 * ids del mock son legibles). El motor de cobertura vive en `../coverage`.
 */

// ── Catálogos públicos ─────────────────────────────────────────────────────────────────────

/** GET /v1/locations/departments */
export const listDepartments: Handler = (): { items: Department[] } => ({
  items: [...DEPARTMENT_SEEDS].sort(byLocationName),
});

/** GET /v1/locations/municipalities?departmentId= — sin `departmentId` 400; inexistente 404; sin municipios `[]`. */
export const listMunicipalities: Handler = (req): { items: Municipality[] } => {
  const departmentId = req.query.get('departmentId');
  if (!departmentId) badRequest(['departmentId: obligatorio']);
  if (!DEPARTMENT_SEEDS.some((d) => d.id === departmentId)) {
    failCode(404, 'DEPARTMENT_NOT_FOUND', 'Departamento no encontrado');
  }
  return {
    items: MUNICIPALITY_SEEDS.filter((m) => m.departmentId === departmentId).sort(byLocationName),
  };
};

// ── Utilidades ──────────────────────────────────────────────────────────────────────────────

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

const unknownKeys = (raw: Record<string, unknown>, allowed: readonly string[], out: string[]) => {
  for (const key of Object.keys(raw))
    if (!allowed.includes(key)) out.push(`${key}: campo no permitido`);
};

const inScope = (user: StaffActor, branchId: string) =>
  user.scope.allBranches || user.scope.branchIds.includes(branchId);

const branchOf = (store: MockStore, id: string): BranchSeed | undefined =>
  store.branches.find((b) => b.id === id);

/** Sucursal existente (activa o no) dentro del alcance del permiso; si no, 404 (no se distingue). */
function scopedBranch(req: Req, user: StaffActor, id: string): BranchSeed {
  const branch = branchOf(req.store, id);
  if (!branch || !inScope(user, id)) fail(404, 'Sucursal no encontrada');
  return branch;
}

function zoneFor(req: Req, user: StaffActor): AdminDeliveryZone {
  const zone = req.store.deliveryZones.find((z) => z.id === req.params.id);
  if (!zone || !inScope(user, zone.branchId)) fail(404, 'Zona no encontrada');
  return zone;
}

function labelOf(raw: unknown, problems: string[]): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw !== null && typeof raw !== 'string') {
    problems.push('zoneLabel: debe ser texto o null');
    return undefined;
  }
  if (typeof raw === 'string' && raw.length > ZONE_LABEL_INPUT_MAX) {
    problems.push(`zoneLabel: máximo ${ZONE_LABEL_INPUT_MAX} caracteres`);
    return undefined;
  }
  return raw;
}

function moneyShape(raw: unknown, problems: string[]): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !MONEY_INPUT_PATTERN.test(raw)) {
    problems.push(
      'baseFee: debe ser un string decimal con 0 a 2 decimales entre 0 y 99999.99 (p. ej. "15" o "15.00")',
    );
    return undefined;
  }
  return raw;
}

/** Normalización D6 con el 400 del servidor. */
function normalized(raw: string | null | undefined): string | null {
  const result = normalizeZoneLabel(raw);
  if (!result.ok) {
    badRequest([
      result.reason === 'control'
        ? 'La zona no admite caracteres de control'
        : 'La zona admite como máximo 60 caracteres',
    ]);
  }
  if (zoneKeyOf(result.label) === null) badRequest(['La zona no es válida']);
  return result.label;
}

const duplicateError = (existingId: string | null) =>
  failCode(
    409,
    'DELIVERY_ZONE_DUPLICATE',
    'Ya existe una zona con esa etiqueta en el municipio de la sucursal',
    existingId
      ? [
          {
            path: `deliveryZones/${existingId}`,
            code: 'DUPLICATE_ZONE',
            message: 'Ya existe esta zona (activa o inactiva)',
          },
        ]
      : [],
  );

const versionConflict = () =>
  failCode(
    409,
    'DELIVERY_ZONE_VERSION_CONFLICT',
    'La zona fue modificada por otra persona; recarga y reintenta',
  );

const findByKey = (store: MockStore, branchId: string, municipalityId: string, key: string) =>
  store.deliveryZones.find(
    (z) =>
      z.branchId === branchId &&
      z.municipalityId === municipalityId &&
      zoneKeyOf(z.zoneLabel) === key,
  );

// ── Zonas (admin) ───────────────────────────────────────────────────────────────────────────

const SORTS = ['municipality', 'baseFee', 'createdAt'] as const;
type Sort = (typeof SORTS)[number];

function intParam(req: Req, name: string, min: number, max: number, problems: string[]) {
  const raw = req.query.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) {
    problems.push(`${name}: entero entre ${min} y ${max}`);
    return undefined;
  }
  return n;
}

/** GET /v1/admin/delivery-zones — `branches.read`. Sin `branchId` solo las sucursales de su alcance. */
export const listAdminDeliveryZones: Handler = (req): AdminDeliveryZonePage => {
  const user = requireStaff(req, 'branches.read');
  const problems: string[] = [];
  const page = intParam(req, 'page', 1, 10_000, problems) ?? 1;
  const pageSize = intParam(req, 'pageSize', 1, 100, problems) ?? 20;
  const sortRaw = req.query.get('sort');
  const order = req.query.get('order') ?? 'asc';
  const activeRaw = req.query.get('active');
  if (sortRaw !== null && !SORTS.includes(sortRaw as Sort)) problems.push('sort: valor inválido');
  if (order !== 'asc' && order !== 'desc') problems.push('order: valor inválido');
  if (activeRaw !== null && activeRaw !== 'true' && activeRaw !== 'false') {
    problems.push('active: debe ser true o false');
  }
  const q = req.query.get('q');
  if (q !== null && q.length > 60) problems.push('q: máximo 60 caracteres');
  if (problems.length) badRequest(problems);

  const branchId = req.query.get('branchId');
  if (branchId) scopedBranch(req, user, branchId);
  const qKey = q ? (zoneKeyOf(normalized(q)) ?? '') : '';
  const departmentId = req.query.get('departmentId');
  const municipalityId = req.query.get('municipalityId');
  const sort = (sortRaw ?? 'municipality') as Sort;

  const rows = req.store.deliveryZones
    .filter((z) => (branchId ? z.branchId === branchId : inScope(user, z.branchId)))
    .filter((z) => !departmentId || z.departmentId === departmentId)
    .filter((z) => !municipalityId || z.municipalityId === municipalityId)
    .filter((z) => activeRaw === null || z.active === (activeRaw === 'true'))
    .filter((z) => !qKey || (zoneKeyOf(z.zoneLabel) ?? '').includes(qKey));

  const byMunicipality = (a: AdminDeliveryZone, b: AdminDeliveryZone) =>
    byLocationName(
      { name: a.departmentName, id: a.departmentId },
      { name: b.departmentName, id: b.departmentId },
    ) ||
    byLocationName(
      { name: a.municipalityName, id: a.municipalityId },
      { name: b.municipalityName, id: b.municipalityId },
    ) ||
    (a.zoneLabel === null ? -1 : 0) - (b.zoneLabel === null ? -1 : 0) ||
    (zoneKeyOf(a.zoneLabel) ?? '').localeCompare(zoneKeyOf(b.zoneLabel) ?? '') ||
    a.id.localeCompare(b.id);
  const compare = (a: AdminDeliveryZone, b: AdminDeliveryZone) =>
    sort === 'baseFee'
      ? compareMoney(a.baseFee, b.baseFee) || byMunicipality(a, b)
      : sort === 'createdAt'
        ? a.createdAt.localeCompare(b.createdAt) || byMunicipality(a, b)
        : byMunicipality(a, b);
  rows.sort(compare);
  if (order === 'desc') rows.reverse();
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: rows.length,
  };
};

/** GET /v1/admin/delivery-zones/:id — `branches.read`. */
export const getAdminDeliveryZone: Handler = (req) => {
  const user = requireStaff(req, 'branches.read');
  return zoneFor(req, user);
};

/** POST /v1/admin/delivery-zones — `branches.manage_delivery_zones`. */
export const createAdminDeliveryZone: Handler = (req): AdminDeliveryZone => {
  const user = requireStaff(req, 'branches.manage_delivery_zones');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['branchId', 'municipalityId', 'zoneLabel', 'baseFee', 'active'], problems);
  if (typeof raw.branchId !== 'string' || !raw.branchId) problems.push('branchId: obligatorio');
  if (typeof raw.municipalityId !== 'string' || !raw.municipalityId) {
    problems.push('municipalityId: obligatorio');
  }
  const zoneLabel = labelOf(raw.zoneLabel, problems);
  if (raw.baseFee === undefined) problems.push('baseFee: obligatorio');
  const feeRaw = moneyShape(raw.baseFee, problems);
  if (raw.active !== undefined && typeof raw.active !== 'boolean') {
    problems.push('active: debe ser booleano');
  }
  if (problems.length) badRequest([...new Set(problems)]);

  const branchId = raw.branchId as string;
  scopedBranch(req, user, branchId); // una sucursal inactiva SÍ admite zonas
  const label = normalized(zoneLabel);
  const baseFee = normalizeMoney(feeRaw as string) as string;
  const municipalityId = raw.municipalityId as string;
  const municipality = MUNICIPALITY_SEEDS.find((m) => m.id === municipalityId);
  if (!municipality) {
    failCode(422, 'MUNICIPALITY_NOT_FOUND', 'El municipio no existe', [
      { path: 'municipalityId', code: 'MUNICIPALITY_NOT_FOUND', message: 'Municipio inexistente' },
    ]);
  }
  const existing = findByKey(req.store, branchId, municipalityId, zoneKeyOf(label) ?? '');
  if (existing) duplicateError(existing.id);
  const department = DEPARTMENT_SEEDS.find((d) => d.id === municipality.departmentId);
  const at = now(req).toISOString();
  req.store.sequences.zone += 1;
  const zone: AdminDeliveryZone = {
    id: `zona-${String(req.store.sequences.zone).padStart(4, '0')}`,
    branchId,
    municipalityId,
    municipalityName: municipality.name,
    departmentId: municipality.departmentId,
    departmentName: department?.name ?? '',
    zoneLabel: label,
    baseFee,
    currency: 'GTQ',
    active: raw.active !== false,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  req.store.deliveryZones.push(zone);
  return zone;
};

/** PATCH /v1/admin/delivery-zones/:id — solo `zoneLabel` y `baseFee`; `expectedVersion` obligatorio. */
export const updateAdminDeliveryZone: Handler = (req): AdminDeliveryZone => {
  const user = requireStaff(req, 'branches.manage_delivery_zones');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['expectedVersion', 'zoneLabel', 'baseFee'], problems);
  if (!Number.isInteger(raw.expectedVersion) || (raw.expectedVersion as number) < 1) {
    problems.push('expectedVersion: obligatorio (entero ≥ 1)');
  }
  const zoneLabel = labelOf(raw.zoneLabel, problems);
  const feeRaw = moneyShape(raw.baseFee, problems);
  if (!problems.length && raw.zoneLabel === undefined && raw.baseFee === undefined) {
    problems.push('Indique al menos zoneLabel o baseFee');
  }
  if (problems.length) badRequest([...new Set(problems)]);

  const nextLabel = zoneLabel === undefined ? undefined : normalized(zoneLabel);
  const nextFee = feeRaw === undefined ? undefined : (normalizeMoney(feeRaw) as string);
  const current = zoneFor(req, user);
  if (raw.expectedVersion !== current.version) versionConflict();
  const label = nextLabel === undefined ? current.zoneLabel : nextLabel;
  const baseFee = nextFee ?? current.baseFee;
  if (label === current.zoneLabel && baseFee === current.baseFee) return current; // sin cambios: ni escritura ni versión
  const key = zoneKeyOf(label) ?? '';
  if (key !== (zoneKeyOf(current.zoneLabel) ?? '')) {
    const dup = findByKey(req.store, current.branchId, current.municipalityId, key);
    if (dup && dup.id !== current.id) duplicateError(dup.id);
  }
  current.zoneLabel = label;
  current.baseFee = baseFee;
  current.version += 1;
  current.updatedAt = now(req).toISOString();
  return current;
};

/** PATCH /v1/admin/delivery-zones/:id/status — asignación explícita e idempotente (último gana). */
export const updateAdminDeliveryZoneStatus: Handler = (req): AdminDeliveryZone => {
  const user = requireStaff(req, 'branches.manage_delivery_zones');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['active', 'reason'], problems);
  if (typeof raw.active !== 'boolean') problems.push('active: obligatorio (booleano)');
  if (raw.reason !== undefined && (typeof raw.reason !== 'string' || raw.reason.length > 200)) {
    problems.push('reason: texto de máximo 200 caracteres');
  }
  if (problems.length) badRequest(problems);
  const current = zoneFor(req, user);
  if (current.active === raw.active) return current;
  current.active = raw.active as boolean;
  current.version += 1;
  current.updatedAt = now(req).toISOString();
  return current;
};

// ── Configuración por sucursal ──────────────────────────────────────────────────────────────

/** GET /v1/admin/branches/:id/delivery-settings — `branches.read`; una sucursal inactiva SÍ se consulta. */
export const getAdminBranchDeliverySettings: Handler = (req): BranchDeliverySettings => {
  const user = requireStaff(req, 'branches.read');
  return settingsView(req.store, scopedBranch(req, user, req.params.id ?? '').id);
};

/** PATCH /v1/admin/branches/:id/delivery-settings — `branches.manage_delivery_zones`; lazy upsert. */
export const updateAdminBranchDeliverySettings: Handler = (req): BranchDeliverySettings => {
  const user = requireStaff(req, 'branches.manage_delivery_zones');
  const branch = scopedBranch(req, user, req.params.id ?? '');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['ownDeliveryZonesEnabled', 'pedidosyaEnabled'], problems);
  for (const flag of ['ownDeliveryZonesEnabled', 'pedidosyaEnabled'] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') {
      problems.push(`${flag}: debe ser booleano`);
    }
  }
  if (
    !problems.length &&
    raw.ownDeliveryZonesEnabled === undefined &&
    raw.pedidosyaEnabled === undefined
  ) {
    problems.push('Indique al menos ownDeliveryZonesEnabled o pedidosyaEnabled');
  }
  if (problems.length) badRequest(problems);
  const before = settingsOf(req.store, branch.id);
  const next = {
    ownDeliveryZonesEnabled:
      (raw.ownDeliveryZonesEnabled as boolean | undefined) ?? before.ownDeliveryZonesEnabled,
    pedidosyaEnabled: (raw.pedidosyaEnabled as boolean | undefined) ?? before.pedidosyaEnabled,
  };
  const changed =
    next.ownDeliveryZonesEnabled !== before.ownDeliveryZonesEnabled ||
    next.pedidosyaEnabled !== before.pedidosyaEnabled;
  if (changed) {
    req.store.deliverySettings[branch.id] = { ...next, updatedAt: now(req).toISOString() };
  }
  return settingsView(req.store, branch.id);
};

// ── Cobertura pública ───────────────────────────────────────────────────────────────────────

/** POST /v1/delivery-coverage/check — público, sin efectos; la tarifa y la elegibilidad las deriva el «servidor». */
export const checkDeliveryCoverage: Handler = (req): DeliveryCoverageCheckResponse => {
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['branchId', 'municipalityId', 'zone'], problems); // un `fee`/`total` del cliente => 400
  if (typeof raw.branchId !== 'string' || !raw.branchId) problems.push('branchId: obligatorio');
  if (typeof raw.municipalityId !== 'string' || !raw.municipalityId) {
    problems.push('municipalityId: obligatorio');
  }
  const zone = labelOf(raw.zone, problems);
  if (problems.length) badRequest(problems);
  const label = normalized(zone);
  const branchId = raw.branchId as string;
  const municipalityId = raw.municipalityId as string;
  // Inexistente e inactiva no se distinguen (no se revela el estado interno de una sucursal).
  if (!branchOf(req.store, branchId)?.active) {
    failCode(422, 'BRANCH_NOT_AVAILABLE', 'La sucursal no está disponible', [
      { path: 'branchId', code: 'BRANCH_NOT_AVAILABLE', message: 'Sucursal no disponible' },
    ]);
  }
  if (!MUNICIPALITY_SEEDS.some((m) => m.id === municipalityId)) {
    failCode(422, 'MUNICIPALITY_NOT_FOUND', 'El municipio no existe', [
      { path: 'municipalityId', code: 'MUNICIPALITY_NOT_FOUND', message: 'Municipio inexistente' },
    ]);
  }
  return checkCoverage(req.store, { branchId, municipalityId, zone: label }, now(req));
};

// ── 🎭 Solo simulación ─────────────────────────────────────────────────────────────────────

/** PUT /v1/demo/delivery/pedidosya-coverage — selector de demostración (`unknown` por defecto). Solo existe en el mock. */
export const setPedidosyaCoverageScenario: Handler = (req) => {
  requireStaff(req, 'branches.manage_delivery_zones');
  const raw = rawBody(req);
  if (
    raw.scenario !== 'unknown' &&
    raw.scenario !== 'available' &&
    raw.scenario !== 'unavailable'
  ) {
    badRequest(['scenario: unknown, available o unavailable']);
  }
  req.store.pedidosyaCoverage = raw.scenario;
  return { scenario: req.store.pedidosyaCoverage };
};

/** GET /v1/demo/delivery/pedidosya-coverage */
export const getPedidosyaCoverageScenario: Handler = (req) => ({
  scenario: req.store.pedidosyaCoverage,
});
