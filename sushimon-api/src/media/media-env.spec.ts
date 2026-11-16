import { validateEnv } from '../config/env.js';
import { MOCK_PUBLIC_BASE_URL, r2Endpoint, resolveMediaConfig } from './media-config.js';

const CANARY = 'valor-secreto-que-nunca-debe-salir-0123';
const R2 = {
  R2_ACCOUNT_ID: 'abcdef0123456789',
  R2_BUCKET: 'sushimon-medios-dev',
  R2_ACCESS_KEY_ID: 'AKIAPRUEBAPRUEBA01',
  R2_SECRET_ACCESS_KEY: CANARY,
  R2_PUBLIC_BASE_URL: 'https://cdn.ejemplo.com',
};
const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.example.invalid:6543/postgres',
  HEALTH_READY_TOKEN: 'token-de-prueba-123456',
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
};
const without = (obj: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
const message = (raw: Record<string, unknown>): string => {
  try {
    validateEnv(raw);
  } catch (e) {
    return (e as Error).message;
  }
  return '';
};

describe('env de medios (F14): todo-o-nada', () => {
  it('sin ninguna variable R2: valores por defecto y almacenamiento no disponible', () => {
    const env = validateEnv({});
    expect(env).toMatchObject({
      R2_REGION: 'auto',
      MEDIA_MAX_BYTES: 5_242_880,
      MEDIA_UPLOAD_TTL_SECONDS: 300,
    });
    expect(resolveMediaConfig(env).mode).toBe('UNAVAILABLE');
  });

  it('variables vacías (copiadas de .env.example) cuentan como no definidas', () => {
    const blanks = Object.fromEntries(Object.keys(R2).map((k) => [k, '']));
    expect(
      resolveMediaConfig(validateEnv({ ...blanks, MEDIA_MAX_BYTES: '', R2_REGION: '' })).mode,
    ).toBe('UNAVAILABLE');
  });

  it('grupo completo => R2, con la base pública normalizada y el bucket', () => {
    const cfg = resolveMediaConfig(validateEnv(R2));
    expect(cfg).toMatchObject({
      mode: 'R2',
      bucket: 'sushimon-medios-dev',
      publicBaseUrl: 'https://cdn.ejemplo.com',
    });
    expect(JSON.stringify(cfg)).not.toContain(CANARY); // la config pública no lleva credenciales
  });

  it('R2_ENDPOINT puede sustituir a R2_ACCOUNT_ID', () => {
    const rest = without(R2, 'R2_ACCOUNT_ID');
    const env = validateEnv({ ...rest, R2_ENDPOINT: 'https://s3.pruebas.example.com/' });
    expect(resolveMediaConfig(env).mode).toBe('R2');
    expect(r2Endpoint(env)).toBe('https://s3.pruebas.example.com');
    expect(r2Endpoint(validateEnv(R2))).toBe('https://abcdef0123456789.r2.cloudflarestorage.com');
  });

  it.each(Object.keys(R2))(
    'definir el grupo sin %s falla y nombra lo que falta, sin valores',
    (missing) => {
      const raw = { ...R2, [missing]: undefined };
      const msg = message(raw);
      expect(msg).toMatch(/configuración R2 incompleta/);
      expect(msg).toContain(missing === 'R2_ACCOUNT_ID' ? 'R2_ACCOUNT_ID o R2_ENDPOINT' : missing);
      for (const value of Object.values(R2)) expect(msg).not.toContain(value);
    },
  );

  it('una sola variable R2 basta para exigir el resto', () => {
    expect(message({ R2_BUCKET: 'sushimon-medios-dev' })).toMatch(/faltan .*R2_ACCESS_KEY_ID/);
  });

  it('el mensaje de un secreto demasiado corto no revela el valor', () => {
    const msg = message({ ...R2, R2_SECRET_ACCESS_KEY: 'corto' });
    expect(msg).toContain('R2_SECRET_ACCESS_KEY');
    expect(msg).not.toContain('corto');
  });

  it.each([
    ['http://cdn.ejemplo.com', /https/],
    ['https://cdn.ejemplo.com/', /barra/],
    ['https://cdn.ejemplo.com?x=1', /query/],
    ['https://cdn.ejemplo.com#h', /query|fragmento/],
    ['https://user:pw@cdn.ejemplo.com', /credenciales/],
    ['https://localhost', /dominio/],
    ['https://127.0.0.1', /dominio/],
    ['https://cdn', /dominio/],
    ['no-es-url', /inválida/],
  ])('R2_PUBLIC_BASE_URL %j inválida', (value, pattern) => {
    expect(message({ ...R2, R2_PUBLIC_BASE_URL: value })).toMatch(pattern);
  });

  it('R2_ENDPOINT debe ser https', () => {
    const rest = without(R2, 'R2_ACCOUNT_ID');
    expect(() => validateEnv({ ...rest, R2_ENDPOINT: 'http://s3.example.com' })).toThrow(
      /R2_ENDPOINT/,
    );
  });

  it('límites: MEDIA_MAX_BYTES 1..5 MiB y MEDIA_UPLOAD_TTL_SECONDS 30..300', () => {
    expect(validateEnv({ MEDIA_MAX_BYTES: '1' }).MEDIA_MAX_BYTES).toBe(1);
    expect(validateEnv({ MEDIA_MAX_BYTES: '5242880' }).MEDIA_MAX_BYTES).toBe(5_242_880);
    expect(() => validateEnv({ MEDIA_MAX_BYTES: '5242881' })).toThrow(/MEDIA_MAX_BYTES/);
    expect(() => validateEnv({ MEDIA_MAX_BYTES: '0' })).toThrow(/MEDIA_MAX_BYTES/);
    expect(() => validateEnv({ MEDIA_MAX_BYTES: 'abc' })).toThrow(/MEDIA_MAX_BYTES/);
    expect(validateEnv({ MEDIA_UPLOAD_TTL_SECONDS: '30' }).MEDIA_UPLOAD_TTL_SECONDS).toBe(30);
    expect(validateEnv({ MEDIA_UPLOAD_TTL_SECONDS: '300' }).MEDIA_UPLOAD_TTL_SECONDS).toBe(300);
    expect(() => validateEnv({ MEDIA_UPLOAD_TTL_SECONDS: '29' })).toThrow(
      /MEDIA_UPLOAD_TTL_SECONDS/,
    );
    expect(() => validateEnv({ MEDIA_UPLOAD_TTL_SECONDS: '301' })).toThrow(
      /MEDIA_UPLOAD_TTL_SECONDS/,
    );
  });

  it('MEDIA_STORAGE_ADAPTER=r2 exige el grupo completo', () => {
    expect(() => validateEnv({ MEDIA_STORAGE_ADAPTER: 'r2' })).toThrow(
      /r2 exige el grupo completo/,
    );
    expect(resolveMediaConfig(validateEnv({ ...R2, MEDIA_STORAGE_ADAPTER: 'r2' })).mode).toBe('R2');
  });

  it('valor desconocido de MEDIA_STORAGE_ADAPTER falla', () => {
    expect(() => validateEnv({ MEDIA_STORAGE_ADAPTER: 's3' })).toThrow(/MEDIA_STORAGE_ADAPTER/);
  });
});

describe('almacenamiento simulado (mock)', () => {
  it('solo con NODE_ENV explícito development|test; usa host .invalid', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const cfg = resolveMediaConfig(validateEnv({ NODE_ENV, MEDIA_STORAGE_ADAPTER: 'mock' }));
      expect(cfg.mode).toBe('MOCK');
      expect(cfg.publicBaseUrl).toBe(MOCK_PUBLIC_BASE_URL);
      expect(new URL(cfg.publicBaseUrl as string).hostname.endsWith('.invalid')).toBe(true);
    }
  });

  it('NODE_ENV ausente o vacío: no arranca (aunque el default sea development)', () => {
    expect(() => validateEnv({ MEDIA_STORAGE_ADAPTER: 'mock' })).toThrow(
      /NODE_ENV=development o test explícito/,
    );
    expect(() => validateEnv({ NODE_ENV: '', MEDIA_STORAGE_ADAPTER: 'mock' })).toThrow(/NODE_ENV/);
  });

  it('en producción no arranca', () => {
    expect(() => validateEnv({ ...prod, MEDIA_STORAGE_ADAPTER: 'mock' })).toThrow(
      /almacenamiento simulado no se permite en producción/,
    );
  });

  it('junto a credenciales R2 no arranca (evita mezclar), sin revelar valores', () => {
    const msg = message({ NODE_ENV: 'test', ...R2, MEDIA_STORAGE_ADAPTER: 'mock' });
    expect(msg).toMatch(/mock no puede combinarse/);
    expect(msg).not.toContain(CANARY);
  });

  it('defensa en profundidad: resolveMediaConfig rechaza mock con NODE_ENV=production', () => {
    const env = validateEnv({ NODE_ENV: 'test', MEDIA_STORAGE_ADAPTER: 'mock' });
    expect(() => resolveMediaConfig(env, 'production')).toThrow(/solo se permite/);
    expect(() => resolveMediaConfig(env, null)).toThrow();
  });

  it('en producción R2 completo arranca; sin R2 arranca en modo no disponible', () => {
    expect(resolveMediaConfig(validateEnv({ ...prod, ...R2 })).mode).toBe('R2');
    expect(resolveMediaConfig(validateEnv(prod)).mode).toBe('UNAVAILABLE');
  });
});
