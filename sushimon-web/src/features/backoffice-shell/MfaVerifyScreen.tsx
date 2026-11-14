'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/features/session/auth-provider';
import { BO_PATHS } from '@/features/session/backoffice-access';
import { useBackofficeAccess, useSupabaseClient } from '@/features/session/use-backoffice-access';
import { toMfaError, TOTP_CODE, verifyTotp, type MfaErrorKey } from '@/lib/auth/mfa';
import { MfaFrame } from './MfaFrame';
import { useAccessRedirect } from './use-access-redirect';

/**
 * Segundo factor en cada inicio de sesión (aal1 → aal2). Si la sesión ya es aal2 no se pide de nuevo: el
 * estado pasa a STAFF_AUTHORIZED y se redirige. Verificar el código no concede acceso por sí mismo.
 */
export function MfaVerifyScreen() {
  const t = useTranslations('backoffice.mfa');
  const auth = useAuth();
  const supabase = useSupabaseClient();
  const access = useBackofficeAccess();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<MfaErrorKey | null>(null);
  const inFlight = useRef(false);

  useAccessRedirect(access.state, BO_PATHS.mfaVerify, done);

  const factors = access.mfa?.verifiedTotp ?? [];
  const selected = factorId && factors.some((f) => f.id === factorId) ? factorId : factors[0]?.id;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !supabase || !selected) return;
    if (!TOTP_CODE.test(code)) {
      setError('invalidCode');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(supabase, selected, code);
      setDone(true);
      setCode('');
      await access.revalidate();
    } catch (e) {
      setError(toMfaError(e).key);
      setCode('');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const showForm = access.state === 'MFA_CHALLENGE_REQUIRED' && !done;

  return (
    <MfaFrame eyebrow={t('eyebrow')} title={t('verifyTitle')} help={t('verifyHelp')}>
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
        <form onSubmit={(e) => void submit(e)} noValidate style={{ display: 'grid', gap: 14 }}>
          {factors.length > 1 ? (
            <label className="field">
              <span className="flabel">{t('factorLabel')}</span>
              <select
                className="inp"
                value={selected}
                onChange={(e) => setFactorId(e.target.value)}
              >
                {factors.map((f, i) => (
                  <option key={f.id} value={f.id}>
                    {t('factorOption', { n: i + 1 })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
            {t('verify')}
          </button>
        </form>
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
