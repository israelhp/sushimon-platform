import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { BranchOfferInspection } from '../branch-products/branch-products.types.js';
import { codedException } from '../common/errors/coded-exception.js';
import type {
  CourierProvider,
  DeliveryCoverageResult,
} from '../delivery-coverage/coverage.types.js';
import type { ModifierSelectionBatchResult } from '../modifiers/modifiers.types.js';
import type {
  CheckoutBlockerDto,
  CheckoutDeliveryOptionDto,
} from './dto/checkout-quote-responses.dto.js';

/**
 * Reglas PURAS de la cotización de checkout (F19, spec 020, ADR-0025). Sin I/O ni reloj: estados de línea, topes de la
 * entrada, forma de `fulfillment` y evaluación de la entrega por proveedor. Las reglas de dominio (precio efectivo,
 * extras, descuentos, horario, cobertura) NO se reimplementan aquí: viven en F08/F09/F12/F13/F15.
 */

// ---------- topes (P43) ----------

export const MAX_LINES = 30;
export const MAX_LINE_QUANTITY = 99;
export const MAX_UNITS = 200;
export const MAX_SELECTIONS_PER_LINE = 30;
export const MAX_SELECTIONS_TOTAL = 300;
export const MAX_BODY_BYTES = 64 * 1024;
/** Vigencia fija de la cotización (P39). */
export const QUOTE_TTL_SECONDS = 600;

export const quoteLimitsExceeded = (message: string) =>
  codedException(HttpStatus.BAD_REQUEST, 'QUOTE_LIMITS_EXCEEDED', message);

export interface LimitedLine {
  quantity: number;
  selections: readonly unknown[];
}

/** 400 `QUOTE_LIMITS_EXCEEDED` si se supera algún tope de la entrada. Mensajes fijos (sin eco de la entrada). */
export function assertQuoteLimits(lines: readonly LimitedLine[]): void {
  if (lines.length > MAX_LINES)
    throw quoteLimitsExceeded(`Máximo ${MAX_LINES} líneas por cotización`);
  let units = 0;
  let selections = 0;
  for (const line of lines) {
    if (line.selections.length > MAX_SELECTIONS_PER_LINE) {
      throw quoteLimitsExceeded(`Máximo ${MAX_SELECTIONS_PER_LINE} selecciones por línea`);
    }
    units += line.quantity;
    selections += line.selections.length;
  }
  if (units > MAX_UNITS) throw quoteLimitsExceeded(`Máximo ${MAX_UNITS} unidades por cotización`);
  if (selections > MAX_SELECTIONS_TOTAL) {
    throw quoteLimitsExceeded(`Máximo ${MAX_SELECTIONS_TOTAL} selecciones por cotización`);
  }
}

// ---------- forma de `fulfillment` ----------

export interface FulfillmentInput {
  type: 'DELIVERY';
  customerAddressId?: string | undefined;
  municipalityId?: string | undefined;
  zone?: string | null | undefined;
  deliveryProvider?: CourierProvider | undefined;
}

/**
 * Combinaciones coherentes (400 si no; ADR-0036: solo a domicilio): `DELIVERY` exige EXACTAMENTE uno de
 * `customerAddressId` o `municipalityId`, y `zone` solo acompaña a `municipalityId`. Defensa en profundidad: el DTO ya
 * rechaza cualquier `type` distinto de `DELIVERY`.
 */
export function assertFulfillmentShape(f: FulfillmentInput): void {
  if ((f.type as string) !== 'DELIVERY') {
    throw new BadRequestException(['fulfillment: solo se admite DELIVERY']);
  }
  const hasAddress = f.customerAddressId !== undefined;
  const hasMunicipality = f.municipalityId !== undefined;
  if (hasAddress === hasMunicipality) {
    throw new BadRequestException([
      'fulfillment: DELIVERY exige exactamente uno de customerAddressId o municipalityId',
    ]);
  }
  if (hasAddress && f.zone !== undefined) {
    throw new BadRequestException(['fulfillment: zone solo acompaña a municipalityId']);
  }
}

// ---------- líneas ----------

export type LineStatus =
  | 'OK'
  | 'PRICE_CHANGED'
  | 'UNAVAILABLE'
  | 'INACTIVE'
  | 'NOT_FOUND'
  | 'MODIFIER_INVALID'
  | 'OPTION_UNAVAILABLE';

export const isPurchasable = (status: LineStatus): boolean =>
  status === 'OK' || status === 'PRICE_CHANGED';

/** Violaciones de F12 que significan «una opción (o su grupo) ya no está disponible». */
const OPTION_UNAVAILABLE_CODES = new Set(['MODIFIER_INACTIVE', 'MODIFIER_NOT_IN_GROUP']);

/**
 * Estado de una línea. Precedencia: NOT_FOUND > INACTIVE > UNAVAILABLE > OPTION_UNAVAILABLE > MODIFIER_INVALID >
 * PRICE_CHANGED > OK. `clientUnitCents` (lo que VIO el cliente) solo puede producir `PRICE_CHANGED`: nunca cambia importes.
 */
export function classifyLine(input: {
  offer: BranchOfferInspection | undefined;
  extras: ModifierSelectionBatchResult | undefined;
  /** Precio efectivo vigente en centavos (solo si la línea existe). */
  effectiveUnitCents: number | null;
  clientUnitCents: number | null;
}): LineStatus {
  const { offer, extras } = input;
  if (!offer || offer.state === 'UNKNOWN' || !extras || extras.status === 'NOT_FOUND') {
    return 'NOT_FOUND';
  }
  if (offer.state === 'HIDDEN') return 'INACTIVE';
  if (offer.state === 'SOLD_OUT') return 'UNAVAILABLE';
  if (extras.status === 'INVALID') {
    return extras.violations.some((v) => OPTION_UNAVAILABLE_CODES.has(v.code))
      ? 'OPTION_UNAVAILABLE'
      : 'MODIFIER_INVALID';
  }
  if (
    input.clientUnitCents !== null &&
    input.effectiveUnitCents !== null &&
    input.clientUnitCents !== input.effectiveUnitCents
  ) {
    return 'PRICE_CHANGED';
  }
  return 'OK';
}

// ---------- entrega ----------

export interface DeliveryDecision {
  options: CheckoutDeliveryOptionDto[];
  selectedProvider: CourierProvider | null;
  /** Tarifa AL CLIENTE en centavos; `null` si no es verificable. */
  feeCents: number | null;
  blockers: string[];
}

const MONEY_CENTS = /^([0-9]{1,9})\.([0-9]{2})$/;

/** `"15.00"` -> 1500; `null` si no cumple el patrón (nunca coma flotante). */
export function moneyToCents(value: string): number | null {
  const m = MONEY_CENTS.exec(value);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('centavos fuera de rango');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Evalúa cada proveedor POR SEPARADO a partir del resultado de F09 (spec §2 Entrega):
 * - OWN: seleccionable solo con el flag encendido, zona activa y tarifa válida; `customerFee = baseFee` de la zona.
 * - PEDIDOSYA: JAMÁS seleccionable ni con tarifa (P40, `BLOCKED_EXTERNAL`); un `AVAILABLE` simulado (`MOCK`) se muestra
 *   con `simulated=true` y no habilita nada; para decidir bloqueos, un resultado simulado cuenta como `UNKNOWN`.
 * - Sin `deliveryProvider`: se elige OWN si es seleccionable; si no, `DELIVERY_UNAVAILABLE` (todos los habilitados dijeron
 *   `UNAVAILABLE`) o `DELIVERY_UNVERIFIED` (alguno `UNKNOWN`/no verificable). Con `deliveryProvider` no seleccionable:
 *   `DELIVERY_PROVIDER_NOT_SELECTABLE` y NO se cambia de proveedor en silencio.
 * El costo del proveedor no existe en ningún campo.
 */
export function decideDelivery(
  coverage: DeliveryCoverageResult,
  requested: CourierProvider | undefined,
): DeliveryDecision {
  const own = coverage.providers.OWN;
  const py = coverage.providers.PEDIDOSYA;

  const ownFee = own.baseFee === null ? null : moneyToCents(own.baseFee);
  const ownSelectable = own.enabled && own.coverageStatus === 'AVAILABLE' && ownFee !== null;
  const ownReason: string | undefined = ownSelectable
    ? undefined
    : !own.enabled
      ? 'PROVIDER_DISABLED'
      : (own.reason ?? 'NO_ZONE_COVERAGE');

  const pySimulated = py.integrationStatus === 'MOCK';
  const pyReason = !py.enabled
    ? 'PROVIDER_DISABLED'
    : pySimulated
      ? 'SIMULATED'
      : py.coverageStatus === 'AVAILABLE'
        ? 'CUSTOMER_FEE_UNDEFINED'
        : (py.reason ?? 'COVERAGE_UNKNOWN');

  const options: CheckoutDeliveryOptionDto[] = [
    {
      provider: 'PEDIDOSYA',
      enabled: py.enabled,
      coverageStatus: py.coverageStatus,
      integrationStatus: py.integrationStatus,
      simulated: pySimulated,
      customerFee: null,
      selectable: false,
      unavailableReason: pyReason,
    },
    {
      provider: 'OWN',
      enabled: own.enabled,
      coverageStatus: own.coverageStatus,
      simulated: false,
      customerFee: ownSelectable && ownFee !== null ? centsToMoney(ownFee) : null,
      selectable: ownSelectable,
      ...(ownReason ? { unavailableReason: ownReason } : {}),
    },
  ];

  if (requested !== undefined) {
    if (requested === 'OWN' && ownSelectable) {
      return { options, selectedProvider: 'OWN', feeCents: ownFee, blockers: [] };
    }
    return {
      options,
      selectedProvider: null,
      feeCents: null,
      blockers: ['DELIVERY_PROVIDER_NOT_SELECTABLE'],
    };
  }
  if (ownSelectable) return { options, selectedProvider: 'OWN', feeCents: ownFee, blockers: [] };

  // Estado EFECTIVO de cada proveedor habilitado: solo un `UNAVAILABLE` REAL cuenta como «no cubre»; un resultado
  // simulado, un `AVAILABLE` sin tarifa vendible o un `UNKNOWN` son «no verificable».
  const effective: ('UNAVAILABLE' | 'UNKNOWN')[] = [];
  if (py.enabled) {
    effective.push(py.coverageStatus === 'UNAVAILABLE' && !pySimulated ? 'UNAVAILABLE' : 'UNKNOWN');
  }
  if (own.enabled) effective.push(own.coverageStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'UNKNOWN');
  const allUnavailable = effective.every((s) => s === 'UNAVAILABLE');
  return {
    options,
    selectedProvider: null,
    feeCents: null,
    blockers: [allUnavailable ? 'DELIVERY_UNAVAILABLE' : 'DELIVERY_UNVERIFIED'],
  };
}

export function fulfillmentBlockers(codes: readonly string[]): CheckoutBlockerDto[] {
  return codes.map((code) => ({ code, scope: 'FULFILLMENT' as const }));
}
