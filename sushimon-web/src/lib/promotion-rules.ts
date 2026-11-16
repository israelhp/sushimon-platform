import type { PromotionKind, PromotionScheduleSlot } from '@/lib/data-access/models';
import {
  addDaysISO,
  fromLocal,
  hmToMinutes,
  isoWeekdayOf,
  localDate,
  localIsoWeekday,
  localMinutes,
} from '@/lib/time';
import { PRODUCT_PRICE_MAX_CENTS, centsToPrice } from './product-rules';

/**
 * F15 — Reglas PURAS de promociones, cupones y Happy Hour (spec 016, ADR-0021). ÚNICO módulo que usan el adaptador mock y los
 * formularios del backoffice; replica lo que haría la API (`PromotionEvaluator`, `promotion-schedule`, `promotion-policy`) solo
 * para SIMULAR lo que ella devolvería. La tienda NUNCA lo usa para calcular precios: muestra lo que viene en la respuesta.
 *
 * - Tiempo (D14): zona `America/Guatemala`, día ISO 1–7 del instante LOCAL, intervalos `[inicio, fin)`, `24:00` solo como fin, sin
 *   cruzar la medianoche (se parte en dos días) y fusión de tramos contiguos al calcular transiciones.
 * - Dinero (D9): cadenas decimales de 2 posiciones; todo cálculo en CÉNTIMOS ENTEROS; el porcentaje en basis points (`"15.00"` →
 *   1500); redondeo medio hacia arriba sobre el total de la línea. Jamás aritmética decimal con `number`.
 * - Combinación (D15, provisional P14): una promoción por línea (la de mayor ahorro); sin apilar; los extras (F12) no se descuentan.
 */

// ── Límites del contrato ───────────────────────────────────────────────────────────────────

export const PROMOTION_NAME_MAX = 120;
export const PROMOTION_DESCRIPTION_MAX = 500;
export const PROMOTION_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
export const PROMOTION_SEARCH_MAX = 80;
export const PROMOTION_PAGE_MAX = 200;
export const PROMOTION_PAGE_SIZE_MAX = 100;
export const PROMOTION_BRANCHES_MAX = 20;
export const PROMOTION_PRODUCTS_MAX = 200;
export const PROMOTION_SLOTS_PER_DAY_MAX = 6;
export const PROMOTION_SLOTS_MAX = 42;
/** Horizonte de «próximas» y de `nextChangeAt` (D14; como F08). */
export const PROMOTION_HORIZON_DAYS = 14;
/** Máximo de promociones y de ítems indicativos en la lista pública. */
export const STORE_PROMOTIONS_MAX = 100;
export const STORE_PROMOTION_ITEMS_MAX = 50;

const DECIMAL_PATTERN = /^[0-9]{1,6}\.[0-9]{2}$/;
const SLOT_START_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const SLOT_END_PATTERN = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
/** Instante ISO 8601 CON zona (`Z` u offset); sin zona => 400. */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

// ── Dinero ─────────────────────────────────────────────────────────────────────────────────

/** `"15.00"` → 1500; `null` si no cumple la forma del contrato (`PromotionDecimal`). `0.00` es válido de forma (el rango lo decide `isValueInRange`). */
export function decimalToCents(value: string): number | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const [whole, fraction] = value.split('.') as [string, string];
  return Number(whole) * 100 + Number(fraction);
}

/** Texto del campo (`15`, `15.5`, `15,50`) → `PromotionDecimal` (`"15.50"`); `null` si no es un número de hasta 6 enteros y 2 decimales. */
export function parseDecimalInput(text: string): string | null {
  const m = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return centsToPrice(Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0'));
}

/** `PERCENT`: `0 < v <= 100`. `FIXED_AMOUNT` (por unidad): `0 < v <= 999999.99`. Recibe céntimos o basis points/100. */
export function isValueInRange(kind: PromotionKind, valueCents: number): boolean {
  if (kind === 'PERCENT') return valueCents > 0 && valueCents <= 10_000;
  return valueCents > 0 && valueCents <= PRODUCT_PRICE_MAX_CENTS;
}

/** Código del cupón normalizado: recortado y en mayúsculas (la API lo guarda así; el `UNIQUE` no distingue mayúsculas). */
export const normalizePromotionCode = (code: string): string => code.trim().toUpperCase();

export function isInstantWithZone(value: unknown): value is string {
  return (
    typeof value === 'string' && INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
  );
}

// ── Descuento de una línea (D15.7) ─────────────────────────────────────────────────────────

export interface LineDiscount {
  /** `unitPrice × quantity` en céntimos. */
  lineBase: number;
  /** Descuento en céntimos, entre 0 y `lineBase`. */
  discount: number;
  finalPrice: number;
}

/**
 * `PERCENT`: `round_half_up(lineBase × bp / 10000)` sobre el TOTAL de la línea. `FIXED_AMOUNT`: `value × quantity` por unidad.
 * En ambos `min(descuento, lineBase)`. Solo enteros: `lineBase ≤ 99 999 999 × 99` y `bp ≤ 10 000` caben en un entero seguro.
 */
export function computeLineDiscount(
  unitPriceCents: number,
  quantity: number,
  kind: PromotionKind,
  valueCents: number,
): LineDiscount {
  const lineBase = unitPriceCents * quantity;
  const raw =
    kind === 'PERCENT'
      ? Math.floor((lineBase * valueCents + 5_000) / 10_000)
      : valueCents * quantity;
  const discount = Math.min(raw, lineBase);
  return { lineBase, discount, finalPrice: lineBase - discount };
}

// ── Horario semanal ────────────────────────────────────────────────────────────────────────

export type ScheduleViolationCode = 'SLOT_ENDS_BEFORE_START' | 'SLOT_OVERLAP' | 'SLOT_LIMIT';

export interface ScheduleViolation {
  path: string;
  code: ScheduleViolationCode;
}

/** Forma de un tramo (400 si falla; T16): `weekday` entero 1..7, `startsAt` `HH:mm`, `endsAt` `HH:mm` o `24:00`, sin otros campos. */
export function isScheduleSlotShape(value: unknown): value is PromotionScheduleSlot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    Object.keys(o).every((k) => k === 'weekday' || k === 'startsAt' || k === 'endsAt') &&
    typeof o.weekday === 'number' &&
    Number.isInteger(o.weekday) &&
    o.weekday >= 1 &&
    o.weekday <= 7 &&
    typeof o.startsAt === 'string' &&
    SLOT_START_PATTERN.test(o.startsAt) &&
    typeof o.endsAt === 'string' &&
    SLOT_END_PATTERN.test(o.endsAt)
  );
}

/** Orden canónico `weekday`, `startsAt` (copia). */
export const sortSchedule = (schedule: readonly PromotionScheduleSlot[]): PromotionScheduleSlot[] =>
  schedule
    .map((s) => ({ weekday: s.weekday, startsAt: s.startsAt, endsAt: s.endsAt }))
    .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));

/**
 * Reglas de negocio de los tramos (422 `PROMOTION_SCHEDULE_INVALID`): fin mayor que inicio (T11), sin solapes en el mismo día
 * (los contiguos son válidos, T12), ≤ 6 por día y ≤ 42 en total. Los `path` apuntan al índice ORIGINAL (`schedule[i]`).
 */
export function scheduleViolations(
  schedule: readonly PromotionScheduleSlot[],
): ScheduleViolation[] {
  const violations: ScheduleViolation[] = [];
  schedule.forEach((s, i) => {
    if (hmToMinutes(s.endsAt) <= hmToMinutes(s.startsAt)) {
      violations.push({ path: `schedule[${i}]`, code: 'SLOT_ENDS_BEFORE_START' });
    }
  });
  const indexed = schedule
    .map((s, i) => ({ ...s, i }))
    .filter((s) => hmToMinutes(s.endsAt) > hmToMinutes(s.startsAt))
    .sort((a, b) => a.weekday - b.weekday || hmToMinutes(a.startsAt) - hmToMinutes(b.startsAt));
  for (let k = 1; k < indexed.length; k++) {
    const prev = indexed[k - 1] as (typeof indexed)[number];
    const cur = indexed[k] as (typeof indexed)[number];
    if (prev.weekday === cur.weekday && hmToMinutes(cur.startsAt) < hmToMinutes(prev.endsAt)) {
      violations.push({ path: `schedule[${cur.i}]`, code: 'SLOT_OVERLAP' });
    }
  }
  const perDay = new Map<number, number>();
  for (const s of schedule) perDay.set(s.weekday, (perDay.get(s.weekday) ?? 0) + 1);
  if (
    schedule.length > PROMOTION_SLOTS_MAX ||
    [...perDay.values()].some((n) => n > PROMOTION_SLOTS_PER_DAY_MAX)
  ) {
    violations.push({ path: 'schedule', code: 'SLOT_LIMIT' });
  }
  return violations;
}

/**
 * Parte un tramo que cruza la medianoche (estrategia B de F08): «vie 22:00 → 02:00» = vie `22:00–24:00` + sáb `00:00–02:00`.
 * Fin `00:00` = hasta la medianoche (solo el primer tramo). El domingo (7) continúa en el lunes (1).
 */
export function splitOvernightSlot(
  weekday: number,
  startsAt: string,
  endsAt: string,
): PromotionScheduleSlot[] {
  const first = { weekday, startsAt, endsAt: '24:00' };
  if (endsAt === '00:00') return [first];
  return [first, { weekday: (weekday % 7) + 1, startsAt: '00:00', endsAt }];
}

/** ¿Está el instante dentro del horario semanal? Sin tramos = siempre. Día ISO y hora del instante LOCAL (T5, T6). */
export function isInSchedule(schedule: readonly PromotionScheduleSlot[], at: Date): boolean {
  if (schedule.length === 0) return true;
  const day = localIsoWeekday(at);
  const minutes = localMinutes(at);
  return schedule.some(
    (s) =>
      s.weekday === day && hmToMinutes(s.startsAt) <= minutes && minutes < hmToMinutes(s.endsAt),
  );
}

// ── Vigencia y ciclo de vida ───────────────────────────────────────────────────────────────

export interface PromotionWindow {
  active: boolean;
  startsAt: string;
  endsAt: string;
  schedule: readonly PromotionScheduleSlot[];
}

export type PromotionLifecycle = 'INACTIVE' | 'EXPIRED' | 'SCHEDULED' | 'RUNNING';

/** Precedencia INACTIVE > EXPIRED > SCHEDULED > RUNNING (solo vigencia; el horario semanal está en `isLiveAt`). `ends_at` es exclusivo. */
export function lifecycleOf(p: PromotionWindow, at: Date): PromotionLifecycle {
  const t = at.getTime();
  if (!p.active) return 'INACTIVE';
  if (t >= Date.parse(p.endsAt)) return 'EXPIRED';
  if (t < Date.parse(p.startsAt)) return 'SCHEDULED';
  return 'RUNNING';
}

/** Vigente AHORA: activa, `[startsAt, endsAt)` y dentro del horario semanal. NO consulta el horario de la sucursal (D6). */
export function isLiveAt(p: PromotionWindow, at: Date): boolean {
  return lifecycleOf(p, at) === 'RUNNING' && isInSchedule(p.schedule, at);
}

export interface Interval {
  /** Epoch ms, inclusivo. */
  start: number;
  /** Epoch ms, EXCLUSIVO. */
  end: number;
}

/**
 * Intervalos en que la promoción rige (vigencia ∩ tramos del día LOCAL), fusionando los contiguos (T8, T9: no hay falso fin a
 * medianoche). Cubre desde el día local anterior a `from` (para fusionar tramos que cruzan) hasta `to`. Sin tramos: un único
 * intervalo `[startsAt, endsAt)` sin recortar. Los datos de entrada no se mutan.
 */
export function liveIntervals(p: PromotionWindow, from: Date, to: Date): Interval[] {
  const startMs = Date.parse(p.startsAt);
  const endMs = Date.parse(p.endsAt);
  if (!(endMs > startMs)) return [];
  if (p.schedule.length === 0) return [{ start: startMs, end: endMs }];
  const raw: Interval[] = [];
  const last = localDate(to);
  for (let day = addDaysISO(localDate(from), -1); day <= last; day = addDaysISO(day, 1)) {
    const weekday = isoWeekdayOf(day);
    for (const slot of p.schedule) {
      if (slot.weekday !== weekday) continue;
      const start = Math.max(fromLocal(day, slot.startsAt).getTime(), startMs);
      const end = Math.min(fromLocal(day, slot.endsAt).getTime(), endMs);
      if (end > start) raw.push({ start, end });
    }
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const iv of raw) {
    const prev = merged[merged.length - 1];
    if (prev && iv.start <= prev.end) prev.end = Math.max(prev.end, iv.end);
    else merged.push({ ...iv });
  }
  return merged;
}

const DAY_MS = 86_400_000;

export interface PromotionTimes {
  live: boolean;
  /** Si `live`: fin del tramo actual (contiguos fusionados). Si no: `null`. */
  nextEndsAt: Date | null;
  /** Próximo instante en que pasa a regir (si no está vigente) o vuelve a regir (si lo está); `null` si no hay en 14 días. */
  nextStartsAt: Date | null;
}

/** Estado y próximos instantes de una promoción ACTIVA (inactiva: nunca rige, sin transiciones). */
export function promotionTimes(p: PromotionWindow, at: Date): PromotionTimes {
  if (!p.active) return { live: false, nextEndsAt: null, nextStartsAt: null };
  const horizon = new Date(at.getTime() + PROMOTION_HORIZON_DAYS * DAY_MS);
  const intervals = liveIntervals(p, at, new Date(horizon.getTime() + DAY_MS));
  const t = at.getTime();
  const live = isLiveAt(p, at);
  const current = live ? intervals.find((iv) => iv.start <= t && t < iv.end) : undefined;
  const next = intervals.find((iv) => iv.start > t && iv.start < horizon.getTime());
  return {
    live,
    nextEndsAt: current ? new Date(current.end) : null,
    nextStartsAt: next ? new Date(next.start) : null,
  };
}

/**
 * `nextChangeAt`: el menor instante futuro, dentro de 14 días, en que cambia el conjunto de promociones vigentes (inicio o fin de
 * vigencia, inicio o fin de tramo con contiguos fusionados). `null` si no hay. Solo promociones ACTIVAS.
 */
export function nextChangeAt(promotions: readonly PromotionWindow[], at: Date): Date | null {
  const t = at.getTime();
  const limit = t + PROMOTION_HORIZON_DAYS * DAY_MS;
  let best: number | null = null;
  for (const p of promotions) {
    if (!p.active) continue;
    for (const iv of liveIntervals(p, at, new Date(limit + DAY_MS))) {
      for (const moment of [iv.start, iv.end]) {
        if (moment > t && moment <= limit && (best === null || moment < best)) best = moment;
      }
    }
  }
  return best === null ? null : new Date(best);
}

// ── Evaluador (D15; solo para SIMULAR lo que devolvería la API) ────────────────────────────

export type OrderModeForPromotions = 'pickup' | 'delivery' | 'dine_in';

export interface EvaluatorPromotion extends PromotionWindow {
  id: string;
  code: string | null;
  kind: PromotionKind;
  /** `PromotionDecimal` (`"15.00"`). */
  value: string;
  dineInOnly: boolean;
  branchIds: readonly string[] | 'ALL';
  productIds: readonly string[] | 'ALL';
}

export interface EvaluatorLine {
  productId: string;
  /** Precio de SUCURSAL (F13), `"85.00"`. Nunca el base. */
  unitPrice: string;
  /** Entero 1..99. */
  quantity: number;
}

export type RejectReason =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'OUT_OF_SCHEDULE'
  | 'BRANCH_NOT_IN_SCOPE'
  | 'DINE_IN_ONLY'
  | 'PRODUCT_NOT_IN_SCOPE'
  | 'CODE_REQUIRED'
  | 'NO_SAVING';

export interface EvaluatedLine {
  productId: string;
  quantity: number;
  lineBase: string;
  discount: string;
  finalPrice: string;
  promotionId: string | null;
}

export interface Rejection {
  promotionId: string;
  /** `null` = rechazada para todo el pedido (estado, sucursal, modo, código). */
  lineIndex: number | null;
  reason: RejectReason;
}

export type CouponState = 'NONE' | 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';

export interface EvaluatorInput {
  at: Date;
  branchId: string;
  mode: OrderModeForPromotions;
  lines: readonly EvaluatorLine[];
  couponCode?: string | null;
  promotions: readonly EvaluatorPromotion[];
}

export interface EvaluatorResult {
  lines: EvaluatedLine[];
  rejected: Rejection[];
  coupon: CouponState;
}

/** Motivo por el que una promoción NO es candidata en este instante/sucursal/modo, o `null` si lo es (sin mirar productos ni código). */
function orderLevelRejection(
  p: EvaluatorPromotion,
  at: Date,
  branchId: string,
  mode: OrderModeForPromotions,
): RejectReason | null {
  const life = lifecycleOf(p, at);
  if (life === 'INACTIVE') return 'INACTIVE';
  if (life === 'EXPIRED') return 'EXPIRED';
  if (life === 'SCHEDULED') return 'NOT_STARTED';
  if (!isInSchedule(p.schedule, at)) return 'OUT_OF_SCHEDULE';
  if (p.branchIds !== 'ALL' && !p.branchIds.includes(branchId)) return 'BRANCH_NOT_IN_SCOPE';
  if (p.dineInOnly && mode !== 'dine_in') return 'DINE_IN_ONLY';
  return null;
}

/**
 * Una promoción por línea: la de MAYOR ahorro; empate (mismo ahorro en céntimos): (a) con código, (b) vence antes, (c) `id` menor.
 * Nunca apila (%+monto, cupón+automática, dos automáticas). Una promoción con código jamás aplica sin el código (normalizado).
 * El resultado no depende del orden de entrada. Líneas distintas pueden llevar promociones distintas.
 */
export function evaluatePromotions(input: EvaluatorInput): EvaluatorResult {
  const coupon = input.couponCode ? normalizePromotionCode(input.couponCode) : '';
  const rejected: Rejection[] = [];
  const eligible: EvaluatorPromotion[] = [];
  for (const p of input.promotions) {
    const reason = orderLevelRejection(p, input.at, input.branchId, input.mode);
    if (reason) rejected.push({ promotionId: p.id, lineIndex: null, reason });
    else if (p.code !== null && p.code !== coupon) {
      rejected.push({ promotionId: p.id, lineIndex: null, reason: 'CODE_REQUIRED' });
    } else eligible.push(p);
  }

  const usedCoupon = new Set<string>();
  const lines = input.lines.map((line, index): EvaluatedLine => {
    const unit = decimalToCents(line.unitPrice) ?? 0;
    let best: { promo: EvaluatorPromotion; discount: LineDiscount } | null = null;
    for (const p of eligible) {
      if (p.productIds !== 'ALL' && !p.productIds.includes(line.productId)) {
        rejected.push({ promotionId: p.id, lineIndex: index, reason: 'PRODUCT_NOT_IN_SCOPE' });
        continue;
      }
      const discount = computeLineDiscount(
        unit,
        line.quantity,
        p.kind,
        decimalToCents(p.value) ?? 0,
      );
      if (discount.discount <= 0) {
        rejected.push({ promotionId: p.id, lineIndex: index, reason: 'NO_SAVING' });
        continue;
      }
      if (!best || beats(p, discount.discount, best.promo, best.discount.discount)) {
        best = { promo: p, discount };
      }
    }
    if (best?.promo.code) usedCoupon.add(best.promo.id);
    const base = unit * line.quantity;
    return {
      productId: line.productId,
      quantity: line.quantity,
      lineBase: centsToPrice(base),
      discount: centsToPrice(best?.discount.discount ?? 0),
      finalPrice: centsToPrice(best?.discount.finalPrice ?? base),
      promotionId: best?.promo.id ?? null,
    };
  });

  let state: CouponState = 'NONE';
  if (coupon) {
    // Desconocido y no vigente son indistinguibles (D9: sin enumeración de códigos).
    const known = input.promotions.find(
      (p) =>
        p.code === coupon && orderLevelRejection(p, input.at, input.branchId, input.mode) === null,
    );
    state = !known ? 'UNKNOWN' : usedCoupon.has(known.id) ? 'APPLIED' : 'NOT_APPLIED';
  }
  return { lines, rejected, coupon: state };
}

/** ¿`a` (ahorro `ad`) le gana a `b` (ahorro `bd`)? Mayor ahorro; luego con código, vence antes, `id` menor. */
function beats(a: EvaluatorPromotion, ad: number, b: EvaluatorPromotion, bd: number): boolean {
  if (ad !== bd) return ad > bd;
  if ((a.code !== null) !== (b.code !== null)) return a.code !== null;
  const ea = Date.parse(a.endsAt);
  const eb = Date.parse(b.endsAt);
  if (ea !== eb) return ea < eb;
  return a.id < b.id;
}

/**
 * Precio promocional INDICATIVO de un producto por una promoción AUTOMÁTICA (cantidad 1, precio de sucursal, esa promoción por sí
 * sola). `null` si no hay ahorro. Misma función que el evaluador (`computeLineDiscount`).
 */
export function indicativePromoPrice(
  unitPrice: string,
  p: Pick<EvaluatorPromotion, 'kind' | 'value'>,
): string | null {
  const unit = decimalToCents(unitPrice);
  const value = decimalToCents(p.value);
  if (unit === null || value === null) return null;
  const { discount, finalPrice } = computeLineDiscount(unit, 1, p.kind, value);
  return discount > 0 ? centsToPrice(finalPrice) : null;
}
