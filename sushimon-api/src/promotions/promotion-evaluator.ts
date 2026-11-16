import { Inject, Injectable } from '@nestjs/common';
import { BUSINESS_TIMEZONE } from '../branch-schedule/clock.js';
import {
  centsToDecimal,
  decimalToCents,
  MAX_LINES,
  MAX_QUANTITY,
  percentOf,
  PromotionEvaluationInputError,
} from './promotion-money.js';
import { isInScheduleLocal, localClockOf, type LocalClock } from './promotion-schedule.js';
import type { OrderMode, PromotionKind, ScheduleSlot } from './promotions.types.js';

export { PromotionEvaluationInputError } from './promotion-money.js';

/**
 * Evaluador de promociones (spec F15 D15). PURO: sin I/O, sin reloj (recibe `at`) y sin aritmética en coma flotante.
 * F19 lo reutilizará para cotizar; F15 solo lo usa para los precios indicativos de la tienda.
 *
 * Política (CONSERVADORA, pendiente P14): UNA promoción por línea (la de mayor ahorro), nunca se apilan porcentaje +
 * monto, cupón + automática ni dos automáticas; descuento <= precio base de la línea; los modificadores no se
 * descuentan (el evaluador solo recibe el precio unitario del producto). Desempate: con código, vence antes, id menor.
 *
 * Cupón (REQUISITO DE SEGURIDAD de F19, spec 016): `coupon` es la vista DESTINADA AL CLIENTE y solo distingue
 * `APPLIED` de `NOT_APPLIED`, sin motivo: un código inexistente, inactivo, vencido, fuera de horario, de otra sucursal,
 * solo en el local o sin ahorro producen la MISMA respuesta (no se puede enumerar códigos). El detalle (`UNKNOWN`,
 * motivos, `rejected`) vive en `internal` y es SOLO para logs y pruebas: jamás debe serializarse hacia el cliente.
 */

export type RejectionReason =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'OUTSIDE_SCHEDULE'
  | 'BRANCH_NOT_ELIGIBLE'
  | 'DINE_IN_ONLY'
  | 'CODE_REQUIRED'
  | 'NO_ELIGIBLE_LINES'
  | 'NO_SAVING'
  | 'NOT_BEST_OFFER';

export interface EvaluatorLineInput {
  productId: string;
  /** Precio unitario de sucursal (F13), `"85.00"`. */
  unitPrice: string;
  /** Entero 1..99. */
  quantity: number;
}

export interface EvaluatorPromotion {
  id: string;
  code: string | null;
  kind: PromotionKind;
  value: string;
  startsAt: Date;
  endsAt: Date;
  dineInOnly: boolean;
  active: boolean;
  branchIds: readonly string[] | 'ALL';
  productIds: readonly string[] | 'ALL';
  schedule: readonly ScheduleSlot[];
}

export interface EvaluatorInput {
  at: Date;
  branchId: string;
  mode: OrderMode;
  /** Máx. 100. */
  lines: readonly EvaluatorLineInput[];
  couponCode?: string | null;
  promotions: readonly EvaluatorPromotion[];
}

export interface EvaluatedLine {
  index: number;
  productId: string;
  quantity: number;
  unitPrice: string;
  lineBase: string;
  applicable: boolean;
  promotionId: string | null;
  discountAmount: string;
  /** Total de la línea tras el descuento. */
  finalPrice: string;
  /** Vista del cliente: `NO_SAVING` se colapsa en `NO_CANDIDATE` (el detalle está en `internal.lineReasons`). */
  reason: 'APPLIED' | 'NO_CANDIDATE';
}

/** Resultado detallado del cupón: SOLO interno (logs/pruebas). */
export type CouponDetail = null | {
  status: 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
  reason?: RejectionReason;
};

/** Vista del cupón apta para el cliente: sin motivo y sin distinguir «desconocido» de «no aplicado». */
export type CouponPublicOutcome = null | { status: 'APPLIED' | 'NOT_APPLIED' };

export interface EvaluatorResult {
  at: string;
  lines: EvaluatedLine[];
  /** Vista para el cliente (`couponPublicOutcome(internal.coupon)`). */
  coupon: CouponPublicOutcome;
  /** Suma de descuentos de las líneas; NO es el total del pedido. */
  discountTotal: string;
  /** Detalle para logs y pruebas. NUNCA se expone al cliente. */
  internal: {
    rejected: { promotionId: string; reason: RejectionReason }[];
    coupon: CouponDetail;
    /** Motivo detallado por línea (`NO_SAVING` distinto de `NO_CANDIDATE`). */
    lineReasons: ('APPLIED' | 'NO_CANDIDATE' | 'NO_SAVING')[];
  };
}

/** `UNKNOWN` colapsa en `NOT_APPLIED` y se descarta el motivo. */
export function couponPublicOutcome(detail: CouponDetail): CouponPublicOutcome {
  if (detail === null) return null;
  return { status: detail.status === 'APPLIED' ? 'APPLIED' : 'NOT_APPLIED' };
}

export interface LineDiscount {
  lineBaseCents: number;
  discountCents: number;
  finalCents: number;
}

const BASIS_POINTS_MAX = 10_000;

function assertQuantity(quantity: unknown): asserts quantity is number {
  if (
    !Number.isInteger(quantity) ||
    (quantity as number) < 1 ||
    (quantity as number) > MAX_QUANTITY
  ) {
    throw new PromotionEvaluationInputError(`cantidad fuera de 1..${MAX_QUANTITY}`);
  }
}

/**
 * Descuento de UNA línea (puro). `PERCENT`: `round_half_up(base * bp / 10000)` sobre el total de la línea.
 * `FIXED_AMOUNT`: `min(valor * cantidad, base)`. En ambos `descuento <= base`.
 */
export function computeLineDiscount(
  kind: PromotionKind,
  value: string,
  unitPrice: string,
  quantity: number,
): LineDiscount {
  assertQuantity(quantity);
  const lineBaseCents = decimalToCents(unitPrice, 'precio unitario') * quantity;
  const valueCents = decimalToCents(value, 'valor de la promoción');
  let discount: number;
  if (kind === 'PERCENT') {
    if (valueCents <= 0 || valueCents > BASIS_POINTS_MAX) {
      throw new PromotionEvaluationInputError('porcentaje fuera de (0, 100]');
    }
    discount = percentOf(lineBaseCents, valueCents);
  } else if (kind === 'FIXED_AMOUNT') {
    if (valueCents <= 0) throw new PromotionEvaluationInputError('monto fijo debe ser positivo');
    discount = valueCents * quantity;
  } else {
    throw new PromotionEvaluationInputError('tipo de promoción desconocido');
  }
  const discountCents = Math.min(discount, lineBaseCents);
  return { lineBaseCents, discountCents, finalCents: lineBaseCents - discountCents };
}

/** Código de cupón normalizado (recorta y pasa a mayúsculas); `null` si queda vacío. */
export function normalizeCouponCode(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new PromotionEvaluationInputError('couponCode inválido');
  const text = raw.trim().toUpperCase();
  return text === '' ? null : text;
}

type PromotionGate = RejectionReason | null;

@Injectable()
export class PromotionEvaluator {
  constructor(@Inject(BUSINESS_TIMEZONE) private readonly timeZone: string) {}

  evaluate(input: EvaluatorInput): EvaluatorResult {
    const atMs = input.at instanceof Date ? input.at.getTime() : Number.NaN;
    if (!Number.isFinite(atMs)) throw new PromotionEvaluationInputError('instante inválido');
    const rawLines: unknown = input.lines;
    if (!Array.isArray(rawLines) || rawLines.length > MAX_LINES) {
      throw new PromotionEvaluationInputError(`máximo ${MAX_LINES} líneas`);
    }
    const coupon = normalizeCouponCode(input.couponCode);
    // Valida todas las líneas por adelantado (no confía en el cargador ni en el llamador).
    const base = input.lines.map((line) => {
      assertQuantity(line.quantity);
      return {
        unitCents: decimalToCents(line.unitPrice, 'precio unitario'),
        quantity: line.quantity,
      };
    });
    for (const p of input.promotions) {
      // Valida kind/value de cada candidata (lanza si están mal formados).
      computeLineDiscount(p.kind, p.value, '0.00', 1);
    }

    // 1) Compuertas de la promoción (no dependen de la línea). La hora local se calcula UNA vez.
    const local = localClockOf(atMs, this.timeZone);
    const gates = new Map<string, PromotionGate>();
    for (const p of input.promotions) gates.set(p.id, this.gate(p, input, atMs, local, coupon));
    // Conjunto de productos por promoción: la pertenencia por línea es O(1).
    const productSets = new Map<string, ReadonlySet<string> | 'ALL'>(
      input.promotions.map((p) => [p.id, p.productIds === 'ALL' ? 'ALL' : new Set(p.productIds)]),
    );

    // 2) Mejor promoción por línea.
    const wonBy = new Set<string>();
    const evaluatedLines: EvaluatedLine[] = [];
    const lineReasons: ('APPLIED' | 'NO_CANDIDATE' | 'NO_SAVING')[] = [];
    const sawSaving = new Set<string>(); // elegible con ahorro > 0 en alguna línea
    const eligibleLine = new Set<string>(); // elegible (producto en alcance) en alguna línea
    let discountSum = 0;
    input.lines.forEach((line, index) => {
      const { unitCents, quantity } = base[index] as { unitCents: number; quantity: number };
      const lineBaseCents = unitCents * quantity;
      let best: { p: EvaluatorPromotion; discount: number } | null = null;
      let anyEligible = false;
      for (const p of input.promotions) {
        if (gates.get(p.id) !== null) continue;
        const inScope = productSets.get(p.id);
        if (inScope !== 'ALL' && !inScope?.has(line.productId)) continue;
        anyEligible = true;
        eligibleLine.add(p.id);
        const { discountCents } = computeLineDiscount(p.kind, p.value, line.unitPrice, quantity);
        if (discountCents <= 0) continue;
        sawSaving.add(p.id);
        if (best === null || this.better(p, discountCents, best.p, best.discount)) {
          best = { p, discount: discountCents };
        }
      }
      if (best) {
        wonBy.add(best.p.id);
        discountSum += best.discount;
      }
      const discount = best?.discount ?? 0;
      evaluatedLines.push({
        index,
        productId: line.productId,
        quantity,
        unitPrice: line.unitPrice,
        lineBase: centsToDecimal(lineBaseCents),
        applicable: best !== null,
        promotionId: best?.p.id ?? null,
        discountAmount: centsToDecimal(discount),
        finalPrice: centsToDecimal(lineBaseCents - discount),
        reason: best ? 'APPLIED' : 'NO_CANDIDATE',
      });
      lineReasons.push(best ? 'APPLIED' : anyEligible ? 'NO_SAVING' : 'NO_CANDIDATE');
    });

    // 3) Rechazadas: las que no ganaron ninguna línea.
    const rejected: { promotionId: string; reason: RejectionReason }[] = [];
    const reasons = new Map<string, RejectionReason>();
    for (const p of input.promotions) {
      if (wonBy.has(p.id)) continue;
      const gate = gates.get(p.id) ?? null;
      let reason: RejectionReason;
      if (gate !== null) reason = gate;
      else if (!eligibleLine.has(p.id)) reason = 'NO_ELIGIBLE_LINES';
      else if (!sawSaving.has(p.id)) reason = 'NO_SAVING';
      else reason = 'NOT_BEST_OFFER';
      reasons.set(p.id, reason);
      rejected.push({ promotionId: p.id, reason });
    }
    rejected.sort((a, b) =>
      a.promotionId < b.promotionId ? -1 : a.promotionId > b.promotionId ? 1 : 0,
    );

    const detail = this.couponOutcome(coupon, input.promotions, wonBy, reasons);
    return {
      at: input.at.toISOString(),
      lines: evaluatedLines,
      coupon: couponPublicOutcome(detail),
      discountTotal: centsToDecimal(discountSum),
      internal: { rejected, coupon: detail, lineReasons },
    };
  }

  /** Motivo por el que la promoción no es candidata para NINGUNA línea (`null` = pasa las compuertas). */
  private gate(
    p: EvaluatorPromotion,
    input: EvaluatorInput,
    atMs: number,
    local: LocalClock,
    coupon: string | null,
  ): PromotionGate {
    if (!p.active) return 'INACTIVE';
    if (atMs < p.startsAt.getTime()) return 'NOT_STARTED';
    if (atMs >= p.endsAt.getTime()) return 'EXPIRED';
    if (!isInScheduleLocal(p.schedule, local)) return 'OUTSIDE_SCHEDULE';
    if (p.branchIds !== 'ALL' && !p.branchIds.includes(input.branchId))
      return 'BRANCH_NOT_ELIGIBLE';
    if (p.dineInOnly && input.mode !== 'dine_in') return 'DINE_IN_ONLY';
    if (p.code !== null && p.code.trim().toUpperCase() !== coupon) return 'CODE_REQUIRED';
    return null;
  }

  /** ¿`a` (con `da`) es preferible a `b` (con `db`)? Mayor ahorro; con código; vence antes; id menor. */
  private better(a: EvaluatorPromotion, da: number, b: EvaluatorPromotion, db: number): boolean {
    if (da !== db) return da > db;
    const aCode = a.code !== null;
    const bCode = b.code !== null;
    if (aCode !== bCode) return aCode;
    const ea = a.endsAt.getTime();
    const eb = b.endsAt.getTime();
    if (ea !== eb) return ea < eb;
    return a.id < b.id;
  }

  private couponOutcome(
    coupon: string | null,
    promotions: readonly EvaluatorPromotion[],
    wonBy: ReadonlySet<string>,
    reasons: ReadonlyMap<string, RejectionReason>,
  ): CouponDetail {
    if (coupon === null) return null;
    const promo = promotions.find((p) => p.code !== null && p.code.trim().toUpperCase() === coupon);
    if (!promo) return { status: 'UNKNOWN' };
    if (wonBy.has(promo.id)) return { status: 'APPLIED' };
    const reason = reasons.get(promo.id) ?? 'NOT_BEST_OFFER';
    // «No vigente» (inactiva, no iniciada, vencida o fuera de horario) es indistinguible de un código inexistente.
    if (
      reason === 'INACTIVE' ||
      reason === 'NOT_STARTED' ||
      reason === 'EXPIRED' ||
      reason === 'OUTSIDE_SCHEDULE'
    ) {
      return { status: 'UNKNOWN' };
    }
    return { status: 'NOT_APPLIED', reason };
  }
}
