'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';
import { useDemoSession } from '@/features/session/demo-session';
import { ROLE_HOME } from '@/lib/permissions';
import { LOGIN_PATH, screenHref } from './nav';

const subscribeNever = () => () => {};

/** `/backoffice`: redirige a la pantalla de inicio del rol (o al acceso si no hay sesión de demostración). */
export function HomeRedirect() {
  const t = useTranslations('backoffice.shell');
  const router = useRouter();
  const { staff } = useDemoSession();
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!mounted) return;
    router.replace(staff ? screenHref(ROLE_HOME[staff.role]) : LOGIN_PATH);
  }, [mounted, staff, router]);

  return (
    <p role="status" style={{ padding: 28 }}>
      {t('loading')}
    </p>
  );
}
