import { validateEnv } from './env.js';

const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.example.invalid:6543/postgres',
  HEALTH_READY_TOKEN: 'token-de-prueba-123456',
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
};

describe('validateEnv', () => {
  it('aplica valores por defecto en desarrollo', () => {
    const env = validateEnv({});
    expect(env).toMatchObject({ PORT: 3001, DB_POOL_MAX: 3, RATE_LIMIT_MAX: 120 });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('trata variables vacías como no definidas', () => {
    expect(validateEnv({ DATABASE_URL: '', HEALTH_READY_TOKEN: '' }).DATABASE_URL).toBeUndefined();
  });

  it('exige DATABASE_URL y token de salud en producción', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL.*HEALTH_READY_TOKEN/,
    );
    expect(validateEnv(prod).NODE_ENV).toBe('production');
  });

  it('exige configuración de Supabase Auth en producción', () => {
    const withoutSupabase = { ...prod, SUPABASE_URL: undefined };
    expect(() => validateEnv(withoutSupabase)).toThrow(/SUPABASE_URL/);
    expect(
      validateEnv({
        ...withoutSupabase,
        SUPABASE_JWT_ISSUER: 'https://x.example/auth/v1',
        SUPABASE_JWKS_URL: 'https://x.example/auth/v1/.well-known/jwks.json',
      }).NODE_ENV,
    ).toBe('production');
  });

  it('valida longitudes y formato de las variables de Auth', () => {
    expect(() => validateEnv({ SUPABASE_JWT_SECRET: 'corto' })).toThrow(/SUPABASE_JWT_SECRET/);
    expect(() => validateEnv({ SUPABASE_URL: 'no-es-url' })).toThrow(/SUPABASE_URL/);
    expect(validateEnv({}).SUPABASE_JWT_AUDIENCE).toBe('authenticated');
  });

  it('prohíbe CORS "*" en producción', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('rechaza URLs inválidas sin imprimir el valor', () => {
    const invalid = 'mysql://usuario:clave-secreta@host/db';
    try {
      validateEnv({ DATABASE_URL: invalid });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/DATABASE_URL/);
      expect((e as Error).message).not.toContain('clave-secreta');
    }
  });
});
