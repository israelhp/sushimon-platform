import type {
  AdminModifier,
  AdminModifierGroup,
  AdminModifierGroupPage,
  AdminModifierGroupSummary,
  AdminModifierList,
  AdminProductModifiers,
  PublicModifierGroup,
} from '@/lib/data-access/models';
import {
  MODIFIER_NAME_MAX,
  MODIFIER_OPTIONS_INPUT_MAX,
  MODIFIER_OPTIONS_MAX,
  MODIFIER_PAGE_MAX,
  MODIFIER_PAGE_SIZE_MAX,
  MODIFIER_SEARCH_MAX,
  PRODUCT_MODIFIER_GROUPS_INPUT_MAX,
  PRODUCT_MODIFIER_GROUPS_MAX,
  areLimitsValid,
  extraPriceToCents,
  hasModifierNameControlChars,
  isOfferable,
  isRequiredGroup,
  modifierNameKey,
  normalizeModifierName,
} from '@/lib/modifier-rules';
import { badRequest, fail, failCode } from '../domain';
import type { MockStore, ModifierGroupRecord, ModifierRecord } from '../store';
import { now, requireStaff, type Handler, type Req } from './shared';

/**
 * F12 — Modificadores de producto (spec 013, ADR-0018). El mock EMULA al servidor: lectura admin con `catalog.read`; escrituras
 * con `catalog.create|update` y alcance GLOBAL (403 si no); 400 de forma (propiedades desconocidas, cuerpo vacío en PATCH, tipos,
 * nombre 1–80, precio `^[0-9]{1,4}\.[0-9]{2}$`, `groupIds` > 50, `orderedIds` > 30, `options` > 100); 404
 * `MODIFIER_GROUP_NOT_FOUND` | `MODIFIER_NOT_FOUND` | `PRODUCT_NOT_FOUND`; 409 `MODIFIER_GROUP_NAME_TAKEN` | `MODIFIER_NAME_TAKEN`
 * (sin distinguir mayúsculas); 422 `MODIFIER_LIMITS_INVALID` (min/max incoherentes o grupo ACTIVO con menos opciones activas que
 * `minSelect`), `MODIFIER_GROUP_UNSATISFIABLE` (desactivar una opción rompe un grupo activo), `MODIFIER_LIMIT_REACHED` (30
 * opciones por grupo, 10 grupos por producto), `MODIFIER_REORDER_MISMATCH` y `MODIFIER_GROUP_INVALID`; 503 `MODIFIERS_BUSY`
 * (determinista, `store.modifiersBusy`). Sin cambios => 200 sin escribir. Sin borrado físico. NO simula auditoría, cabeceras de
 * caché, throttling ni la forma UUID. La ficha pública de F11 incluye `modifierGroups` (solo grupos ofrecibles y opciones activas).
 */

// ── Vistas ─────────────────────────────────────────────────────────────────────────────────

const byOrder = (a: ModifierRecord, b: ModifierRecord) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

const optionsOf = (store: MockStore, groupId: string): ModifierRecord[] =>
  store.modifiers.filter((m) => m.groupId === groupId).sort(byOrder);

const modifierView = (m: ModifierRecord): AdminModifier => ({
  id: m.id,
  groupId: m.groupId,
  name: m.name,
  extraPrice: m.extraPrice,
  active: m.active,
  sortOrder: m.sortOrder,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

const productCountOf = (store: MockStore, groupId: string): number =>
  Object.values(store.productModifierGroups).filter((ids) => ids.includes(groupId)).length;

function summaryView(store: MockStore, g: ModifierGroupRecord): AdminModifierGroupSummary {
  const options = optionsOf(store, g.id);
  return {
    id: g.id,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    required: isRequiredGroup(g.minSelect),
    active: g.active,
    optionCount: options.length,
    activeOptionCount: options.filter((o) => o.active).length,
    productCount: productCountOf(store, g.id),
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

function groupView(store: MockStore, g: ModifierGroupRecord): AdminModifierGroup {
  return { ...summaryView(store, g), options: optionsOf(store, g.id).map(modifierView) };
}

/**
 * Grupos que la ficha pública ofrece (D9): activos, asociados al producto y con al menos `max(min, 1)` opciones activas, en
 * el orden de asociación, con SOLO sus opciones activas. Un grupo insatisfacible se omite (nunca oculta el producto).
 */
export function offerableGroupsOf(store: MockStore, productId: string): PublicModifierGroup[] {
  const out: PublicModifierGroup[] = [];
  for (const groupId of store.productModifierGroups[productId] ?? []) {
    const g = store.modifierGroups.find((x) => x.id === groupId);
    if (!g) continue;
    const options = optionsOf(store, g.id)
      .filter((o) => o.active)
      .map((o) => ({ id: o.id, name: o.name, extraPrice: o.extraPrice }));
    const group: PublicModifierGroup = {
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      required: isRequiredGroup(g.minSelect),
      options,
    };
    if (isOfferable({ ...group, active: g.active })) out.push(group);
  }
  return out;
}

// ── Autorización ───────────────────────────────────────────────────────────────────────────

const reader = (req: Req) => requireStaff(req, 'catalog.read');

/** Escritura: permiso + alcance GLOBAL (403 si solo tiene sucursales): los modificadores son globales. */
function writer(req: Req, permission: 'catalog.create' | 'catalog.update') {
  const actor = requireStaff(req, permission);
  if (!actor.scope.allBranches) {
    fail(403, 'Los modificadores son globales: se requiere alcance sobre todas las sucursales');
  }
  return actor;
}

/** Simulación determinista de `MODIFIERS_BUSY` (la transacción agotó su tiempo; no se guardó nada). */
function maybeBusy(store: MockStore): void {
  if ((store.modifiersBusy ?? 0) > 0) {
    store.modifiersBusy = (store.modifiersBusy ?? 0) - 1;
    failCode(503, 'MODIFIERS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

// ── Validación de forma (400) ──────────────────────────────────────────────────────────────

const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const has = (raw: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(raw, key);

function rawBody(req: Req): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
}

const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

function unknownKeys(raw: Record<string, unknown>, allowed: readonly string[], problems: string[]) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) problems.push(`${key}: campo no permitido`);
  }
}

/** Nombre normalizado (1–80, sin controles) o `undefined` con el problema anotado. */
function parseName(value: unknown, field: string, problems: string[]): string | undefined {
  if (typeof value !== 'string') {
    problems.push(`${field}: debe ser texto`);
    return undefined;
  }
  const name = normalizeModifierName(value);
  if (name.length < 1 || name.length > MODIFIER_NAME_MAX || hasModifierNameControlChars(name)) {
    problems.push(`${field}: entre 1 y ${MODIFIER_NAME_MAX} caracteres`);
    return undefined;
  }
  return name;
}

function parsePrice(value: unknown, field: string, problems: string[]): string | undefined {
  if (typeof value !== 'string' || extraPriceToCents(value) === null) {
    problems.push(`${field}: cadena decimal con 2 decimales, de 0.00 a 9999.99`);
    return undefined;
  }
  return value;
}

function parseInteger(value: unknown, field: string, problems: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    problems.push(`${field}: debe ser un entero`);
    return undefined;
  }
  return value;
}

function parseBoolean(value: unknown, field: string, problems: string[]): boolean | undefined {
  if (typeof value !== 'boolean') {
    problems.push(`${field}: debe ser booleano`);
    return undefined;
  }
  return value;
}

function parseIdList(value: unknown, field: string, max: number, problems: string[]): string[] {
  if (!Array.isArray(value)) {
    problems.push(`${field}: debe ser una lista`);
    return [];
  }
  if (value.length > max) problems.push(`${field}: máximo ${max} elementos`);
  const ids: string[] = [];
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) problems.push(`${field}[${i}]: id inválido`);
    else ids.push(item);
  });
  return ids;
}

function pagination(req: Req, problems: string[]): { page: number; pageSize: number } {
  const page = strictInt(req.query.get('page'), 1);
  const pageSize = strictInt(req.query.get('pageSize'), 20);
  if (page === null || page < 1 || page > MODIFIER_PAGE_MAX) {
    problems.push(`page: entre 1 y ${MODIFIER_PAGE_MAX}`);
  }
  if (pageSize === null || pageSize < 1 || pageSize > MODIFIER_PAGE_SIZE_MAX) {
    problems.push(`pageSize: entre 1 y ${MODIFIER_PAGE_SIZE_MAX}`);
  }
  return { page: page ?? 1, pageSize: pageSize ?? 20 };
}

// ── Errores de negocio ─────────────────────────────────────────────────────────────────────

function groupNotFound(): never {
  return failCode(404, 'MODIFIER_GROUP_NOT_FOUND', 'Grupo de modificadores no encontrado');
}
const groupNameTaken = () =>
  failCode(409, 'MODIFIER_GROUP_NAME_TAKEN', 'Ya existe un grupo con ese nombre', [
    { path: 'name', code: 'NAME_TAKEN', message: 'El nombre ya está en uso' },
  ]);
const optionNameTaken = () =>
  failCode(409, 'MODIFIER_NAME_TAKEN', 'Ya existe una opción con ese nombre en el grupo', [
    { path: 'name', code: 'NAME_TAKEN', message: 'El nombre ya está en uso' },
  ]);
const limitsInvalid = (message: string) => failCode(422, 'MODIFIER_LIMITS_INVALID', message);

function findGroup(store: MockStore, id: string | undefined): ModifierGroupRecord {
  const group = store.modifierGroups.find((g) => g.id === id);
  if (!group) groupNotFound();
  return group;
}

/** Límites del grupo: coherencia y, si queda ACTIVO, satisfacibilidad (un grupo inactivo no tiene esa restricción). */
function assertLimits(min: number, max: number, active: boolean, activeOptions: number): void {
  if (!areLimitsValid(min, max)) {
    limitsInvalid('Mínimo y máximo no válidos: 0 ≤ mínimo ≤ máximo y máximo entre 1 y 20');
  }
  if (active && min > activeOptions) {
    limitsInvalid(
      'El mínimo supera las opciones activas del grupo: agrega opciones o baja el mínimo',
    );
  }
}

// ── Lectura ────────────────────────────────────────────────────────────────────────────────

/** GET /v1/admin/modifier-groups?q&active&page&pageSize */
export const listAdminModifierGroups: Handler = (req): AdminModifierGroupPage => {
  reader(req);
  const problems: string[] = [];
  const { page, pageSize } = pagination(req, problems);
  const q = req.query.get('q');
  if (q !== null && q.length > MODIFIER_SEARCH_MAX) {
    problems.push(`q: máximo ${MODIFIER_SEARCH_MAX} caracteres`);
  }
  const activeRaw = req.query.get('active');
  if (activeRaw !== null && activeRaw !== 'true' && activeRaw !== 'false') {
    problems.push('active: debe ser true o false');
  }
  if (problems.length > 0) badRequest(problems);
  const needle = q ? foldText(q.trim()) : '';
  const { store } = req;
  const matches = store.modifierGroups
    .filter((g) => activeRaw === null || g.active === (activeRaw === 'true'))
    .filter((g) => !needle || foldText(g.name).includes(needle))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
    );
  const start = (page - 1) * pageSize;
  return {
    items: matches.slice(start, start + pageSize).map((g) => summaryView(store, g)),
    page,
    pageSize,
    total: matches.length,
  };
};

/** GET /v1/admin/modifier-groups/:id */
export const getAdminModifierGroup: Handler = (req): AdminModifierGroup => {
  reader(req);
  return groupView(req.store, findGroup(req.store, req.params.id));
};

/** GET /v1/admin/products/:id/modifiers */
export const getAdminProductModifiers: Handler = (req): AdminProductModifiers => {
  reader(req);
  return productModifiersView(req.store, productOrFail(req.store, req.params.id).id);
};

function productOrFail(store: MockStore, id: string | undefined) {
  const product = store.products.find((p) => p.id === id);
  if (!product) failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  return product;
}

function productModifiersView(store: MockStore, productId: string): AdminProductModifiers {
  const groups = (store.productModifierGroups[productId] ?? [])
    .map((id) => store.modifierGroups.find((g) => g.id === id))
    .filter((g): g is ModifierGroupRecord => Boolean(g))
    .map((g) => groupView(store, g));
  return { productId, groups };
}

// ── Grupos ─────────────────────────────────────────────────────────────────────────────────

interface OptionShape {
  name: string;
  extraPrice: string;
}

/** POST /v1/admin/modifier-groups */
export const createAdminModifierGroup: Handler = (req): AdminModifierGroup => {
  writer(req, 'catalog.create');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['name', 'minSelect', 'maxSelect', 'active', 'options'], problems);
  if (!has(raw, 'name')) problems.push('name: obligatorio');
  const name = has(raw, 'name') ? parseName(raw.name, 'name', problems) : undefined;
  const minSelect = has(raw, 'minSelect') ? parseInteger(raw.minSelect, 'minSelect', problems) : 0;
  const maxSelect = has(raw, 'maxSelect') ? parseInteger(raw.maxSelect, 'maxSelect', problems) : 1;
  const active = has(raw, 'active') ? parseBoolean(raw.active, 'active', problems) : true;
  const options: OptionShape[] = [];
  if (has(raw, 'options')) {
    if (!Array.isArray(raw.options)) problems.push('options: debe ser una lista');
    else {
      if (raw.options.length > MODIFIER_OPTIONS_INPUT_MAX) {
        problems.push(`options: máximo ${MODIFIER_OPTIONS_INPUT_MAX} elementos`);
      }
      raw.options.forEach((item: unknown, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          problems.push(`options[${i}]: debe ser un objeto`);
          return;
        }
        const o = item as Record<string, unknown>;
        unknownKeys(o, ['name', 'extraPrice'], problems);
        const optionName = parseName(o.name, `options[${i}].name`, problems);
        const price = has(o, 'extraPrice')
          ? parsePrice(o.extraPrice, `options[${i}].extraPrice`, problems)
          : '0.00';
        if (optionName !== undefined && price !== undefined) {
          options.push({ name: optionName, extraPrice: price });
        }
      });
    }
  }
  if (problems.length > 0) badRequest(problems);
  const { store } = req;

  if (
    store.modifierGroups.some((g) => modifierNameKey(g.name) === modifierNameKey(name as string))
  ) {
    groupNameTaken();
  }
  if (options.length > MODIFIER_OPTIONS_MAX) {
    failCode(422, 'MODIFIER_LIMIT_REACHED', `Máximo ${MODIFIER_OPTIONS_MAX} opciones por grupo`);
  }
  const keys = new Set<string>();
  for (const o of options) {
    const key = modifierNameKey(o.name);
    if (keys.has(key)) optionNameTaken();
    keys.add(key);
  }
  assertLimits(minSelect as number, maxSelect as number, active as boolean, options.length);
  maybeBusy(store);

  const stamp = now(req).toISOString();
  const group: ModifierGroupRecord = {
    id: `mgroup-${store.sequences.modifierGroup++}`,
    name: name as string,
    minSelect: minSelect as number,
    maxSelect: maxSelect as number,
    active: active as boolean,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.modifierGroups.push(group);
  options.forEach((o, sortOrder) => {
    store.modifiers.push({
      id: `mopt-${store.sequences.modifier++}`,
      groupId: group.id,
      name: o.name,
      extraPrice: o.extraPrice,
      active: true,
      sortOrder,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
  return groupView(store, group);
};

/** PATCH /v1/admin/modifier-groups/:id — parcial; sin cambios => 200 sin tocar. */
export const updateAdminModifierGroup: Handler = (req): AdminModifierGroup => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  if (Object.keys(raw).length === 0) badRequest(['Envía al menos un campo']);
  const problems: string[] = [];
  unknownKeys(raw, ['name', 'minSelect', 'maxSelect', 'active'], problems);
  const name = has(raw, 'name') ? parseName(raw.name, 'name', problems) : undefined;
  const minSelect = has(raw, 'minSelect')
    ? parseInteger(raw.minSelect, 'minSelect', problems)
    : undefined;
  const maxSelect = has(raw, 'maxSelect')
    ? parseInteger(raw.maxSelect, 'maxSelect', problems)
    : undefined;
  const active = has(raw, 'active') ? parseBoolean(raw.active, 'active', problems) : undefined;
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const group = findGroup(store, req.params.id);

  if (
    name !== undefined &&
    name !== group.name &&
    store.modifierGroups.some(
      (g) => g.id !== group.id && modifierNameKey(g.name) === modifierNameKey(name),
    )
  ) {
    groupNameTaken();
  }
  const next = {
    name: name ?? group.name,
    minSelect: minSelect ?? group.minSelect,
    maxSelect: maxSelect ?? group.maxSelect,
    active: active ?? group.active,
  };
  const changed =
    next.name !== group.name ||
    next.minSelect !== group.minSelect ||
    next.maxSelect !== group.maxSelect ||
    next.active !== group.active;
  if (!changed) return groupView(store, group);
  // Desactivar un grupo siempre es posible; lo demás debe dejar límites coherentes y alcanzables.
  if (next.active || next.minSelect !== group.minSelect || next.maxSelect !== group.maxSelect) {
    assertLimits(
      next.minSelect,
      next.maxSelect,
      next.active,
      optionsOf(store, group.id).filter((o) => o.active).length,
    );
  }
  maybeBusy(store);
  Object.assign(group, next, { updatedAt: now(req).toISOString() });
  return groupView(store, group);
};

// ── Opciones ───────────────────────────────────────────────────────────────────────────────

/** POST /v1/admin/modifier-groups/:id/modifiers */
export const createAdminModifier: Handler = (req): AdminModifier => {
  writer(req, 'catalog.create');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['name', 'extraPrice', 'active'], problems);
  if (!has(raw, 'name')) problems.push('name: obligatorio');
  const name = has(raw, 'name') ? parseName(raw.name, 'name', problems) : undefined;
  const extraPrice = has(raw, 'extraPrice')
    ? parsePrice(raw.extraPrice, 'extraPrice', problems)
    : '0.00';
  const active = has(raw, 'active') ? parseBoolean(raw.active, 'active', problems) : true;
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const group = findGroup(store, req.params.id);
  const options = optionsOf(store, group.id);
  if (options.some((o) => modifierNameKey(o.name) === modifierNameKey(name as string))) {
    optionNameTaken();
  }
  if (options.length >= MODIFIER_OPTIONS_MAX) {
    failCode(422, 'MODIFIER_LIMIT_REACHED', `Máximo ${MODIFIER_OPTIONS_MAX} opciones por grupo`);
  }
  maybeBusy(store);
  const stamp = now(req).toISOString();
  const record: ModifierRecord = {
    id: `mopt-${store.sequences.modifier++}`,
    groupId: group.id,
    name: name as string,
    extraPrice: extraPrice as string,
    active: active as boolean,
    sortOrder: options.length === 0 ? 0 : Math.max(...options.map((o) => o.sortOrder)) + 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.modifiers.push(record);
  return modifierView(record);
};

/** PUT /v1/admin/modifier-groups/:id/modifiers/reorder — `orderedIds` = exactamente las opciones del grupo. */
export const reorderAdminModifiers: Handler = (req): AdminModifierList => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['orderedIds'], problems);
  if (!has(raw, 'orderedIds')) problems.push('orderedIds: obligatorio');
  const orderedIds = has(raw, 'orderedIds')
    ? parseIdList(raw.orderedIds, 'orderedIds', MODIFIER_OPTIONS_MAX, problems)
    : [];
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const group = findGroup(store, req.params.id);
  const current = optionsOf(store, group.id);
  const exact =
    orderedIds.length === current.length &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((id) => current.some((o) => o.id === id));
  if (!exact) {
    failCode(
      422,
      'MODIFIER_REORDER_MISMATCH',
      'orderedIds debe contener exactamente las opciones del grupo, sin repetir',
    );
  }
  const unchanged = orderedIds.every((id, i) => current[i]?.id === id);
  if (!unchanged) {
    maybeBusy(store);
    const stamp = now(req).toISOString();
    orderedIds.forEach((id, sortOrder) => {
      const option = current.find((o) => o.id === id) as ModifierRecord;
      if (option.sortOrder !== sortOrder) {
        option.sortOrder = sortOrder;
        option.updatedAt = stamp;
      }
    });
  }
  return { items: optionsOf(store, group.id).map(modifierView) };
};

/** PATCH /v1/admin/modifiers/:id — parcial; sin cambios => 200 sin tocar. */
export const updateAdminModifier: Handler = (req): AdminModifier => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  if (Object.keys(raw).length === 0) badRequest(['Envía al menos un campo']);
  const problems: string[] = [];
  unknownKeys(raw, ['name', 'extraPrice', 'active'], problems);
  const name = has(raw, 'name') ? parseName(raw.name, 'name', problems) : undefined;
  const extraPrice = has(raw, 'extraPrice')
    ? parsePrice(raw.extraPrice, 'extraPrice', problems)
    : undefined;
  const active = has(raw, 'active') ? parseBoolean(raw.active, 'active', problems) : undefined;
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const option = store.modifiers.find((m) => m.id === req.params.id);
  if (!option) failCode(404, 'MODIFIER_NOT_FOUND', 'Opción no encontrada');
  const group = findGroup(store, option.groupId);
  const siblings = optionsOf(store, group.id);

  if (
    name !== undefined &&
    name !== option.name &&
    siblings.some((o) => o.id !== option.id && modifierNameKey(o.name) === modifierNameKey(name))
  ) {
    optionNameTaken();
  }
  const patch: Partial<ModifierRecord> = {};
  if (name !== undefined && name !== option.name) patch.name = name;
  if (extraPrice !== undefined && extraPrice !== option.extraPrice) patch.extraPrice = extraPrice;
  if (active !== undefined && active !== option.active) patch.active = active;
  if (Object.keys(patch).length === 0) return modifierView(option);

  if (patch.active === false && group.active) {
    const remaining = siblings.filter((o) => o.id !== option.id && o.active).length;
    if (remaining < group.minSelect) {
      failCode(
        422,
        'MODIFIER_GROUP_UNSATISFIABLE',
        'Desactivar esta opción dejaría el grupo con menos opciones activas que su mínimo',
      );
    }
  }
  maybeBusy(store);
  Object.assign(option, patch, { updatedAt: now(req).toISOString() });
  return modifierView(option);
};

// ── Asociación producto–grupo ──────────────────────────────────────────────────────────────

/** PUT /v1/admin/products/:id/modifier-groups — REEMPLAZA la lista (≤ 10). Devuelve el estado resultante. */
export const replaceAdminProductModifierGroups: Handler = (req): AdminProductModifiers => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  const problems: string[] = [];
  unknownKeys(raw, ['groupIds'], problems);
  if (!has(raw, 'groupIds')) problems.push('groupIds: obligatorio');
  const groupIds = has(raw, 'groupIds')
    ? parseIdList(raw.groupIds, 'groupIds', PRODUCT_MODIFIER_GROUPS_INPUT_MAX, problems)
    : [];
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const product = productOrFail(store, req.params.id);
  if (groupIds.length > PRODUCT_MODIFIER_GROUPS_MAX) {
    failCode(
      422,
      'MODIFIER_LIMIT_REACHED',
      `Máximo ${PRODUCT_MODIFIER_GROUPS_MAX} grupos por producto`,
    );
  }
  if (new Set(groupIds).size !== groupIds.length) {
    failCode(422, 'MODIFIER_GROUP_INVALID', 'La lista de grupos tiene duplicados');
  }
  const current = store.productModifierGroups[product.id] ?? [];
  for (const id of groupIds) {
    if (current.includes(id)) continue; // un grupo ya asociado que luego se desactivó puede permanecer
    const group = store.modifierGroups.find((g) => g.id === id);
    if (!group || !group.active) {
      failCode(422, 'MODIFIER_GROUP_INVALID', 'Algún grupo no existe o está inactivo', [
        { path: 'groupIds', code: 'GROUP_INVALID', message: id },
      ]);
    }
  }
  const unchanged =
    groupIds.length === current.length && groupIds.every((id, i) => current[i] === id);
  if (!unchanged) {
    maybeBusy(store);
    if (groupIds.length === 0) delete store.productModifierGroups[product.id];
    else store.productModifierGroups[product.id] = [...groupIds];
  }
  return productModifiersView(store, product.id);
};
