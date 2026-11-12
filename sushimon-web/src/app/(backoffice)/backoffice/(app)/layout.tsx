import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';

/** Rutas autenticadas del backoffice: sidebar + barra superior + detalle de pedido. */
export default function BackofficeAppLayout({ children }: { children: React.ReactNode }) {
  return <BackofficeShell>{children}</BackofficeShell>;
}
