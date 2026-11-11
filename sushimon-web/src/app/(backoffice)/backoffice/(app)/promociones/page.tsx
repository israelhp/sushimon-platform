import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { PromotionsScreen } from '@/features/bo-catalog/components/PromotionsScreen';

export const metadata: Metadata = { title: 'Promociones' };

export default function PromocionesPage() {
  return (
    <ScreenGuard screen="promociones">
      <PromotionsScreen />
    </ScreenGuard>
  );
}
