import type { Metadata } from 'next';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Zona backoffice: aplica la hoja del backoffice (`[data-zone='bo']`, tokens --bo-*) y su proveedor de avisos.
 * El sidebar y la barra superior los agregan los bloques de pantallas.
 */
export default function BackofficeZoneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-zone="bo">
      <ToastProvider zone="bo">{children}</ToastProvider>
    </div>
  );
}
