import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { DeliveriesScreen } from '@/features/bo-deliveries/components/DeliveriesScreen';

export const metadata: Metadata = { title: 'Entregas' };

export default function EntregasPage() {
  return (
    <ScreenGuard screen="entregas">
      <DeliveriesScreen />
    </ScreenGuard>
  );
}
