import { Suspense } from 'react';
import { MenuScreen } from '@/features/menu/components/menu-screen';

/**
 * Menú de la tienda (`/menu?cat=<id>`). `useSearchParams` exige un límite de Suspense; el esqueleto de la
 * pantalla se pinta mientras se resuelven los parámetros de la URL.
 */
export default function MenuPage() {
  return (
    <Suspense fallback={null}>
      <MenuScreen />
    </Suspense>
  );
}
