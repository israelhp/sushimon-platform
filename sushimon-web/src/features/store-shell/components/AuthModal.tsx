'use client';

import { ClipboardList, History, LifeBuoy, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/session/auth-provider';
import { useDemoSession } from '@/features/session/demo-session';
import { useAuthModal } from '../store-shell-context';
import { Avatar, firstNameOf } from './Avatar';
import { GoogleLogo } from './GoogleLogo';

/** Duración de la animación "Iniciando sesión…" del inicio de sesión simulado (solo presentación). */
const SIGNING_IN_MS = 450;

type Step = 'start' | 'choose' | 'signing';

/**
 * Inicio de sesión SIMULADO ("Continuar con Google" → selector de cuentas de prueba), rotulado como
 * demostración. No autentica ni autoriza nada: la sesión de demostración solo la lee el adaptador mock.
 * En producción el acceso lo decide el servidor (Supabase Auth). Se abre con `useAuthModal().open()`.
 */
export function AuthModal() {
  const { isOpen, close } = useAuthModal();
  const auth = useAuth();
  if (!isOpen) return null;
  return auth.mode === 'supabase' ? (
    <GoogleAuthDialog onClose={close} />
  ) : (
    <AuthModalDialog onClose={close} />
  );
}

function AuthModalDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const session = useDemoSession();
  const { notify } = useToast();
  const [step, setStep] = useState<Step>('start');
  const [picked, setPicked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const signIn = (account: { email: string; name: string }) => {
    setPicked(account.email);
    setStep('signing');
    timer.current = setTimeout(() => {
      session.signInCustomer(account);
      notify(t('welcome', { a: firstNameOf(account.name) }));
      onClose();
    }, SIGNING_IN_MS);
  };

  const benefits = [
    { Icon: ClipboardList, text: t('benefitTrack') },
    { Icon: History, text: t('benefitHistory') },
    { Icon: LifeBuoy, text: t('benefitIncidents') },
  ];

  return (
    <Modal open onClose={onClose} title={t('title')} layer="top">
      <div className="flex flex-col gap-4 pb-2">
        <p className="m-0 text-[15px] leading-snug text-muted">{t('intro')}</p>
        <ul className="m-0 grid list-none gap-2 p-0 text-[14px] font-bold">
          {benefits.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        {step === 'start' ? (
          <div className="flex flex-col items-stretch gap-2">
            <button
              type="button"
              onClick={() => setStep('choose')}
              className="btn w-full !border-line !bg-white !text-neutral-900 hover:!bg-neutral-100"
            >
              <GoogleLogo /> {t('continueGoogle')}
            </button>
            <SimulationBadge kind="simulation" className="self-center">
              {tc('simulation')}
            </SimulationBadge>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-line bg-surface p-3 shadow-card"
            aria-live="polite"
          >
            <p className="m-0 mb-2 flex items-center gap-2 px-1 text-[13px] font-bold text-muted">
              <GoogleLogo className="h-4 w-4" /> {t('chooseAccount')}
            </p>
            {session.googleAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                disabled={step === 'signing'}
                onClick={() => signIn(account)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-subtle disabled:opacity-80"
              >
                <Avatar name={account.name} className="h-10 w-10 text-[14px]" />
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold">{account.name}</span>
                  <span className="block truncate text-[13px] text-muted">{account.email}</span>
                </span>
                {step === 'signing' && picked === account.email ? (
                  <LoaderCircle className="anim-spin h-5 w-5 text-secondary" aria-hidden="true" />
                ) : null}
              </button>
            ))}
            {step === 'signing' ? (
              <p className="m-0 mt-1 px-1 text-[13px] font-bold" role="status">
                {t('signingIn')}
              </p>
            ) : null}
          </div>
        )}

        <p className="m-0 flex items-start gap-2 text-[12px] leading-snug text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          {t('privacyDemo')}
        </p>
        <button type="button" onClick={onClose} className="link-btn self-center">
          {t('guest')}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Inicio de sesión REAL: "Continuar con Google" (Supabase Auth, PKCE). Redirige a Google y vuelve por
 * `/auth/callback`. Sin selector de cuentas de prueba ni rótulo de simulación.
 */
function GoogleAuthDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('auth');
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const benefits = [
    { Icon: ClipboardList, text: t('benefitTrack') },
    { Icon: History, text: t('benefitHistory') },
    { Icon: LifeBuoy, text: t('benefitIncidents') },
  ];

  const signIn = async () => {
    setPending(true);
    setFailed(false);
    try {
      // Vuelve a la misma pantalla (ruta + consulta); `signInWithGoogle` lo valida con `safeNextPath`.
      await auth.signInWithGoogle(`${window.location.pathname}${window.location.search}`);
    } catch {
      setPending(false);
      setFailed(true);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('title')} layer="top">
      <div className="flex flex-col gap-4 pb-2">
        <p className="m-0 text-[15px] leading-snug text-muted">{t('intro')}</p>
        {auth.expired ? (
          <p className="m-0 text-[14px] font-bold text-danger" role="alert">
            {t('sessionExpired')}
          </p>
        ) : null}
        <ul className="m-0 grid list-none gap-2 p-0 text-[14px] font-bold">
          {benefits.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={pending}
          onClick={() => void signIn()}
          className="btn w-full !border-line !bg-white !text-neutral-900 hover:!bg-neutral-100"
        >
          {pending ? (
            <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" />
          ) : (
            <GoogleLogo />
          )}{' '}
          {pending ? t('googleRedirecting') : t('continueGoogle')}
        </button>
        {failed ? (
          <p className="m-0 text-[13px] font-bold text-danger" role="alert">
            {t('errorProvider')}
          </p>
        ) : null}
        <p className="m-0 flex items-start gap-2 text-[12px] leading-snug text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          {t('privacyReal')}
        </p>
        <button type="button" onClick={onClose} className="link-btn self-center">
          {t('guest')}
        </button>
      </div>
    </Modal>
  );
}
