/** Fila de producto tal como la usan servicios y vistas (precio ya como cadena decimal exacta). */
export interface ProductRow {
  id: string;
  sku: string | null;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePrice: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaRow {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface MediaInput {
  url: string;
  altText: string | null;
}

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
}

export interface PublicProductMediaView {
  url: string;
  altText: string | null;
}

export interface PublicProductView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePrice: string;
  category: CategoryRef;
  media: PublicProductMediaView[];
}

export interface PublicProductDetailView extends PublicProductView {
  categoryAncestors: CategoryRef[];
}

export interface PublicProductPageView {
  items: PublicProductView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminProductCategoryView extends CategoryRef {
  active: boolean;
  effectivelyVisible: boolean;
}

export interface AdminProductMediaView {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

export interface AdminProductView {
  id: string;
  sku: string | null;
  slug: string;
  name: string;
  description: string | null;
  basePrice: string;
  categoryId: string;
  category: AdminProductCategoryView;
  active: boolean;
  publiclyVisible: boolean;
  media: AdminProductMediaView[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductPageView {
  items: AdminProductView[];
  page: number;
  pageSize: number;
  total: number;
}

/** Resumen mínimo de un producto visible (puerto de favoritos y futuros consumidores). */
export interface VisibleProductSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  categoryId: string;
}

export type ProductSort = 'name' | 'basePrice' | 'createdAt';
export type SortOrder = 'asc' | 'desc';

/** Filtros ya normalizados que entiende el repositorio. `pattern` es un patrón LIKE ya escapado y plegado. */
export interface ProductPageFilter {
  /** `undefined` = sin filtro; un arreglo (posiblemente vacío) restringe a esas categorías. */
  categoryIds?: readonly string[];
  active?: boolean;
  pattern?: string | null;
  /** Solo backoffice: incluye el slug en la búsqueda. */
  searchSlug?: boolean;
  /** Solo backoffice: incluye el SKU en la búsqueda (la búsqueda pública NUNCA busca por SKU). */
  searchSku?: boolean;
  sort: ProductSort;
  order: SortOrder;
  page: number;
  pageSize: number;
}

export interface NewProductData {
  sku: string | null;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePrice: string;
  active: boolean;
}

export interface ProductPatch {
  sku?: string | null;
  categoryId?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  basePrice?: string;
  active?: boolean;
  updatedAt: Date;
}
