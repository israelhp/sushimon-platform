import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { RolesScreen } from '@/features/bo-admin/components/RolesScreen';

export const metadata: Metadata = { title: 'Roles y permisos' };

export default function RolesPage() {
  return (
    <ScreenGuard screen="roles">
      <RolesScreen />
    </ScreenGuard>
  );
}
