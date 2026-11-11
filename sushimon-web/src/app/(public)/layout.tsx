import { ToastProvider } from '@/components/ui/Toast';

/**
 * Zona tienda: aplica los tokens y clases propias de la tienda (`[data-zone='store']`) y su proveedor de avisos.
 * El encabezado, la navegación móvil, el pie y los overlays los agregan los bloques de pantallas.
 */
export default function StoreZoneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-zone="store" className="flex min-h-dvh flex-col bg-bg text-fg">
      <ToastProvider zone="store">{children}</ToastProvider>
    </div>
  );
}
