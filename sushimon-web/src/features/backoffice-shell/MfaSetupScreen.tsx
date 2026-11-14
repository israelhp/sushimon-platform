'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/features/session/auth-provider';
import { BO_PATHS } from '@/features/session/backoffice-access';
import { useBackofficeAccess, useSupabaseClient } from '@/features/session/use-backoffice-access';
import {
  startTotpEnrollment,
  toMfaError,
  TOTP_CODE,
  verifyTotp,
  type MfaErrorKey,
  type TotpEnrollment,
} from '@/lib/auth/mfa';
import { MfaFrame } from './MfaFrame';
import { useAccessRedirect } from './use-access-redirect';

/**
 * Configuración del segundo factor (TOTP) del personal. Restringida: solo permite enrolar, verificar o cerrar
 * sesión. El factor se crea con Supabase Auth solo al pulsar "Comenzar" (no al renderizar). Verificar el código
 * NO basta para entrar: se revalida con la API y solo `STAFF_AUTHORIZED` redirige al backoffice.
 */
export function MfaSetupScreen() {
  const t = useTranslations('backoffice.mfa');
  const auth = useAuth();
  const supabase = useSupabaseClient();
  const access = useBackofficeAccess();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<MfaErrorKey | null>(null);
  const inFlight = useRef(false);

  useAccessRedirect(access.state, BO_PATHS.mfaSetup, done);

  // El secreto/QR solo viven mientras la pantalla está montada.
  useEffect(() => () => setEnrollment(null), []);

  const guarded = async (fn: () => Promise<void>) => {
    if (inFlight.current || !supabase) return; // solicitudes simultáneas / doble clic
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toMfaError(e).key);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const start = () =>
    guarded(async () => {
      setEnrollment(await startTotpEnrollment(supabase!));
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!enrollment) return;
    if (!TOTP_CODE.test(code)) {
      setError('invalidCode');
      return;
    }
    void guarded(async () => {
      await verifyTotp(supabase!, enrollment.factorId, code);
      setDone(true);
      setEnrollment(null); // el secreto deja de estar en memoria
      setCode('');
      await access.revalidate();
    });
  };

  const showForm = access.state === 'MFA_ENROLLMENT_REQUIRED' && !done;

  return (
    <MfaFrame eyebrow={t('eyebrow')} title={t('setupTitle')} help={t('setupHelp')}>
      {error ? (
        <div className="banner b-red" role="alert">
          <div className="grow">{t(`errors.${error}`)}</div>
        </div>
      ) : null}
      {access.state === 'ERROR' ? (
        <>
          <div className="banner b-red" role="alert">
            <div className="grow">{t('errors.network')}</div>
          </div>
          <button type="button" className="btn block" onClick={() => void access.revalidate()}>
            {t('retry')}
          </button>
        </>
      ) : showForm ? (
        enrollment ? (
          <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 14 }}>
            <ol className="sm" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
              <li>{t('step1')}</li>
              <li>{t('step2')}</li>
              <li>{t('step3')}</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL SVG generado por Supabase */}
            <img
              src={enrollment.qrCode}
              alt={t('qrAlt')}
              width={192}
              height={192}
              style={{ background: '#fff', padding: 8, borderRadius: 8, justifySelf: 'center' }}
            />
            <details>
              <summary className="sm strong">{t('manualTitle')}</summary>
              <p className="xs muted">{t('manualHelp')}</p>
              <code
                data-testid="totp-secret"
                style={{ wordBreak: 'break-all', userSelect: 'all', fontSize: 13 }}
              >
                {enrollment.secret}
              </code>
            </details>
            <label className="field">
              <span className="flabel">{t('codeLabel')}</span>
              <input
                className="inp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                aria-invalid={error === 'invalidCode'}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary block"
              style={{ height: 50 }}
              disabled={busy}
            >
              {t('confirm')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-primary block"
            style={{ height: 50 }}
            disabled={busy}
            onClick={() => void start()}
          >
            {t('start')}
          </button>
        )
      ) : (
        <div role="status" className="sm muted">
          {done ? t('verifyingAccess') : t('checking')}
        </div>
      )}
      <button
        type="button"
        className="link-btn"
        style={{ alignSelf: 'center' }}
        onClick={() => void auth.signOut()}
      >
        {t('signOut')}
      </button>
    </MfaFrame>
  );
}
