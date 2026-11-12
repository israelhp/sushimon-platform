import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { CategoriesScreen } from '@/features/bo-catalog/components/CategoriesScreen';

export const metadata: Metadata = { title: 'Categorías' };

export default function CategoriasPage() {
  return (
    <ScreenGuard screen="categorias">
      <CategoriesScreen />
    </ScreenGuard>
  );
}
