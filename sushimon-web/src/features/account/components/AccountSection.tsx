'use client';

import { ArrowLeft, Database, LoaderCircle, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import { useCustomerScope } from '@/features/session/customer-scope';
import { STORE_ROUTES } from '@/features/store-shell/nav';

/** Los datos de la cuenta salen del adaptador mock (la API real sincroniza con la cuenta). */
const IS_DEMO_DATA = process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http';

export interface SectionQueryState {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * Armazón de las subpáginas de la cuenta (datos, direcciones, favoritos, pedidos): enlace de regreso,
 * título, acción y los tres estados que no son contenido: sin sesión (invitación a entrar), carga y error.
 * La identidad sale de `useCustomerScope` (Supabase Auth real o sesión de demostración) y solo decide qué se pinta;
 * la API real autoriza cada petición (401/403).
 */
export function AccountSection({
  title,
  intro,
  action,
  requireAuth = true,
  query,
  children,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
  requireAuth?: boolean;
  /** Consulta principal de la sección (carga/error). */
  query?: SectionQueryState;
  children: ReactNode;
}) {
  const t = useTranslations('hub');
  const tAuth = useTranslations('auth');
  const identity = useCustomerScope();
  const auth = useAuthModal();
  const signedIn = identity.state === 'ready';
  const gated = requireAuth && identity.state === 'guest';
  // `pending`: la sesión real ya autenticó pero aún no se conoce la identidad; no se muestra la invitación a entrar.
  const loading = (requireAuth && identity.state === 'pending') || (signedIn && !!query?.isPending);
  const failed = signedIn && !loading && !!query?.isError;
  const ready = !gated && !loading && !failed;

  let body: ReactNode = children;
  if (gated) {
    body = (
      <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <LogIn className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="disp text-[22px]">{t('signInRequired')}</h2>
        <p className="m-0 max-w-[44ch] text-[14px] text-muted">{t('signInRequiredText')}</p>
        <button
          type="button"
          onClick={auth.open}
          className="btn mt-1 !border-line !bg-white !text-neutral-900"
        >
          <GoogleLogo /> {tAuth('continueGoogle')}
        </button>
      </section>
    );
  } else if (loading) {
    body = (
      <div
        role="status"
        aria-busy="true"
        className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card"
      >
        <LoaderCircle className="anim-spin h-6 w-6 text-secondary" aria-hidden="true" />
        <span className="font-bold">{t('loading')}</span>
      </div>
    );
  } else if (failed) {
    body = <ErrorNotice message={t('loadError')} onRetry={() => void query?.refetch()} />;
  }

  return (
    <div className="wrap max-w-[760px] pb-12 pt-4 sm:pt-7">
      <Link
        href={STORE_ROUTES.account}
        className="mb-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-extrabold text-secondary no-underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('back')}
      </Link>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="disp text-[clamp(28px,6vw,44px)]">{title}</h1>
          {intro ? <p className="m-0 mt-1 max-w-[60ch] text-[14px] text-muted">{intro}</p> : null}
        </div>
        {action && (!requireAuth || ready) ? action : null}
      </div>
      {body}
      {signedIn && ready && IS_DEMO_DATA ? (
        <p className="m-0 mt-5 flex items-center justify-center gap-1.5 text-[12px] text-muted">
          <Database className="h-4 w-4" aria-hidden="true" /> {t('demoStorage')}
        </p>
      ) : null}
    </div>
  );
}
