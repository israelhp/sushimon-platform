import { describe, expect, it } from 'vitest';
import {
  pathForAccess,
  resolveBackofficeAccess,
  type AccessInput,
  type BackofficeAccessKind,
} from './backoffice-access';

const pending = { isPending: true, isError: false } as const;
const base: AccessInput = {
  authStatus: 'authenticated',
  expired: false,
  context: pending,
  mfa: { isPending: false, isError: false },
};
const ctx = (access: 'NOT_STAFF' | 'MFA_REQUIRED' | 'GRANTED') => ({
  isPending: false,
  isError: false,
  data: { access },
});
const mfa = (verified: number, level: 'aal1' | 'aal2' = 'aal1') => ({
  isPending: false,
  isError: false,
  data: {
    currentLevel: level,
    verifiedTotp: Array.from({ length: verified }, (_, i) => ({ id: `f${i}`, label: 'x' })),
  },
});

describe('resolveBackofficeAccess', () => {
  it.each<[string, Partial<AccessInput>, BackofficeAccessKind]>([
    ['sesión cargando', { authStatus: 'loading' }, 'INITIALIZING'],
    ['sin sesión', { authStatus: 'anonymous' }, 'UNAUTHENTICATED'],
    ['sesión expirada', { authStatus: 'anonymous', expired: true }, 'SESSION_EXPIRED'],
    ['contexto cargando', {}, 'INITIALIZING'],
    ['error del contexto', { context: { isPending: false, isError: true } }, 'ERROR'],
    ['no es personal', { context: ctx('NOT_STAFF') }, 'STAFF_UNAUTHORIZED'],
    ['personal en aal2', { context: ctx('GRANTED') }, 'STAFF_AUTHORIZED'],
    [
      'MFA pedida, factores cargando',
      { context: ctx('MFA_REQUIRED'), mfa: pending },
      'INITIALIZING',
    ],
    [
      'MFA pedida, error en Supabase',
      { context: ctx('MFA_REQUIRED'), mfa: { isPending: false, isError: true } },
      'ERROR',
    ],
    [
      'MFA pedida, sin factor verificado',
      { context: ctx('MFA_REQUIRED'), mfa: mfa(0) },
      'MFA_ENROLLMENT_REQUIRED',
    ],
    [
      'MFA pedida, un factor verificado',
      { context: ctx('MFA_REQUIRED'), mfa: mfa(1) },
      'MFA_CHALLENGE_REQUIRED',
    ],
    [
      'MFA pedida, varios factores',
      { context: ctx('MFA_REQUIRED'), mfa: mfa(2) },
      'MFA_CHALLENGE_REQUIRED',
    ],
  ])('%s → %s', (_n, over, expected) => {
    expect(resolveBackofficeAccess({ ...base, ...over })).toBe(expected);
  });

  it('inconsistencia (cliente aal2, API aal1): nunca concede, revalida pidiendo verificación', () => {
    expect(
      resolveBackofficeAccess({ ...base, context: ctx('MFA_REQUIRED'), mfa: mfa(1, 'aal2') }),
    ).toBe('MFA_CHALLENGE_REQUIRED');
  });

  it('un cliente con factores MFA no obtiene acceso: manda la API', () => {
    expect(
      resolveBackofficeAccess({ ...base, context: ctx('NOT_STAFF'), mfa: mfa(1, 'aal2') }),
    ).toBe('STAFF_UNAUTHORIZED');
  });
});

describe('pathForAccess', () => {
  it('cada estado tiene una pantalla y STAFF_AUTHORIZED/INITIALIZING/ERROR ninguna', () => {
    expect(pathForAccess('UNAUTHENTICATED')).toBe('/backoffice/login');
    expect(pathForAccess('STAFF_UNAUTHORIZED')).toBe('/backoffice/access-denied');
    expect(pathForAccess('MFA_ENROLLMENT_REQUIRED')).toBe('/backoffice/mfa/setup');
    expect(pathForAccess('MFA_CHALLENGE_REQUIRED')).toBe('/backoffice/mfa/verify');
    expect(pathForAccess('STAFF_AUTHORIZED')).toBeNull();
    expect(pathForAccess('INITIALIZING')).toBeNull();
    expect(pathForAccess('ERROR')).toBeNull();
  });
});
