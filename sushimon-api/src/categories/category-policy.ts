import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { codedException } from '../common/errors/coded-exception.js';
import { SLUG_MAX, SLUG_PATTERN, slugifyText, uniqueSlug } from '../common/text/slug.js';
import type {
  AdminCategoryFilter,
  AdminCategoryView,
  CategoryNode,
  CategoryRow,
  CategoryUsage,
  PublicCategoryView,
} from './categories.types.js';

/** Reglas de dominio de categorías: funciones puras, sin I/O (spec F10 D1-D7). */

export const MAX_DEPTH = 3;
export const MAX_CATEGORIES = 500;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;
export { SLUG_MAX, SLUG_PATTERN, uniqueSlug };
/** `audit_events.entity_id` es uuid NOT NULL: el reorden de raíces (sin padre) usa el UUID nulo. */
export const ROOT_AUDIT_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

const fail = (message: string): never => {
  throw new BadRequestException([message]);
};

const unprocessable = (code: string, message: string) =>
  codedException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);

export const slugTaken = () =>
  codedException(
    HttpStatus.CONFLICT,
    'CATEGORY_SLUG_TAKEN',
    'Ya existe una categoría con ese slug',
  );

// ---------- borrado (ADR-0034) ----------

export const isUnused = (u: CategoryUsage): boolean => u.children + u.products + u.banners === 0;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** 409 `CATEGORY_IN_USE` (`CategoryInUseError`): mensaje con conteos, sin nombres ni ids; `usage` siempre presente. */
export function categoryInUse(usage: CategoryUsage): HttpException {
  const parts = [
    usage.children > 0 ? plural(usage.children, 'subcategoría', 'subcategorías') : null,
    usage.products > 0 ? plural(usage.products, 'producto', 'productos') : null,
    usage.banners > 0 ? plural(usage.banners, 'banner', 'banners') : null,
  ].filter((p): p is string => p !== null);
  return new HttpException(
    {
      message: `La categoría está en uso (${parts.join(', ')}). Mueve o elimina esos elementos, o desactívala en su lugar`,
      code: 'CATEGORY_IN_USE',
      extra: { usage: { ...usage } },
    },
    HttpStatus.CONFLICT,
  );
}

// ---------- normalización ----------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function normalizeName(raw: string): string {
  const name = raw.normalize('NFC').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (name === '') return fail('name no puede estar vacío');
  if (name.length > NAME_MAX) return fail(`name no puede superar ${NAME_MAX} caracteres`);
  return name;
}

/** Vacío/null = sin descripción. Conserva saltos de línea; quita el resto de caracteres de control. */
export function normalizeDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
  if (text === '') return null;
  if (text.length > DESCRIPTION_MAX)
    return fail(`description no puede superar ${DESCRIPTION_MAX} caracteres`);
  return text;
}

export function normalizeSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (slug === '' || slug.length > SLUG_MAX)
    return fail(`slug debe tener entre 1 y ${SLUG_MAX} caracteres`);
  if (!SLUG_PATTERN.test(slug))
    return fail('slug solo admite minúsculas, números y guiones simples entre grupos');
  return slug;
}

/** Minúsculas, sin acentos, kebab, ≤ 80. Nombre sin caracteres útiles => `categoria`. */
export const slugify = (name: string): string => slugifyText(name, 'categoria');

export function assertSlugFree(slug: string, rows: readonly CategoryNode[], selfId?: string): void {
  if (rows.some((r) => r.slug === slug && r.id !== selfId)) throw slugTaken();
}

// ---------- orden y árbol ----------

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/** Orden estable entre hermanos: sort_order, name, id. */
export function compareSiblings(a: CategoryNode, b: CategoryNode): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const byName =
    collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function childrenIndex<T extends CategoryNode>(rows: readonly T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const row of rows) {
    const list = map.get(row.parentId);
    if (list) list.push(row);
    else map.set(row.parentId, [row]);
  }
  for (const list of map.values()) list.sort(compareSiblings);
  return map;
}

export const indexById = <T extends CategoryNode>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

/** Nivel de la categoría (raíz = 1). Con datos corruptos (ciclo) se corta en `MAX_DEPTH + 7`. */
export function depthOf(id: string, byId: ReadonlyMap<string, CategoryNode>): number {
  let depth = 0;
  let cursor: string | null = id;
  while (cursor !== null && depth < MAX_DEPTH + 7) {
    const node = byId.get(cursor);
    if (!node) break;
    depth += 1;
    cursor = node.parentId;
  }
  return depth;
}

/** Altura del subárbol (la propia categoría = 1). */
export function subtreeHeight(
  id: string,
  children: ReadonlyMap<string | null, readonly CategoryNode[]>,
): number {
  let height = 1;
  const stack: { id: string; level: number }[] = [{ id, level: 1 }];
  while (stack.length > 0) {
    const { id: current, level } = stack.pop() as { id: string; level: number };
    height = Math.max(height, level);
    if (level > MAX_DEPTH + 7) break;
    for (const child of children.get(current) ?? []) stack.push({ id: child.id, level: level + 1 });
  }
  return height;
}

/** ¿`candidateId` es `id` o cuelga de `id`? */
export function isSelfOrDescendant(
  candidateId: string,
  id: string,
  byId: ReadonlyMap<string, CategoryNode>,
): boolean {
  let cursor: string | null = candidateId;
  for (let i = 0; cursor !== null && i < MAX_DEPTH + 7; i += 1) {
    if (cursor === id) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** Posición al final de los hermanos (max + 1; 0 si no hay), sin contar `excludeId`. */
export function nextSortOrder(
  rows: readonly CategoryNode[],
  parentId: string | null,
  excludeId?: string,
): number {
  let max = -1;
  for (const r of rows)
    if (r.parentId === parentId && r.id !== excludeId) max = Math.max(max, r.sortOrder);
  return max + 1;
}

// ---------- validaciones de jerarquía ----------

export function assertLimit(count: number): void {
  if (count >= MAX_CATEGORIES)
    throw unprocessable(
      'CATEGORY_LIMIT_REACHED',
      `Se alcanzó el máximo de ${MAX_CATEGORIES} categorías`,
    );
}

/**
 * Destino válido para colgar una categoría (alta o movimiento). `movingId` = categoría que se mueve (undefined en altas;
 * `movingHeight` = altura de su subárbol, 1 en altas). Orden: inexistente → ciclo → inactivo → profundidad.
 */
export function assertParentAllowed(
  parentId: string,
  byId: ReadonlyMap<string, CategoryNode>,
  children: ReadonlyMap<string | null, readonly CategoryNode[]>,
  movingId?: string,
): void {
  const parent = byId.get(parentId);
  if (!parent) throw unprocessable('CATEGORY_PARENT_INVALID', 'La categoría padre no existe');
  if (movingId !== undefined && isSelfOrDescendant(parentId, movingId, byId))
    throw unprocessable(
      'CATEGORY_CYCLE',
      'Una categoría no puede ser hija de sí misma ni de sus descendientes',
    );
  if (!parent.active)
    throw unprocessable('CATEGORY_PARENT_INVALID', 'La categoría padre está inactiva');
  const height = movingId === undefined ? 1 : subtreeHeight(movingId, children);
  if (depthOf(parentId, byId) + height > MAX_DEPTH)
    throw unprocessable(
      'CATEGORY_DEPTH_EXCEEDED',
      `El menú admite como máximo ${MAX_DEPTH} niveles de categorías`,
    );
}

/** `orderedIds` debe ser EXACTAMENTE el conjunto de hermanos (sin duplicados ni ajenos). */
export function assertReorderExact(
  siblingIds: readonly string[],
  orderedIds: readonly string[],
): void {
  const expected = new Set(siblingIds);
  const given = new Set(orderedIds);
  const exact =
    given.size === orderedIds.length &&
    given.size === expected.size &&
    orderedIds.every((id) => expected.has(id));
  if (!exact)
    throw unprocessable(
      'CATEGORY_REORDER_MISMATCH',
      'orderedIds debe contener exactamente los hermanos actuales, sin repetidos',
    );
}

// ---------- vistas ----------

export function buildVisibleTree(rows: readonly CategoryNode[]): PublicCategoryView[] {
  const children = childrenIndex(rows);
  const build = (node: CategoryNode, level: number): PublicCategoryView => ({
    id: node.id,
    slug: node.slug,
    name: node.name,
    description: node.description,
    children:
      level >= MAX_DEPTH
        ? []
        : (children.get(node.id) ?? []).filter((c) => c.active).map((c) => build(c, level + 1)),
  });
  return (children.get(null) ?? []).filter((r) => r.active).map((r) => build(r, 1));
}

/** Todas las categorías, depth-first (el orden en que se pintaría el árbol), con nivel y visibilidad efectiva. */
export function buildAdminViews(rows: readonly CategoryRow[]): AdminCategoryView[] {
  const children = childrenIndex(rows);
  const out: AdminCategoryView[] = [];
  const visit = (row: CategoryRow, depth: number, parentVisible: boolean): void => {
    const visible = parentVisible && row.active;
    out.push({
      id: row.id,
      parentId: row.parentId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      active: row.active,
      effectivelyVisible: visible,
      depth,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    if (depth > MAX_DEPTH + 7) return;
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1, visible);
  };
  for (const root of children.get(null) ?? []) visit(root, 1, true);
  return out;
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function filterAdminViews(
  views: readonly AdminCategoryView[],
  filter: AdminCategoryFilter,
): AdminCategoryView[] {
  const q = filter.q?.trim() ? fold(filter.q.trim()) : null;
  return views
    .filter((v) => (filter.active === undefined ? true : v.active === filter.active))
    .filter((v) => (filter.parentId === undefined ? true : v.parentId === filter.parentId))
    .filter((v) => (q === null ? true : fold(v.name).includes(q) || v.slug.includes(q)))
    .slice(0, MAX_CATEGORIES);
}

/** Ids visibles (ella y todos sus ancestros activos). Con `rootId`: solo ese subárbol (incluida la raíz). */
export function visibleIds(rows: readonly CategoryNode[], rootId?: string): string[] {
  const out: string[] = [];
  const walk = (list: readonly PublicCategoryView[]): void => {
    for (const node of list) {
      out.push(node.id);
      walk(node.children);
    }
  };
  const tree = buildVisibleTree(rows);
  if (rootId === undefined) {
    walk(tree);
    return out;
  }
  const find = (list: readonly PublicCategoryView[]): PublicCategoryView | null => {
    for (const node of list) {
      if (node.id === rootId) return node;
      const inner = find(node.children);
      if (inner) return inner;
    }
    return null;
  };
  const root = find(tree);
  if (root) walk([root]);
  return out;
}

// ---------- actualización ----------

export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  active?: boolean;
}

export interface NormalizedUpdate {
  name?: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  active?: boolean;
}

/** Normaliza lo enviado; un cuerpo sin ningún campo es 400. */
export function normalizeUpdate(input: UpdateCategoryInput): NormalizedUpdate {
  const out: NormalizedUpdate = {};
  if (input.name !== undefined) out.name = normalizeName(input.name);
  if (input.slug !== undefined) out.slug = normalizeSlug(input.slug);
  if (input.description !== undefined) out.description = normalizeDescription(input.description);
  if (input.parentId !== undefined) out.parentId = input.parentId;
  if (input.active !== undefined) out.active = input.active;
  if (Object.keys(out).length === 0) return fail('Debe enviar al menos un campo a modificar');
  return out;
}

export interface CategoryDiff {
  /** Campos a escribir (sin `sortOrder`: lo añade el servicio al mover). */
  changes: NormalizedUpdate;
  oldValues: AuditValues;
  newValues: AuditValues;
}

/** Solo lo que cambia de verdad; `null` si nada cambia. `active` no entra en old/new (tiene eventos propios). */
export function diffCategory(current: CategoryNode, patch: NormalizedUpdate): CategoryDiff | null {
  const changes: NormalizedUpdate = {};
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  const keys = ['name', 'slug', 'description', 'parentId'] as const;
  for (const key of keys) {
    const next = patch[key];
    if (next !== undefined && next !== current[key]) {
      (changes as Record<string, unknown>)[key] = next;
      oldValues[key] = current[key];
      newValues[key] = next;
    }
  }
  if (patch.active !== undefined && patch.active !== current.active) changes.active = patch.active;
  return Object.keys(changes).length === 0 ? null : { changes, oldValues, newValues };
}
