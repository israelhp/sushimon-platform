'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { BoLogo, IconLock } from '@/components/icons/bo';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { useAuth } from '@/features/session/auth-provider';
import { pathForAccess } from '@/features/session/backoffice-access';
import { useBackofficeAccess } from '@/features/session/use-backoffice-access';
import { useDemoSession } from '@/features/session/demo-session';
import { useBranches } from '@/features/store/hooks';
import { cn } from '@/lib/cn';
import type { StaffRole } from '@/lib/data-access/models';
import { ROLE_HOME } from '@/lib/permissions';
import { DEMO_STAFF_BY_ROLE, STAFF_SEEDS } from '@/mocks/fixtures/staff';
import { BoThemeButton } from './BoThemeButton';
import { screenHref } from './nav';
import { avatarStyle, staffInitials } from './staff-display';

/** Cuentas de DEMOSTRACIÓN del selector "Entrar como (demo)" (una por rol). */
const DEMO_ROLES: readonly StaffRole[] = ['admin', 'manager', 'kitchen'];

/**
 * Valor de relleno de la contraseña de demostración. NO se valida ni se envía: el acceso real
 * (usuario interno + rol + sucursal) lo resolverá el servidor con Supabase Auth.
 */
const DEMO_PASSWORD_PLACEHOLDER = 'demodemodemo';

/** Acceso al backoffice (prototipo): formulario simulado + selector de cuenta de demostración por rol. */
function DemoLoginScreen() {
  const t = useTranslations('backoffice.login');
  const tr = useTranslations('backoffice.roles');
  const router = useRouter();
  const toast = useToast();
  const { staff, signInStaffUser } = useDemoSession();
  const branches = useBranches();
  const [role, setRole] = useState<StaffRole>('admin');
  const accounts = DEMO_ROLES.map((r) => {
    const user = STAFF_SEEDS.find((u) => u.id === DEMO_STAFF_BY_ROLE[r])!;
    const branch = user.branchId
      ? (branches.data?.find((b) => b.id === user.branchId)?.name ?? user.branchId)
      : null;
    return { role: r, user, branchLabel: branch ?? t('branchAll') };
  });
  const selected = accounts.find((a) => a.role === role)!;
  const [email, setEmail] = useState(selected.user.email);
  const [error, setError] = useState<string | null>(null);

  // Si ya hay sesión de demostración, no se muestra el acceso.
  useEffect(() => {
    if (staff) router.replace(screenHref(ROLE_HOME[staff.role]));
  }, [staff, router]);

  const pick = (next: StaffRole) => {
    const account = accounts.find((a) => a.role === next)!;
    setRole(next);
    setEmail(account.user.email);
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const user = STAFF_SEEDS.find((u) => u.active && u.email === email.trim().toLowerCase());
    if (!user) {
      setError(t('unknownUser'));
      return;
    }
    const next = signInStaffUser(user.id);
    router.replace(screenHref(ROLE_HOME[next.role]));
  };

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
          <SimulationBadge kind="demo" zone="bo" />
          <BoThemeButton scope="login" />
        </div>
        <form className="auth-card" onSubmit={submit} noValidate>
          <BoLogo className="auth-mlogo" />
          <div>
            <div className="eyebrow">{t('eyebrow')}</div>
            <h2>{t('title')}</h2>
            <div className="sm muted" style={{ fontWeight: 600 }}>
              {t('subtitle')}
            </div>
          </div>
          <label className="field">
            <span className="flabel">{t('email')}</span>
            <input
              className="inp"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label className="field">
            <span className="flabel">{t('password')}</span>
            <input
              className="inp"
              type="password"
              autoComplete="current-password"
              defaultValue={DEMO_PASSWORD_PLACEHOLDER}
            />
          </label>
          <div className="demo-box" title={t('demoNotice')}>
            <div
              className="xs strong"
              style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}
            >
              {t('demoAs')}
            </div>
            {accounts.map((a) => (
              <button
                key={a.role}
                type="button"
                className={cn('prof', a.role === role && 'on')}
                aria-pressed={a.role === role}
                onClick={() => pick(a.role)}
              >
                <span className="avatar" style={avatarStyle(a.role)} aria-hidden="true">
                  {staffInitials(a.user.name)}
                </span>
                <span className="grow">
                  <span className="strong" style={{ display: 'block', fontSize: 13 }}>
                    {a.user.name}
                  </span>
                  <span
                    className="xs muted"
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      color: a.role === role ? 'var(--bo-text)' : undefined,
                    }}
                  >
                    {t('accountMeta', { role: tr(a.role), branch: a.branchLabel })}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {error ? (
            <div className="banner b-red" role="alert">
              <div className="grow">{error}</div>
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary block" style={{ height: 50 }}>
            {t('submit')}
          </button>
          <button
            type="button"
            className="link-btn"
            style={{ alignSelf: 'center' }}
            onClick={() => toast.notify(t('forgotToast', { email }))}
          >
            {t('forgot')}
          </button>
        </form>
      </main>
    </div>
  );
}

/** Acceso al backoffice: demostración (auth `mock`) o Google real (auth `supabase`). */
export function LoginScreen() {
  const auth = useAuth();
  return auth.mode === 'supabase' ? <GoogleLoginScreen /> : <DemoLoginScreen />;
}

/** Motivos del callback OAuth (`?auth_error=`) → clave de mensaje. Nunca se muestra texto del proveedor. */
type AuthErrorKey = 'errorProvider' | 'errorExchange' | 'errorNotConfigured' | 'errorMissingCode';
const AUTH_ERRORS: Record<string, AuthErrorKey> = {
  provider: 'errorProvider',
  exchange_failed: 'errorExchange',
  not_configured: 'errorNotConfigured',
  missing_code: 'errorMissingCode',
};

/**
 * Acceso real: "Continuar con Google" (Supabase Auth, PKCE). Autenticarse NO da acceso: tras volver del
 * callback se consulta `GET /v1/auth/context` y solo entra quien el servidor autoriza como personal activo.
 */
function GoogleLoginScreen() {
  const t = useTranslations('backoffice.login');
  const router = useRouter();
  const auth = useAuth();
  const access = useBackofficeAccess();
  const { staff } = useDemoSession();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);

  // Parámetros del callback: se leen tras montar (la pantalla es dinámica; evita desajustes de hidratación).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura única de la URL tras hidratar
    setNext(params.get('next'));
    const reason = params.get('auth_error');
    setErrorKey(reason ? (AUTH_ERRORS[reason] ?? 'errorProvider') : null);
  }, []);

  const safeNext = next ? safeNextPath(next, '') : '';
  const nextBackoffice =
    safeNext === '/backoffice' || safeNext.startsWith('/backoffice/') ? safeNext : null;
  useEffect(() => {
    if (access.state === 'STAFF_AUTHORIZED' && staff) {
      router.replace(nextBackoffice ?? screenHref(ROLE_HOME[staff.role]));
      return;
    }
    // Personal autorizado sin MFA completo: configurar (sin factor) o verificar (con factor).
    const target = pathForAccess(access.state);
    if (target && target.startsWith('/backoffice/mfa')) {
      router.replace(
        nextBackoffice ? `${target}?next=${encodeURIComponent(nextBackoffice)}` : target,
      );
    }
  }, [access.state, staff, nextBackoffice, router]);

  const signIn = async () => {
    setPending(true);
    setFailure(null);
    try {
      await auth.signInWithGoogle(nextBackoffice ?? '/backoffice');
    } catch {
      setPending(false);
      setFailure(t('errorProvider'));
    }
  };

  const checking =
    access.state === 'INITIALIZING' ||
    access.state === 'MFA_ENROLLMENT_REQUIRED' ||
    access.state === 'MFA_CHALLENGE_REQUIRED' ||
    access.state === 'STAFF_AUTHORIZED';
  const denied = access.state === 'STAFF_UNAUTHORIZED' || access.state === 'ERROR';

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
            <div className="eyebrow">{t('eyebrow')}</div>
            <h2>{t('title')}</h2>
            <div className="sm muted" style={{ fontWeight: 600 }}>
              {t('googleHelp')}
            </div>
          </div>
          {auth.expired ? (
            <div className="banner b-red" role="alert">
              <div className="grow">{t('expired')}</div>
            </div>
          ) : null}
          {errorKey || failure ? (
            <div className="banner b-red" role="alert">
              <div className="grow">{failure ?? t(errorKey ?? 'errorProvider')}</div>
            </div>
          ) : null}
          {denied ? (
            <>
              <div className="banner b-red" role="alert">
                <div className="grow">{t('denied')}</div>
              </div>
              <button
                type="button"
                className="btn block"
                style={{ height: 50 }}
                onClick={() => void auth.signOut()}
              >
                {t('signOut')}
              </button>
            </>
          ) : checking ? (
            <div role="status" className="sm muted">
              {t('checking')}
            </div>
          ) : access.state === 'UNAUTHENTICATED' || access.state === 'SESSION_EXPIRED' ? (
            <button
              type="button"
              className="btn btn-primary block"
              style={{ height: 50 }}
              disabled={pending}
              onClick={() => void signIn()}
            >
              {t('googleCta')}
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
