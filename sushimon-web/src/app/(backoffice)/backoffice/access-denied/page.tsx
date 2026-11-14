import type { Metadata } from 'next';
import { AccessDeniedScreen } from '@/features/backoffice-shell/AccessDeniedScreen';

export const metadata: Metadata = {
  title: 'Acceso denegado',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AccessDeniedScreen />;
}
