import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { BranchOffersService } from '../branch-products/branch-offers.service.js';
import type { BranchOfferInspection } from '../branch-products/branch-products.types.js';
import {
  BRANCH_AVAILABILITY_PORT,
  type BranchAvailabilityPort,
} from '../branch-schedule/branch-availability.port.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import type { DbGate } from '../common/concurrency/db-gate.js';
import { centsToDecimal, decimalToCents } from '../common/money/money.js';
import { CustomerAddressesService } from '../customers/addresses/customer-addresses.service.js';
import { applyZoneRule, isGuatemalaCity } from '../customers/addresses/customer-address.policy.js';
import type { CustomerAddressDto } from '../customers/addresses/dto/customer-address.dto.js';
import type { DeliveryCoverageResult } from '../delivery-coverage/coverage.types.js';
import {
  DELIVERY_COVERAGE_PORT,
  type DeliveryCoveragePort,
} from '../delivery-coverage/delivery-coverage.service.js';
import { normalizeZoneLabel } from '../delivery-coverage/zone-policy.js';
import { LocationsService } from '../locations/locations.service.js';
import { ModifierSelectionService } from '../modifiers/modifier-selection.service.js';
import type { ModifierSelectionBatchResult } from '../modifiers/modifiers.types.js';
import { PromotionCandidatesService } from '../promotions/promotion-candidates.service.js';
import {
  normalizeCouponCode,
  PromotionEvaluator,
  type EvaluatorPromotion,
} from '../promotions/promotion-evaluator.js';
import {
  branchNotAvailable,
  CHECKOUT_DB_GATE,
  CHECKOUT_QUOTE_SECRET_TOKEN,
  municipalityNotFound,
  translateCheckoutDbError,
} from './checkout-errors.js';
import {
  assertFulfillmentShape,
  assertQuoteLimits,
  classifyLine,
  decideDelivery,
  fulfillmentBlockers,
  isPurchasable,
  moneyToCents,
  QUOTE_TTL_SECONDS,
} from './checkout-policy.js';
import type { CheckoutQuoteRequestDto } from './dto/checkout-quote-request.dto.js';
import type {
  CheckoutBlockerDto,
  CheckoutDeliveryDto,
  CheckoutNoticeDto,
  CheckoutQuoteDto,
} from './dto/checkout-quote-responses.dto.js';
import { evaluateDiscounts, priceQuote, type EngineLine } from './quote-engine.js';
import { canonicalInput, canonicalLines } from './quote-canon.js';
import {
  inputHashOf,
  linesHashOf,
  MIN_SECRET_LENGTH,
  signQuoteToken,
  subjectOf,
  type QuoteEvidence,
} from './quote-token.js';

export interface ResolvedSavedAddress {
  addressLine: string;
  referenceNote: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Lugar de entrega ya resuelto por la cotización (F20 lo copia al snapshot sin releer la BD). */
export interface ResolvedPlace {
  municipalityId: string;
  municipalityName: string;
  zone: string | null;
  savedAddress: ResolvedSavedAddress | null;
}

/** Resultado de `quoteWithEvidence`: la cotización pública + lo que F20 compara contra el token + el lugar resuelto. */
export interface QuoteWithEvidence {
  quote: CheckoutQuoteDto;
  /** Payload del token que se habría firmado; `null` si no `canProceed` o si no hay secreto utilizable. */
  evidence: QuoteEvidence | null;
  resolved: { place: ResolvedPlace | null };
}

/** Lo que la cotización necesita saber del lugar de entrega (municipio + zona ya resueltos). */
interface Place {
  municipalityId: string;
  municipalityName: string;
  /** Dirección guardada del cliente (copia para el snapshot del pedido); `null` con municipio + zona. */
  savedAddress: ResolvedSavedAddress | null;
  /** Zona normalizada (`null` = sin zona). En la ciudad de Guatemala, solo la forma canónica «Zona N». */
  zone: string | null;
  /** `true` si falta información obligatoria (ciudad de Guatemala sin «Zona N» válida): no se consulta cobertura. */
  incomplete: boolean;
}

interface BranchClock {
  accepted: boolean;
  reason: string;
  nextOpensAt: Date | null;
}

interface Loaded {
  branch: BranchClock;
  offers: Map<string, BranchOfferInspection>;
  extras: ModifierSelectionBatchResult[];
  promotions: EvaluatorPromotion[];
  truncated: boolean;
  place: Place | null;
  coverage: DeliveryCoverageResult | null;
}

type QuoteBody = Pick<
  CheckoutQuoteRequestDto,
  'cart' | 'fulfillment' | 'couponCode' | 'clientView'
>;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

/** `[{groupId, optionId}]` -> `[{groupId, modifierIds[]}]` (adaptador de F12), conservando el orden de aparición. */
function groupSelections(line: {
  selections: readonly { groupId: string; optionId: string }[];
}): { groupId: string; modifierIds: string[] }[] {
  const byGroup = new Map<string, string[]>();
  for (const s of line.selections) {
    const list = byGroup.get(s.groupId);
    if (list) list.push(s.optionId);
    else byGroup.set(s.groupId, [s.optionId]);
  }
  return [...byGroup].map(([groupId, modifierIds]) => ({ groupId, modifierIds }));
}

/**
 * Cotizador de checkout (F19, spec 020, ADR-0025). ORQUESTA los servicios de dominio ya existentes sin duplicar sus
 * reglas: precio efectivo y estado (`BranchOffersService.inspect`, F13), extras por lote (`ModifierSelectionService
 * .validateMany`, F12), descuentos (`PromotionCandidatesService` + `PromotionEvaluator`, F15), horario
 * (`BranchAvailabilityPort`, F08), cobertura y tarifa OWN (`DeliveryCoveragePort`, F09) y dirección guardada
 * (`CustomerAddressesService.get`, F05, anti-IDOR). SIN efectos: no escribe en la BD, no crea pedidos ni reserva.
 *
 * Lectura en 2 oleadas paralelas dentro de `CHECKOUT_DB_GATE` (presupuesto <= ~10 consultas, sin N+1):
 *  1) horario (1), ofertas (2: productos + categorías visibles), extras por lote (1), candidatas de promoción (1) y el
 *     lugar de entrega (municipio 1 | dirección guardada 2);  2) cobertura (<= 2, solo DELIVERY completo).
 * El cliente NUNCA aporta importes: `clientView` solo produce avisos (`PRICE_CHANGED`, `TOTAL_CHANGED`).
 */
@Injectable()
export class CheckoutQuoteService {
  private readonly logger = new Logger(CheckoutQuoteService.name);

  constructor(
    @Inject(BranchOffersService) private readonly offers: BranchOffersService,
    @Inject(ModifierSelectionService) private readonly modifiers: ModifierSelectionService,
    @Inject(PromotionCandidatesService) private readonly candidates: PromotionCandidatesService,
    @Inject(PromotionEvaluator) private readonly evaluator: PromotionEvaluator,
    @Inject(BRANCH_AVAILABILITY_PORT) private readonly availability: BranchAvailabilityPort,
    @Inject(DELIVERY_COVERAGE_PORT) private readonly coverage: DeliveryCoveragePort,
    @Inject(CustomerAddressesService) private readonly addresses: CustomerAddressesService,
    @Inject(LocationsService) private readonly locations: LocationsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CHECKOUT_DB_GATE) private readonly gate: DbGate,
    @Inject(CHECKOUT_QUOTE_SECRET_TOKEN) private readonly secret: string | undefined,
  ) {}

  async quote(
    principal: Principal | undefined,
    body: CheckoutQuoteRequestDto,
  ): Promise<CheckoutQuoteDto> {
    return (await this.quoteWithEvidence(principal, body)).quote;
  }

  /**
   * Misma cotización que `quote()` (que delega aquí sin cambiar su resultado) más la evidencia que F20 compara con el
   * token y el lugar de entrega resuelto (ADR-0026 D2). Una sola pasada de lecturas; sin efectos.
   */
  async quoteWithEvidence(
    principal: Principal | undefined,
    body: Pick<CheckoutQuoteRequestDto, 'cart' | 'fulfillment' | 'couponCode' | 'clientView'>,
  ): Promise<QuoteWithEvidence> {
    const { cart, fulfillment } = body;
    assertQuoteLimits(cart.lines);
    assertFulfillmentShape(fulfillment);
    if (fulfillment.customerAddressId !== undefined && !principal) {
      throw new UnauthorizedException('No autenticado');
    }
    const zoneLabel = normalizeZoneLabel(fulfillment.zone);
    const coupon = normalizeCouponCode(body.couponCode);
    const at = this.clock.now();

    let loaded: Loaded;
    try {
      loaded = await this.gate.run(() => this.load(principal, body, zoneLabel, coupon, at));
    } catch (error) {
      throw translateCheckoutDbError(error);
    }
    return this.assemble(principal, body, loaded, coupon, zoneLabel, at);
  }

  // ---------- lectura (2 oleadas) ----------

  private async load(
    principal: Principal | undefined,
    body: QuoteBody,
    zoneLabel: string | null,
    coupon: string | null,
    at: Date,
  ): Promise<Loaded> {
    const { cart, fulfillment } = body;
    const productIds = [...new Set(cart.lines.map((l) => l.productId))];

    // Oleada 1: todo lo independiente, en paralelo.
    const [branch, offers, extras, promos, place] = await Promise.all([
      settle(this.availability.canAcceptOrderNow(cart.branchId)),
      settle(this.offers.inspect(cart.branchId, productIds)),
      settle(
        this.modifiers.validateMany(
          cart.lines.map((l) => ({ productId: l.productId, selections: groupSelections(l) })),
        ),
      ),
      settle(this.candidates.load(cart.branchId, at, coupon)),
      settle(this.resolvePlace(principal, fulfillment, zoneLabel)),
    ]);

    // Prioridad de errores determinista: sucursal (422) > lugar (401/404/422) > resto.
    if (!branch.ok) {
      throw branch.error instanceof NotFoundException ? branchNotAvailable() : branch.error;
    }
    if (branch.value.reason === 'INACTIVE') throw branchNotAvailable();
    if (!place.ok) throw place.error;
    if (!offers.ok) throw offers.error;
    if (!extras.ok) throw extras.error;
    if (!promos.ok) throw promos.error;

    // Oleada 2: cobertura, solo a domicilio y con dirección completa.
    const coverage =
      place.value && !place.value.incomplete
        ? await this.coverage.check({
            branchId: cart.branchId,
            municipalityId: place.value.municipalityId,
            zone: place.value.zone,
          })
        : null;

    return {
      branch: branch.value,
      offers: offers.value,
      extras: extras.value,
      promotions: promos.value.promotions,
      truncated: promos.value.truncated,
      place: place.value,
      coverage,
    };
  }

  /** Municipio y zona del lugar de entrega. Dirección guardada: SIEMPRE con el cliente del JWT (404 igual si es ajena). */
  private async resolvePlace(
    principal: Principal | undefined,
    fulfillment: QuoteBody['fulfillment'],
    zoneLabel: string | null,
  ): Promise<Place | null> {
    if (fulfillment.customerAddressId !== undefined) {
      if (!principal) throw new UnauthorizedException('No autenticado');
      const address: CustomerAddressDto = await this.addresses.get(
        principal,
        fulfillment.customerAddressId,
      );
      return placeOf(
        address.municipality.id,
        address.municipality.name,
        isGuatemalaCity(address.municipality.name, address.department.name),
        address.zone,
        {
          addressLine: address.addressLine,
          referenceNote: address.referenceNote,
          latitude: address.latitude,
          longitude: address.longitude,
        },
      );
    }
    const municipality = await this.locations.findMunicipality(
      fulfillment.municipalityId as string,
    );
    if (!municipality) throw municipalityNotFound();
    return placeOf(
      municipality.id,
      municipality.name,
      isGuatemalaCity(municipality.name, municipality.departmentName),
      zoneLabel,
      null,
    );
  }

  // ---------- composición (pura, sin I/O) ----------

  private assemble(
    principal: Principal | undefined,
    body: QuoteBody,
    loaded: Loaded,
    coupon: string | null,
    zoneLabel: string | null,
    at: Date,
  ): QuoteWithEvidence {
    const { cart, fulfillment } = body;

    // Lo que el cliente VIO: solo para avisos; nunca entra en un cálculo.
    const seen = new Map<number, number>();
    for (const v of body.clientView?.lines ?? []) {
      const cents = moneyToCents(v.unitPrice);
      if (cents !== null && !seen.has(v.index)) seen.set(v.index, cents);
    }

    const lines: EngineLine[] = cart.lines.map((line, index) => {
      const offer = loaded.offers.get(line.productId);
      const extras = loaded.extras[index];
      const unitCents = offer?.price ? decimalToCents(offer.price) : null;
      const clientUnitCents = seen.get(index) ?? null;
      const status = classifyLine({
        offer,
        extras,
        effectiveUnitCents: unitCents,
        clientUnitCents,
      });
      const ok = extras?.status === 'OK' ? extras : null;
      return {
        index,
        productId: line.productId,
        quantity: line.quantity,
        status,
        unitCents,
        extrasPerUnitCents: ok ? decimalToCents(ok.extraTotal) : 0,
        modifiers: ok
          ? ok.items.map((it) => ({
              groupId: it.groupId,
              optionId: it.modifierId,
              extraPrice: centsToDecimal(decimalToCents(it.extraPrice)),
            }))
          : [],
        previousUnitPrice: clientUnitCents === null ? null : centsToDecimal(clientUnitCents),
      };
    });

    const evaluation = evaluateDiscounts(this.evaluator, {
      at,
      branchId: cart.branchId,
      mode: 'delivery',
      couponCode: coupon,
      promotions: loaded.promotions,
      lines,
    });
    // Sin el código ni PII: solo el hecho (contador) de que un cupón pedido no se aplicó.
    if (evaluation.internalCouponUnknown) this.logger.debug('cupón no vigente o desconocido');

    // Entrega.
    let delivery: CheckoutDeliveryDto;
    let feeCents: number | null;
    let fulfillmentCodes: string[];
    if (loaded.place?.incomplete || !loaded.coverage) {
      delivery = { selectedProvider: null, options: [] };
      feeCents = null;
      fulfillmentCodes = ['ADDRESS_INCOMPLETE'];
    } else {
      const decision = decideDelivery(loaded.coverage, fulfillment.deliveryProvider);
      delivery = { selectedProvider: decision.selectedProvider, options: decision.options };
      feeCents = decision.feeCents;
      fulfillmentCodes = decision.blockers;
    }

    const amounts = priceQuote(lines, evaluation.discounts, feeCents);

    const blockers: CheckoutBlockerDto[] = [
      ...lines
        .filter((l) => !isPurchasable(l.status))
        .map((l) => ({ code: l.status, scope: 'LINE' as const, lineIndex: l.index })),
      ...(loaded.branch.accepted ? [] : [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' as const }]),
      ...fulfillmentBlockers(fulfillmentCodes),
    ];
    const notices: CheckoutNoticeDto[] = lines
      .filter((l) => l.status === 'PRICE_CHANGED')
      .map((l) => ({ code: 'PRICE_CHANGED', lineIndex: l.index }));
    if (body.clientView?.total !== undefined && amounts.totalCents !== null) {
      if (moneyToCents(body.clientView.total) !== amounts.totalCents) {
        notices.push({ code: 'TOTAL_CHANGED' });
      }
    }
    if (loaded.truncated) notices.push({ code: 'PROMOTIONS_TRUNCATED' });

    const canProceed = blockers.length === 0;
    const generatedAt = at.toISOString();
    const expiresAt = new Date(at.getTime() + QUOTE_TTL_SECONDS * 1000);
    const evidence =
      canProceed &&
      this.secret !== undefined &&
      this.secret.length >= MIN_SECRET_LENGTH &&
      amounts.total !== null
        ? this.evidenceOf(principal, body, coupon, zoneLabel, amounts, delivery)
        : null;
    const iat = Math.floor(at.getTime() / 1000);
    const dto: CheckoutQuoteDto = {
      quote: {
        generatedAt,
        expiresAt: expiresAt.toISOString(),
        token:
          evidence === null
            ? null
            : signQuoteToken(
                { v: 1, iat, exp: iat + QUOTE_TTL_SECONDS, ...evidence },
                this.secret as string,
              ),
      },
      currency: 'GTQ',
      branch: {
        id: cart.branchId,
        isAcceptingOrders: loaded.branch.accepted,
        reason: loaded.branch.reason,
        nextOpensAt: loaded.branch.nextOpensAt?.toISOString() ?? null,
      },
      fulfillment: { type: fulfillment.type, delivery },
      lines: amounts.lines,
      subtotal: amounts.subtotal,
      extrasTotal: amounts.extrasTotal,
      discountTotal: amounts.discountTotal,
      deliveryFee: amounts.deliveryFee,
      total: amounts.total,
      coupon: evaluation.coupon,
      canProceed,
      blockers,
      notices,
    };
    const place = loaded.place;
    return {
      quote: dto,
      evidence,
      resolved: {
        place: place
          ? {
              municipalityId: place.municipalityId,
              municipalityName: place.municipalityName,
              zone: place.zone,
              savedAddress: place.savedAddress,
            }
          : null,
      },
    };
  }

  /** Payload (sin vigencia) que firma el token y que F20 compara tras recotizar. */
  private evidenceOf(
    principal: Principal | undefined,
    body: QuoteBody,
    coupon: string | null,
    zoneLabel: string | null,
    amounts: ReturnType<typeof priceQuote>,
    delivery: CheckoutDeliveryDto | null,
  ): QuoteEvidence {
    const secret = this.secret as string;
    return {
      branchId: body.cart.branchId,
      type: body.fulfillment.type,
      provider: delivery?.selectedProvider ?? null,
      subtotal: amounts.subtotal,
      discountTotal: amounts.discountTotal,
      deliveryFee: amounts.deliveryFee as string,
      total: amounts.total as string,
      inputHash: inputHashOf(secret, canonicalInput(body, coupon, zoneLabel)),
      sub: subjectOf(secret, principal?.authUserId ?? null),
      linesHash: linesHashOf(secret, canonicalLines(amounts.lines)),
    };
  }
}

/** Regla de zona de F05/C2: en la ciudad de Guatemala la zona es obligatoria con formato «Zona N»; si no, incompleta. */
function placeOf(
  municipalityId: string,
  municipalityName: string,
  city: boolean,
  rawZone: string | null,
  savedAddress: ResolvedSavedAddress | null,
): Place {
  const base = { municipalityId, municipalityName, savedAddress };
  if (!city) return { ...base, zone: rawZone, incomplete: false };
  const rule = applyZoneRule(rawZone, true);
  return rule.ok
    ? { ...base, zone: rule.value, incomplete: false }
    : { ...base, zone: null, incomplete: true };
}
