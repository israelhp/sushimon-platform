'use client';

import { useMemo } from 'react';
import type {
  Branch,
  DeliveryQuote,
  OrderSchedule,
  Product,
  StoreConfig,
} from '@/lib/data-access/models';
import { isScheduleValid } from '@/lib/schedule';
import { useAddresses, useMe } from '@/features/account/hooks';
import { estimateSubtotal, type CartLine } from '@/features/cart/cart';
import { useCart } from '@/features/cart/cart-context';
import { useProducts } from '@/features/catalog/hooks';
import { checkZone, requiresZone } from '@/features/order-mode/draft';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { useBranches, useDeliveryQuote, useStoreConfig } from '@/features/store/hooks';
import {
  hasAnyError,
  validateAddress,
  validateContact,
  type AddressErrors,
  type CheckoutStep,
  type ContactErrors,
} from './checkout-model';
import { useCheckoutDraft } from './checkout-context';

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
  const configQuery = useStoreConfig();
  const branchesQuery = useBranches();
  const addressesQuery = useAddresses();
  const meQuery = useMe();
  const config: StoreConfig | undefined = configQuery.data;
  const now = useMemo(() => (config ? new Date(config.serverTime) : null), [config]);

  const type = mode.type;
  const when: OrderSchedule = mode.when;
  const activeBranches = useMemo<Branch[]>(
    () => (branchesQuery.data ?? []).filter((b) => b.status === 'active'),
    [branchesQuery.data],
  );

  // ── Dirección y cotización ──────────────────────────────────────────────────────────────
  const nonexistentZones = config?.nonexistentZones ?? [];
  const needsZone = requiresZone(draft.address.department, draft.address.municipality);
  const contactErrors: ContactErrors = validateContact(draft.contact);
  const addressErrors: AddressErrors =
    type === 'delivery' ? validateAddress(draft.address, nonexistentZones) : {};
  const addressReady =
    type === 'delivery' &&
    !hasAnyError(addressErrors) &&
    (!needsZone || checkZone(draft.address.zone, nonexistentZones) === 'ok');
  const quoteArgs =
    addressReady && draft.quoteWanted
      ? {
          department: draft.address.department,
          municipality: draft.address.municipality,
          zone: needsZone ? String(Number(draft.address.zone.trim())) : undefined,
          branchId: draft.deliveryBranchId ?? undefined,
        }
      : null;
  const quoteQuery = useDeliveryQuote(quoteArgs);
  const quote: DeliveryQuote | null = quoteArgs ? (quoteQuery.data ?? null) : null;
  const covered = !!quote?.covered && quote.fee !== null;

  // ── Sucursal ────────────────────────────────────────────────────────────────────────────
  const pickupBranchId =
    activeBranches.find((b) => b.id === draft.pickupBranchId)?.id ??
    activeBranches.find((b) => b.id === mode.branchId)?.id ??
    activeBranches.find((b) => b.openNow)?.id ??
    activeBranches[0]?.id ??
    null;
  const branchId =
    type === 'delivery'
      ? covered
        ? quote.branchId
        : (draft.deliveryBranchId ?? null)
      : type === 'pickup'
        ? pickupBranchId
        : null;
  const branch = activeBranches.find((b) => b.id === branchId) ?? null;
  const hours = branch?.hours ?? config?.weeklyHours ?? [];
  const closedNow = when.kind === 'now' && !!branch && !branch.openNow;
  const allClosed =
    when.kind === 'now' && activeBranches.length > 0 && activeBranches.every((b) => !b.openNow);
  const scheduleValid =
    when.kind === 'now' ||
    (!!config && !!now && isScheduleValid(config.schedule, hours, when, now));

  // ── Productos ───────────────────────────────────────────────────────────────────────────
  const productsQuery = useProducts();
  const rows = useMemo<CheckoutRow[]>(() => {
    const byId = new Map<string, Product>((productsQuery.data ?? []).map((p) => [p.id, p]));
    return cart.lines.flatMap((line, index) => {
      const product = byId.get(line.productId);
      return product ? [{ line, index, product, subtotal: product.price * line.quantity }] : [];
    });
  }, [cart.lines, productsQuery.data]);
  /** Disponibilidad en la sucursal asignada (o en alguna activa si aún no hay una). */
  const availableHere = (p: Product) =>
    branchId
      ? (p.availability.find((a) => a.branchId === branchId)?.available ?? p.available)
      : p.available;
  const unavailable = rows.filter((r) => !availableHere(r.product));
  const prices = Object.fromEntries((productsQuery.data ?? []).map((p) => [p.id, p.price]));
  const subtotal = estimateSubtotal(
    rows.map((r) => r.line),
    prices,
  );
  const units = rows.reduce((n, r) => n + r.line.quantity, 0);
  const shipping = type === 'delivery' ? (covered ? (quote.fee ?? 0) : null) : 0;
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
    closedNow,
    allClosed,
    scheduleValid,
    rows,
    unavailable,
    availableHere,
    subtotal,
    units,
    shipping,
    total,
    quote,
    quoteQuery,
    quoteRequested: !!quoteArgs,
    covered,
    contactErrors,
    addressErrors,
    needsZone,
    addresses,
    me: meQuery.data ?? null,
    defaultAddressId: meQuery.data?.defaultAddressId ?? null,
    stepOk,
    productsQuery,
    configQuery,
    branchesQuery,
    cartLinesCount: cart.lines.length,
  };
}

export type CheckoutData = ReturnType<typeof useCheckoutData>;
