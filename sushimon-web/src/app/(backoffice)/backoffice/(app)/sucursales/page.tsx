import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { BranchesScreen } from '@/features/bo-admin/components/BranchesScreen';

export const metadata: Metadata = { title: 'Sucursales' };

export default function SucursalesPage() {
  return (
    <ScreenGuard screen="sucursales">
      <BranchesScreen />
    </ScreenGuard>
  );
}
