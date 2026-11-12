import type { Metadata } from 'next';
import { HomeRedirect } from '@/features/backoffice-shell/HomeRedirect';

export const metadata: Metadata = { title: 'Backoffice', robots: { index: false, follow: false } };

/** `/backoffice` redirige a la pantalla de inicio del rol (o al acceso de demostración). */
export default function BackofficeHome() {
  return <HomeRedirect />;
}
