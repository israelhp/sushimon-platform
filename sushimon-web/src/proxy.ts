import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveAuthConfig } from '@/lib/auth/config';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { publicEnv } from '@/lib/data-access';

const LOGIN_PATH = '/backoffice/login';

/**
 * Renueva la sesión de Supabase en cada navegación (cookies) y manda al login del backoffice a quien no tenga
 * sesión. Es comodidad de UX: NO es autorización (la API valida el JWT y los permisos en cada llamada).
 * Con auth `mock` no hace nada.
 */
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
  if (isBackoffice && pathname !== LOGIN_PATH && !data?.claims) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = `?next=${encodeURIComponent(safeNextPath(`${pathname}${search}`, '/backoffice'))}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Todo menos estáticos, imágenes y el callback (que canjea el código sin leer la sesión previa).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
