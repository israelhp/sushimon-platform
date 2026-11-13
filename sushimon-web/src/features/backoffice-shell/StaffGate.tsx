'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/features/session/auth-provider';
import { useAuthContext } from '@/features/session/auth-queries';
import { useDemoSession } from '@/features/session/demo-session';
import { LOGIN_PATH } from './nav';

const subscribeNever = () => () => {};

/**
 * Puerta de las rutas autenticadas del backoffice. Es una comprobación de UI (evita pantallas vacías); NO es
 * autorización: la API valida el JWT, el personal activo, el permiso y la sucursal en cada solicitud.
 * - Auth `mock`: exige la sesión de demostración.
 * - Auth `supabase`: exige sesión real Y que el servidor confirme `backofficeAccess`.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.shell');
  const router = useRouter();
  const { staff } = useDemoSession();
  const auth = useAuth();
  const context = useAuthContext();
  // La sesión de demostración vive en sessionStorage: hasta hidratar en el cliente no se sabe si existe.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const real = auth.mode === 'supabase';
  const denied =
    real &&
    mounted &&
    (auth.status === 'anonymous' ||
      (auth.status === 'authenticated' &&
        (context.isError || context.data?.backofficeAccess === false)));

  useEffect(() => {
    if (!mounted) return;
    if (real) {
      if (denied) router.replace(LOGIN_PATH);
    } else if (!staff) {
      router.replace(LOGIN_PATH);
    }
  }, [mounted, real, denied, staff, router]);

  const allowed = real
    ? auth.status === 'authenticated' && context.data?.backofficeAccess === true && Boolean(staff)
    : Boolean(staff);

  if (!mounted || !allowed) {
    return (
      <div className="page" role="status" style={{ padding: 28 }}>
        {t('loading')}
      </div>
    );
  }
  return <>{children}</>;
}
