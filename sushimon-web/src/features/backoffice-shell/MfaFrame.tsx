'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { BoLogo, IconLock } from '@/components/icons/bo';
import { BoThemeButton } from './BoThemeButton';

/** Marco visual de las pantallas previas al backoffice (login, MFA, acceso denegado). No muestra datos del personal. */
export function MfaFrame({
  eyebrow,
  title,
  help,
  children,
}: {
  eyebrow: string;
  title: string;
  help?: string;
  children: ReactNode;
}) {
  const t = useTranslations('backoffice.login');
  return (
    <div className="auth">
      <aside className="auth-brand sg sg-navy">
        <div className="auth-logo">
          <BoLogo />
        </div>
        <div>
          <div className="auth-kicker">{t('kicker')}</div>
          <h1>{t('headline')}</h1>
          <p>{t('body')}</p>
        </div>
        <div className="auth-foot">
          <IconLock />
          {t('foot')}
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-tools" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BoThemeButton scope="login" />
        </div>
        <div className="auth-card">
          <BoLogo className="auth-mlogo" />
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
            {help ? (
              <div className="sm muted" style={{ fontWeight: 600 }}>
                {help}
              </div>
            ) : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
