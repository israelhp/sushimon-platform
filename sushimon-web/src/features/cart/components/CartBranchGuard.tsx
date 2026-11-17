'use client';

import dynamic from 'next/dynamic';
import { useOptionalOrderMode } from '@/features/order-mode/order-mode-context';
import { useCartBranchId, useCartCount } from '../cart-context';
import { useClientReady } from '@/features/store/client-ready';

/** El diálogo (plan por línea, consultas de la sucursal nueva) solo se descarga cuando hay un desajuste real. */
const CartBranchDialog = dynamic(
  () => import('./CartBranchDialog').then((m) => ({ default: m.CartBranchDialog })),
  { ssr: false },
);

/**
 * Detector de la política de sucursal (spec 019 §4): el carrito es de UNA sucursal. Si la del modo de pedido difiere de la del
 * carrito con líneas, monta el diálogo del plan. Es mínimo (dos selectores y una comparación) para vivir en el paquete inicial;
 * el diálogo y sus consultas se cargan de forma perezosa.
 */
export function CartBranchGuard() {
  const ready = useClientReady();
  const count = useCartCount();
  const cartBranch = useCartBranchId();
  const target = useOptionalOrderMode()?.mode.branchId ?? null;
  const mismatch = ready && count > 0 && target !== null && cartBranch !== target;
  return mismatch ? <CartBranchDialog /> : null;
}
