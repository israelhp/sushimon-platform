import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackofficeAccessKind } from '@/features/session/backoffice-access';
import { MfaError } from '@/lib/auth/mfa';
import { resetNavigationMock, router } from '@/test/next-navigation-mock';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderWithIntl as baseRender } from '@/test/render';
import type { ReactElement } from 'react';

/** Las pantallas usan el botón de tema del backoffice: requiere ThemeProvider. */
const renderWithIntl = (ui: ReactElement) => {
  const view = baseRender(<ThemeProvider>{ui}</ThemeProvider>);
  return {
    ...view,
    rerender: (next: ReactElement) => view.rerender(<ThemeProvider>{next}</ThemeProvider>),
  };
};

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

const h = vi.hoisted(() => ({
  state: 'MFA_ENROLLMENT_REQUIRED' as string,
  mfa: undefined as
    undefined | { currentLevel: 'aal1'; verifiedTotp: { id: string; label: string }[] },
  revalidate: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/features/session/use-backoffice-access', () => ({
  useSupabaseClient: () => ({}),
  useBackofficeAccess: () => ({ state: h.state, mfa: h.mfa, revalidate: h.revalidate }),
}));
vi.mock('@/features/session/auth-provider', () => ({
  useAuth: () => ({
    mode: 'supabase',
    status: 'authenticated',
    expired: false,
    signOut: h.signOut,
  }),
}));
vi.mock('@/lib/auth/mfa', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/mfa')>()),
  startTotpEnrollment: h.start,
  verifyTotp: h.verify,
}));

import { AccessDeniedScreen } from './AccessDeniedScreen';
import { MfaSetupScreen } from './MfaSetupScreen';
import { MfaVerifyScreen } from './MfaVerifyScreen';

function setState(state: BackofficeAccessKind, verified = 0) {
  h.state = state;
  h.mfa = {
    currentLevel: 'aal1',
    verifiedTotp: Array.from({ length: verified }, (_, i) => ({ id: `f${i + 1}`, label: 'x' })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNavigationMock('/backoffice/mfa/setup');
  window.history.replaceState({}, '', '/backoffice/mfa/setup');
  setState('MFA_ENROLLMENT_REQUIRED');
});

describe('MfaSetupScreen', () => {
  it('no crea ningún factor al renderizar; solo al pulsar "Comenzar"', async () => {
    renderWithIntl(<MfaSetupScreen />);
    expect(
      await screen.findByRole('button', { name: 'Comenzar configuración' }),
    ).toBeInTheDocument();
    expect(h.start).not.toHaveBeenCalled();
  });

  it('muestra QR y clave manual, verifica el código y no redirige hasta que la API autorice', async () => {
    const user = userEvent.setup();
    h.start.mockResolvedValue({
      factorId: 'f9',
      qrCode: 'data:image/svg+xml;utf-8,<svg/>',
      secret: 'ABCD EFGH',
    });
    h.verify.mockResolvedValue(undefined);
    const view = renderWithIntl(<MfaSetupScreen />);
    await user.click(await screen.findByRole('button', { name: 'Comenzar configuración' }));
    expect(await screen.findByAltText(/Código QR/)).toBeInTheDocument();
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('ABCD EFGH');

    await user.type(screen.getByLabelText('Código de 6 dígitos'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirmar y activar' }));
    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({}, 'f9', '123456'));
    expect(h.revalidate).toHaveBeenCalled();
    // El secreto deja de mostrarse y NO se navega mientras el servidor no diga STAFF_AUTHORIZED.
    expect(screen.queryByTestId('totp-secret')).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();

    setState('STAFF_AUTHORIZED');
    view.rerender(<MfaSetupScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice'));
  });

  it('código con formato inválido: error sin llamar a Supabase', async () => {
    const user = userEvent.setup();
    h.start.mockResolvedValue({ factorId: 'f9', qrCode: 'x', secret: 's' });
    renderWithIntl(<MfaSetupScreen />);
    await user.click(await screen.findByRole('button', { name: 'Comenzar configuración' }));
    await user.type(screen.getByLabelText('Código de 6 dígitos'), '12');
    await user.click(screen.getByRole('button', { name: 'Confirmar y activar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/código es incorrecto/i);
    expect(h.verify).not.toHaveBeenCalled();
  });

  it('código incorrecto según Supabase: muestra el error y permite reintentar', async () => {
    const user = userEvent.setup();
    h.start.mockResolvedValue({ factorId: 'f9', qrCode: 'x', secret: 's' });
    h.verify.mockRejectedValueOnce(new MfaError('invalidCode'));
    renderWithIntl(<MfaSetupScreen />);
    await user.click(await screen.findByRole('button', { name: 'Comenzar configuración' }));
    await user.type(screen.getByLabelText('Código de 6 dígitos'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar y activar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/código es incorrecto/i);
    expect(h.revalidate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar y activar' })).toBeEnabled();
  });

  it('cerrar sesión disponible', async () => {
    const user = userEvent.setup();
    renderWithIntl(<MfaSetupScreen />);
    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(h.signOut).toHaveBeenCalled();
  });

  it.each([
    ['MFA_CHALLENGE_REQUIRED', '/backoffice/mfa/verify'],
    ['STAFF_UNAUTHORIZED', '/backoffice/access-denied'],
    ['UNAUTHENTICATED', '/backoffice/login'],
  ] as const)('estado %s redirige a %s (sin mostrar el formulario)', async (state, path) => {
    setState(state, 1);
    renderWithIntl(<MfaSetupScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.stringContaining(path)));
    expect(
      screen.queryByRole('button', { name: 'Comenzar configuración' }),
    ).not.toBeInTheDocument();
  });

  it('en su propia ruta no se redirige a sí misma (sin bucle)', async () => {
    renderWithIntl(<MfaSetupScreen />);
    await screen.findByRole('button', { name: 'Comenzar configuración' });
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('MfaVerifyScreen', () => {
  beforeEach(() => {
    resetNavigationMock('/backoffice/mfa/verify');
    setState('MFA_CHALLENGE_REQUIRED', 1);
  });

  it('verifica con el factor y espera a la API antes de entrar', async () => {
    const user = userEvent.setup();
    h.verify.mockResolvedValue(undefined);
    const view = renderWithIntl(<MfaVerifyScreen />);
    await user.type(await screen.findByLabelText('Código de 6 dígitos'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({}, 'f1', '654321'));
    expect(router.replace).not.toHaveBeenCalled();
    setState('STAFF_AUTHORIZED');
    view.rerender(<MfaVerifyScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice'));
  });

  it('permite elegir el factor cuando hay varios', async () => {
    const user = userEvent.setup();
    setState('MFA_CHALLENGE_REQUIRED', 2);
    h.verify.mockResolvedValue(undefined);
    renderWithIntl(<MfaVerifyScreen />);
    await user.selectOptions(await screen.findByLabelText('Dispositivo'), 'f2');
    await user.type(screen.getByLabelText('Código de 6 dígitos'), '111111');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({}, 'f2', '111111'));
  });

  it.each([
    ['invalidCode', /código es incorrecto/i],
    ['expired', /expiró/i],
    ['rateLimited', /Demasiados intentos/i],
    ['session', /sesión expiró/i],
  ] as const)('error %s se muestra y limpia el campo', async (key, text) => {
    const user = userEvent.setup();
    h.verify.mockRejectedValueOnce(new MfaError(key));
    renderWithIntl(<MfaVerifyScreen />);
    const input = await screen.findByLabelText('Código de 6 dígitos');
    await user.type(input, '999999');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(input).toHaveValue('');
  });

  it('solo acepta dígitos', async () => {
    const user = userEvent.setup();
    renderWithIntl(<MfaVerifyScreen />);
    const input = await screen.findByLabelText('Código de 6 dígitos');
    await user.type(input, 'a1b2c3d4e5f6g7');
    expect(input).toHaveValue('123456');
  });

  it('con sesión ya en aal2 (STAFF_AUTHORIZED) no pide el código otra vez', async () => {
    setState('STAFF_AUTHORIZED');
    renderWithIntl(<MfaVerifyScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice'));
    expect(screen.queryByLabelText('Código de 6 dígitos')).not.toBeInTheDocument();
  });

  it('respeta el destino ?next= solo si es del backoffice', async () => {
    window.history.replaceState({}, '', '/backoffice/mfa/verify?next=%2Fbackoffice%2Fpedidos');
    setState('STAFF_AUTHORIZED');
    renderWithIntl(<MfaVerifyScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice/pedidos'));
  });

  it('un ?next= externo se descarta', async () => {
    window.history.replaceState({}, '', '/backoffice/mfa/verify?next=https%3A%2F%2Fevil.example');
    setState('STAFF_AUTHORIZED');
    renderWithIntl(<MfaVerifyScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice'));
  });

  it('error temporal del servidor: aviso y reintento', async () => {
    const user = userEvent.setup();
    setState('ERROR');
    renderWithIntl(<MfaVerifyScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos comunicarnos/);
    await act(async () => user.click(screen.getByRole('button', { name: 'Reintentar' })));
    expect(h.revalidate).toHaveBeenCalled();
  });
});

describe('AccessDeniedScreen', () => {
  it('mensaje genérico, volver a la tienda y cerrar sesión', async () => {
    const user = userEvent.setup();
    setState('STAFF_UNAUTHORIZED');
    renderWithIntl(<AccessDeniedScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no tiene acceso al backoffice/);
    expect(screen.getByRole('link', { name: 'Volver a la tienda' })).toHaveAttribute('href', '/');
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(h.signOut).toHaveBeenCalled();
  });

  it('personal autorizado (STAFF_AUTHORIZED) no se queda aquí', async () => {
    setState('STAFF_AUTHORIZED');
    renderWithIntl(<AccessDeniedScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/backoffice'));
  });
});
