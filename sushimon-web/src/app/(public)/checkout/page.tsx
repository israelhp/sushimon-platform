import { CheckoutPage } from '@/features/checkout/components/CheckoutPage';

/**
 * Checkout de la tienda (5 pasos + confirmación; F24: solo efectivo). Todo el estado interactivo
 * vive en `features/checkout`; esta ruta solo lo monta dentro del armazón de la tienda.
 */
export default function CheckoutRoute() {
  return <CheckoutPage />;
}
