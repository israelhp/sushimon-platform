import type {
  AdminPromotion,
  AdminPromotionPage,
  AdminPromotionSummary,
  PromotionKind,
  PromotionScheduleSlot,
  PromotionScope,
  StorePromotion,
  StorePromotionItem,
  StorePromotionList,
} from '@/lib/data-access/models';
import { PRODUCT_PAGE_SIZE_MAX } from '@/lib/product-rules';
import {
  PROMOTION_BRANCHES_MAX,
  PROMOTION_CODE_PATTERN,
  PROMOTION_DESCRIPTION_MAX,
  PROMOTION_NAME_MAX,
  PROMOTION_PAGE_MAX,
  PROMOTION_PRODUCTS_MAX,
  PROMOTION_SEARCH_MAX,
  PROMOTION_SLOTS_MAX,
  STORE_PROMOTIONS_MAX,
  STORE_PROMOTION_ITEMS_MAX,
  decimalToCents,
  indicativePromoPrice,
  isInstantWithZone,
  isScheduleSlotShape,
  isValueInRange,
  lifecycleOf,
  nextChangeAt,
  normalizePromotionCode,
  promotionTimes,
  scheduleViolations,
  sortSchedule,
} from '@/lib/promotion-rules';
import { badRequest, availableAt, effectivePriceAt, failCode } from '../domain';
import type { PromotionRecord } from '../fixtures/promotions';
import type { MockStore } from '../store';
import { isProductVisible } from './products';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F15 — Promociones, cupones y Happy Hour (spec 016, ADR-0021). El mock EMULA al servidor:
 * - Público (`GET /v1/store/promotions?branchId&state=live|upcoming`): sucursal ACTIVA (404 `BRANCH_NOT_FOUND`), solo promociones
 *   activas que aplican a esa sucursal; `live` = vigente AHORA (vigencia `[inicio, fin)` + horario semanal local de `America/Guatemala`,
 *   día ISO 1–7), `upcoming` = empieza a regir en ≤ 14 días. NUNCA devuelve `code`; un cupón sale con `requiresCode=true` y SIN
 *   `kind`, `value`, `productIds` ni `items`. `isHappyHour` = automática con horario semanal. `items` (automáticas con productos
 *   seleccionados): precio de sucursal (F13) y precio promocional INDICATIVO con `computeLineDiscount` (cantidad 1), solo productos
 *   visibles y disponibles. `nextChangeAt` = próximo cambio del conjunto vigente. NO simula `Cache-Control`, límite de tasa ni UUID.
 * - Admin: `promotions.read|create|update`; lectura con alcance (acotado = las que aplican a alguna de sus sucursales, `branches`
 *   recortado, `editable=false` si no cubre todas); escritura exige cubrir TODAS las sucursales (`ALL` => alcance global): fuera de
 *   alcance 404 `PROMOTION_NOT_FOUND` / `BRANCH_NOT_FOUND`, cubierta parcialmente 403 `PROMOTION_SCOPE_FORBIDDEN`. Errores: 400 de
 *   forma, 409 `PROMOTION_CODE_TAKEN` | `PROMOTION_VERSION_CONFLICT`, 422 `PROMOTION_{VALUE,PERIOD,SCHEDULE,SCOPE}_INVALID` con
 *   `violations`, 503 `PROMOTIONS_BUSY` (determinista: `store.promotionsBusy`). `PATCH` parcial con `expectedVersion`, sin cambios =
 *   200 sin subir `version`; el estado va aparte (idempotente, sin versión). NO simula auditoría. Sin borrado.
 *
 * Toda regla de tiempo y dinero sale de `lib/promotion-rules` (única fuente para el mock y los formularios).
 */

// ── Utilidades ─────────────────────────────────────────────────────────────────────────────

const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Presente = con valor: JSON omite `undefined`, así que el mock lo trata como ausente (igual que http). */
const has = (raw: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

const iso = (ms: number | Date) => new Date(ms).toISOString();

/** ¿La promoción aplica a la sucursal? (`ALL` incluye las futuras). */
const appliesToBranch = (p: PromotionRecord, branchId: string) =>
  p.branchScope === 'ALL' || p.branchIds.includes(branchId);

const sortedSchedule = (p: PromotionRecord): PromotionScheduleSlot[] => sortSchedule(p.schedule);

/** `isHappyHour` derivado: automática (sin código) con horario semanal. */
const isHappyHourOf = (p: PromotionRecord) => p.code === null && p.schedule.length > 0;

// ── Público ────────────────────────────────────────────────────────────────────────────────

function storeItems(store: MockStore, p: PromotionRecord, branchId: string): StorePromotionItem[] {
  if (p.code !== null || p.productScope !== 'SELECTED') return [];
  return p.productIds
    .map((id) => store.products.find((x) => x.id === id))
    .filter(
      (x): x is NonNullable<typeof x> =>
        !!x && isProductVisible(store, x) && availableAt(store, x, branchId),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || byId(a, b))
    .flatMap((x) => {
      const regular = effectivePriceAt(store, x, branchId);
      const promo = indicativePromoPrice(regular, p);
      return promo === null ? [] : [{ productId: x.id, regularPrice: regular, promoPrice: promo }];
    })
    .slice(0, STORE_PROMOTION_ITEMS_MAX);
}

function storeView(
  store: MockStore,
  p: PromotionRecord,
  branchId: string,
  state: 'live' | 'upcoming',
  at: Date,
): StorePromotion {
  const times = promotionTimes(p, at);
  const requiresCode = p.code !== null;
  const view: StorePromotion = {
    id: p.id,
    name: p.name,
    description: p.description,
    requiresCode,
    isHappyHour: isHappyHourOf(p),
    dineInOnly: p.dineInOnly,
    state,
    validFrom: p.startsAt,
    validUntil: p.endsAt,
    schedule: sortedSchedule(p),
    nextStartsAt: times.nextStartsAt ? iso(times.nextStartsAt) : null,
    nextEndsAt: times.nextEndsAt ? iso(times.nextEndsAt) : null,
    productScope: p.productScope,
  };
  // Un cupón NUNCA revela su código ni su descuento ni sus productos por esta vía.
  if (!requiresCode) {
    view.kind = p.kind;
    view.value = p.value;
    if (p.productScope === 'SELECTED') {
      view.productIds = [...p.productIds];
      const items = storeItems(store, p, branchId);
      if (items.length > 0) view.items = items;
    }
  }
  return view;
}

/** GET /v1/store/promotions?branchId&state — público. */
export const listStorePromotions: Handler = (req): StorePromotionList => {
  const problems: string[] = [];
  const branchId = req.query.get('branchId');
  if (!branchId) problems.push('branchId: obligatorio');
  const stateRaw = req.query.get('state') ?? 'live';
  if (stateRaw !== 'live' && stateRaw !== 'upcoming') problems.push('state: live o upcoming');
  if (problems.length > 0) badRequest(problems);
  const state = stateRaw as 'live' | 'upcoming';
  const { store } = req;
  const branch = store.branches.find((b) => b.id === branchId);
  if (!branch || !branch.active) failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
  const at = now(req);

  const applicable = store.promotions.filter((p) => p.active && appliesToBranch(p, branch.id));
  const matches = applicable
    .filter((p) => {
      const times = promotionTimes(p, at);
      return state === 'live' ? times.live : !times.live && times.nextStartsAt !== null;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || byId(a, b));
  const next = nextChangeAt(applicable, at);
  return {
    branchId: branch.id,
    generatedAt: iso(at),
    nextChangeAt: next ? iso(next) : null,
    truncated: matches.length > STORE_PROMOTIONS_MAX,
    items: matches
      .slice(0, STORE_PROMOTIONS_MAX)
      .map((p) => storeView(store, p, branch.id, state, at)),
  };
};

// ── Administración: vistas y alcance ───────────────────────────────────────────────────────

type Scope = StaffActor['scope'];

const inScope = (scope: Scope, branchId: string) =>
  scope.allBranches || scope.branchIds.includes(branchId);

/** ¿Toca el alcance? Global: todas; acotado: las que aplican a alguna de sus sucursales (incluidas las `ALL`). */
function touchesScope(scope: Scope, p: PromotionRecord, store: MockStore): boolean {
  if (scope.allBranches) return true;
  const mine = store.branches.filter((b) => scope.branchIds.includes(b.id)).map((b) => b.id);
  return mine.some((id) => appliesToBranch(p, id));
}

/** ¿Cubre TODAS las sucursales de la promoción? (`ALL` exige alcance global.) */
function coversAll(scope: Scope, p: Pick<PromotionRecord, 'branchScope' | 'branchIds'>): boolean {
  if (scope.allBranches) return true;
  return p.branchScope === 'SELECTED' && p.branchIds.every((id) => scope.branchIds.includes(id));
}

function summaryOf(
  store: MockStore,
  p: PromotionRecord,
  readScope: Scope,
  updateScope: Scope | null,
  at: Date,
): AdminPromotionSummary {
  const lifecycle = lifecycleOf(p, at);
  const branches =
    p.branchScope === 'ALL'
      ? []
      : store.branches
          .filter((b) => p.branchIds.includes(b.id) && inScope(readScope, b.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'es') || byId(a, b))
          .map((b) => ({ id: b.id, name: b.name }));
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    kind: p.kind,
    value: p.value,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    dineInOnly: p.dineInOnly,
    active: p.active,
    lifecycle,
    liveNow: promotionTimes(p, at).live,
    branchScope: p.branchScope,
    branches,
    productScope: p.productScope,
    productCount: p.productScope === 'ALL' ? 0 : p.productIds.length,
    scheduleCount: p.schedule.length,
    editable: updateScope !== null && coversAll(updateScope, p),
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function detailOf(
  store: MockStore,
  p: PromotionRecord,
  readScope: Scope,
  updateScope: Scope | null,
  at: Date,
): AdminPromotion {
  const products =
    p.productScope === 'ALL'
      ? []
      : store.products
          .filter((x) => p.productIds.includes(x.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || byId(a, b))
          .map((x) => ({ id: x.id, name: x.name, slug: x.slug }));
  return {
    ...summaryOf(store, p, readScope, updateScope, at),
    products,
    schedule: sortedSchedule(p),
  };
}

/** Alcance del permiso de ESCRITURA del actor (si lo tiene; lectura y escritura son permisos distintos). */
function updateScopeOf(actor: StaffActor): Scope | null {
  return actor.grants['promotions.update'] ?? null;
}

function viewFor(req: Req, actor: StaffActor, p: PromotionRecord): AdminPromotion {
  return detailOf(req.store, p, actor.scope, updateScopeOf(actor), now(req));
}

// ── Administración: lectura ────────────────────────────────────────────────────────────────

const STATUS = ['active', 'inactive', 'scheduled', 'running', 'expired'] as const;
const SORTS = ['startsAt', 'endsAt', 'name', 'createdAt'] as const;
const KINDS: readonly PromotionKind[] = ['PERCENT', 'FIXED_AMOUNT'];

/** GET /v1/admin/promotions?branchId&status&kind&from&to&q&sort&order&page&pageSize */
export const listAdminPromotions: Handler = (req): AdminPromotionPage => {
  const actor = requireStaff(req, 'promotions.read');
  const problems: string[] = [];
  const q = req.query;
  const page = strictInt(q.get('page'), 1);
  const pageSize = strictInt(q.get('pageSize'), 20);
  if (page === null || page < 1 || page > PROMOTION_PAGE_MAX) {
    problems.push(`page: entre 1 y ${PROMOTION_PAGE_MAX}`);
  }
  if (pageSize === null || pageSize < 1 || pageSize > PRODUCT_PAGE_SIZE_MAX) {
    problems.push(`pageSize: entre 1 y ${PRODUCT_PAGE_SIZE_MAX}`);
  }
  const status = q.get('status');
  if (status !== null && !(STATUS as readonly string[]).includes(status)) {
    problems.push('status: active, inactive, scheduled, running o expired');
  }
  const kind = q.get('kind');
  if (kind !== null && !(KINDS as readonly string[]).includes(kind)) {
    problems.push('kind: PERCENT o FIXED_AMOUNT');
  }
  const sort = q.get('sort') ?? 'startsAt';
  if (!(SORTS as readonly string[]).includes(sort)) problems.push('sort inválido');
  const order = q.get('order') ?? 'desc';
  if (order !== 'asc' && order !== 'desc') problems.push('order: asc o desc');
  const text = q.get('q');
  if (text !== null && text.length > PROMOTION_SEARCH_MAX) {
    problems.push(`q: máximo ${PROMOTION_SEARCH_MAX} caracteres`);
  }
  const fromRaw = q.get('from');
  const toRaw = q.get('to');
  if (fromRaw !== null && !isInstantWithZone(fromRaw)) problems.push('from: instante con zona');
  if (toRaw !== null && !isInstantWithZone(toRaw)) problems.push('to: instante con zona');
  if (
    fromRaw !== null &&
    toRaw !== null &&
    isInstantWithZone(fromRaw) &&
    isInstantWithZone(toRaw) &&
    Date.parse(toRaw) <= Date.parse(fromRaw)
  ) {
    problems.push('to: debe ser mayor que from');
  }
  if (problems.length > 0) badRequest(problems);

  const { store } = req;
  const branchId = q.get('branchId');
  if (branchId !== null) {
    const exists = store.branches.some((b) => b.id === branchId);
    if (!exists || !inScope(actor.scope, branchId)) {
      failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
    }
  }
  const at = now(req);
  const needle = text ? foldText(text.trim()) : '';
  const from = fromRaw === null ? null : Date.parse(fromRaw);
  const to = toRaw === null ? null : Date.parse(toRaw);
  const sign = order === 'desc' ? -1 : 1;
  const compare = (a: PromotionRecord, b: PromotionRecord): number => {
    let main = 0;
    if (sort === 'name') main = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    else if (sort === 'endsAt') main = a.endsAt.localeCompare(b.endsAt);
    else if (sort === 'createdAt') main = a.createdAt.localeCompare(b.createdAt);
    else main = a.startsAt.localeCompare(b.startsAt);
    return main * sign || byId(a, b);
  };
  const matches = store.promotions
    .filter((p) => touchesScope(actor.scope, p, store))
    .filter((p) => branchId === null || appliesToBranch(p, branchId))
    .filter((p) => {
      if (status === null) return true;
      if (status === 'active') return p.active;
      if (status === 'inactive') return !p.active;
      const life = lifecycleOf(p, at);
      return life === (status.toUpperCase() as typeof life);
    })
    .filter((p) => kind === null || p.kind === kind)
    .filter((p) => from === null || Date.parse(p.endsAt) > from)
    .filter((p) => to === null || Date.parse(p.startsAt) < to)
    .filter(
      (p) =>
        !needle || foldText(p.name).includes(needle) || foldText(p.code ?? '').includes(needle),
    )
    .sort(compare);
  const size = pageSize as number;
  const start = ((page as number) - 1) * size;
  const update = updateScopeOf(actor);
  return {
    items: matches
      .slice(start, start + size)
      .map((p) => summaryOf(store, p, actor.scope, update, at)),
    page: page as number,
    pageSize: size,
    total: matches.length,
  };
};

function notFound(): never {
  return failCode(404, 'PROMOTION_NOT_FOUND', 'Promoción no encontrada');
}

/** GET /v1/admin/promotions/:id */
export const getAdminPromotion: Handler = (req): AdminPromotion => {
  const actor = requireStaff(req, 'promotions.read');
  const p = req.store.promotions.find((x) => x.id === req.params.id);
  if (!p || !touchesScope(actor.scope, p, req.store)) notFound();
  return viewFor(req, actor, p);
};

// ── Administración: forma (400) ────────────────────────────────────────────────────────────

interface Shape {
  name?: string;
  description?: string | null;
  code?: string | null;
  kind?: PromotionKind;
  value?: string;
  startsAt?: string;
  endsAt?: string;
  dineInOnly?: boolean;
  active?: boolean;
  branchScope?: PromotionScope;
  branchIds?: string[];
  productScope?: PromotionScope;
  productIds?: string[];
  schedule?: PromotionScheduleSlot[];
  expectedVersion?: number;
}

const CREATE_KEYS = [
  'name',
  'description',
  'code',
  'kind',
  'value',
  'startsAt',
  'endsAt',
  'dineInOnly',
  'active',
  'branchScope',
  'branchIds',
  'productScope',
  'productIds',
  'schedule',
] as const;
const UPDATE_KEYS = [...CREATE_KEYS.filter((k) => k !== 'active'), 'expectedVersion'] as const;

function idList(raw: unknown, key: string, max: number, problems: string[]): string[] | undefined {
  if (!Array.isArray(raw)) {
    problems.push(`${key}: debe ser una lista`);
    return undefined;
  }
  if (raw.some((x) => typeof x !== 'string' || x.length === 0)) {
    problems.push(`${key}: ids de texto`);
    return undefined;
  }
  if (raw.length > max) problems.push(`${key}: máximo ${max}`);
  if (new Set(raw).size !== raw.length) problems.push(`${key}: sin repetidos`);
  return raw as string[];
}

function parseShape(raw: Record<string, unknown>, allowed: readonly string[]): Shape {
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) problems.push(`${key}: campo no permitido`);
  }
  const out: Shape = {};
  if (has(raw, 'name')) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name.length < 1 || name.length > PROMOTION_NAME_MAX) {
      problems.push(`name: entre 1 y ${PROMOTION_NAME_MAX} caracteres`);
    } else out.name = name;
  }
  if (has(raw, 'description')) {
    const d = raw.description;
    if (d !== null && typeof d !== 'string') problems.push('description: texto o null');
    else if (typeof d === 'string' && d.length > PROMOTION_DESCRIPTION_MAX) {
      problems.push(`description: máximo ${PROMOTION_DESCRIPTION_MAX} caracteres`);
    } else out.description = typeof d === 'string' ? d.trim() || null : null;
  }
  if (has(raw, 'code')) {
    const c = raw.code;
    if (c === null) out.code = null;
    else if (typeof c !== 'string' || !PROMOTION_CODE_PATTERN.test(c.trim())) {
      problems.push('code: 3 a 32 caracteres (letras, números, guion o guion bajo)');
    } else out.code = normalizePromotionCode(c);
  }
  if (has(raw, 'kind')) {
    if (!(KINDS as readonly unknown[]).includes(raw.kind))
      problems.push('kind: PERCENT o FIXED_AMOUNT');
    else out.kind = raw.kind as PromotionKind;
  }
  if (has(raw, 'value')) {
    if (typeof raw.value !== 'string' || decimalToCents(raw.value) === null) {
      problems.push('value: cadena decimal con 2 decimales (p. ej. "15.00")');
    } else out.value = raw.value;
  }
  for (const key of ['startsAt', 'endsAt'] as const) {
    if (has(raw, key)) {
      if (!isInstantWithZone(raw[key])) problems.push(`${key}: instante ISO 8601 con zona`);
      else out[key] = new Date(raw[key] as string).toISOString();
    }
  }
  for (const key of ['dineInOnly', 'active'] as const) {
    if (has(raw, key)) {
      if (typeof raw[key] !== 'boolean') problems.push(`${key}: booleano`);
      else out[key] = raw[key] as boolean;
    }
  }
  for (const key of ['branchScope', 'productScope'] as const) {
    if (has(raw, key)) {
      if (raw[key] !== 'ALL' && raw[key] !== 'SELECTED') problems.push(`${key}: ALL o SELECTED`);
      else out[key] = raw[key] as PromotionScope;
    }
  }
  if (has(raw, 'branchIds')) {
    out.branchIds = idList(raw.branchIds, 'branchIds', PROMOTION_BRANCHES_MAX, problems);
  }
  if (has(raw, 'productIds')) {
    out.productIds = idList(raw.productIds, 'productIds', PROMOTION_PRODUCTS_MAX, problems);
  }
  if (has(raw, 'schedule')) {
    if (!Array.isArray(raw.schedule)) problems.push('schedule: debe ser una lista');
    else if (raw.schedule.length > PROMOTION_SLOTS_MAX) {
      problems.push(`schedule: máximo ${PROMOTION_SLOTS_MAX} tramos`);
    } else {
      const slots: PromotionScheduleSlot[] = [];
      raw.schedule.forEach((s, i) => {
        if (!isScheduleSlotShape(s)) {
          problems.push(`schedule[${i}]: weekday 1..7, startsAt HH:mm, endsAt HH:mm o 24:00`);
        } else slots.push({ weekday: s.weekday, startsAt: s.startsAt, endsAt: s.endsAt });
      });
      out.schedule = slots;
    }
  }
  if (has(raw, 'expectedVersion')) {
    const v = raw.expectedVersion;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      problems.push('expectedVersion: entero >= 1');
    } else out.expectedVersion = v;
  }
  if (problems.length > 0) badRequest(problems);
  return out;
}

// ── Administración: reglas de negocio (422) y alcance ──────────────────────────────────────

interface Resulting {
  name: string;
  description: string | null;
  code: string | null;
  kind: PromotionKind;
  value: string;
  startsAt: string;
  endsAt: string;
  dineInOnly: boolean;
  branchScope: PromotionScope;
  branchIds: string[];
  productScope: PromotionScope;
  productIds: string[];
  schedule: PromotionScheduleSlot[];
}

/** 400 de combinación de sucursales (el contrato exige `branchIds` solo con `SELECTED` y no vacío). */
function assertBranchShape(
  r: Pick<Resulting, 'branchScope' | 'branchIds' | 'productScope' | 'productIds'>,
): void {
  if (r.productScope === 'ALL' && r.productIds.length > 0) {
    badRequest(['productIds: debe omitirse o venir vacío con productScope=ALL']);
  }
  if (r.branchScope === 'ALL' && r.branchIds.length > 0) {
    badRequest(['branchIds: debe omitirse o venir vacío con branchScope=ALL']);
  }
  if (r.branchScope === 'SELECTED' && r.branchIds.length === 0) {
    badRequest(['branchIds: obligatorio y no vacío con branchScope=SELECTED']);
  }
}

/** Alcance de ESCRITURA sobre las sucursales RESULTANTES: `ALL` => global; `SELECTED` => existen y están en alcance (404 si no). */
function assertWriteScope(
  store: MockStore,
  scope: Scope,
  r: Pick<Resulting, 'branchScope' | 'branchIds'>,
): void {
  if (r.branchScope === 'ALL') {
    if (!scope.allBranches) {
      failCode(
        403,
        'PROMOTION_SCOPE_FORBIDDEN',
        'Una promoción para todas las sucursales exige alcance sobre todas',
      );
    }
    return;
  }
  for (const id of r.branchIds) {
    if (!store.branches.some((b) => b.id === id) || !inScope(scope, id)) {
      failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
    }
  }
}

/** 422: valor, periodo, horario y alcance de productos (en ese orden; el primero que falle responde). */
function assertBusinessRules(store: MockStore, r: Resulting): void {
  const cents = decimalToCents(r.value) ?? 0;
  if (!isValueInRange(r.kind, cents)) {
    failCode(
      422,
      'PROMOTION_VALUE_INVALID',
      r.kind === 'PERCENT'
        ? 'El porcentaje debe ser mayor que 0 y no superar 100'
        : 'El monto debe ser mayor que 0 y no superar 999999.99',
      [{ path: 'value', code: 'VALUE_OUT_OF_RANGE', message: 'Valor fuera de rango' }],
    );
  }
  if (Date.parse(r.endsAt) <= Date.parse(r.startsAt)) {
    failCode(422, 'PROMOTION_PERIOD_INVALID', 'El fin debe ser posterior al inicio', [
      { path: 'endsAt', code: 'ENDS_BEFORE_START', message: 'endsAt debe ser mayor que startsAt' },
    ]);
  }
  const slotProblems = scheduleViolations(r.schedule);
  if (slotProblems.length > 0) {
    failCode(
      422,
      'PROMOTION_SCHEDULE_INVALID',
      'Revisa las franjas horarias',
      slotProblems.map((v) => ({ path: v.path, code: v.code, message: v.code })),
    );
  }
  if (r.productScope === 'SELECTED') {
    if (r.productIds.length === 0) {
      failCode(422, 'PROMOTION_SCOPE_INVALID', 'Elige al menos un producto', [
        { path: 'productIds', code: 'EMPTY', message: 'Obligatorio con productScope=SELECTED' },
      ]);
    }
    const unknown = r.productIds
      .map((id, i) => ({ id, i }))
      .filter(({ id }) => !store.products.some((p) => p.id === id));
    if (unknown.length > 0) {
      failCode(
        422,
        'PROMOTION_SCOPE_INVALID',
        'Hay productos inexistentes',
        unknown.map(({ i }) => ({
          path: `productIds[${i}]`,
          code: 'PRODUCT_UNKNOWN',
          message: 'El producto no existe',
        })),
      );
    }
  }
}

const codeTaken = (store: MockStore, code: string | null, exceptId?: string) =>
  code !== null && store.promotions.some((p) => p.code === code && p.id !== exceptId);

function failBusy(store: MockStore): void {
  if ((store.promotionsBusy ?? 0) > 0) {
    store.promotionsBusy = (store.promotionsBusy ?? 0) - 1;
    failCode(503, 'PROMOTIONS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

// ── Administración: escrituras ─────────────────────────────────────────────────────────────

/** POST /v1/admin/promotions */
export const createAdminPromotion: Handler = (req): AdminPromotion => {
  const actor = requireStaff(req, 'promotions.create');
  const raw = rawBody(req);
  const shape = parseShape(raw, CREATE_KEYS);
  const missing = ['name', 'kind', 'value', 'startsAt', 'endsAt', 'branchScope', 'productScope']
    .filter((k) => !has(raw, k))
    .map((k) => `${k}: obligatorio`);
  if (missing.length > 0) badRequest(missing);
  const r: Resulting = {
    name: shape.name as string,
    description: shape.description ?? null,
    code: shape.code ?? null,
    kind: shape.kind as PromotionKind,
    value: shape.value as string,
    startsAt: shape.startsAt as string,
    endsAt: shape.endsAt as string,
    dineInOnly: shape.dineInOnly ?? false,
    branchScope: shape.branchScope as PromotionScope,
    branchIds: shape.branchIds ?? [],
    productScope: shape.productScope as PromotionScope,
    productIds: shape.productIds ?? [],
    schedule: shape.schedule ?? [],
  };
  assertBranchShape(r);
  const { store } = req;
  assertWriteScope(store, actor.scope, r);
  failBusy(store);
  assertBusinessRules(store, r);
  if (codeTaken(store, r.code)) {
    failCode(409, 'PROMOTION_CODE_TAKEN', 'Ya existe una promoción con ese código', [
      { path: 'code', code: 'CODE_TAKEN', message: 'El código ya está en uso' },
    ]);
  }
  const at = now(req).toISOString();
  const record: PromotionRecord = {
    id: `promo-${store.sequences.promotion++}`,
    ...r,
    schedule: sortSchedule(r.schedule),
    active: shape.active ?? true,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  store.promotions.push(record);
  return viewFor(req, actor, record);
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

const sameSchedule = (a: readonly PromotionScheduleSlot[], b: readonly PromotionScheduleSlot[]) =>
  JSON.stringify(sortSchedule(a)) === JSON.stringify(sortSchedule(b));

/** PATCH /v1/admin/promotions/:id */
export const updateAdminPromotion: Handler = (req): AdminPromotion => {
  const actor = requireStaff(req, 'promotions.update');
  const { store } = req;
  const current = store.promotions.find((p) => p.id === req.params.id);
  if (!current || !touchesScope(actor.scope, current, store)) notFound();
  if (!coversAll(actor.scope, current)) {
    failCode(403, 'PROMOTION_SCOPE_FORBIDDEN', 'No cubres todas las sucursales de esta promoción');
  }
  const shape = parseShape(rawBody(req), UPDATE_KEYS);
  if (shape.expectedVersion === undefined) badRequest(['expectedVersion: obligatorio']);
  const fields = Object.keys(shape).filter((k) => k !== 'expectedVersion');
  if (fields.length === 0) badRequest(['Indica al menos un campo a cambiar']);
  if (shape.expectedVersion !== current.version) {
    failCode(
      409,
      'PROMOTION_VERSION_CONFLICT',
      'La promoción cambió; recarga e inténtalo de nuevo',
    );
  }

  const branchScope = shape.branchScope ?? current.branchScope;
  const r: Resulting = {
    name: shape.name ?? current.name,
    description: shape.description !== undefined ? shape.description : current.description,
    code: shape.code !== undefined ? shape.code : current.code,
    kind: shape.kind ?? current.kind,
    value: shape.value ?? current.value,
    startsAt: shape.startsAt ?? current.startsAt,
    endsAt: shape.endsAt ?? current.endsAt,
    dineInOnly: shape.dineInOnly ?? current.dineInOnly,
    branchScope,
    branchIds:
      branchScope === 'ALL' ? (shape.branchIds ?? []) : (shape.branchIds ?? current.branchIds),
    productScope: shape.productScope ?? current.productScope,
    productIds:
      (shape.productScope ?? current.productScope) === 'ALL'
        ? (shape.productIds ?? [])
        : (shape.productIds ?? current.productIds),
    schedule: shape.schedule ?? current.schedule,
  };
  assertBranchShape(r);
  assertWriteScope(store, actor.scope, r);
  failBusy(store);
  assertBusinessRules(store, r);
  if (codeTaken(store, r.code, current.id)) {
    failCode(409, 'PROMOTION_CODE_TAKEN', 'Ya existe una promoción con ese código', [
      { path: 'code', code: 'CODE_TAKEN', message: 'El código ya está en uso' },
    ]);
  }

  const changed =
    r.name !== current.name ||
    r.description !== current.description ||
    r.code !== current.code ||
    r.kind !== current.kind ||
    r.value !== current.value ||
    Date.parse(r.startsAt) !== Date.parse(current.startsAt) ||
    Date.parse(r.endsAt) !== Date.parse(current.endsAt) ||
    r.dineInOnly !== current.dineInOnly ||
    r.branchScope !== current.branchScope ||
    !sameSet(r.branchIds, current.branchIds) ||
    r.productScope !== current.productScope ||
    !sameSet(r.productIds, current.productIds) ||
    !sameSchedule(r.schedule, current.schedule);
  // Sin cambios reales: 200 sin escribir, sin subir `version` y sin auditar.
  if (!changed) return viewFor(req, actor, current);

  Object.assign(current, r, { schedule: sortSchedule(r.schedule) });
  current.version += 1;
  current.updatedAt = now(req).toISOString();
  return viewFor(req, actor, current);
};

/** PATCH /v1/admin/promotions/:id/status — idempotente, sin `expectedVersion`. */
export const updateAdminPromotionStatus: Handler = (req): AdminPromotion => {
  const actor = requireStaff(req, 'promotions.update');
  const { store } = req;
  const current = store.promotions.find((p) => p.id === req.params.id);
  if (!current || !touchesScope(actor.scope, current, store)) notFound();
  if (!coversAll(actor.scope, current)) {
    failCode(403, 'PROMOTION_SCOPE_FORBIDDEN', 'No cubres todas las sucursales de esta promoción');
  }
  const raw = rawBody(req);
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (key !== 'active' && key !== 'reason') problems.push(`${key}: campo no permitido`);
  }
  if (typeof raw.active !== 'boolean') problems.push('active: booleano obligatorio');
  if (has(raw, 'reason') && (typeof raw.reason !== 'string' || raw.reason.length > 200)) {
    problems.push('reason: texto de hasta 200 caracteres');
  }
  if (problems.length > 0) badRequest(problems);
  if (raw.active !== current.active) {
    failBusy(store);
    current.active = raw.active as boolean;
    current.version += 1;
    current.updatedAt = now(req).toISOString();
  }
  return viewFor(req, actor, current);
};
