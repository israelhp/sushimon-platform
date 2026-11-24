import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { RidersScreen } from '@/features/bo-riders/components/RidersScreen';

export const metadata: Metadata = { title: 'Motoristas' };

export default function MotoristasPage() {
  return (
    <ScreenGuard screen="motoristas">
      <RidersScreen />
    </ScreenGuard>
  );
}
