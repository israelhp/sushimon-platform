import type { Branch } from '@/lib/data-access/models';
import type { components } from '@sushimon/contracts';
import { ApiError } from '@/lib/data-access/errors';
import { emptyWeek } from '@/lib/branch-hours';
import { branchView, fail } from '../domain';
import type { BranchSeed } from '../fixtures/branches';
import { body, now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F07 — Gestión de sucursales (contrato: `/v1/branches`, `/v1/admin/branches`). El mock aplica las mismas reglas que
 * la API: código normalizado y único (409), inmutable, coordenadas ambas o ninguna, motivo obligatorio al desactivar,
 * 404 fuera de alcance, sin DELETE y solo activas en lo público. Los ids del mock NO son UUID (`sucursal-N`): el
 * contrato real devuelve UUID. La auditoría (`app.audit_events`) no se simula.
 */
type S = components['schemas'];
type PublicBranch = S['PublicBranch'];
type AdminBranch = S['AdminBranch'];

const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PHONE_CHARS_RE = /^[0-9+\s()-]+$/;

/** 400 con `details` (como `ErrorResponse.details`). */
function invalid(details: string[]): never {
  throw new ApiError(400, 'bad_request', 'Datos inválidos', undefined, details);
}

const asPhone = (seed: BranchSeed) => (seed.phone.trim() ? seed.phone : null);

const publicView = (b: BranchSeed): PublicBranch => ({
  id: b.id,
  code: b.code,
  name: b.name,
  address: b.address,
  phone: asPhone(b),
  latitude: b.latitude,
  longitude: b.longitude,
});

const adminView = (b: BranchSeed): AdminBranch => ({
  ...publicView(b),
  active: b.active,
  createdAt: b.createdAt,
});

const byNameThenCode = (a: BranchSeed, b: BranchSeed) =>
  a.name.localeCompare(b.name, 'es') || a.code.localeCompare(b.code);

// ── Público ───────────────────────────────────────────────────────────────────────────────

/** GET /v1/branches — solo activas y solo campos públicos. */
export const listPublicBranches: Handler = (req): S['PublicBranchListResponse'] => ({
  items: req.store.branches
    .filter((b) => b.active)
    .sort(byNameThenCode)
    .map(publicView),
});

/** GET /v1/branches/:id — 404 si no existe o está inactiva. */
export const getPublicBranch: Handler = (req): PublicBranch => {
  const found = req.store.branches.find((b) => b.id === req.params.id && b.active);
  if (!found) fail(404, 'Sucursal no encontrada');
  return publicView(found);
};

// ── Admin ─────────────────────────────────────────────────────────────────────────────────

/** Sucursales dentro del alcance del empleado (null = todas). */
const inScope = (user: StaffActor, b: BranchSeed) =>
  user.scope.allBranches || user.scope.branchIds.includes(b.id);

function scopedBranch(req: Req, user: StaffActor): BranchSeed {
  const found = req.store.branches.find((b) => b.id === req.params.id && inScope(user, b));
  // 404: no se distingue "no existe" de "fuera de alcance".
  if (!found) fail(404, 'Sucursal no encontrada');
  return found;
}

const BRANCH_SORTS = ['name', 'code', 'createdAt'] as const;
const intParam = (raw: string | null, fallback: number) =>
  raw === null || raw === '' ? fallback : /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;

/** GET /v1/admin/branches — filtros q, active, sort, order, page, pageSize. */
export const listAdminBranches: Handler = (req): S['AdminBranchPage'] => {
  const user = requireStaff(req, 'branches.read');
  const problems: string[] = [];
  const q = (req.query.get('q') ?? '').trim().toLowerCase();
  if (q.length > 100) problems.push('q: máximo 100 caracteres');
  const activeRaw = req.query.get('active');
  if (activeRaw !== null && activeRaw !== '' && activeRaw !== 'true' && activeRaw !== 'false') {
    problems.push('active: debe ser true o false');
  }
  const sort = req.query.get('sort') ?? 'name';
  if (!(BRANCH_SORTS as readonly string[]).includes(sort))
    problems.push('sort: valor no permitido');
  const order = req.query.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') problems.push('order: valor no permitido');
  const page = intParam(req.query.get('page'), 1);
  if (!Number.isInteger(page) || page < 1) problems.push('page: entero mayor o igual a 1');
  const pageSize = intParam(req.query.get('pageSize'), 20);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    problems.push('pageSize: entero entre 1 y 100');
  }
  if (problems.length) invalid(problems);

  const dir = order === 'desc' ? -1 : 1;
  const filtered = req.store.branches
    .filter((b) => inScope(user, b))
    .filter((b) => !activeRaw || b.active === (activeRaw === 'true'))
    .filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.includes(q))
    .sort((a, b) => {
      const primary =
        sort === 'code'
          ? a.code.localeCompare(b.code)
          : sort === 'createdAt'
            ? a.createdAt.localeCompare(b.createdAt)
            : a.name.localeCompare(b.name, 'es');
      return dir * primary || byNameThenCode(a, b);
    });
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map(adminView),
    page,
    pageSize,
    total: filtered.length,
  };
};

/** GET /v1/admin/branches/:id */
export const getAdminBranch: Handler = (req): AdminBranch => {
  const user = requireStaff(req, 'branches.read');
  return adminView(scopedBranch(req, user));
};

// ── Validación de campos ──────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function rejectUnknown(raw: Raw, allowed: readonly string[], problems: string[]) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      problems.push(key === 'code' ? 'code: no se puede modificar' : `${key}: campo no permitido`);
    }
  }
}

function text(raw: Raw, key: string, max: number, problems: string[]): string | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !v.trim()) {
    problems.push(`${key}: obligatorio`);
    return undefined;
  }
  if (v.trim().length > max) {
    problems.push(`${key}: máximo ${max} caracteres`);
    return undefined;
  }
  return v.trim();
}

/** `undefined` = no viene; `null` = borrar. */
function phone(raw: Raw, problems: string[]): string | null | undefined {
  const v = raw.phone;
  if (v === undefined) return undefined;
  if (v === null || (typeof v === 'string' && !v.trim())) return null;
  const digitCount = typeof v === 'string' ? v.replace(/\D/g, '').length : 0;
  if (
    typeof v !== 'string' ||
    v.length > 25 ||
    !PHONE_CHARS_RE.test(v.trim()) ||
    digitCount < 7 ||
    digitCount > 15
  ) {
    problems.push('phone: de 7 a 15 dígitos (admite +, espacios, guiones y paréntesis)');
    return undefined;
  }
  return v.trim();
}

function coordinate(
  raw: Raw,
  key: 'latitude' | 'longitude',
  limit: number,
  problems: string[],
): number | null | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return v;
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) {
    problems.push(`${key}: número entre -${limit} y ${limit}`);
    return undefined;
  }
  return v;
}

const asRaw = (req: Req): Raw => body<Raw>(req) as Raw;

/** POST /v1/admin/branches — alta global (solo personal con alcance a todas las sucursales). */
export const createAdminBranch: Handler = (req): AdminBranch => {
  const user = requireStaff(req, 'branches.create');
  if (!user.scope.allBranches) fail(403, 'El alta de sucursales requiere alcance global');
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(
    raw,
    ['code', 'name', 'address', 'phone', 'latitude', 'longitude', 'active'],
    problems,
  );

  const codeRaw = typeof raw.code === 'string' ? raw.code.trim().toLowerCase() : '';
  if (codeRaw.length < 2 || codeRaw.length > 40 || !CODE_RE.test(codeRaw)) {
    problems.push(
      'code: 2 a 40 caracteres; minúsculas, números y guiones (sin guion al inicio/fin ni repetido)',
    );
  }
  const name = text(raw, 'name', 100, problems) ?? (problems.push('name: obligatorio'), '');
  const address =
    text(raw, 'address', 300, problems) ?? (problems.push('address: obligatorio'), '');
  const phoneValue = phone(raw, problems);
  const latitude = coordinate(raw, 'latitude', 90, problems);
  const longitude = coordinate(raw, 'longitude', 180, problems);
  if ((latitude == null) !== (longitude == null)) {
    problems.push('latitude/longitude: deben venir ambas o ninguna');
  }
  if (raw.active !== undefined && typeof raw.active !== 'boolean') {
    problems.push('active: debe ser booleano');
  }
  if (problems.length) invalid([...new Set(problems)]);

  if (req.store.branches.some((b) => b.code === codeRaw)) {
    fail(409, 'Ya existe una sucursal con ese código');
  }
  const active = raw.active !== false;
  req.store.sequences.branch += 1;
  let id = `sucursal-${req.store.sequences.branch}`;
  while (req.store.branches.some((b) => b.id === id)) {
    req.store.sequences.branch += 1;
    id = `sucursal-${req.store.sequences.branch}`;
  }
  const seed: BranchSeed = {
    id,
    code: codeRaw,
    legacyBackofficeId: null,
    name,
    address,
    phone: phoneValue ?? '',
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    active,
    createdAt: now(req).toISOString(),
    // F09: una sucursal nueva nace sin zonas ni fila de configuración (= valores por defecto: sin entrega propia). F08: sin horario configurado (no se asume abierta).
    area: { es: address, en: address },
    zoneLabel: '',
    status: active ? 'active' : 'coming_soon',
  };
  req.store.branches.push(seed);
  req.store.branchHours[seed.id] = emptyWeek();
  return adminView(seed);
};

/** PATCH /v1/admin/branches/:id — nombre, teléfono, dirección y coordenadas. */
export const updateAdminBranch: Handler = (req): AdminBranch => {
  const user = requireStaff(req, 'branches.update');
  const current = scopedBranch(req, user);
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['name', 'address', 'phone', 'latitude', 'longitude'], problems);
  if (Object.keys(raw).length === 0) problems.push('al menos un campo');
  const name = text(raw, 'name', 100, problems);
  const address = text(raw, 'address', 300, problems);
  const phoneValue = phone(raw, problems);
  const latitude = coordinate(raw, 'latitude', 90, problems);
  const longitude = coordinate(raw, 'longitude', 180, problems);
  const nextLat = raw.latitude === undefined ? current.latitude : (latitude ?? null);
  const nextLon = raw.longitude === undefined ? current.longitude : (longitude ?? null);
  if ((nextLat === null) !== (nextLon === null)) {
    problems.push('latitude/longitude: deben venir ambas o ninguna');
  }
  if (problems.length) invalid([...new Set(problems)]);

  if (name !== undefined) current.name = name;
  if (address !== undefined) {
    current.address = address;
    current.area = { es: address, en: address };
  }
  if (phoneValue !== undefined) current.phone = phoneValue ?? '';
  current.latitude = nextLat;
  current.longitude = nextLon;
  return adminView(current);
};

/** PATCH /v1/admin/branches/:id/status — estado ADMINISTRATIVO; desactivar exige motivo; idempotente. */
export const updateAdminBranchStatus: Handler = (req): AdminBranch => {
  const user = requireStaff(req, 'branches.update');
  const current = scopedBranch(req, user);
  const raw = asRaw(req);
  const problems: string[] = [];
  rejectUnknown(raw, ['active', 'reason'], problems);
  if (typeof raw.active !== 'boolean') problems.push('active: obligatorio (booleano)');
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (raw.reason !== undefined && typeof raw.reason !== 'string')
    problems.push('reason: debe ser texto');
  if (reason.length > 200) problems.push('reason: máximo 200 caracteres');
  if (raw.active === false && !reason) problems.push('reason: obligatorio al desactivar');
  if (problems.length) invalid(problems);

  const active = raw.active === true;
  if (current.active !== active) {
    current.active = active;
    // Vista operativa simulada (F09): una sucursal inactiva no ofrece pedidos. Su horario y cierres no se tocan (F08).
    current.status = active ? 'active' : 'coming_soon';
  }
  return adminView(current);
};

// ── 🎭 Operación simulada (F08/F09/F33): solo existe en el mock ──────────────────────────────

/** GET /v1/demo/branches/operations — vista operativa SIMULADA (zona/área) de TODAS las sucursales. */
export const listBranchOperations: Handler = (req): Branch[] =>
  req.store.branches.map((b) => branchView(b));
