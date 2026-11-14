import type { components } from '@sushimon/contracts';
import { emptyWeek, hmToMin, normalizeWeek, validateWeek, weeksEqual } from '@/lib/branch-hours';
import { ApiError, codeForStatus } from '@/lib/data-access/errors';
import type { BranchHoursDay, ErrorViolation } from '@/lib/data-access/models';
import { AVAILABILITY_TIMEZONE, evaluateAvailability } from '../branch-availability';
import { fail } from '../domain';
import type { BranchSeed } from '../fixtures/branches';
import type { ClosureRecord } from '../fixtures/schedule';
import { sha256Hex } from '../sha256';
import type { MockStore } from '../store';
import { body, now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F08 — Horarios, cierres y disponibilidad (spec 007). El mock emula al servidor con las reglas de la spec:
 * semana completa con `version` (409 `HOURS_VERSION_CONFLICT`), 400 de forma vs 422 de negocio con `violations`,
 * cierres `[startsAt, endsAt)` con solape (409), edición según estado (D8), alcance por sucursal (404 fuera de alcance),
 * motivo SOLO en admin, y disponibilidad con el reloj del servidor (`mocks/clock.ts`). Los ids no son UUID. La
 * auditoría y las cabeceras de caché no se simulan.
 */
type S = components['schemas'];

const DAY_MS = 86_400_000;
const MAX_CLOSURE_DAYS = 366;
const MAX_FUTURE_DAYS = 730;
const UPCOMING_DAYS = 30;
const UPCOMING_MAX = 10;
const REASON_MAX = 200;
const CLOSURE_LIMIT = 100;
const MAX_RETROACTIVE_MS = 3_600_000;

/** Error de negocio con `code` y `violations` (como `ErrorResponse` del contrato). */
function businessError(
  status: 409 | 422,
  code: string,
  message: string,
  violations: ErrorViolation[] = [],
): never {
  throw new ApiError(
    status,
    codeForStatus(status),
    message,
    undefined,
    undefined,
    code,
    violations.length ? violations : undefined,
  );
}

/** 400 de forma con `details`. */
function badRequest(details: string[]): never {
  throw new ApiError(400, 'bad_request', 'Datos inválidos', undefined, details);
}

// ── Núcleo reutilizable (también lo usa el mock de pedidos) ────────────────────────────────

export const weekOf = (store: MockStore, branchId: string): BranchHoursDay[] =>
  store.branchHours[branchId] ?? emptyWeek();

/** Disponibilidad de una sucursal en `at` (motor de la spec). */
export function availabilityFor(store: MockStore, branch: BranchSeed, at: Date) {
  return evaluateAvailability({
    active: branch.active,
    days: weekOf(store, branch.id),
    closures: store.closures.filter((c) => c.branchId === branch.id),
    at,
  });
}

/** Cierres próximos (en curso o dentro de 30 días), sin motivo, ≤ 10, por `startsAt`. */
export function upcomingClosuresOf(store: MockStore, branchId: string, at: Date) {
  const t = at.getTime();
  return store.closures
    .filter(
      (c) =>
        c.branchId === branchId &&
        new Date(c.endsAt).getTime() > t &&
        new Date(c.startsAt).getTime() <= t + UPCOMING_DAYS * DAY_MS,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
    .slice(0, UPCOMING_MAX)
    .map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt }));
}

/**
 * Emula el lock timeout del servidor (`SET LOCAL lock_timeout` => 409 `BRANCH_SCHEDULE_BUSY`, reintentable): consume una
 * «ocupación» programada en `store.scheduleBusy[branchId]` (determinista, sin aleatoriedad).
 */
function assertNotBusy(store: MockStore, branchId: string): void {
  const left = store.scheduleBusy?.[branchId] ?? 0;
  if (left <= 0 || !store.scheduleBusy) return;
  store.scheduleBusy[branchId] = left - 1;
  businessError(
    409,
    'BRANCH_SCHEDULE_BUSY',
    'La sucursal está siendo modificada por otra persona; reintenta en unos segundos',
  );
}

/** SHA-256 hex del horario canónico (`weekday|opensAt|closesAt` por intervalo, `\n`, semana vacía = hash de ''). */
export function hoursVersion(days: readonly BranchHoursDay[]): string {
  const lines = days
    .flatMap((d) => d.intervals.map((i) => ({ weekday: d.weekday, ...i })))
    .sort(
      (a, b) =>
        a.weekday - b.weekday ||
        hmToMin(a.opensAt) - hmToMin(b.opensAt) ||
        a.closesAt.localeCompare(b.closesAt),
    )
    .map((i) => `${i.weekday}|${i.opensAt}|${i.closesAt}`);
  return sha256Hex(lines.join('\n'));
}

// ── Público ─────────────────────────────────────────────────────────────────────────────────

function activeBranch(req: Req): BranchSeed {
  const found = req.store.branches.find((b) => b.id === req.params.id && b.active);
  // 404 también si está inactiva (como F07 público): `INACTIVE` nunca se expone por HTTP.
  if (!found) fail(404, 'Sucursal no encontrada');
  return found;
}

/** GET /v1/branches/:id/hours */
export const getPublicBranchHours: Handler = (req): S['PublicBranchHours'] => {
  const branch = activeBranch(req);
  return {
    branchId: branch.id,
    timezone: AVAILABILITY_TIMEZONE,
    days: normalizeWeek(weekOf(req.store, branch.id)),
    upcomingClosures: upcomingClosuresOf(req.store, branch.id, now(req)),
  };
};

/** GET /v1/branches/:id/availability */
export const getPublicBranchAvailability: Handler = (req): S['BranchAvailability'] => {
  const branch = activeBranch(req);
  const at = now(req);
  return {
    branchId: branch.id,
    timezone: AVAILABILITY_TIMEZONE,
    serverTime: at.toISOString(),
    ...availabilityFor(req.store, branch, at),
  };
};

// ── Admin ───────────────────────────────────────────────────────────────────────────────────

/** Sucursal dentro del alcance del permiso; fuera de alcance o inexistente => 404. */
function scopedBranch(req: Req, user: StaffActor): BranchSeed {
  const found = req.store.branches.find(
    (b) =>
      b.id === req.params.id && (user.scope.allBranches || user.scope.branchIds.includes(b.id)),
  );
  if (!found) fail(404, 'Sucursal no encontrada');
  return found;
}

const hoursView = (store: MockStore, branchId: string): S['BranchHours'] => {
  const days = normalizeWeek(weekOf(store, branchId));
  return { branchId, timezone: AVAILABILITY_TIMEZONE, version: hoursVersion(days), days };
};

/** GET /v1/admin/branches/:id/hours */
export const getAdminBranchHours: Handler = (req) => {
  const user = requireStaff(req, 'branches.read');
  return hoursView(req.store, scopedBranch(req, user).id);
};

const VERSION_RE = /^[0-9a-f]{64}$/;

/** PUT /v1/admin/branches/:id/hours — semana completa; 400 forma, 422 negocio, 409 versión; idempotente. */
export const replaceAdminBranchHours: Handler = (req) => {
  const user = requireStaff(req, 'branches.manage_hours');
  const branch = scopedBranch(req, user);
  const raw = body<Record<string, unknown>>(req) as Record<string, unknown>;
  const details: string[] = [];
  for (const key of Object.keys(raw)) {
    if (key !== 'expectedVersion' && key !== 'days') details.push(`${key}: campo no permitido`);
  }
  if (typeof raw.expectedVersion !== 'string' || !VERSION_RE.test(raw.expectedVersion)) {
    details.push('expectedVersion: debe ser un SHA-256 hexadecimal en minúsculas (64 caracteres)');
  }
  if (!Array.isArray(raw.days)) details.push('days: obligatorio (arreglo de 7 días)');
  const days: BranchHoursDay[] = [];
  if (Array.isArray(raw.days)) {
    raw.days.forEach((d: unknown, i: number) => {
      const day = d as { weekday?: unknown; intervals?: unknown } | null;
      if (!day || typeof day !== 'object' || !Array.isArray(day.intervals)) {
        details.push(`days[${i}]: debe tener weekday e intervals`);
        return;
      }
      const intervals = day.intervals.map((x: unknown) => {
        const it = x as { opensAt?: unknown; closesAt?: unknown } | null;
        return { opensAt: String(it?.opensAt), closesAt: String(it?.closesAt) };
      });
      days.push({ weekday: day.weekday as BranchHoursDay['weekday'], intervals });
    });
  }
  if (!details.length) {
    for (const issue of validateWeek(days)) {
      if (issue.kind === 'shape') details.push(`${issue.path}: ${issue.message}`);
    }
  }
  if (details.length) badRequest(details);

  const violations = validateWeek(days)
    .filter((i) => i.kind === 'business')
    .map((i) => ({ path: i.path, code: i.code, message: i.message }));
  if (violations.length) businessError(422, 'SCHEDULE_INVALID', 'Horario inválido', violations);

  assertNotBusy(req.store, branch.id);
  const current = hoursView(req.store, branch.id);
  if (raw.expectedVersion !== current.version) {
    businessError(409, 'HOURS_VERSION_CONFLICT', 'El horario cambió desde que lo abriste', []);
  }
  // Sin cambios: 200 idempotente, sin escritura (ni auditoría).
  if (weeksEqual(days, current.days)) return current;
  req.store.branchHours[branch.id] = normalizeWeek(days);
  return hoursView(req.store, branch.id);
};

// ── Cierres ─────────────────────────────────────────────────────────────────────────────────

const ISO_ZONED_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Instante ISO CON zona → ms (truncado al segundo); null si es inválido o no trae zona. */
function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_ZONED_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000) * 1000;
}

const statusOf = (
  c: { startsAt: string; endsAt: string },
  nowMs: number,
): S['BranchClosure']['status'] =>
  new Date(c.endsAt).getTime() <= nowMs
    ? 'past'
    : new Date(c.startsAt).getTime() > nowMs
      ? 'upcoming'
      : 'active';

const closureView = (c: ClosureRecord, nowMs: number): S['BranchClosure'] => ({
  id: c.id,
  branchId: c.branchId,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  reason: c.reason,
  status: statusOf(c, nowMs),
});

function readReason(raw: Record<string, unknown>, details: string[]): string | null | undefined {
  if (raw.reason === undefined) return undefined;
  if (raw.reason === null) return null;
  if (typeof raw.reason !== 'string') {
    details.push('reason: debe ser texto o null');
    return undefined;
  }
  const trimmed = raw.reason.trim();
  if (trimmed.length > REASON_MAX) {
    details.push(`reason: máximo ${REASON_MAX} caracteres`);
    return undefined;
  }
  return trimmed || null;
}

function rangeViolations(startMs: number, endMs: number, nowMs: number): ErrorViolation[] {
  const out: ErrorViolation[] = [];
  if (endMs <= startMs) {
    out.push({
      path: 'endsAt',
      code: 'RANGE_EMPTY',
      message: 'El fin debe ser posterior al inicio',
    });
  } else if (endMs - startMs > MAX_CLOSURE_DAYS * DAY_MS) {
    out.push({
      path: 'endsAt',
      code: 'DURATION_EXCEEDED',
      message: `La duración máxima es de ${MAX_CLOSURE_DAYS} días`,
    });
  }
  if (startMs > nowMs + MAX_FUTURE_DAYS * DAY_MS) {
    out.push({
      path: 'startsAt',
      code: 'STARTS_TOO_FAR',
      message: 'El inicio no puede superar los 2 años a futuro',
    });
  }
  if (startMs < nowMs - MAX_RETROACTIVE_MS) {
    out.push({
      path: 'startsAt',
      code: 'STARTS_TOO_EARLY',
      message: 'El inicio no puede ser anterior a «ahora − 1 hora»',
    });
  }
  if (endMs <= nowMs) {
    out.push({ path: 'endsAt', code: 'ALREADY_ENDED', message: 'El cierre ya terminó' });
  }
  return out;
}

function assertNoOverlap(
  store: MockStore,
  branchId: string,
  startMs: number,
  endMs: number,
  selfId?: string,
) {
  const clash = store.closures.find(
    (c) =>
      c.branchId === branchId &&
      c.id !== selfId &&
      new Date(c.startsAt).getTime() < endMs &&
      startMs < new Date(c.endsAt).getTime(),
  );
  if (clash) {
    businessError(409, 'CLOSURE_OVERLAP', 'El cierre se solapa con otro cierre de la sucursal', [
      {
        path: `closures/${clash.id}`,
        code: 'CLOSURE_OVERLAP',
        message: 'Se solapa con otro cierre de la sucursal',
      },
    ]);
  }
}

const STATUS_FILTERS = ['current', 'upcoming', 'active', 'past', 'all'] as const;
const intParam = (raw: string | null, fallback: number) =>
  raw === null || raw === '' ? fallback : /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;

/** GET /v1/admin/branches/:id/closures */
export const listAdminBranchClosures: Handler = (req): S['BranchClosureList'] => {
  const user = requireStaff(req, 'branches.read');
  const branch = scopedBranch(req, user);
  const details: string[] = [];
  const status = req.query.get('status') ?? 'current';
  if (!(STATUS_FILTERS as readonly string[]).includes(status))
    details.push('status: valor no permitido');
  const fromRaw = req.query.get('from');
  const toRaw = req.query.get('to');
  const from = fromRaw ? parseInstant(fromRaw) : null;
  const to = toRaw ? parseInstant(toRaw) : null;
  if (fromRaw && from === null) details.push('from: ISO 8601 con zona');
  if (toRaw && to === null) details.push('to: ISO 8601 con zona');
  if (from !== null && to !== null && to <= from) details.push('to: debe ser posterior a from');
  const page = intParam(req.query.get('page'), 1);
  if (!Number.isInteger(page) || page < 1) details.push('page: entero mayor o igual a 1');
  const pageSize = intParam(req.query.get('pageSize'), 20);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    details.push('pageSize: entero entre 1 y 100');
  }
  if (details.length) badRequest(details);

  const nowMs = now(req).getTime();
  const descending = status === 'past' || status === 'all';
  const filtered = req.store.closures
    .filter((c) => c.branchId === branch.id)
    .filter((c) => {
      const s = statusOf(c, nowMs);
      return status === 'all' || (status === 'current' ? s !== 'past' : s === status);
    })
    .filter(
      (c) =>
        (to === null || new Date(c.startsAt).getTime() < to) &&
        (from === null || new Date(c.endsAt).getTime() > from),
    )
    .sort(
      (a, b) =>
        (descending ? -1 : 1) * a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize).map((c) => closureView(c, nowMs)),
    page,
    pageSize,
    total: filtered.length,
  };
};

/** POST /v1/admin/branches/:id/closures */
export const createAdminBranchClosure: Handler = (req) => {
  const user = requireStaff(req, 'branches.manage_hours');
  const branch = scopedBranch(req, user);
  const raw = body<Record<string, unknown>>(req) as Record<string, unknown>;
  const details: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!['startsAt', 'endsAt', 'reason'].includes(key)) details.push(`${key}: campo no permitido`);
  }
  const startMs = parseInstant(raw.startsAt);
  const endMs = parseInstant(raw.endsAt);
  if (startMs === null) details.push('startsAt: ISO 8601 con zona (Z o ±hh:mm)');
  if (endMs === null) details.push('endsAt: ISO 8601 con zona (Z o ±hh:mm)');
  const reason = readReason(raw, details);
  if (details.length || startMs === null || endMs === null) badRequest(details);

  const nowMs = now(req).getTime();
  const violations = rangeViolations(startMs, endMs, nowMs);
  if (violations.length) {
    businessError(422, 'CLOSURE_RANGE_INVALID', 'Rango de cierre inválido', violations);
  }
  assertNotBusy(req.store, branch.id);
  // Tope: cierres vigentes o futuros (endsAt > ahora); los terminados no cuentan.
  const open = req.store.closures.filter(
    (c) => c.branchId === branch.id && new Date(c.endsAt).getTime() > nowMs,
  ).length;
  if (open >= CLOSURE_LIMIT) {
    businessError(
      422,
      'CLOSURE_LIMIT_REACHED',
      `La sucursal ya tiene ${CLOSURE_LIMIT} cierres vigentes o futuros`,
    );
  }
  assertNoOverlap(req.store, branch.id, startMs, endMs);

  req.store.sequences.closure += 1;
  const record: ClosureRecord = {
    id: `cierre-${req.store.sequences.closure}`,
    branchId: branch.id,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    reason: reason ?? null,
  };
  req.store.closures.push(record);
  return closureView(record, nowMs);
};

function findClosure(req: Req, branch: BranchSeed): ClosureRecord {
  const found = req.store.closures.find(
    (c) => c.id === req.params.closureId && c.branchId === branch.id,
  );
  if (!found) fail(404, 'Cierre no encontrado');
  return found;
}

/** PATCH /v1/admin/branches/:id/closures/:closureId — según estado (D8). */
export const updateAdminBranchClosure: Handler = (req) => {
  const user = requireStaff(req, 'branches.manage_hours');
  const branch = scopedBranch(req, user);
  const current = findClosure(req, branch);
  const raw = body<Record<string, unknown>>(req) as Record<string, unknown>;
  const details: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!['startsAt', 'endsAt', 'reason'].includes(key)) details.push(`${key}: campo no permitido`);
  }
  if (Object.keys(raw).length === 0) details.push('Envía al menos un campo');
  const startMs = raw.startsAt === undefined ? undefined : parseInstant(raw.startsAt);
  const endMs = raw.endsAt === undefined ? undefined : parseInstant(raw.endsAt);
  if (startMs === null) details.push('startsAt: ISO 8601 con zona (Z o ±hh:mm)');
  if (endMs === null) details.push('endsAt: ISO 8601 con zona (Z o ±hh:mm)');
  const reason = readReason(raw, details);
  if (details.length) badRequest(details);

  const nowMs = now(req).getTime();
  assertNotBusy(req.store, branch.id);
  const state = statusOf(current, nowMs);
  const curStart = new Date(current.startsAt).getTime();
  const curEnd = new Date(current.endsAt).getTime();
  const notEditable = (message: string): never =>
    businessError(409, 'CLOSURE_NOT_EDITABLE', message, []);

  if (state === 'past') notEditable('Un cierre terminado no se puede modificar');

  if (state === 'active') {
    if (startMs !== undefined && startMs !== curStart) {
      notEditable('En un cierre en curso no se puede cambiar el inicio');
    }
    let nextEnd = curEnd;
    if (endMs !== undefined && endMs !== null) {
      if (endMs > curEnd) notEditable('En un cierre en curso solo se puede acortar el fin');
      // Terminar ahora: cualquier instante <= ahora se fija a «ahora» (truncado al segundo).
      nextEnd = endMs <= nowMs ? Math.floor(nowMs / 1000) * 1000 : endMs;
      if (nextEnd <= curStart) {
        businessError(422, 'CLOSURE_RANGE_INVALID', 'Rango de cierre inválido', [
          { path: 'endsAt', code: 'RANGE_EMPTY', message: 'El fin debe ser posterior al inicio' },
        ]);
      }
    }
    current.endsAt = new Date(nextEnd).toISOString();
  } else {
    const nextStart = startMs ?? curStart;
    const nextEnd = endMs ?? curEnd;
    const violations = rangeViolations(nextStart, nextEnd, nowMs);
    if (violations.length) {
      businessError(422, 'CLOSURE_RANGE_INVALID', 'Rango de cierre inválido', violations);
    }
    assertNoOverlap(req.store, branch.id, nextStart, nextEnd, current.id);
    current.startsAt = new Date(nextStart).toISOString();
    current.endsAt = new Date(nextEnd).toISOString();
  }
  if (reason !== undefined) current.reason = reason;
  return closureView(current, nowMs);
};

/** DELETE /v1/admin/branches/:id/closures/:closureId — solo futuros (204). */
export const deleteAdminBranchClosure: Handler = (req) => {
  const user = requireStaff(req, 'branches.manage_hours');
  const branch = scopedBranch(req, user);
  const current = findClosure(req, branch);
  assertNotBusy(req.store, branch.id);
  if (statusOf(current, now(req).getTime()) !== 'upcoming') {
    businessError(409, 'CLOSURE_NOT_DELETABLE', 'Solo se pueden cancelar cierres futuros', []);
  }
  req.store.closures = req.store.closures.filter((c) => c.id !== current.id);
  return undefined;
};
