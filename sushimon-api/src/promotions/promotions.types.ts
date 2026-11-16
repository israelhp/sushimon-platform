/** Tipos de dominio de promociones (F15). Sin dependencias de Nest ni de Prisma. */

export type PromotionKind = 'PERCENT' | 'FIXED_AMOUNT';
export type PromotionScope = 'ALL' | 'SELECTED';
export type OrderMode = 'pickup' | 'delivery' | 'dine_in';

export const PROMOTION_KINDS: readonly PromotionKind[] = ['PERCENT', 'FIXED_AMOUNT'];

/** Tramo semanal en hora local: día ISO 1..7 y `HH:mm` (`24:00` solo como fin). */
export interface ScheduleSlot {
  weekday: number;
  startsAt: string;
  endsAt: string;
}

/** Promoción persistida con sus hijas ya resueltas (vacío = «todas» en sucursales y productos). */
export interface PromotionRecord {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  kind: PromotionKind;
  /** Cadena decimal de 2 posiciones. */
  value: string;
  startsAt: Date;
  endsAt: Date;
  dineInOnly: boolean;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** Vacío = todas las sucursales. */
  branches: { id: string; name: string }[];
  /** Solo en el detalle; en listados queda vacío y se usa `productCount`. Vacío con `productCount=0` = todos. */
  products: { id: string; name: string; slug: string }[];
  productCount: number;
  schedule: ScheduleSlot[];
}

/** Valores escalares y listas de una escritura (`undefined` = sin cambio en un PATCH). */
export interface PromotionScalars {
  code?: string | null;
  name?: string;
  description?: string | null;
  kind?: PromotionKind;
  value?: string;
  startsAt?: Date;
  endsAt?: Date;
  dineInOnly?: boolean;
  active?: boolean;
}

export interface PromotionLists {
  branchIds?: string[];
  productIds?: string[];
  schedule?: ScheduleSlot[];
}

export interface NewPromotion {
  code: string | null;
  name: string;
  description: string | null;
  kind: PromotionKind;
  value: string;
  startsAt: Date;
  endsAt: Date;
  dineInOnly: boolean;
  active: boolean;
  branchIds: string[];
  productIds: string[];
  schedule: ScheduleSlot[];
}

export type PromotionLifecycle = 'INACTIVE' | 'SCHEDULED' | 'RUNNING' | 'EXPIRED';
export type PromotionStatusFilter = 'active' | 'inactive' | 'scheduled' | 'running' | 'expired';
export type PromotionSort = 'startsAt' | 'endsAt' | 'name' | 'createdAt';

export interface PromotionPageFilter {
  /** `null` = alcance global; si no, las sucursales visibles para el actor. */
  scopeBranchIds: readonly string[] | null;
  branchId?: string;
  status?: PromotionStatusFilter;
  kind?: PromotionKind;
  from?: Date;
  to?: Date;
  pattern: string | null;
  sort: PromotionSort;
  order: 'asc' | 'desc';
  now: Date;
  page: number;
  pageSize: number;
}

/** Candidata cruda para la tienda (incluye nombre y descripción). */
export interface StoreCandidateRecord {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  kind: PromotionKind;
  value: string;
  startsAt: Date;
  endsAt: Date;
  dineInOnly: boolean;
  active: boolean;
  branchIds: string[];
  /** Vacío si se omitió la lectura (cupones en la tienda) o si aplica a todos; ver `hasProducts`. */
  productIds: string[];
  /** ¿Tiene productos seleccionados? (se calcula siempre, aunque no se lean los ids). */
  hasProducts: boolean;
  schedule: ScheduleSlot[];
}

export interface ProductBasics {
  id: string;
  name: string;
  active: boolean;
  categoryId: string;
}
