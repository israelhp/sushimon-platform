import type {
  AdminCategory,
  AdminCategoryList,
  PublicCategoryTree,
} from '@/lib/data-access/models';
import {
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  CATEGORY_SLUG_MAX,
  CATEGORY_SLUG_PATTERN,
  MAX_CATEGORIES,
  MAX_CATEGORY_DEPTH,
  childrenOf,
  depthOf,
  flattenTree,
  hasControlChars,
  isEffectivelyVisible,
  normalizeCategoryName,
  publicTree,
  slugifyCategoryName,
  uniqueSlug,
  validateMove,
} from '@/lib/category-tree';
import { badRequest, fail, failCode } from '../domain';
import type { CategoryRecord } from '../fixtures/categories';
import type { MockStore } from '../store';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F10 — Categorías y jerarquía del menú (spec 011). El mock EMULA al servidor: lectura pública solo de categorías
 * visibles (ella y todos sus ancestros activos), lista admin plana depth-first con `depth`/`effectivelyVisible`, 400 de forma
 * (propiedades desconocidas, cuerpo vacío en PATCH, nombre/slug/descripción inválidos), 404, 409 `CATEGORY_SLUG_TAKEN`, 422
 * `CATEGORY_CYCLE` | `CATEGORY_DEPTH_EXCEEDED` | `CATEGORY_PARENT_INVALID` | `CATEGORY_REORDER_MISMATCH` |
 * `CATEGORY_LIMIT_REACHED`, permisos `catalog.read|create|update` y 403 en escrituras sin alcance GLOBAL (las categorías no
 * pertenecen a una sucursal). NO simula auditoría, cabeceras de caché ni la forma UUID (los ids del mock son legibles).
 * Sin DELETE: solo se desactiva.
 */

// ── Vistas ─────────────────────────────────────────────────────────────────────────────────

/** Registro + `depth` y `effectivelyVisible` calculados sobre TODO el árbol. */
function views(records: readonly CategoryRecord[]): AdminCategory[] {
  return flattenTree(records).map(({ node, depth, effectivelyVisible }) => ({
    ...node,
    depth,
    effectivelyVisible,
  }));
}

const viewOf = (store: MockStore, id: string): AdminCategory => {
  const found = views(store.menuCategories).find((c) => c.id === id);
  if (!found) fail(404, 'Categoría no encontrada');
  return found;
};

// ── Autorización ───────────────────────────────────────────────────────────────────────────

/** Lectura: `catalog.read` con cualquier alcance. */
const reader = (req: Req) => requireStaff(req, 'catalog.read');

/** Escritura: permiso + alcance GLOBAL (403 si solo tiene sucursales). */
function writer(req: Req, permission: 'catalog.create' | 'catalog.update'): StaffActor {
  const actor = requireStaff(req, permission);
  if (!actor.scope.allBranches) {
    fail(403, 'Las categorías son globales: se requiere alcance sobre todas las sucursales');
  }
  return actor;
}

// ── Validación de forma (400) ──────────────────────────────────────────────────────────────

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

const has = (raw: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(raw, key);

interface Shape {
  name?: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  active?: boolean;
}

function parseShape(raw: Record<string, unknown>, allowed: readonly string[]): Shape {
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) problems.push(`${key}: campo no permitido`);
  }
  const out: Shape = {};
  if (has(raw, 'name')) {
    if (typeof raw.name !== 'string') problems.push('name: debe ser texto');
    else {
      const name = normalizeCategoryName(raw.name);
      if (name.length < 1 || name.length > CATEGORY_NAME_MAX) {
        problems.push(`name: entre 1 y ${CATEGORY_NAME_MAX} caracteres`);
      } else out.name = name;
    }
  }
  if (has(raw, 'slug')) {
    if (
      typeof raw.slug !== 'string' ||
      raw.slug.length > CATEGORY_SLUG_MAX ||
      !CATEGORY_SLUG_PATTERN.test(raw.slug)
    ) {
      problems.push('slug: minúsculas, números y guiones (p. ej. "rolls-frios"), máx. 80');
    } else out.slug = raw.slug;
  }
  if (has(raw, 'description')) {
    const d = raw.description;
    if (d !== null && typeof d !== 'string') problems.push('description: debe ser texto o null');
    else if (typeof d === 'string' && (d.length > CATEGORY_DESCRIPTION_MAX || hasControlChars(d))) {
      problems.push(`description: máximo ${CATEGORY_DESCRIPTION_MAX} caracteres, sin control`);
    } else out.description = typeof d === 'string' ? d.trim() || null : null;
  }
  if (has(raw, 'parentId')) {
    if (raw.parentId !== null && typeof raw.parentId !== 'string') {
      problems.push('parentId: debe ser un identificador o null');
    } else out.parentId = raw.parentId as string | null;
  }
  if (has(raw, 'active')) {
    if (typeof raw.active !== 'boolean') problems.push('active: debe ser booleano');
    else out.active = raw.active;
  }
  if (problems.length > 0) badRequest(problems);
  return out;
}

const slugTaken = () =>
  failCode(409, 'CATEGORY_SLUG_TAKEN', 'Ya existe una categoría con ese slug', [
    { path: 'slug', code: 'SLUG_TAKEN', message: 'El slug ya está en uso' },
  ]);

const nextSort = (store: MockStore, parentId: string | null) => {
  const siblings = store.menuCategories.filter((c) => c.parentId === parentId);
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((c) => c.sortOrder)) + 1;
};

const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Lectura ────────────────────────────────────────────────────────────────────────────────

/** GET /v1/store/categories — público: solo visibles, anidadas y ordenadas. */
export const listStoreCategories: Handler = (req): PublicCategoryTree => ({
  items: publicTree(req.store.menuCategories),
});

/** GET /v1/admin/categories?active&parentId&q — plana, depth-first (los filtros no reordenan). */
export const listAdminCategories: Handler = (req): AdminCategoryList => {
  reader(req);
  const problems: string[] = [];
  const activeRaw = req.query.get('active');
  if (activeRaw !== null && activeRaw !== 'true' && activeRaw !== 'false') {
    problems.push('active: debe ser true o false');
  }
  const q = req.query.get('q');
  if (q !== null && q.length > CATEGORY_NAME_MAX) problems.push(`q: máximo ${CATEGORY_NAME_MAX}`);
  if (problems.length > 0) badRequest(problems);
  const parentId = req.query.get('parentId');
  const needle = q ? foldText(q.trim()) : '';
  const items = views(req.store.menuCategories)
    .filter((c) => activeRaw === null || c.active === (activeRaw === 'true'))
    .filter((c) => parentId === null || c.parentId === parentId)
    .filter((c) => !needle || foldText(c.name).includes(needle) || c.slug.includes(needle))
    .slice(0, MAX_CATEGORIES);
  return { items, total: items.length };
};

// ── Escritura ──────────────────────────────────────────────────────────────────────────────

/** POST /v1/admin/categories */
export const createAdminCategory: Handler = (req): AdminCategory => {
  writer(req, 'catalog.create');
  const raw = rawBody(req);
  const input = parseShape(raw, ['name', 'slug', 'description', 'parentId', 'active']);
  if (input.name === undefined) badRequest(['name: obligatorio']);
  const { store } = req;
  if (store.menuCategories.length >= MAX_CATEGORIES) {
    failCode(422, 'CATEGORY_LIMIT_REACHED', `Se alcanzó el máximo de ${MAX_CATEGORIES} categorías`);
  }
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const parent = store.menuCategories.find((c) => c.id === parentId);
    if (!parent || !isEffectivelyVisible(store.menuCategories, parentId)) {
      failCode(422, 'CATEGORY_PARENT_INVALID', 'La categoría padre no existe o está inactiva');
    }
    if (depthOf(store.menuCategories, parentId) + 1 > MAX_CATEGORY_DEPTH) {
      failCode(
        422,
        'CATEGORY_DEPTH_EXCEEDED',
        `Máximo ${MAX_CATEGORY_DEPTH} niveles de categorías`,
      );
    }
  }
  const taken = new Set(store.menuCategories.map((c) => c.slug));
  let slug: string;
  if (input.slug !== undefined) {
    if (taken.has(input.slug)) slugTaken();
    slug = input.slug;
  } else {
    slug = uniqueSlug(
      slugifyCategoryName(input.name) || `categoria-${store.sequences.menuCategory}`,
      taken,
    );
  }
  const stamp = now(req).toISOString();
  const record: CategoryRecord = {
    id: `cat-${slug}-${store.sequences.menuCategory}`,
    parentId,
    slug,
    name: input.name,
    description: input.description ?? null,
    sortOrder: nextSort(store, parentId),
    active: input.active ?? true,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.sequences.menuCategory++;
  store.menuCategories.push(record);
  return viewOf(store, record.id);
};

/** PATCH /v1/admin/categories/:id — nombre, slug, descripción, mover y activar/desactivar; sin cambios => 200 sin tocar. */
export const updateAdminCategory: Handler = (req): AdminCategory => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  if (Object.keys(raw).length === 0) badRequest(['Envía al menos un campo']);
  const input = parseShape(raw, ['name', 'slug', 'description', 'parentId', 'active']);
  const { store } = req;
  const current = store.menuCategories.find((c) => c.id === req.params.id);
  if (!current) fail(404, 'Categoría no encontrada');

  const patch: Partial<CategoryRecord> = {};
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name;
  if (input.description !== undefined && input.description !== current.description) {
    patch.description = input.description;
  }
  if (input.active !== undefined && input.active !== current.active) patch.active = input.active;
  if (input.slug !== undefined && input.slug !== current.slug) {
    if (store.menuCategories.some((c) => c.id !== current.id && c.slug === input.slug)) slugTaken();
    patch.slug = input.slug;
  }
  if (input.parentId !== undefined && input.parentId !== current.parentId) {
    const problem = validateMove(store.menuCategories, current.id, input.parentId);
    if (problem === 'CATEGORY_CYCLE') {
      failCode(
        422,
        problem,
        'No puedes mover una categoría dentro de sí misma o de sus subcategorías',
      );
    }
    if (problem === 'CATEGORY_DEPTH_EXCEEDED') {
      failCode(422, problem, `Máximo ${MAX_CATEGORY_DEPTH} niveles de categorías`);
    }
    if (problem === 'CATEGORY_PARENT_INVALID') {
      failCode(422, problem, 'La categoría padre no existe o está inactiva');
    }
    patch.parentId = input.parentId;
    patch.sortOrder = nextSort(store, input.parentId);
  }
  if (Object.keys(patch).length > 0) {
    Object.assign(current, patch, { updatedAt: now(req).toISOString() });
  }
  return viewOf(store, current.id);
};

/** PUT /v1/admin/categories/reorder — EXACTAMENTE los hermanos actuales; idempotente; devuelve los hermanos ordenados. */
export const reorderAdminCategories: Handler = (req): AdminCategoryList => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (key !== 'parentId' && key !== 'orderedIds') problems.push(`${key}: campo no permitido`);
  }
  if (!has(raw, 'parentId') || (raw.parentId !== null && typeof raw.parentId !== 'string')) {
    problems.push('parentId: obligatorio (identificador o null)');
  }
  const ids = raw.orderedIds;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_CATEGORIES ||
    !ids.every((id) => typeof id === 'string')
  ) {
    problems.push(`orderedIds: lista de identificadores (máx. ${MAX_CATEGORIES})`);
  }
  if (problems.length > 0) badRequest(problems);
  const parentId = raw.parentId as string | null;
  const orderedIds = ids as string[];
  const { store } = req;
  if (parentId !== null && !store.menuCategories.some((c) => c.id === parentId)) {
    fail(404, 'Categoría padre no encontrada');
  }
  const siblings = childrenOf(store.menuCategories, parentId);
  const sameSet =
    orderedIds.length === siblings.length &&
    new Set(orderedIds).size === orderedIds.length &&
    siblings.every((s) => orderedIds.includes(s.id));
  if (!sameSet) {
    failCode(
      422,
      'CATEGORY_REORDER_MISMATCH',
      'La lista debe contener exactamente las categorías hermanas actuales, sin repetir',
    );
  }
  const stamp = now(req).toISOString();
  orderedIds.forEach((id, index) => {
    const record = store.menuCategories.find((c) => c.id === id);
    if (record && record.sortOrder !== index) {
      record.sortOrder = index;
      record.updatedAt = stamp;
    }
  });
  const all = views(store.menuCategories);
  const items = orderedIds.flatMap((id) => all.find((c) => c.id === id) ?? []);
  return { items, total: items.length };
};
