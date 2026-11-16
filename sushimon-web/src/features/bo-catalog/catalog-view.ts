import type { BoProductArtKind } from '@/components/icons/bo';
import type {
  ProductBranchAvailability,
  Promotion,
  PromotionInput,
} from '@/lib/data-access/models';

/**
 * Lógica pura del catálogo del backoffice: arte por categoría, disponibilidad por sucursal SIMULADA (F13) y formulario de
 * promociones (el de productos F11 vive en `products-view`). Sin React ni red: se prueba aparte.
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

/** Arte y mosaico del primer slug conocido de la cadena (categoría y luego sus ancestros); sin dato, `roll`. */
export function categoryLook(slugs: readonly string[]): { art: BoProductArtKind; tile: BoTile } {
  for (const slug of slugs) {
    const found = CATEGORY_LOOK[slug];
    if (found) return found;
  }
  return { art: 'roll', tile: 'tile-beige' };
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
  product: { availability: readonly ProductBranchAvailability[] },
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
