import { notFound } from 'next/navigation';

/**
 * Cualquier URL de la tienda sin página propia cae aquí y lanza `notFound()`: así el 404 se pinta con
 * el armazón de la tienda (`(public)/not-found.tsx`) y responde con estado 404.
 */
export default function UnknownStoreRoute() {
  notFound();
}
