'use client';

import { CheckoutProvider } from '../checkout-context';
import { CheckoutFlow } from './CheckoutFlow';

/** Raíz del checkout: proveedor del borrador (reductor) + flujo de 5 pasos. */
export function CheckoutPage() {
  return (
    <CheckoutProvider>
      <CheckoutFlow />
    </CheckoutProvider>
  );
}
