'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { IconLock } from '@/components/icons/bo';
import { useShell } from './shell-context';
import { screenHref } from './nav';
import { ROLE_HOME } from '@/lib/permissions';

/**
 * Pantalla "sin permiso": por rol (ruta fuera del menú del rol) o porque el servidor respondió 403
 * (escenario `forbidden`). Es solo informativa: la API decide siempre.
 */
export function ForbiddenScreen({ reason = 'role' }: { reason?: 'role' | 'server' }) {
  const t = useTranslations('backoffice.forbidden');
  const tr = useTranslations('backoffice.roles');
  const { role } = useShell();
  return (
    <div className="page">
      <div className="empty" role="alert">
        <IconLock size="md" />
        <h1 className="empty-t">{t('title')}</h1>
        <div className="sm">
          {reason === 'server' ? t('bodyServer') : t('body', { role: tr(role) })}
        </div>
        <Link className="btn btn-primary mt8" href={screenHref(ROLE_HOME[role])}>
          {t('home')}
        </Link>
      </div>
    </div>
  );
}
