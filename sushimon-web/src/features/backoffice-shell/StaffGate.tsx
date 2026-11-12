'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useDemoSession } from '@/features/session/demo-session';
import { LOGIN_PATH } from './nav';

const subscribeNever = () => () => {};

/**
 * Puerta de las rutas autenticadas del backoffice. Sin sesión de DEMOSTRACIÓN redirige a `/backoffice/login`.
 * Es una comprobación de UI (evita pantallas vacías); NO es autorización: la API rechaza igualmente cualquier
 * consulta sin identidad, rol y sucursal válidos.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.shell');
  const router = useRouter();
  const { staff } = useDemoSession();
  // La sesión de demostración vive en sessionStorage: hasta hidratar en el cliente no se sabe si existe.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (mounted && !staff) router.replace(LOGIN_PATH);
  }, [mounted, staff, router]);

  if (!mounted || !staff) {
    return (
      <div className="page" role="status" style={{ padding: 28 }}>
        {t('loading')}
      </div>
    );
  }
  return <>{children}</>;
}
