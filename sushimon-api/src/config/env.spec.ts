import { envWarnings, validateEnv } from './env.js';

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

  it('BUSINESS_TIMEZONE: default Guatemala, vacío = default, IANA inválida falla', () => {
    expect(validateEnv({}).BUSINESS_TIMEZONE).toBe('America/Guatemala');
    expect(validateEnv({ BUSINESS_TIMEZONE: '' }).BUSINESS_TIMEZONE).toBe('America/Guatemala');
    expect(validateEnv({ BUSINESS_TIMEZONE: 'America/Mexico_City' }).BUSINESS_TIMEZONE).toBe(
      'America/Mexico_City',
    );
    expect(() => validateEnv({ BUSINESS_TIMEZONE: 'Mars/Olympus' })).toThrow(/BUSINESS_TIMEZONE/);
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

  describe('cobertura de PedidosYa (F09 D17)', () => {
    it('defaults: adaptador unavailable, sin escenario, timeout 3000; vacío = default', () => {
      const env = validateEnv({});
      expect(env.PEDIDOSYA_COVERAGE_ADAPTER).toBe('unavailable');
      expect(env.PEDIDOSYA_MOCK_SCENARIO).toBeUndefined();
      expect(env.PEDIDOSYA_COVERAGE_TIMEOUT_MS).toBe(3000);
      const blank = validateEnv({
        PEDIDOSYA_COVERAGE_ADAPTER: '',
        PEDIDOSYA_MOCK_SCENARIO: '',
        PEDIDOSYA_COVERAGE_TIMEOUT_MS: '',
      });
      expect(blank.PEDIDOSYA_COVERAGE_ADAPTER).toBe('unavailable');
      expect(blank.PEDIDOSYA_COVERAGE_TIMEOUT_MS).toBe(3000);
    });

    it('mock en desarrollo con cada escenario válido; sin escenario es válido', () => {
      expect(
        validateEnv({ NODE_ENV: 'development', PEDIDOSYA_COVERAGE_ADAPTER: 'mock' })
          .PEDIDOSYA_COVERAGE_ADAPTER,
      ).toBe('mock');
      for (const s of [
        'available',
        'unavailable',
        'unknown',
        'timeout',
        'provider_error',
        'invalid_request',
      ]) {
        expect(
          validateEnv({
            NODE_ENV: 'test',
            PEDIDOSYA_COVERAGE_ADAPTER: 'mock',
            PEDIDOSYA_MOCK_SCENARIO: s,
          }).PEDIDOSYA_MOCK_SCENARIO,
        ).toBe(s);
      }
    });

    it('escenario inválido, escenario sin mock o adaptador desconocido => error de arranque', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          PEDIDOSYA_COVERAGE_ADAPTER: 'mock',
          PEDIDOSYA_MOCK_SCENARIO: 'raro',
        }),
      ).toThrow(/PEDIDOSYA_MOCK_SCENARIO/);
      expect(() => validateEnv({ PEDIDOSYA_MOCK_SCENARIO: 'available' })).toThrow(
        /PEDIDOSYA_MOCK_SCENARIO/,
      );
      expect(() => validateEnv({ PEDIDOSYA_COVERAGE_ADAPTER: 'live' })).toThrow(
        /PEDIDOSYA_COVERAGE_ADAPTER/,
      );
    });

    it('mock con NODE_ENV=production => la API no arranca, sin eco de valores', () => {
      let message = '';
      try {
        validateEnv({ ...prod, PEDIDOSYA_COVERAGE_ADAPTER: 'mock' });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/PEDIDOSYA_COVERAGE_ADAPTER/);
      expect(message).not.toContain('postgresql://');
      expect(validateEnv({ ...prod, PEDIDOSYA_COVERAGE_ADAPTER: 'unavailable' })).toBeTruthy();
      expect(validateEnv(prod).PEDIDOSYA_COVERAGE_ADAPTER).toBe('unavailable');
    });

    it('mock exige NODE_ENV explícito development|test: ausente, vacío, staging o desconocido => no arranca', () => {
      const mock = { PEDIDOSYA_COVERAGE_ADAPTER: 'mock' };
      expect(() => validateEnv(mock)).toThrow(/PEDIDOSYA_COVERAGE_ADAPTER/);
      expect(() => validateEnv({ ...mock, NODE_ENV: '' })).toThrow();
      expect(() => validateEnv({ ...mock, NODE_ENV: 'staging' })).toThrow();
      expect(() => validateEnv({ ...mock, NODE_ENV: 'Production' })).toThrow();
      expect(validateEnv({ ...mock, NODE_ENV: 'test' }).PEDIDOSYA_COVERAGE_ADAPTER).toBe('mock');
      // sin mock, NODE_ENV ausente conserva su default (development): no cambia el resto de la app
      expect(validateEnv({}).NODE_ENV).toBe('development');
    });

    it('timeout: entero entre 100 y 10000', () => {
      expect(
        validateEnv({ PEDIDOSYA_COVERAGE_TIMEOUT_MS: '100' }).PEDIDOSYA_COVERAGE_TIMEOUT_MS,
      ).toBe(100);
      expect(() => validateEnv({ PEDIDOSYA_COVERAGE_TIMEOUT_MS: '99' })).toThrow(
        /PEDIDOSYA_COVERAGE_TIMEOUT_MS/,
      );
      expect(() => validateEnv({ PEDIDOSYA_COVERAGE_TIMEOUT_MS: '10001' })).toThrow();
      expect(() => validateEnv({ PEDIDOSYA_COVERAGE_TIMEOUT_MS: '1.5' })).toThrow();
    });
  });
});

describe('NODE_ENV ausente en un despliegue (M3)', () => {
  const remote = 'postgresql://u:p@db.example.invalid:6543/postgres';

  it('sin NODE_ENV y DATABASE_URL remota => falla pidiendo NODE_ENV explícito (sin filtrar la URL)', () => {
    const attempt = () => validateEnv({ DATABASE_URL: remote });
    expect(attempt).toThrow(/NODE_ENV: debe definirse explícitamente/);
    expect(attempt).not.toThrow(/db\.example|u:p/);
    expect(() => validateEnv({ NODE_ENV: '', DATABASE_URL: remote })).toThrow(/NODE_ENV/);
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'sin NODE_ENV y DATABASE_URL en %s => arranca',
    (h) => {
      expect(validateEnv({ DATABASE_URL: `postgresql://u:p@${h}:5432/db` }).NODE_ENV).toBe(
        'development',
      );
    },
  );

  it('sin NODE_ENV y sin DATABASE_URL (dev/test/CI) => arranca con development', () => {
    expect(validateEnv({}).NODE_ENV).toBe('development');
  });

  it('sin NODE_ENV con variable de plataforma => falla', () => {
    expect(() => validateEnv({ VERCEL: '1' })).toThrow(/VERCEL/);
    expect(() => validateEnv({ RENDER: 'true' })).toThrow(/NODE_ENV/);
  });

  it('con NODE_ENV explícito y base remota no cambia nada', () => {
    expect(validateEnv({ NODE_ENV: 'development', DATABASE_URL: remote }).NODE_ENV).toBe(
      'development',
    );
    expect(validateEnv({ NODE_ENV: 'test', DATABASE_URL: remote }).NODE_ENV).toBe('test');
  });
});

describe('envWarnings (M2)', () => {
  it('producción con TRUST_PROXY_HOPS=0 => aviso (no falla el arranque)', () => {
    const env = validateEnv({ ...prod, TRUST_PROXY_HOPS: '0' });
    expect(envWarnings(env)).toEqual([expect.stringContaining('TRUST_PROXY_HOPS=0')]);
  });

  it('producción con >= 1, o desarrollo con 0 => sin avisos', () => {
    expect(envWarnings(validateEnv({ ...prod, TRUST_PROXY_HOPS: '1' }))).toEqual([]);
    expect(envWarnings(validateEnv({}))).toEqual([]);
  });
});
