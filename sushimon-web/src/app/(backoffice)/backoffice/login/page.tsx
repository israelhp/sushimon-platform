import type { Metadata } from 'next';
import { LoginScreen } from '@/features/backoffice-shell/LoginScreen';

export const metadata: Metadata = {
  title: 'Acceso al backoffice',
  robots: { index: false, follow: false },
};

export default function BackofficeLoginPage() {
  return <LoginScreen />;
}
