'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CheckoutFulfillmentInput, PublicBranch, StoreConfig } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  buildClientView,
  moneyToCents,
  normalizeCoupon,
  type CourierProvider,
  type QuoteInputs,
} from '@/lib/checkout-quote';
import { coverageZoneOf } from '@/lib/delivery-zone';
import { useAddresses, useMe } from '@/features/account/hooks';
import { useCustomerScope } from '@/features/session/customer-scope';
import { useDemoSession } from '@/features/session/demo-session';
import { defaultAddressIdOf } from '@/features/account/address-format';
import { isBlockingStatus, toQuoteInput, type CartState } from '@/lib/cart-rules';
import { useCart } from '@/features/cart/cart-context';
import { useCartView } from '@/features/cart/use-cart-view';
import { checkZone, requiresZone } from '@/features/order-mode/draft';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { useBranchesAvailability } from '@/features/branch-schedule/hooks';
import { useLocationOptions } from '@/features/delivery-coverage/hooks';
import { usePublicBranches } from '@/features/branches/hooks';
import { useStoreConfig } from '@/features/store/hooks';
import {
  hasAnyError,
  validateAddress,
  validateContact,
  type AddressErrors,
  type CheckoutStep,
  type ContactErrors,
} from './checkout-model';
import { useCheckoutDraft } from './checkout-context';
import { useCheckoutQuote } from './use-checkout-quote';

/** Pausa de escritura del cupón y de la zona escrita (los selects y las cantidades NO usan debounce). */
export const QUOTE_DEBOUNCE_MS = 400;

const NO_ZONES: number[] = [];

/**
 * Datos derivados del checkout (carrito + catálogo + modo de pedido + borrador + cotización).
 * Los montos son SOLO para mostrar: el precio final lo calcula el servidor al crear el pedido.
 */
export function useCheckoutData() {
  const { draft } = useCheckoutDraft();
  const cart = useCart();
  const { mode } = useOrderMode();
  const client = useDataClient();
  // `useStoreConfig` es SIMULADO (zonas inexistentes, hora del servidor: F10, sin API todavía).
  const configQuery = useStoreConfig();
  // Sucursales activas: lista PÚBLICA real (F07). Disponibilidad (F08) y cobertura (F09) se consultan por su id.
  const branchesQuery = usePublicBranches();
  // Identidad del cliente (Supabase Auth real o sesión de demostración): habilita cuenta/direcciones y aísla su caché.
  const identity = useCustomerScope();
  const demo = useDemoSession();
  const signedIn = identity.state === 'ready';
  const addressesQuery = useAddresses();
  const meQuery = useMe();
  const config: StoreConfig | undefined = configQuery.data;
  const now = useMemo(() => (config ? new Date(config.serverTime) : null), [config]);

  // `GET /v1/branches` ya devuelve solo las activas.
  const activeBranches = useMemo<PublicBranch[]>(
    () => branchesQuery.data ?? [],
    [branchesQuery.data],
  );

  // F08: la disponibilidad la calcula el servidor; aquí solo se consume (undefined = aún sin datos, no se asume cerrada).
  const availability = useBranchesAvailability(activeBranches.map((b) => b.id));

  // ── Dirección ───────────────────────────────────────────────────────────────────────────
  const nonexistentZones = config?.nonexistentZones ?? NO_ZONES;
  const needsZone = requiresZone(draft.address.department, draft.address.municipality);
  const contactErrors: ContactErrors = validateContact(draft.contact);
  // ADR-0036: todo pedido es a domicilio e inmediato, así que la dirección siempre se valida.
  const addressErrors: AddressErrors = validateAddress(draft.address, nonexistentZones);

  // ── Sucursal ────────────────────────────────────────────────────────────────────────────
  // F19 (ADR-0025 D10): la cotización usa SIEMPRE la sucursal del carrito (F18: una sola). Ya no se reasigna por cobertura: si la
  // elegida en el modo de pedido difiere, el flujo de cambio de sucursal de F18 (`CartBranchGuard`) pide resolverlo.
  const branchId = cart.branchId ?? mode.branchId ?? null;
  const branch = activeBranches.find((b) => b.id === branchId) ?? null;
  const branchAvailability = branch ? availability.byId[branch.id] : undefined;
  // ADR-0036: sucursal cerrada o fuera de horario => bloqueo informativo (sin programar ni recoger).
  const closedNow = !!branch && branchAvailability?.isAcceptingOrders === false;
  const allClosed =
    activeBranches.length > 0 &&
    activeBranches.every((b) => availability.byId[b.id]?.isAcceptingOrders === false);

  // ── Productos ───────────────────────────────────────────────────────────────────────────
  // F18: las líneas, su revalidación y el subtotal ESTIMADO salen de la MISMA fuente que el cajón (`useCartView`, sucursal del
  // carrito). El total definitivo es el de la cotización del servidor (F19); el subtotal local solo se ve MIENTRAS llega, rotulado.
  const view = useCartView({ enabled: true });
  const rows = view.rows;
  /** Líneas que no se pueden pedir (agotadas, inexistentes, extras inválidos, otra sucursal). */
  const unavailable = rows.filter((r) => r.evaluation && isBlockingStatus(r.evaluation.status));
  const subtotal = view.subtotalCents / 100;
  const units = cart.count;

  // ── Cotización del servidor (F19) ───────────────────────────────────────────────────────
  // Cupón: lo ESCRITO (`coupon`) no entra en la cotización; solo el APLICADO (botón «Aplicar» o Enter). Sin debounce.
  const [coupon, setCouponText] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [couponNotice, setCouponNotice] = useState<'rate-limited' | null>(null);
  const setCoupon = (text: string) => {
    setCouponText(text);
    setCouponNotice(null);
  };
  const applyCoupon = () => {
    setCouponNotice(null);
    setAppliedCoupon(normalizeCoupon(coupon));
  };
  const removeCoupon = () => {
    setCouponText('');
    setAppliedCoupon('');
    setCouponNotice(null);
  };
  const [provider, setProvider] = useState<CourierProvider | null>(null);
  const typedZone = needsZone ? draft.address.zone : '';
  const debouncedZone = useDebouncedValue(typedZone, QUOTE_DEBOUNCE_MS);
  // Lo escrito aún no se aplicó a la cotización: «Continuar» espera (no se cotiza por pulsación).
  const settling = typedZone !== debouncedZone;
  const locations = useLocationOptions(draft.address.department, true);
  const municipality =
    locations.municipalities.find((m) => m.name === draft.address.municipality) ?? null;
  const savedAddress =
    signedIn && draft.addressId !== 'other'
      ? (addressesQuery.data ?? []).find((a) => a.id === draft.addressId)
      : undefined;

  const quoteCart = useMemo(() => {
    const state: CartState = {
      v: 2,
      branchId: cart.branchId,
      updatedAt: 0,
      lines: [...cart.lines],
    };
    return toQuoteInput(state, { expectedBranchId: mode.branchId ?? cart.branchId });
  }, [cart.branchId, cart.lines, mode.branchId]);

  const fulfillment = useMemo<CheckoutFulfillmentInput | null>(() => {
    const preference = provider ? { deliveryProvider: provider } : {};
    if (savedAddress) {
      return { type: 'DELIVERY', customerAddressId: savedAddress.id, ...preference };
    }
    if (!municipality) return null;
    // Zona incompleta o inválida => sin zona: el servidor responde `ADDRESS_INCOMPLETE` (no se inventa una).
    const zone =
      needsZone && checkZone(debouncedZone, nonexistentZones) === 'ok'
        ? coverageZoneOf(debouncedZone)
        : null;
    return { type: 'DELIVERY', municipalityId: municipality.id, zone, ...preference };
  }, [provider, savedAddress, municipality, needsZone, debouncedZone, nonexistentZones]);

  const quoteInputs = useMemo<QuoteInputs | null>(() => {
    if (!quoteCart || !fulfillment || view.status !== 'ready') return null;
    return {
      cart: quoteCart,
      fulfillment,
      couponCode: appliedCoupon,
      clientView: buildClientView(quoteCart, cart.lines, null),
    };
  }, [quoteCart, fulfillment, view.status, appliedCoupon, cart.lines]);
  const quote = useCheckoutQuote(quoteInputs, {
    settling,
    // En Pago/Confirmación no se refresca al volver el foco: no deben esconderse los importes a mitad de pago.
    refreshOnFocus: draft.step <= 3,
    // 429 con cupón = error LOCAL del campo: el cupón se descarta y la cotización SIN cupón sigue vigente.
    onCouponRateLimited: () => {
      setAppliedCoupon('');
      setCouponNotice('rate-limited');
    },
  });
  const serverQuote = quote.quote;

  // «Total actualizado: de Qx a Qy» unos segundos cuando una cotización vigente trae otro total que la anterior (estado derivado
  // durante el render: patrón de React «guardar el valor previo»).
  const totalNow = serverQuote?.total ?? null;
  const [seenTotal, setSeenTotal] = useState<string | null>(null);
  const [totalChange, setTotalChange] = useState<{ from: string; to: string } | null>(null);
  if (totalNow !== null && totalNow !== seenTotal) {
    setSeenTotal(totalNow);
    setTotalChange(seenTotal !== null ? { from: seenTotal, to: totalNow } : null);
  }
  useEffect(() => {
    if (!totalChange) return;
    const id = setTimeout(() => setTotalChange(null), 6000);
    return () => clearTimeout(id);
  }, [totalChange]);

  // Importes de PANTALLA: los del servidor cuando hay cotización vigente; si no, solo el subtotal local ESTIMADO.
  const serverTotalCents = moneyToCents(serverQuote?.total);
  const serverFeeCents = moneyToCents(serverQuote?.deliveryFee);
  const shipping = serverFeeCents !== null ? serverFeeCents / 100 : null;
  const total = serverTotalCents !== null ? serverTotalCents / 100 : subtotal;

  const addresses = addressesQuery.data ?? [];

  const stepOk = (step: CheckoutStep): boolean => {
    switch (step) {
      case 1:
        return view.canContinue;
      case 2:
        return !hasAnyError(contactErrors) && !hasAnyError(addressErrors);
      // F19: desde «Envío» solo se avanza con una cotización VIGENTE, de las entradas ACTUALES y con `canProceed`.
      case 3:
      case 4:
        return quote.canContinue;
      default:
        return true;
    }
  };

  return {
    config,
    now,
    branches: activeBranches,
    branchId,
    branch,
    branchAvailability,
    availability: availability.byId,
    closedNow,
    allClosed,
    rows,
    unavailable,
    /** Subtotal ESTIMADO local (F18): solo se muestra mientras llega la cotización, rotulado «estimado». */
    subtotal,
    units,
    /** Tarifa del SERVIDOR (`null` si no hay cotización vigente o no es verificable). */
    shipping,
    /** Total del SERVIDOR si hay cotización vigente; si no, el subtotal estimado (`totalIsEstimate`). */
    total,
    totalIsEstimate: serverTotalCents === null,
    // F19
    quote,
    quoteInputs,
    /** Cotización vigente y coincidente con las entradas actuales (o `null`). */
    serverQuote,
    coupon,
    setCoupon,
    /** Cupón aplicado a la cotización (normalizado) o `''`. */
    appliedCoupon,
    applyCoupon,
    removeCoupon,
    /** `rate-limited`: el servidor limitó los intentos de cupón; el cupón se descartó. */
    couponNotice,
    /** Lo que se pinta (vigente o la última respuesta de la misma sesión, atenuada y «Actualizando…»). */
    shownQuote: quote.shown,
    /** Cambio de total entre dos cotizaciones vigentes (se limpia a los 6 s). */
    totalChange,
    /**
     * F20: se puede confirmar solo con una cotización VIGENTE que traiga su `token` firmado (la API real lo emite solo con
     * `canProceed`; sin secreto de servidor es `null` y no se confirma). El mock emite un token simulado.
     */
    confirmationAvailable: !!serverQuote?.quote.token,
    /** El carrito es de otra sucursal que la del modo de pedido: no se cotiza hasta resolverlo (F18). */
    branchMismatch:
      cart.lines.length > 0 && mode.branchId !== null && cart.branchId !== mode.branchId,
    /** A domicilio sin municipio resuelto o sin dirección guardada elegida: aún no hay con qué cotizar. */
    addressPending: fulfillment === null,
    provider,
    setProvider,
    /** Datos simulados (mock): se rotula «Simulación». */
    isSimulation: client.kind === 'mock',
    contactErrors,
    addressErrors,
    needsZone,
    addresses,
    me: meQuery.data ?? null,
    /** `ready` = hay cliente identificado; `scope` aísla lo que se guarde por cuenta. */
    signedIn,
    /** Sesión real autenticada pero identidad aún resolviéndose (no es invitado). */
    identityPending: identity.state === 'pending',
    scope: identity.state === 'ready' ? identity.scope : null,
    signedInEmail: meQuery.data?.email || demo.customer?.email || '',
    defaultAddressId: defaultAddressIdOf(addresses),
    stepOk,
    view,
    configQuery,
    branchesQuery,
    cartLinesCount: cart.lines.length,
  };
}

export type CheckoutData = ReturnType<typeof useCheckoutData>;
