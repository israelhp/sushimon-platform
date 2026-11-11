import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { UsersScreen } from '@/features/bo-admin/components/UsersScreen';

export const metadata: Metadata = { title: 'Usuarios' };

export default function UsuariosPage() {
  return (
    <ScreenGuard screen="usuarios">
      <UsersScreen />
    </ScreenGuard>
  );
}
