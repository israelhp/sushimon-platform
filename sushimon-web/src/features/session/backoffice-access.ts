import type { MfaStatus } from '@/lib/auth/mfa';

/**
 * Estado ÚNICO del acceso al backoffice (sin booleanos contradictorios). Se deriva de: sesión de Supabase,
 * `GET /v1/auth/context` (decide el servidor) y, solo si el servidor pide MFA, los factores en Supabase.
 * Es para elegir pantalla; no concede nada: cada endpoint de la API vuelve a exigir aal2 y permisos.
 */
export type BackofficeAccessKind =
  | 'INITIALIZING'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'STAFF_UNAUTHORIZED'
  | 'MFA_ENROLLMENT_REQUIRED'
  | 'MFA_CHALLENGE_REQUIRED'
  | 'STAFF_AUTHORIZED'
  | 'ERROR';

type Async<T> = { isPending: boolean; isError: boolean; data?: T };

export interface AccessInput {
  authStatus: 'loading' | 'anonymous' | 'authenticated';
  expired: boolean;
  context: Async<{ access: 'NOT_STAFF' | 'MFA_REQUIRED' | 'GRANTED' }>;
  mfa: Async<MfaStatus>;
}

export function resolveBackofficeAccess(input: AccessInput): BackofficeAccessKind {
  const { authStatus, expired, context, mfa } = input;
  if (authStatus === 'loading') return 'INITIALIZING';
  if (authStatus === 'anonymous') return expired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED';

  if (context.isError) return 'ERROR';
  if (!context.data) return 'INITIALIZING';
  switch (context.data.access) {
    case 'NOT_STAFF':
      return 'STAFF_UNAUTHORIZED';
    case 'GRANTED':
      return 'STAFF_AUTHORIZED';
    case 'MFA_REQUIRED': {
      if (mfa.isError) return 'ERROR';
      if (!mfa.data) return 'INITIALIZING';
      // Sin factor verificado → configurar. Con factor → verificar (incluye el caso inconsistente en que
      // el cliente cree estar en aal2 pero la API aún ve aal1: se revalida, nunca se concede).
      return mfa.data.verifiedTotp.length === 0
        ? 'MFA_ENROLLMENT_REQUIRED'
        : 'MFA_CHALLENGE_REQUIRED';
    }
    default:
      return 'ERROR';
  }
}

export const BO_PATHS = {
  login: '/backoffice/login',
  mfaSetup: '/backoffice/mfa/setup',
  mfaVerify: '/backoffice/mfa/verify',
  accessDenied: '/backoffice/access-denied',
  home: '/backoffice',
} as const;

/** Pantalla que corresponde a cada estado, o null si el estado se resuelve en la propia pantalla. */
export function pathForAccess(kind: BackofficeAccessKind): string | null {
  switch (kind) {
    case 'UNAUTHENTICATED':
    case 'SESSION_EXPIRED':
      return BO_PATHS.login;
    case 'STAFF_UNAUTHORIZED':
      return BO_PATHS.accessDenied;
    case 'MFA_ENROLLMENT_REQUIRED':
      return BO_PATHS.mfaSetup;
    case 'MFA_CHALLENGE_REQUIRED':
      return BO_PATHS.mfaVerify;
    default:
      return null;
  }
}
