import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { DashboardScreen } from '@/features/bo-dashboard/components/DashboardScreen';

export const metadata: Metadata = { title: 'Panel' };

export default function PanelPage() {
  return (
    <ScreenGuard screen="panel">
      <DashboardScreen />
    </ScreenGuard>
  );
}
