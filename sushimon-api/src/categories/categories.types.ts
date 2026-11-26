/** Fila mínima para armar el árbol público (selects mínimos: nada administrativo). */
export interface CategoryNode {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

/** Fila completa (backoffice y escrituras). */
export interface CategoryRow extends CategoryNode {
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicCategoryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  children: PublicCategoryView[];
}

export interface AdminCategoryView {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  effectivelyVisible: boolean;
  depth: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCategoryListView {
  items: AdminCategoryView[];
  total: number;
}

export interface AdminCategoryFilter {
  active?: boolean;
  parentId?: string;
  q?: string;
}

/** Para F11/F17: categoría visible con su cadena de ancestros (raíz → padre) y sus hijas visibles. */
export interface VisibleCategoryDetail {
  category: PublicCategoryView;
  ancestors: { id: string; slug: string; name: string }[];
}

export interface NewCategoryData {
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface CategoryPatch {
  parentId?: string | null;
  slug?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
  updatedAt: Date;
}

/** Qué impide borrar una categoría (ADR-0034): solo conteos, nunca nombres ni ids. */
export interface CategoryUsage {
  children: number;
  products: number;
  banners: number;
}
