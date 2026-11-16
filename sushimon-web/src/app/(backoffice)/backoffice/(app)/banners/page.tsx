import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { BannersScreen } from '@/features/bo-banners/components/BannersScreen';

export const metadata: Metadata = { title: 'Banners' };

export default function BannersPage() {
  return (
    <ScreenGuard screen="banners">
      <BannersScreen />
    </ScreenGuard>
  );
}
