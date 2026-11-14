'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/features/session/auth-provider';
import { BO_PATHS } from '@/features/session/backoffice-access';
import { useBackofficeAccess } from '@/features/session/use-backoffice-access';
import { MfaFrame } from './MfaFrame';
import { useAccessRedirect } from './use-access-redirect';

/** Acceso denegado: mensaje genérico (no revela si el correo es de personal ni por qué). */
export function AccessDeniedScreen() {
  const t = useTranslations('backoffice.accessDenied');
  const auth = useAuth();
  const access = useBackofficeAccess();
  useAccessRedirect(access.state, BO_PATHS.accessDenied);
  const waiting = access.state === 'INITIALIZING';
  return (
    <MfaFrame eyebrow={t('eyebrow')} title={t('title')}>
      {waiting ? (
        <div role="status" className="sm muted">
          {t('checking')}
        </div>
      ) : (
        <>
          <div className="banner b-red" role="alert">
            <div className="grow">{t('body')}</div>
          </div>
          <Link className="btn btn-primary block" style={{ height: 50 }} href="/">
            {t('store')}
          </Link>
          <button type="button" className="btn block" onClick={() => void auth.signOut()}>
            {t('signOut')}
          </button>
        </>
      )}
    </MfaFrame>
  );
}
