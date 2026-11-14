import type { Metadata } from 'next';
import { MfaVerifyScreen } from '@/features/backoffice-shell/MfaVerifyScreen';

export const metadata: Metadata = {
  title: 'Verificación en dos pasos',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <MfaVerifyScreen />;
}
