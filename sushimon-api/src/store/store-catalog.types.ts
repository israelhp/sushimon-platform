export type MenuSort = 'menu' | 'name' | 'price';
export type SortDirection = 'asc' | 'desc';

/** Patrones de búsqueda ya plegados y con comodines escapados (ver `buildSearchPatterns`). */
export interface CardSearch {
  contains: string;
  prefix: string;
  /** Ids de categorías visibles cuyo nombre coincide (calculados en memoria con el mismo plegado). */
  categoryIds: readonly string[];
}

/** Filtro ya validado que entiende el repositorio de tarjetas. */
export interface CardFilter {
  /** `null` = sin sucursal: precio base y `available = null`. */
  branchId: string | null;
  /** Categorías visibles permitidas, en el orden del árbol (depth-first): fija también el orden `menu`. */
  categoryIds: readonly string[];
  availableOnly: boolean;
  sort: MenuSort | 'relevance';
  order: SortDirection;
  search: CardSearch | null;
  limit: number;
  offset: number;
}

/** Fila cruda de una tarjeta (producto + precio/disponibilidad de la sucursal + imagen principal). */
export interface CardRow {
  id: string;
  slug: string;
  name: string;
  /** Primeros caracteres de la descripción (solo para derivar el resumen). */
  description: string | null;
  categoryId: string;
  /** Precio EFECTIVO de la sucursal, o el base sin sucursal. */
  price: string;
  /** `null` sin sucursal. */
  available: boolean | null;
  imageUrl: string | null;
  imageAlt: string | null;
}
