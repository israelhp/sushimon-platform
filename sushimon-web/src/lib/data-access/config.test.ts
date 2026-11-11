import { describe, expect, it } from 'vitest';
import { resolveDataSource } from './config';

describe('resolveDataSource', () => {
  it('usa mock/default por defecto', () => {
    expect(resolveDataSource({})).toEqual({ kind: 'mock', scenario: 'default' });
  });

  it('exige URL de API con http y normaliza la barra final', () => {
    expect(() => resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: 'http' })).toThrow(/API_URL/);
    expect(
      resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: 'http', NEXT_PUBLIC_API_URL: 'http://x.test/' }),
    ).toEqual({ kind: 'http', baseUrl: 'http://x.test' });
  });

  it('prohíbe mock en producción salvo autorización explícita', () => {
    expect(() => resolveDataSource({ NODE_ENV: 'production' })).toThrow(/producción/);
    expect(
      resolveDataSource({ NODE_ENV: 'production', NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION: 'true' })
        .kind,
    ).toBe('mock');
  });

  it('rechaza escenarios y fuentes desconocidos (sin fallback silencioso)', () => {
    expect(() => resolveDataSource({ NEXT_PUBLIC_MOCK_SCENARIO: 'zzz' })).toThrow(/Escenario/);
    expect(() => resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: 'otro' })).toThrow(/inválido/);
  });
});
