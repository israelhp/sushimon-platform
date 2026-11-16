/** Fila de `app.branch_products` tal como la usan servicios y vistas (precio como cadena decimal exacta). */
export interface BranchProductRow {
  priceOverride: string | null;
  available: boolean;
  updatedAt: Date;
}

export interface BranchStatus {
  id: string;
  active: boolean;
}

/** Datos del producto necesarios para calcular precio y visibilidad. */
export interface ProductFacts {
  id: string;
  basePrice: string;
  active: boolean;
  categoryId: string;
}

/** Estado de un producto en una sucursal (contrato: `AdminBranchProductState`). */
export interface BranchProductStateView {
  branchId: string;
  productId: string;
  basePrice: string;
  priceOverride: string | null;
  effectivePrice: string;
  available: boolean;
  offered: boolean;
  updatedAt: string | null;
}

export interface AdminBranchProductRowView extends BranchProductStateView {
  sku: string | null;
  slug: string;
  name: string;
  category: {
    id: string;
    slug: string;
    name: string;
    active: boolean;
    effectivelyVisible: boolean;
  };
  active: boolean;
  publiclyVisible: boolean;
}

export interface AdminBranchProductPageView {
  branchId: string;
  items: AdminBranchProductRowView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminProductBranchRowView extends BranchProductStateView {
  branchCode: string;
  branchName: string;
  branchActive: boolean;
}

export interface AdminProductBranchesView {
  productId: string;
  basePrice: string;
  active: boolean;
  publiclyVisible: boolean;
  items: AdminProductBranchRowView[];
}

export interface StoreBranchMenuItemView {
  productId: string;
  slug: string;
  price: string;
  available: boolean;
}

export interface StoreBranchMenuView {
  branchId: string;
  items: StoreBranchMenuItemView[];
}

/** Fila cruda de la matriz por sucursal (productos LEFT JOIN branch_products). */
export interface MatrixRow {
  id: string;
  sku: string | null;
  slug: string;
  name: string;
  categoryId: string;
  active: boolean;
  basePrice: string;
  priceOverride: string | null;
  available: boolean;
  updatedAt: Date | null;
}

export interface MatrixFilter {
  categoryId?: string;
  available?: boolean;
  hasOverride?: boolean;
  /** Patrón LIKE ya escapado y plegado (`buildSearchPattern`). */
  pattern: string | null;
  page: number;
  pageSize: number;
}

/** Fila cruda de la matriz por producto (sucursales LEFT JOIN branch_products). */
export interface ProductBranchRow {
  branchId: string;
  code: string;
  name: string;
  active: boolean;
  priceOverride: string | null;
  available: boolean;
  updatedAt: Date | null;
}

export interface OverlayRow {
  id: string;
  slug: string;
  price: string;
  available: boolean;
}

/** Resultado de `resolve`/`assertOrderable` para un producto existente. */
export interface BranchOffer {
  price: string;
  basePrice: string;
  available: boolean;
}

export interface ResolveRow {
  id: string;
  active: boolean;
  categoryId: string;
  basePrice: string;
  price: string;
  available: boolean;
}
