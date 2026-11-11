import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('aplica valores por defecto', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('separa los orígenes CORS', () => {
    expect(validateEnv({ CORS_ORIGINS: 'https://a.com, https://b.com' }).CORS_ORIGINS).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('rechaza un puerto inválido', () => {
    expect(() => validateEnv({ PORT: '99999' })).toThrow(/Configuración de entorno inválida/);
  });
});
