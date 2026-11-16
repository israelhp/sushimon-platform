import type { AdminCategory, PublicCategory } from '@/lib/data-access/models';

/**
 * F10 — Reglas puras de la jerarquía de categorías (spec 011). Las usa el adaptador mock para emular al servidor y la
 * UI para calcular opciones/estados cosméticos; la autoridad es siempre la API (que además tiene trigger anti-ciclo en BD).
 */
export const MAX_CATEGORY_DEPTH = 3;
export const MAX_CATEGORIES = 500;
export const CATEGORY_NAME_MAX = 80;
export const CATEGORY_SLUG_MAX = 80;
export const CATEGORY_DESCRIPTION_MAX = 500;
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Mínimo que necesitan las reglas (lo cumplen `AdminCategory` y el registro del mock). */
export interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  active: boolean;
}

/** Nombre normalizado como el servidor: NFC, sin caracteres de control, espacios colapsados y recortados. */
export function normalizeCategoryName(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** Slug base desde un nombre: minúsculas, sin acentos, kebab, ≤ 80. Vacío si no queda nada utilizable. */
export function slugifyCategoryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATEGORY_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** Desambigua con `-2`, `-3`… respetando el máximo de 80 caracteres. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, CATEGORY_SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Orden estable de hermanos: `sortOrder`, luego `name`, luego `id`. */
export function compareSiblings(a: TreeNode, b: TreeNode): number {
  return (
    a.sortOrder - b.sortOrder ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function childrenOf<T extends TreeNode>(nodes: readonly T[], parentId: string | null): T[] {
  return nodes.filter((n) => n.parentId === parentId).sort(compareSiblings);
}

/** Cadena de ancestros (del padre hacia la raíz). Se corta ante un ciclo corrupto para no iterar sin fin. */
export function ancestorsOf<T extends TreeNode>(nodes: readonly T[], id: string): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: T[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id);
  while (current?.parentId && !seen.has(current.parentId)) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    chain.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  return chain;
}

/** Nivel de una categoría (raíz = 1). */
export const depthOf = (nodes: readonly TreeNode[], id: string): number =>
  ancestorsOf(nodes, id).length + 1;

/** Ids de todos los descendientes (sin incluir la propia categoría). */
export function descendantIds(nodes: readonly TreeNode[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const n of nodes) {
      if (n.parentId === current && !out.has(n.id) && n.id !== id) {
        out.add(n.id);
        stack.push(n.id);
      }
    }
  }
  return out;
}

/** Altura del subárbol que cuelga de `id` incluyéndola (hoja = 1). */
export function subtreeHeight(nodes: readonly TreeNode[], id: string): number {
  const walk = (current: string, seen: Set<string>): number => {
    let deepest = 0;
    for (const n of nodes) {
      if (n.parentId === current && !seen.has(n.id)) {
        deepest = Math.max(deepest, walk(n.id, new Set([...seen, n.id])));
      }
    }
    return deepest + 1;
  };
  return walk(id, new Set([id]));
}

/** Activa y con TODOS sus ancestros activos (lo que ve el público). */
export function isEffectivelyVisible(nodes: readonly TreeNode[], id: string): boolean {
  const self = nodes.find((n) => n.id === id);
  return Boolean(self?.active) && ancestorsOf(nodes, id).every((a) => a.active);
}

export type MoveError = 'CATEGORY_CYCLE' | 'CATEGORY_DEPTH_EXCEEDED' | 'CATEGORY_PARENT_INVALID';

/**
 * Valida mover `id` bajo `newParentId` (`null` = raíz). Orden: padre inexistente => PARENT_INVALID; ella misma o un
 * descendiente => CYCLE; padre inactivo (o con un ancestro inactivo) => PARENT_INVALID; subárbol resultante > 3 niveles => DEPTH_EXCEEDED.
 */
export function validateMove(
  nodes: readonly TreeNode[],
  id: string,
  newParentId: string | null,
): MoveError | null {
  if (newParentId === null) return null;
  const parent = nodes.find((n) => n.id === newParentId);
  if (!parent) return 'CATEGORY_PARENT_INVALID';
  if (newParentId === id || descendantIds(nodes, id).has(newParentId)) return 'CATEGORY_CYCLE';
  // Spec 011 D3: un hijo activo bajo un padre inactivo (oculto) tampoco admite hijos ni movimientos hacia él.
  if (!isEffectivelyVisible(nodes, newParentId)) return 'CATEGORY_PARENT_INVALID';
  if (depthOf(nodes, newParentId) + subtreeHeight(nodes, id) > MAX_CATEGORY_DEPTH) {
    return 'CATEGORY_DEPTH_EXCEEDED';
  }
  return null;
}

export interface TreeRow<T extends TreeNode> {
  node: T;
  depth: number;
  effectivelyVisible: boolean;
}

/** Recorrido depth-first (hermanos en orden estable) con nivel y visibilidad efectiva. Ignora ciclos corruptos. */
export function flattenTree<T extends TreeNode>(nodes: readonly T[]): TreeRow<T>[] {
  const rows: TreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number, visible: boolean) => {
    for (const node of childrenOf(nodes, parentId)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const effectivelyVisible = visible && node.active;
      rows.push({ node, depth, effectivelyVisible });
      walk(node.id, depth + 1, effectivelyVisible);
    }
  };
  walk(null, 1, true);
  return rows;
}

/** Árbol público anidado (solo visibles) a partir de los registros completos. */
export function publicTree<T extends TreeNode & Pick<PublicCategory, 'slug' | 'description'>>(
  nodes: readonly T[],
): PublicCategory[] {
  const build = (parentId: string | null): PublicCategory[] =>
    childrenOf(nodes, parentId)
      .filter((n) => n.active)
      .map((n) => ({
        id: n.id,
        slug: n.slug,
        name: n.name,
        description: n.description,
        children: build(n.id),
      }));
  return build(null);
}

// ── Utilidades del árbol público (menú) ───────────────────────────────────────────────────────

/** Nodo con su ruta de ancestros (de la raíz hacia él). */
export interface PublicNode {
  category: PublicCategory;
  path: readonly PublicCategory[];
}

export function flattenPublic(
  tree: readonly PublicCategory[],
  path: readonly PublicCategory[] = [],
): PublicNode[] {
  return tree.flatMap((category) => [
    { category, path },
    ...flattenPublic(category.children, [...path, category]),
  ]);
}

/** Busca por slug (o id) en el árbol público. */
export function findPublic(tree: readonly PublicCategory[], key: string | null): PublicNode | null {
  if (!key) return null;
  return flattenPublic(tree).find((n) => n.category.slug === key || n.category.id === key) ?? null;
}

// ── Utilidades del listado admin (UI) ─────────────────────────────────────────────────────────

/** Hermanos (mismo `parentId`) en el orden del listado admin. */
export function siblingsInList(list: readonly AdminCategory[], parentId: string | null) {
  return list.filter((c) => c.parentId === parentId);
}

/** Mueve `id` una posición entre `ids`; null si no hay a dónde moverse. */
export function moveWithin(ids: readonly string[], id: string, dir: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Padres posibles (cosmético: el servidor decide): visibles (activos con todos sus ancestros activos), que no sean ella ni sus descendientes y que no superen
 * la profundidad máxima con su subárbol.
 */
export function parentOptions(
  list: readonly AdminCategory[],
  editingId: string | null,
): AdminCategory[] {
  const height = editingId ? subtreeHeight(list, editingId) : 1;
  const banned = editingId ? descendantIds(list, editingId) : new Set<string>();
  return list.filter(
    (c) =>
      c.id !== editingId &&
      !banned.has(c.id) &&
      c.effectivelyVisible &&
      c.depth + height <= MAX_CATEGORY_DEPTH,
  );
}
