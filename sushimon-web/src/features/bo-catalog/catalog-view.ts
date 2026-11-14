import type { BoProductArtKind } from '@/components/icons/bo';
import type {
  ProductBranchAvailability,
  Category,
  Product,
  Promotion,
  PromotionInput,
} from '@/lib/data-access/models';

/**
 * Lógica pura del catálogo del backoffice (Productos, Categorías, Promociones): disponibilidad por
 * sucursal, filtros, orden de categorías y validación de formularios. Sin React ni red: se prueba aparte.
 * Los textos viajan como códigos de error; la traducción vive en los mensajes (`backoffice.*`).
 */

// ── Arte y mosaico por categoría (CAT_ART / CAT_TILE del prototipo, mapeados a las categorías canónicas) ──

export type BoTile = 'tile-beige' | 'tile-coral' | 'tile-blue' | 'tile-navy';

const CATEGORY_LOOK: Record<string, { art: BoProductArtKind; tile: BoTile }> = {
  entradas: { art: 'dumpling', tile: 'tile-beige' },
  monchis: { art: 'soup', tile: 'tile-coral' },
  rolls: { art: 'roll', tile: 'tile-coral' },
  espirituosas: { art: 'drink', tile: 'tile-navy' },
  relax: { art: 'drink', tile: 'tile-blue' },
  postres: { art: 'dessert', tile: 'tile-coral' },
};

export function categoryLook(categoryId: string): { art: BoProductArtKind; tile: BoTile } {
  return CATEGORY_LOOK[categoryId] ?? { art: 'roll', tile: 'tile-beige' };
}

// ── Disponibilidad por sucursal ─────────────────────────────────────────────────────────────

export type AvailabilityKind = 'on' | 'off' | 'partial';

export interface AvailabilityState {
  kind: AvailabilityKind;
  /** Sucursales del alcance donde está disponible. */
  on: number;
  total: number;
}

/** Estado del producto en las sucursales del alcance (una sucursal, o todas las activas). */
export function availabilityState(
  product: Pick<Product, 'availability'>,
  scope: readonly string[],
): AvailabilityState {
  const on = scope.filter(
    (id) => product.availability.find((a) => a.branchId === id)?.available === true,
  ).length;
  const kind: AvailabilityKind =
    scope.length > 0 && on === scope.length ? 'on' : on === 0 ? 'off' : 'partial';
  return { kind, on, total: scope.length };
}

/** Cuerpo del PATCH para fijar la disponibilidad en el alcance (solo esas sucursales). */
export function availabilityPatch(
  scope: readonly string[],
  value: boolean,
): ProductBranchAvailability[] {
  return scope.map((branchId) => ({ branchId, available: value }));
}

// ── Filtros y conteos ───────────────────────────────────────────────────────────────────────

export const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface ProductFilter {
  query: string;
  /** `all` o id de categoría. */
  categoryId: string;
}

export function filterProducts<T extends Pick<Product, 'name' | 'nameEn' | 'categoryId'>>(
  products: readonly T[],
  { query, categoryId }: ProductFilter,
): T[] {
  const q = normalizeText(query);
  return products.filter(
    (p) =>
      (categoryId === 'all' || p.categoryId === categoryId) &&
      (!q || normalizeText(p.name).includes(q) || normalizeText(p.nameEn ?? '').includes(q)),
  );
}

export function countByCategory(products: readonly Pick<Product, 'categoryId'>[]) {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  return counts;
}

// ── Orden de categorías ─────────────────────────────────────────────────────────────────────

export function sortCategories(categories: readonly Category[]): Category[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Ids en el nuevo orden tras mover `id` una posición (`-1` sube, `1` baja); `null` si no se puede. */
export function moveId(ids: readonly string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  const a = next[i]!;
  next[i] = next[j]!;
  next[j] = a;
  return next;
}

/** Cambios de `sortOrder` (1..n) necesarios para que el servidor refleje el orden de `ids`. */
export function orderChanges(categories: readonly Category[], ids: readonly string[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const changes: { id: string; sortOrder: number }[] = [];
  ids.forEach((id, index) => {
    const current = byId.get(id);
    if (current && current.sortOrder !== index + 1) changes.push({ id, sortOrder: index + 1 });
  });
  return changes;
}

// ── Formulario de producto ──────────────────────────────────────────────────────────────────

export interface ProductFormValues {
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  categoryId: string;
  /** Texto del campo (se valida al guardar). */
  price: string;
  featured: boolean;
  /** Disponibilidad por id de sucursal. */
  availability: Record<string, boolean>;
}

export type ProductField = 'name' | 'price' | 'categoryId';
export type ProductErrorCode = 'nameRequired' | 'priceInvalid' | 'categoryRequired';
export interface ProductFormError {
  field: ProductField;
  code: ProductErrorCode;
}

export const MAX_PRICE = 9999;

/** Precio en quetzales o `null` si no es un número mayor a 0 (admite coma decimal). */
export function parsePrice(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null;
  return Math.round(n * 100) / 100;
}

/** Errores en el orden en que aparecen los campos (el primero recibe el foco). */
export function validateProductForm(values: ProductFormValues): ProductFormError[] {
  const errors: ProductFormError[] = [];
  if (!values.name.trim()) errors.push({ field: 'name', code: 'nameRequired' });
  if (!values.categoryId) errors.push({ field: 'categoryId', code: 'categoryRequired' });
  if (parsePrice(values.price) === null) errors.push({ field: 'price', code: 'priceInvalid' });
  return errors;
}

export function emptyProductForm(
  categoryId: string,
  branchIds: readonly string[],
): ProductFormValues {
  return {
    name: '',
    nameEn: '',
    description: '',
    descriptionEn: '',
    categoryId,
    price: '',
    featured: false,
    availability: Object.fromEntries(branchIds.map((id) => [id, true])),
  };
}

export function productToForm(product: Product, branchIds: readonly string[]): ProductFormValues {
  return {
    name: product.name,
    nameEn: product.nameEn ?? '',
    description: product.description,
    descriptionEn: product.descriptionEn ?? '',
    categoryId: product.categoryId,
    price: String(product.price),
    featured: product.featured,
    availability: Object.fromEntries(
      branchIds.map((id) => [
        id,
        product.availability.find((a) => a.branchId === id)?.available === true,
      ]),
    ),
  };
}

// ── Promociones ─────────────────────────────────────────────────────────────────────────────

export type PromotionKind = Promotion['kind'];
export const PROMOTION_KINDS: readonly PromotionKind[] = ['percent', 'fixed_price', '2x1'];
/** Lunes a domingo, ISO (1 = lunes), en el orden de los botones. */
export const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Etiqueta del descuento de la tarjeta: `2x1`, `-20%` o `Q199`. */
export function discountLabel(p: Pick<Promotion, 'kind' | 'value'>): string {
  if (p.kind === '2x1') return '2x1';
  return p.kind === 'percent' ? `-${p.value}%` : `Q${p.value}`;
}

/** Tono de la franja `.sg` por posición (coral, azul marino, ámbar). */
export const PROMO_TONES = ['sg-coral', 'sg-navy', 'sg-amber'] as const;

/** "1 oct – 31 dic 2026" (mes abreviado del idioma; el año es el de la fecha final). */
export function formatRange(from: string, to: string, months: readonly string[]): string {
  const part = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return { y: y ?? 0, label: `${d ?? 0} ${months[(m ?? 1) - 1] ?? ''}` };
  };
  const a = part(from);
  const b = part(to);
  return `${a.label} – ${b.label} ${b.y}`;
}

/** Una promoción solo puede estar "activa" para el cliente si no venció. */
export function isRunning(p: Pick<Promotion, 'active' | 'status'>): boolean {
  return p.active && p.status !== 'expired' && p.status !== 'inactive';
}

export interface PromotionFormValues {
  name: string;
  kind: PromotionKind;
  value: string;
  days: number[];
  start: string;
  end: string;
  from: string;
  to: string;
}

export type PromotionField = 'name' | 'value' | 'days' | 'start' | 'end' | 'from' | 'to';
export type PromotionErrorCode =
  | 'nameRequired'
  | 'valueRequired'
  | 'percentMax'
  | 'daysRequired'
  | 'timeRequired'
  | 'timeOrder'
  | 'dateRequired'
  | 'dateOrder';
export interface PromotionFormError {
  field: PromotionField;
  code: PromotionErrorCode;
}

const HM = /^\d{2}:\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mismas reglas que el servidor (nombre, valor, días, horas y vigencia) para avisar antes de enviar. */
export function validatePromotionForm(v: PromotionFormValues): PromotionFormError[] {
  const errors: PromotionFormError[] = [];
  if (!v.name.trim()) errors.push({ field: 'name', code: 'nameRequired' });
  if (v.kind !== '2x1') {
    const value = Number(v.value);
    if (!(value > 0)) errors.push({ field: 'value', code: 'valueRequired' });
    else if (v.kind === 'percent' && value > 100)
      errors.push({ field: 'value', code: 'percentMax' });
  }
  if (v.days.length === 0) errors.push({ field: 'days', code: 'daysRequired' });
  if (!HM.test(v.start)) errors.push({ field: 'start', code: 'timeRequired' });
  else if (!HM.test(v.end)) errors.push({ field: 'end', code: 'timeRequired' });
  else if (v.start >= v.end) errors.push({ field: 'end', code: 'timeOrder' });
  if (!ISO_DATE.test(v.from)) errors.push({ field: 'from', code: 'dateRequired' });
  else if (!ISO_DATE.test(v.to)) errors.push({ field: 'to', code: 'dateRequired' });
  else if (v.from > v.to) errors.push({ field: 'to', code: 'dateOrder' });
  return errors;
}

/** Valores iniciales de "Nueva promoción" (como `newPromo` del prototipo): 15 %, vie y sáb, 12:00–16:00, 30 días. */
export function emptyPromotionForm(today: string, inThirtyDays: string): PromotionFormValues {
  return {
    name: '',
    kind: 'percent',
    value: '15',
    days: [5, 6],
    start: '12:00',
    end: '16:00',
    from: today,
    to: inThirtyDays,
  };
}

export function promotionInput(v: PromotionFormValues): PromotionInput {
  return {
    name: v.name.trim(),
    kind: v.kind,
    value: v.kind === '2x1' ? 0 : Number(v.value),
    daysOfWeek: [...v.days].sort((a, b) => a - b),
    startTime: v.start,
    endTime: v.end,
    validFrom: v.from,
    validTo: v.to,
    active: true,
  };
}
