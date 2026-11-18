import type { EvaluatorLineInput, EvaluatorPromotion } from '../promotions/promotion-evaluator.js';
import { PromotionEvaluator } from '../promotions/promotion-evaluator.js';
import type { OrderMode } from '../promotions/promotions.types.js';
import { centsToDecimal, decimalToCents } from '../common/money/money.js';
import { isPurchasable, type LineStatus } from './checkout-policy.js';
import type {
  CheckoutModifierLineDto,
  CheckoutQuoteLineDto,
} from './dto/checkout-quote-responses.dto.js';

/**
 * Motor de cálculo de la cotización (F19, ADR-0025 D6). TODO en centavos enteros, nunca `number` flotante sobre importes.
 * Fórmulas (spec §2): `lineSubtotal = (unitPrice + extrasPerUnit) × quantity`; `discount` = descuento del evaluador de F15
 * sobre `unitPrice × quantity` (los extras NO se descuentan, F15 D15.6); `lineTotal = lineSubtotal − discount`;
 * `subtotal = Σ lineSubtotal`; `extrasTotal = Σ extrasPerUnit × quantity`; `discountTotal = Σ discount`;
 * `total = subtotal − discountTotal + deliveryFee`. Las líneas no comprables quedan con importes `null` y no suman.
 */

export interface EngineLine {
  index: number;
  productId: string;
  quantity: number;
  status: LineStatus;
  /** Precio efectivo de sucursal en centavos (`null` si la línea no existe). */
  unitCents: number | null;
  extrasPerUnitCents: number;
  modifiers: CheckoutModifierLineDto[];
  /** Eco de `clientView` solo si el precio cambió. */
  previousUnitPrice: string | null;
}

export interface LineDiscount {
  cents: number;
  promotionId: string | null;
}

export interface QuoteAmounts {
  lines: CheckoutQuoteLineDto[];
  subtotal: string;
  extrasTotal: string;
  discountTotal: string;
  deliveryFee: string | null;
  total: string | null;
  /** Total en centavos (para comparar con `clientView.total` sin reparsear). */
  totalCents: number | null;
}

/**
 * `deliveryFeeCents`: `0` en PICKUP; la tarifa verificada en DELIVERY; `null` si no hay tarifa verificable (=> total
 * `null`). `discounts` se indexa por `EngineLine.index`.
 */
export function priceQuote(
  lines: readonly EngineLine[],
  discounts: ReadonlyMap<number, LineDiscount>,
  deliveryFeeCents: number | null,
): QuoteAmounts {
  let subtotal = 0;
  let extrasTotal = 0;
  let discountTotal = 0;
  let allPurchasable = true;
  const out: CheckoutQuoteLineDto[] = lines.map((line) => {
    if (!isPurchasable(line.status) || line.unitCents === null) {
      allPurchasable = false;
      return {
        index: line.index,
        productId: line.productId,
        quantity: line.quantity,
        status: line.status,
        unitPrice: null,
        modifiers: [],
        extrasPerUnit: null,
        lineSubtotal: null,
        discount: null,
        promotionId: null,
        lineTotal: null,
        previousUnitPrice: null,
      };
    }
    const lineSubtotal = (line.unitCents + line.extrasPerUnitCents) * line.quantity;
    const found = discounts.get(line.index);
    const discount = found?.cents ?? 0;
    if (discount < 0 || discount > line.unitCents * line.quantity) {
      throw new RangeError('descuento fuera de rango'); // el evaluador garantiza descuento <= base: nunca ocurre
    }
    subtotal += lineSubtotal;
    extrasTotal += line.extrasPerUnitCents * line.quantity;
    discountTotal += discount;
    return {
      index: line.index,
      productId: line.productId,
      quantity: line.quantity,
      status: line.status,
      unitPrice: centsToDecimal(line.unitCents),
      modifiers: line.modifiers,
      extrasPerUnit: centsToDecimal(line.extrasPerUnitCents),
      lineSubtotal: centsToDecimal(lineSubtotal),
      discount: centsToDecimal(discount),
      promotionId: discount > 0 ? (found?.promotionId ?? null) : null,
      lineTotal: centsToDecimal(lineSubtotal - discount),
      previousUnitPrice: line.status === 'PRICE_CHANGED' ? line.previousUnitPrice : null,
    };
  });
  const totalCents =
    allPurchasable && deliveryFeeCents !== null
      ? subtotal - discountTotal + deliveryFeeCents
      : null;
  return {
    lines: out,
    subtotal: centsToDecimal(subtotal),
    extrasTotal: centsToDecimal(extrasTotal),
    discountTotal: centsToDecimal(discountTotal),
    deliveryFee: deliveryFeeCents === null ? null : centsToDecimal(deliveryFeeCents),
    total: totalCents === null ? null : centsToDecimal(totalCents),
    totalCents,
  };
}

export interface DiscountEvaluation {
  discounts: Map<number, LineDiscount>;
  /** Vista del cliente (`null` sin cupón). */
  coupon: { status: 'APPLIED' | 'NOT_APPLIED' } | null;
  /** Solo para logs/contadores (sin código ni PII): el cupón pedido no resultó `APPLIED`. */
  internalCouponUnknown: boolean;
}

/**
 * Descuentos con el `PromotionEvaluator` de F15 sobre las líneas COMPRABLES (precio unitario del producto, sin extras).
 * Una promoción por línea, la de mayor ahorro; nunca se apilan. El cupón se colapsa en `APPLIED|NOT_APPLIED`.
 */
export function evaluateDiscounts(
  evaluator: PromotionEvaluator,
  input: {
    at: Date;
    branchId: string;
    mode: OrderMode;
    couponCode: string | null;
    promotions: readonly EvaluatorPromotion[];
    lines: readonly EngineLine[];
  },
): DiscountEvaluation {
  const purchasable = input.lines.filter((l) => isPurchasable(l.status) && l.unitCents !== null);
  const evaluatorLines: EvaluatorLineInput[] = purchasable.map((l) => ({
    productId: l.productId,
    unitPrice: centsToDecimal(l.unitCents as number),
    quantity: l.quantity,
  }));
  const result = evaluator.evaluate({
    at: input.at,
    branchId: input.branchId,
    mode: input.mode,
    lines: evaluatorLines,
    couponCode: input.couponCode,
    promotions: input.promotions,
  });
  const discounts = new Map<number, LineDiscount>();
  result.lines.forEach((evaluated, i) => {
    const original = purchasable[i];
    if (!original || !evaluated.applicable) return;
    discounts.set(original.index, {
      cents: decimalToCents(evaluated.discountAmount),
      promotionId: evaluated.promotionId,
    });
  });
  return {
    discounts,
    coupon: result.coupon,
    internalCouponUnknown:
      result.internal.coupon !== null && result.internal.coupon.status === 'UNKNOWN',
  };
}
