import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { createSupabaseServerClient } from '@/lib/auth/supabase-server';

/**
 * Callback OAuth (PKCE): canjea `code` por la sesión (cookies) y vuelve a `next` (solo rutas internas).
 * Los errores no exponen detalle: redirigen con un código genérico que la UI traduce.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get('next'), '/');
  const code = searchParams.get('code');
  const failure = (reason: string) =>
    NextResponse.redirect(
      `${origin}${next.startsWith('/backoffice') ? '/backoffice/login' : '/'}?auth_error=${reason}`,
    );

  if (searchParams.get('error')) return failure('provider');
  if (!code) return failure('missing_code');

  const supabase = await createSupabaseServerClient();
  if (!supabase) return failure('not_configured');
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failure('exchange_failed');
  return NextResponse.redirect(`${origin}${next}`);
}
