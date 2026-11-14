import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveAuthConfig } from '@/lib/auth/config';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { publicEnv } from '@/lib/data-access';

const LOGIN_PATH = '/backoffice/login';
const MFA_VERIFY_PATH = '/backoffice/mfa/verify';
/** Pantallas previas al backoffice: accesibles con sesión aal1 (completar/verificar MFA, ver denegación) o sin sesión (login). */
const PRE_MFA_PATHS = new Set([
  LOGIN_PATH,
  MFA_VERIFY_PATH,
  '/backoffice/mfa/setup',
  '/backoffice/access-denied',
]);

/**
 * Renueva la sesión de Supabase en cada navegación (cookies), manda al login del backoffice a quien no tenga
 * sesión y a la verificación MFA a quien tenga sesión aal1. Es comodidad de UX: NO es autorización (la API valida
 * el JWT, aal2, el personal activo y los permisos en cada llamada). Las respuestas del backoffice no se cachean.
 * Con auth `mock` no hace nada.
 */
/** Contenido privado del backoffice: nunca en cachés compartidas ni del navegador. */
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export async function proxy(request: NextRequest) {
  const config = resolveAuthConfig(publicEnv());
  if (config.kind !== 'supabase') return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims verifica la firma del JWT contra el JWKS y renueva el token si expiró.
  const { data } = await supabase.auth.getClaims();
  const { pathname, search } = request.nextUrl;
  const isBackoffice = pathname === '/backoffice' || pathname.startsWith('/backoffice/');
  if (!isBackoffice) return response;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = `?next=${encodeURIComponent(safeNextPath(`${pathname}${search}`, '/backoffice'))}`;
    return noStore(NextResponse.redirect(url));
  };
  const claims = data?.claims;
  if (pathname !== LOGIN_PATH && !claims) return redirectTo(LOGIN_PATH);
  // Sesión sin segundo factor (claim `aal` firmado y verificado por getClaims): solo las pantallas de MFA.
  if (claims && !PRE_MFA_PATHS.has(pathname) && claims.aal !== 'aal2') {
    return redirectTo(MFA_VERIFY_PATH);
  }
  return noStore(response);
}

export const config = {
  // Todo menos estáticos, imágenes y el callback (que canjea el código sin leer la sesión previa).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
