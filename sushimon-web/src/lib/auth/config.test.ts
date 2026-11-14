import { describe, expect, it } from 'vitest';
import { resolveAuthConfig } from './config';

const supa = {
  NEXT_PUBLIC_AUTH_SOURCE: 'supabase',
  NEXT_PUBLIC_DATA_SOURCE: 'http',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54341/',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
};

describe('resolveAuthConfig', () => {
  it('usa mock por defecto', () => {
    expect(resolveAuthConfig({})).toEqual({ kind: 'mock' });
  });

  it('configura supabase y normaliza la URL', () => {
    expect(resolveAuthConfig(supa)).toEqual({
      kind: 'supabase',
      supabaseUrl: 'http://127.0.0.1:54341',
      publishableKey: 'sb_publishable_x',
    });
  });

  it('exige URL y clave pública con supabase', () => {
    expect(() => resolveAuthConfig({ ...supa, NEXT_PUBLIC_SUPABASE_URL: undefined })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(() =>
      resolveAuthConfig({ ...supa, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }),
    ).toThrow(/PUBLISHABLE_KEY/);
  });

  it('prohíbe auth real con datos simulados (sin API que valide el token)', () => {
    expect(() => resolveAuthConfig({ ...supa, NEXT_PUBLIC_DATA_SOURCE: 'mock' })).toThrow(
      /DATA_SOURCE=http/,
    );
  });

  it('rechaza URL inválida y valores desconocidos', () => {
    expect(() => resolveAuthConfig({ ...supa, NEXT_PUBLIC_SUPABASE_URL: 'no-url' })).toThrow(
      /URL válida/,
    );
    expect(() => resolveAuthConfig({ NEXT_PUBLIC_AUTH_SOURCE: 'otro' })).toThrow(/inválido/);
  });

  it('prohíbe mock en producción salvo autorización explícita', () => {
    expect(() => resolveAuthConfig({ NODE_ENV: 'production' })).toThrow(/producción/);
    expect(
      resolveAuthConfig({ NODE_ENV: 'production', NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION: 'true' }),
    ).toEqual({ kind: 'mock' });
  });
});
