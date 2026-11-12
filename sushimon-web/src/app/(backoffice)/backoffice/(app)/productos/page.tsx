import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { ProductsScreen } from '@/features/bo-catalog/components/ProductsScreen';

export const metadata: Metadata = { title: 'Productos' };

export default function ProductosPage() {
  return (
    <ScreenGuard screen="productos">
      <ProductsScreen />
    </ScreenGuard>
  );
}
