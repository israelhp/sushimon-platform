'use client';

import { useMemo } from 'react';
import type {
  BranchHoursDay,
  PublicBranch,
  PublicClosureWindow,
  OrderSchedule,
  Product,
  StoreConfig,
} from '@/lib/data-access/models';
import { isScheduleValid } from '@/lib/schedule';
import { useAddresses, useMe } from '@/features/account/hooks';
import { useCustomerScope } from '@/features/session/customer-scope';
import { useDemoSession } from '@/features/session/demo-session';
import { defaultAddressIdOf } from '@/features/account/address-format';
import { estimateSubtotal, type CartLine } from '@/features/cart/cart';
import { useCart } from '@/features/cart/cart-context';
import { useProducts } from '@/features/catalog/hooks';
import { checkZone, requiresZone } from '@/features/order-mode/draft';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { useBranchesAvailability, usePublicBranchHours } from '@/features/branch-schedule/hooks';
import { useAddressCoverage } from '@/features/delivery-coverage/hooks';
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

const NO_HOURS: BranchHoursDay[] = [];
const NO_CLOSURES: PublicClosureWindow[] = [];

export interface CheckoutRow {
  line: CartLine;
  /** Índice en el carrito (para cantidades y eliminar). */
  index: number;
  product: Product;
  subtotal: number;
}

/**
 * Datos derivados del checkout (carrito + catálogo + modo de pedido + borrador + cotización).
 * Los montos son SOLO para mostrar: el precio final lo calcula el servidor al crear el pedido.
 */
export function useCheckoutData() {
  const { draft } = useCheckoutDraft();
  const cart = useCart();
  const { mode } = useOrderMode();
  // `useStoreConfig` es SIMULADO (reglas de programación, zonas inexistentes, hora del servidor: F10, sin API todavía).
  const configQuery = useStoreConfig();
  // Sucursales activas: lista PÚBLICA real (F07). Disponibilidad (F08) y cobertura (F09) se consultan por su id.
  const branchesQuery = usePublicBranches();
  // Identidad del cliente (Supabase Auth real o sesión de demostración): habilita cuenta/direcciones y aísla su caché.
  const identity = useCustomerScope();
  const demo = useDemoSession();
  const addressesQuery = useAddresses();
  const meQuery = useMe();
  const config: StoreConfig | undefined = configQuery.data;
  const now = useMemo(() => (config ? new Date(config.serverTime) : null), [config]);

  const type = mode.type;
  const when: OrderSchedule = mode.when;
  // `GET /v1/branches` ya devuelve solo las activas.
  const activeBranches = useMemo<PublicBranch[]>(
    () => branchesQuery.data ?? [],
    [branchesQuery.data],
  );

  // F08: la disponibilidad la calcula el servidor; aquí solo se consume (undefined = aún sin datos, no se asume cerrada).
  const availability = useBranchesAvailability(activeBranches.map((b) => b.id));

  // ── Dirección y cotización ──────────────────────────────────────────────────────────────
  const nonexistentZones = config?.nonexistentZones ?? [];
  const needsZone = requiresZone(draft.address.department, draft.address.municipality);
  const contactErrors: ContactErrors = validateContact(draft.contact);
  const addressErrors: AddressErrors =
    type === 'delivery' ? validateAddress(draft.address, nonexistentZones) : {};
  // F09: la cobertura y la tarifa PROPIA las devuelve el servidor (`checkDeliveryCoverage`, una consulta por sucursal activa).
  // Se comprueba al COMPLETAR la selección departamento → municipio → zona (selects: nunca por pulsación), no al abrir.
  const selectionComplete =
    type === 'delivery' &&
    !!draft.address.department &&
    !!draft.address.municipality &&
    (!needsZone || checkZone(draft.address.zone, nonexistentZones) === 'ok');
  const coverage = useAddressCoverage(
    {
      department: draft.address.department,
      municipality: draft.address.municipality,
      zone: needsZone ? draft.address.zone : '',
    },
    activeBranches.map((b) => b.id),
    selectionComplete,
  );
  // Resultado de la sucursal ELEGIDA a mano (si la hay) o el mejor entre todas.
  const outcome =
    (draft.deliveryBranchId ? coverage.byBranch[draft.deliveryBranchId] : undefined) ??
    coverage.best;
  // Solo la cobertura PROPIA confirmada trae tarifa: PedidosYa no es verificable (UNKNOWN) y no cotiza en F09.
  const covered =
    outcome?.kind === 'confirmed' && outcome.provider === 'OWN' && outcome.fee !== null;
  const coveredFee = covered ? outcome.fee : null;
  const coveredBranchId = covered ? outcome.branchId : null;

  // ── Sucursal ────────────────────────────────────────────────────────────────────────────
  const pickupBranchId =
    activeBranches.find((b) => b.id === draft.pickupBranchId)?.id ??
    activeBranches.find((b) => b.id === mode.branchId)?.id ??
    activeBranches.find((b) => availability.byId[b.id]?.isAcceptingOrders)?.id ??
    activeBranches[0]?.id ??
    null;
  const branchId =
    type === 'delivery'
      ? (coveredBranchId ?? draft.deliveryBranchId ?? null)
      : type === 'pickup'
        ? pickupBranchId
        : null;
  const branch = activeBranches.find((b) => b.id === branchId) ?? null;
  const branchAvailability = branch ? availability.byId[branch.id] : undefined;
  // Horario para programar: el de la sucursal asignada o, mientras no hay una, el de la primera que recibe pedidos.
  const hoursBranchId =
    branch?.id ??
    activeBranches.find((b) => availability.byId[b.id]?.isAcceptingOrders)?.id ??
    activeBranches[0]?.id ??
    null;
  const hoursQuery = usePublicBranchHours(hoursBranchId);
  const hours = hoursQuery.data?.days ?? NO_HOURS;
  const closures = hoursQuery.data?.upcomingClosures ?? NO_CLOSURES;
  const hoursLoading = !!hoursBranchId && hoursQuery.isPending;
  const closedNow =
    when.kind === 'now' && !!branch && branchAvailability?.isAcceptingOrders === false;
  const allClosed =
    when.kind === 'now' &&
    activeBranches.length > 0 &&
    activeBranches.every((b) => availability.byId[b.id]?.isAcceptingOrders === false);
  const scheduleValid =
    when.kind === 'now' ||
    (!!config && !!now && isScheduleValid(config.schedule, hours, when, now, closures));

  // ── Productos ───────────────────────────────────────────────────────────────────────────
  // F13: precio y disponibilidad de la sucursal ASIGNADA al pedido (en domicilio la decide la cobertura, que puede diferir de la
  // elegida en el selector); sin sucursal asignada, ninguna (precios base).
  const productsQuery = useProducts({ branchId });
  const rows = useMemo<CheckoutRow[]>(() => {
    const byId = new Map<string, Product>((productsQuery.data ?? []).map((p) => [p.id, p]));
    return cart.lines.flatMap((line, index) => {
      const product = byId.get(line.productId);
      return product ? [{ line, index, product, subtotal: product.price * line.quantity }] : [];
    });
  }, [cart.lines, productsQuery.data]);
  /** Disponibilidad en la sucursal asignada (overlay F13 ya aplicado por `useProducts`). */
  const unavailable = rows.filter((r) => !r.product.available);
  const prices = Object.fromEntries((productsQuery.data ?? []).map((p) => [p.id, p.price]));
  const subtotal = estimateSubtotal(
    rows.map((r) => r.line),
    prices,
  );
  const units = rows.reduce((n, r) => n + r.line.quantity, 0);
  // Solo para MOSTRAR (el servidor recalcula y congela el `baseFee` al crear el pedido): string decimal → número de pantalla.
  const shipping = type === 'delivery' ? (coveredFee !== null ? Number(coveredFee) : null) : 0;
  const total = subtotal + (shipping ?? 0);

  const addresses = addressesQuery.data ?? [];

  const stepOk = (step: CheckoutStep): boolean => {
    switch (step) {
      case 1:
        return rows.length > 0 && unavailable.length === 0;
      case 2:
        return (
          !!type &&
          scheduleValid &&
          !hasAnyError(contactErrors) &&
          (type === 'pickup' || !hasAnyError(addressErrors))
        );
      case 3:
        return type === 'delivery' ? covered && !closedNow : !!branch && !closedNow;
      default:
        return true;
    }
  };

  return {
    config,
    now,
    type,
    when,
    branches: activeBranches,
    branchId,
    branch,
    pickupBranchId,
    hours,
    closures,
    hoursLoading,
    branchAvailability,
    availability: availability.byId,
    closedNow,
    allClosed,
    scheduleValid,
    rows,
    unavailable,
    subtotal,
    units,
    shipping,
    total,
    coverage,
    outcome,
    selectionComplete,
    covered,
    coveredFee,
    contactErrors,
    addressErrors,
    needsZone,
    addresses,
    me: meQuery.data ?? null,
    /** `ready` = hay cliente identificado; `scope` aísla lo que se guarde por cuenta. */
    signedIn: identity.state === 'ready',
    /** Sesión real autenticada pero identidad aún resolviéndose (no es invitado). */
    identityPending: identity.state === 'pending',
    scope: identity.state === 'ready' ? identity.scope : null,
    signedInEmail: meQuery.data?.email || demo.customer?.email || '',
    defaultAddressId: defaultAddressIdOf(addresses),
    stepOk,
    productsQuery,
    configQuery,
    branchesQuery,
    cartLinesCount: cart.lines.length,
  };
}

export type CheckoutData = ReturnType<typeof useCheckoutData>;
