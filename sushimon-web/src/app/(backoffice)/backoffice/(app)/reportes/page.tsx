import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { ReportsScreen } from '@/features/bo-admin/components/ReportsScreen';

export const metadata: Metadata = { title: 'Reportes' };

export default function ReportesPage() {
  return (
    <ScreenGuard screen="reportes">
      <ReportsScreen />
    </ScreenGuard>
  );
}
