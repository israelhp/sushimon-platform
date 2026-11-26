import type {
  CheckoutBlocker,
  CheckoutDeliveryOption,
  CheckoutNotice,
  CheckoutQuote,
  CheckoutQuoteLine,
  CheckoutLineStatus,
} from '@/lib/data-access/models';
import { moneyToCents } from '@/lib/checkout-quote';
import { coverageZoneOf } from '@/lib/delivery-zone';
import { validateSelection, type RuleGroup } from '@/lib/modifier-rules';
import { priceToCents, centsToPrice } from '@/lib/product-rules';
import {
  computeLineDiscount,
  decimalToCents,
  normalizePromotionCode,
  promotionTimes,
} from '@/lib/promotion-rules';
import { availableAt, badRequest, effectivePriceAt, fail, failCode } from '../domain';
import { evaluateOwn, evaluatePedidosYa } from '../coverage';
import { inputHashOf, linesHashOf, mintMockQuoteToken } from '../quote-token';
import { MUNICIPALITY_SEEDS, municipalityByName } from '../fixtures/geography';
import type { PromotionRecord } from '../fixtures/promotions';
import type { MockStore } from '../store';
import { isProductVisible } from './products';
import { availabilityFor } from './schedule';
import { now, requireCustomer, type Handler, type Req } from './shared';

/**
 * F19 — `POST /v1/checkout/quote` (spec 020, ADR-0025). SIMULADO: el mock EMULA al servidor con la MISMA forma del contrato
 * (`CheckoutQuote`) pero con `quote.token = null` y una vigencia ficticia de 10 min sobre el reloj de la demo. Sin efectos:
 * no crea pedidos, pagos ni entregas, no reserva inventario.
 *
 * Reglas reproducidas: 400 de forma (propiedades desconocidas como `price|fee|total|discount`, combinación incoherente de
 * `fulfillment`, topes → `QUOTE_LIMITS_EXCEEDED`), 401 `customerAddressId` sin sesión, 404 dirección ajena/inexistente (igual),
 * 422 `BRANCH_NOT_AVAILABLE` / `MUNICIPALITY_NOT_FOUND`, 503 `CHECKOUT_BUSY` (determinista: `store.checkoutBusy`); estados de línea con la
 * precedencia del contrato; extras con las reglas de F12; precio efectivo de sucursal (F13); una promoción por línea (la de mayor
 * ahorro; los extras no se descuentan; las de «solo en local» no aplican) y cupón colapsado `APPLIED|NOT_APPLIED` sin motivo;
 * horario de sucursal (F08); entrega propia con zona (F09) y PedidosYa SIEMPRE no seleccionable (`UNKNOWN`/simulado, sin tarifa);
 * aritmética en centavos enteros. NO simula límite de tasa, `Cache-Control` ni la forma UUID.
 */

const MAX_LINES = 30;
const MAX_QUANTITY = 99;
const MAX_UNITS = 200;
const MAX_LINE_SELECTIONS = 30;
const MAX_SELECTIONS = 300;
const MAX_COUPON = 64;
const QUOTE_TTL_MS = 600_000;
const MONEY = /^\d{1,9}\.\d{2}$/;
const CITY_MUNICIPALITY = municipalityByName('Guatemala', 'Guatemala');

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function strictKeys(raw: Obj, allowed: readonly string[], where: string, out: string[]) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) out.push(`${where}${key}: campo no permitido`);
  }
}

interface ParsedLine {
  productId: string;
  quantity: number;
  selections: { groupId: string; optionId: string }[];
}

interface ParsedRequest {
  branchId: string;
  lines: ParsedLine[];
  /** ADR-0036: solo a domicilio e inmediato (PICKUP => 400). */
  fulfillment: {
    type: 'DELIVERY';
    customerAddressId?: string;
    municipalityId?: string;
    zone: string | null;
    deliveryProvider?: 'OWN' | 'PEDIDOSYA';
  };
  couponCode: string;
  clientView: { lines: Map<number, string>; total: string | null };
}

/** Validación de FORMA (400). Nunca acepta importes: `price|fee|total|discount` son propiedades desconocidas. */
function parse(req: Req): ParsedRequest {
  const problems: string[] = [];
  const raw = req.body;
  if (!isObj(raw)) badRequest(['Cuerpo de la solicitud inválido']);
  strictKeys(raw, ['cart', 'fulfillment', 'couponCode', 'clientView'], '', problems);

  const cart = isObj(raw.cart) ? raw.cart : null;
  if (!cart) problems.push('cart: obligatorio');
  const lines: ParsedLine[] = [];
  let branchId = '';
  if (cart) {
    strictKeys(cart, ['branchId', 'lines'], 'cart.', problems);
    if (typeof cart.branchId !== 'string' || !cart.branchId)
      problems.push('cart.branchId: obligatorio');
    else branchId = cart.branchId;
    if (!Array.isArray(cart.lines) || cart.lines.length < 1 || cart.lines.length > MAX_LINES) {
      problems.push(`cart.lines: entre 1 y ${MAX_LINES} líneas`);
    } else {
      cart.lines.forEach((line: unknown, i: number) => {
        const where = `cart.lines[${i}].`;
        if (!isObj(line)) return problems.push(`cart.lines[${i}]: inválida`);
        strictKeys(line, ['productId', 'quantity', 'selections'], where, problems);
        const q = line.quantity;
        if (typeof line.productId !== 'string' || !line.productId) {
          problems.push(`${where}productId: obligatorio`);
        }
        if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) {
          problems.push(`${where}quantity: entero entre 1 y ${MAX_QUANTITY}`);
        }
        const selections: ParsedLine['selections'] = [];
        if (!Array.isArray(line.selections)) problems.push(`${where}selections: obligatorio`);
        else {
          line.selections.forEach((s: unknown, j: number) => {
            if (!isObj(s)) return problems.push(`${where}selections[${j}]: inválida`);
            strictKeys(
              s,
              ['groupId', 'optionId', 'quantity'],
              `${where}selections[${j}].`,
              problems,
            );
            if (
              typeof s.groupId !== 'string' ||
              typeof s.optionId !== 'string' ||
              s.quantity !== 1
            ) {
              problems.push(`${where}selections[${j}]: groupId, optionId y quantity=1`);
            } else selections.push({ groupId: s.groupId, optionId: s.optionId });
          });
        }
        lines.push({
          productId: typeof line.productId === 'string' ? line.productId : '',
          quantity: typeof q === 'number' ? q : 0,
          selections,
        });
      });
    }
  }

  const fulfillment = isObj(raw.fulfillment) ? raw.fulfillment : null;
  let parsedFulfillment: ParsedRequest['fulfillment'] = { type: 'DELIVERY', zone: null };
  if (!fulfillment) problems.push('fulfillment: obligatorio');
  else {
    strictKeys(
      fulfillment,
      ['type', 'customerAddressId', 'municipalityId', 'zone', 'deliveryProvider'],
      'fulfillment.',
      problems,
    );
    if (fulfillment.type === 'DELIVERY') {
      const hasAddress = fulfillment.customerAddressId !== undefined;
      const hasMunicipality = fulfillment.municipalityId !== undefined;
      if (hasAddress === hasMunicipality) {
        problems.push('fulfillment: exactamente uno de customerAddressId o municipalityId');
      }
      if (hasAddress && fulfillment.zone !== undefined) {
        problems.push('fulfillment.zone: solo con municipalityId');
      }
      const provider = fulfillment.deliveryProvider;
      if (provider !== undefined && provider !== 'OWN' && provider !== 'PEDIDOSYA') {
        problems.push('fulfillment.deliveryProvider: OWN o PEDIDOSYA');
      }
      const zone = fulfillment.zone;
      if (zone !== undefined && zone !== null && (typeof zone !== 'string' || zone.length > 60)) {
        problems.push('fulfillment.zone: texto de hasta 60 caracteres o null');
      }
      parsedFulfillment = {
        type: 'DELIVERY',
        customerAddressId:
          typeof fulfillment.customerAddressId === 'string'
            ? fulfillment.customerAddressId
            : undefined,
        municipalityId:
          typeof fulfillment.municipalityId === 'string' ? fulfillment.municipalityId : undefined,
        zone: typeof zone === 'string' ? zone : null,
        deliveryProvider: provider === 'OWN' || provider === 'PEDIDOSYA' ? provider : undefined,
      };
    } else problems.push('fulfillment.type: solo DELIVERY (no hay recogida en sucursal)');
  }

  let couponCode = '';
  if (raw.couponCode !== undefined) {
    if (typeof raw.couponCode !== 'string' || raw.couponCode.length > MAX_COUPON) {
      problems.push(`couponCode: texto de hasta ${MAX_COUPON} caracteres`);
    } else couponCode = normalizePromotionCode(raw.couponCode);
  }

  const clientView: ParsedRequest['clientView'] = { lines: new Map(), total: null };
  if (raw.clientView !== undefined) {
    if (!isObj(raw.clientView)) problems.push('clientView: inválido');
    else {
      strictKeys(raw.clientView, ['lines', 'total'], 'clientView.', problems);
      const view = raw.clientView;
      if (view.total !== undefined) {
        if (typeof view.total === 'string' && MONEY.test(view.total)) clientView.total = view.total;
        else problems.push('clientView.total: importe decimal de 2 posiciones');
      }
      if (view.lines !== undefined) {
        if (!Array.isArray(view.lines) || view.lines.length > MAX_LINES) {
          problems.push('clientView.lines: inválido');
        } else {
          view.lines.forEach((l: unknown, i: number) => {
            if (!isObj(l)) return problems.push(`clientView.lines[${i}]: inválida`);
            strictKeys(l, ['index', 'unitPrice'], `clientView.lines[${i}].`, problems);
            if (
              typeof l.index === 'number' &&
              Number.isInteger(l.index) &&
              typeof l.unitPrice === 'string' &&
              MONEY.test(l.unitPrice)
            ) {
              clientView.lines.set(l.index, l.unitPrice);
            } else problems.push(`clientView.lines[${i}]: index y unitPrice`);
          });
        }
      }
    }
  }
  if (problems.length) badRequest(problems);

  const units = lines.reduce((n, l) => n + l.quantity, 0);
  const selections = lines.reduce((n, l) => n + l.selections.length, 0);
  if (
    units > MAX_UNITS ||
    selections > MAX_SELECTIONS ||
    lines.some((l) => l.selections.length > MAX_LINE_SELECTIONS)
  ) {
    failCode(400, 'QUOTE_LIMITS_EXCEEDED', 'La cotización supera los topes permitidos');
  }
  return { branchId, lines, fulfillment: parsedFulfillment, couponCode, clientView };
}

// ── Líneas ────────────────────────────────────────────────────────────────────────────────

/** Grupos del producto con sus opciones (activas o no), como `ModifierSelectionService` los lee. */
function groupsOf(store: MockStore, productId: string): RuleGroup[] {
  return (store.productModifierGroups[productId] ?? []).flatMap((groupId) => {
    const group = store.modifierGroups.find((g) => g.id === groupId);
    if (!group) return [];
    return [
      {
        id: group.id,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        active: group.active,
        options: store.modifiers
          .filter((m) => m.groupId === group.id)
          .map((m) => ({ id: m.id, name: m.name, extraPrice: m.extraPrice, active: m.active })),
      },
    ];
  });
}

interface LineCalc {
  status: CheckoutLineStatus;
  unitCents: number | null;
  extrasCents: number | null;
  modifiers: CheckoutQuoteLine['modifiers'];
}

function evaluateLine(store: MockStore, branchId: string, line: ParsedLine): LineCalc {
  const none = { unitCents: null, extrasCents: null, modifiers: [] };
  const product = store.products.find((p) => p.id === line.productId);
  if (!product) return { status: 'NOT_FOUND', ...none };
  if (!isProductVisible(store, product)) return { status: 'INACTIVE', ...none };
  if (!availableAt(store, product, branchId)) return { status: 'UNAVAILABLE', ...none };

  // Una selección por grupo (el carrito manda una entrada por opción): se agrupa por `groupId`.
  const byGroup = new Map<string, string[]>();
  for (const s of line.selections)
    byGroup.set(s.groupId, [...(byGroup.get(s.groupId) ?? []), s.optionId]);
  const result = validateSelection(
    groupsOf(store, product.id),
    [...byGroup].map(([groupId, modifierIds]) => ({ groupId, modifierIds })),
  );
  if (!result.ok) {
    const optionGone = result.violations.some(
      (v) => v.code === 'MODIFIER_INACTIVE' || v.code === 'MODIFIER_NOT_IN_GROUP',
    );
    return { status: optionGone ? 'OPTION_UNAVAILABLE' : 'MODIFIER_INVALID', ...none };
  }
  const unitCents = priceToCents(effectivePriceAt(store, product, branchId));
  if (unitCents === null) return { status: 'INACTIVE', ...none };
  return {
    status: 'OK',
    unitCents,
    extrasCents: result.extraCents,
    modifiers: result.items.map((i) => ({
      groupId: i.groupId,
      optionId: i.modifierId,
      extraPrice: i.extraPrice,
    })),
  };
}

// ── Promociones ───────────────────────────────────────────────────────────────────────────

const appliesToBranch = (p: PromotionRecord, branchId: string) =>
  p.branchScope === 'ALL' || p.branchIds.includes(branchId);
const appliesToProduct = (p: PromotionRecord, productId: string) =>
  p.productScope === 'ALL' || p.productIds.includes(productId);

/** Candidatas: automáticas vigentes de la sucursal + el cupón escrito si coincide. «Solo en local» no aplica a domicilio/retiro. */
function candidatesOf(store: MockStore, branchId: string, couponCode: string, at: Date) {
  return store.promotions.filter(
    (p) =>
      p.active &&
      !p.dineInOnly &&
      appliesToBranch(p, branchId) &&
      promotionTimes(p, at).live &&
      (p.code === null || (couponCode !== '' && normalizePromotionCode(p.code) === couponCode)),
  );
}

// ── Entrega ───────────────────────────────────────────────────────────────────────────────

interface DeliveryResult {
  delivery: NonNullable<CheckoutQuote['fulfillment']['delivery']>;
  feeCents: number | null;
  blockers: CheckoutBlocker[];
}

function savedAddressTarget(req: Req, addressId: string) {
  // Sin sesión: 401 (la API real exige sesión de cliente para `customerAddressId`).
  if (!req.context.session.customer) fail(401, 'Inicia sesión para usar una dirección guardada');
  const stored = requireCustomer(req).addresses.find((a) => a.id === addressId);
  // Ajena e inexistente responden IGUAL (anti-IDOR).
  if (!stored) failCode(404, 'ADDRESS_NOT_FOUND', 'Dirección no encontrada');
  const municipality = municipalityByName(stored.department, stored.municipality);
  return { municipalityId: municipality?.id ?? null, zone: coverageZoneOf(stored.zone) };
}

function evaluateDelivery(req: Req, parsed: ParsedRequest): DeliveryResult {
  const { store } = req;
  const { branchId } = parsed;
  const f = parsed.fulfillment;
  let municipalityId: string | null;
  let zone: string | null;
  if (f.customerAddressId) {
    ({ municipalityId, zone } = savedAddressTarget(req, f.customerAddressId));
  } else {
    municipalityId = f.municipalityId ?? null;
    zone = f.zone;
  }
  if (municipalityId !== null && !MUNICIPALITY_SEEDS.some((m) => m.id === municipalityId)) {
    failCode(422, 'MUNICIPALITY_NOT_FOUND', 'El municipio no existe');
  }

  const blockers: CheckoutBlocker[] = [];
  const zoneOk = /^zona\s+\d{1,3}$/i.test((zone ?? '').trim());
  // En la ciudad de Guatemala la zona es obligatoria («Zona N», decisión C2 de F05).
  const incomplete =
    municipalityId === null || (municipalityId === CITY_MUNICIPALITY?.id && !zoneOk);
  const own = evaluateOwn(store, branchId, municipalityId ?? '', zone);
  const py = evaluatePedidosYa(store, branchId);

  const ownOption: CheckoutDeliveryOption = {
    provider: 'OWN',
    enabled: own.enabled,
    coverageStatus: own.coverageStatus,
    simulated: false,
    customerFee: own.coverageStatus === 'AVAILABLE' && own.enabled ? own.baseFee : null,
    selectable: own.enabled && own.coverageStatus === 'AVAILABLE' && !incomplete,
    ...(own.enabled && own.coverageStatus === 'AVAILABLE'
      ? {}
      : { unavailableReason: own.reason ?? 'NO_ZONE_COVERAGE' }),
  };
  const simulated = py.integrationStatus === 'MOCK';
  const pyOption: CheckoutDeliveryOption = {
    provider: 'PEDIDOSYA',
    enabled: py.enabled,
    coverageStatus: py.coverageStatus,
    integrationStatus: py.integrationStatus,
    simulated,
    // La tarifa al cliente con PedidosYa no está definida (P40): nunca se ofrece ni se puede elegir.
    customerFee: null,
    selectable: false,
    unavailableReason: !py.enabled
      ? 'PROVIDER_DISABLED'
      : simulated
        ? 'SIMULATED'
        : py.coverageStatus === 'UNAVAILABLE'
          ? 'NO_ZONE_COVERAGE'
          : 'COVERAGE_UNKNOWN',
  };
  const options = [ownOption, pyOption];

  if (incomplete) {
    blockers.push({ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' });
    return {
      delivery: { selectedProvider: null, options },
      feeCents: null,
      blockers,
    };
  }

  const preference = f.deliveryProvider;
  const preferred = preference ? options.find((o) => o.provider === preference) : undefined;
  let selected: CheckoutDeliveryOption | undefined;
  if (preference) {
    if (preferred?.selectable) selected = preferred;
    else blockers.push({ code: 'DELIVERY_PROVIDER_NOT_SELECTABLE', scope: 'FULFILLMENT' });
  } else {
    selected = options.find((o) => o.selectable);
    if (!selected) {
      const enabled = options.filter((o) => o.enabled);
      const allUnavailable = enabled.every((o) => o.coverageStatus === 'UNAVAILABLE');
      blockers.push({
        code: allUnavailable ? 'DELIVERY_UNAVAILABLE' : 'DELIVERY_UNVERIFIED',
        scope: 'FULFILLMENT',
      });
    }
  }
  const feeCents = selected ? (moneyToCents(selected.customerFee) ?? null) : null;
  return {
    delivery: { selectedProvider: selected?.provider ?? null, options },
    feeCents,
    blockers,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────────────────

const money = (cents: number) => centsToPrice(cents);

/** POST /v1/checkout/quote — SIMULADO, sin efectos. */
export const quoteCheckout: Handler = (req): CheckoutQuote => {
  const { store } = req;
  // Determinista (pruebas): el semáforo de lecturas se agotó; reintentable.
  if ((store.checkoutBusy ?? 0) > 0) {
    store.checkoutBusy = (store.checkoutBusy ?? 0) - 1;
    failCode(503, 'CHECKOUT_BUSY', 'Hay muchas solicitudes; reintenta en unos segundos');
  }
  const parsed = parse(req);
  const branch = store.branches.find((b) => b.id === parsed.branchId);
  if (!branch || !branch.active || branch.status !== 'active') {
    failCode(422, 'BRANCH_NOT_AVAILABLE', 'La sucursal no está disponible');
  }
  const at = now(req);
  const availability = availabilityFor(store, branch, at);

  // Líneas y descuentos (centavos enteros). Los extras NO se descuentan.
  const candidates = candidatesOf(store, branch.id, parsed.couponCode, at);
  let couponApplied = false;
  const lines: CheckoutQuoteLine[] = [];
  const notices: CheckoutNotice[] = [];
  const blockers: CheckoutBlocker[] = [];
  let subtotal = 0;
  let extrasTotal = 0;
  let discountTotal = 0;
  let allPurchasable = true;

  parsed.lines.forEach((line, index) => {
    const calc = evaluateLine(store, branch.id, line);
    const seen = parsed.clientView.lines.get(index);
    const purchasable = calc.unitCents !== null && calc.extrasCents !== null;
    if (!purchasable) {
      allPurchasable = false;
      blockers.push({ code: calc.status, scope: 'LINE', lineIndex: index });
      lines.push({
        index,
        productId: line.productId,
        quantity: line.quantity,
        status: calc.status,
        unitPrice: null,
        modifiers: [],
        extrasPerUnit: null,
        lineSubtotal: null,
        discount: null,
        promotionId: null,
        lineTotal: null,
        previousUnitPrice: null,
      });
      return;
    }
    const unitCents = calc.unitCents as number;
    const extrasCents = calc.extrasCents as number;
    let best: { id: string; discount: number; coupon: boolean } | null = null;
    for (const p of candidates) {
      if (!appliesToProduct(p, line.productId)) continue;
      const value = decimalToCents(p.value);
      if (value === null) continue;
      const { discount } = computeLineDiscount(unitCents, line.quantity, p.kind, value);
      if (discount > 0 && (!best || discount > best.discount)) {
        best = { id: p.id, discount, coupon: p.code !== null };
      }
    }
    const lineSubtotal = (unitCents + extrasCents) * line.quantity;
    const discount = best?.discount ?? 0;
    if (best?.coupon) couponApplied = true;
    subtotal += lineSubtotal;
    extrasTotal += extrasCents * line.quantity;
    discountTotal += discount;
    const priceChanged = seen !== undefined && seen !== money(unitCents);
    if (priceChanged) notices.push({ code: 'PRICE_CHANGED', lineIndex: index });
    lines.push({
      index,
      productId: line.productId,
      quantity: line.quantity,
      status: priceChanged ? 'PRICE_CHANGED' : 'OK',
      unitPrice: money(unitCents),
      modifiers: calc.modifiers,
      extrasPerUnit: money(extrasCents),
      lineSubtotal: money(lineSubtotal),
      discount: money(discount),
      promotionId: best?.id ?? null,
      lineTotal: money(lineSubtotal - discount),
      previousUnitPrice: priceChanged ? (seen ?? null) : null,
    });
  });

  // Entrega
  const deliveryResult = evaluateDelivery(req, parsed);
  const delivery: CheckoutQuote['fulfillment']['delivery'] = deliveryResult.delivery;
  const feeCents: number | null = deliveryResult.feeCents;
  blockers.push(...deliveryResult.blockers);
  if (!availability.isAcceptingOrders) blockers.push({ code: 'BRANCH_CLOSED', scope: 'BRANCH' });

  const total = allPurchasable && feeCents !== null ? subtotal - discountTotal + feeCents : null;
  if (total !== null && parsed.clientView.total && parsed.clientView.total !== money(total)) {
    notices.push({ code: 'TOTAL_CHANGED' });
  }
  const ttlEnd = new Date(at.getTime() + QUOTE_TTL_MS);
  const canProceed = blockers.length === 0;
  const result: CheckoutQuote = {
    // Simulación: vigencia ficticia sobre el reloj de la demo. El token (F20) es un doble SIN firma (`mockq.…`) con la evidencia
    // de la cotización; solo se emite si se puede continuar (como la API real) y lo lee el mock de `POST /v1/orders`.
    quote: { generatedAt: at.toISOString(), expiresAt: ttlEnd.toISOString(), token: null },
    currency: 'GTQ',
    branch: {
      id: branch.id,
      isAcceptingOrders: availability.isAcceptingOrders,
      reason: availability.reason,
      nextOpensAt: availability.nextOpensAt ?? null,
    },
    fulfillment: { type: 'DELIVERY', delivery },
    lines,
    subtotal: money(subtotal),
    extrasTotal: money(extrasTotal),
    discountTotal: money(discountTotal),
    deliveryFee: feeCents === null ? null : money(feeCents),
    total: total === null ? null : money(total),
    coupon: parsed.couponCode ? { status: couponApplied ? 'APPLIED' : 'NOT_APPLIED' } : null,
    canProceed,
    blockers,
    notices,
  };
  if (canProceed && total !== null && feeCents !== null) {
    result.quote.token = mintMockQuoteToken({
      sub: req.context.session.customer?.email.trim().toLowerCase() ?? 'guest',
      inputHash: inputHashOf(parsed),
      provider: delivery?.selectedProvider ?? null,
      subtotal: money(subtotal),
      discountTotal: money(discountTotal),
      deliveryFee: money(feeCents),
      total: money(total),
      linesHash: linesHashOf(lines),
      exp: ttlEnd.getTime(),
    });
  }
  return result;
};
