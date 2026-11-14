'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/features/session/auth-provider';
import { pathForAccess } from '@/features/session/backoffice-access';
import { useBackofficeAccess } from '@/features/session/use-backoffice-access';
import { useDemoSession } from '@/features/session/demo-session';
import { LOGIN_PATH } from './nav';

const subscribeNever = () => () => {};

/**
 * Puerta de las rutas autenticadas del backoffice. Es una comprobación de UI (evita pantallas vacías); NO es
 * autorización: la API valida el JWT, el personal activo, el permiso y la sucursal en cada solicitud.
 * - Auth `mock`: exige la sesión de demostración.
 * - Auth `supabase`: exige sesión real Y que el servidor confirme `access = GRANTED` (personal activo + aal2).
 *   Mientras valida no se renderiza nada administrativo; sin MFA redirige a configurar/verificar.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.shell');
  const router = useRouter();
  const { staff } = useDemoSession();
  const auth = useAuth();
  const access = useBackofficeAccess();
  // La sesión de demostración vive en sessionStorage: hasta hidratar en el cliente no se sabe si existe.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const real = auth.mode === 'supabase';

  useEffect(() => {
    if (!mounted) return;
    if (real) {
      // Cada estado va a su pantalla (login, configurar/verificar MFA, acceso denegado). Sin bucles: las
      // pantallas destino no están bajo este guard.
      const target = pathForAccess(access.state);
      if (target) router.replace(target);
      else if (access.state === 'ERROR') router.replace(LOGIN_PATH);
    } else if (!staff) {
      router.replace(LOGIN_PATH);
    }
  }, [mounted, real, access.state, staff, router]);

  // Real: solo con el servidor confirmando acceso (aal2 + personal activo) Y el contexto adoptado por el shell.
  const allowed = real ? access.state === 'STAFF_AUTHORIZED' && Boolean(staff) : Boolean(staff);

  if (!mounted || !allowed) {
    return (
      <div className="page" role="status" style={{ padding: 28 }}>
        {t('loading')}
      </div>
    );
  }
  return <>{children}</>;
}
