import type { Metadata } from 'next';
import { MfaSetupScreen } from '@/features/backoffice-shell/MfaSetupScreen';

export const metadata: Metadata = {
  title: 'Configurar verificación en dos pasos',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <MfaSetupScreen />;
}
