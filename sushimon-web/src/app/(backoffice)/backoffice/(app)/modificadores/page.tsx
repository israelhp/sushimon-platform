import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { ModifiersScreen } from '@/features/bo-catalog/components/ModifiersScreen';

export const metadata: Metadata = { title: 'Extras' };

export default function ModificadoresPage() {
  return (
    <ScreenGuard screen="modificadores">
      <ModifiersScreen />
    </ScreenGuard>
  );
}
