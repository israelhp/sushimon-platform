import { isMockScenario, type MockScenario } from '@/mocks/scenarios';

export type DataSourceConfig =
  { kind: 'mock'; scenario: MockScenario } | { kind: 'http'; baseUrl: string };

type Env = Record<string, string | undefined>;

/**
 * Resuelve la fuente de datos desde el entorno. Reglas:
 * - Nunca hay fallback silencioso de http → mock: si la configuración es inválida, se lanza error.
 * - En producción, "mock" exige NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION=true (demos explícitas).
 */
export function resolveDataSource(env: Env): DataSourceConfig {
  const kind = env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';

  if (kind === 'http') {
    const baseUrl = env.NEXT_PUBLIC_API_URL;
    if (!baseUrl) throw new Error('NEXT_PUBLIC_API_URL es obligatorio con DATA_SOURCE=http');
    return { kind: 'http', baseUrl: baseUrl.replace(/\/+$/, '') };
  }

  if (kind === 'mock') {
    if (env.NODE_ENV === 'production' && env.NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION !== 'true') {
      throw new Error(
        'DATA_SOURCE=mock no está permitido en producción sin autorización explícita',
      );
    }
    const scenario = env.NEXT_PUBLIC_MOCK_SCENARIO ?? 'default';
    if (!isMockScenario(scenario)) throw new Error(`Escenario mock desconocido: ${scenario}`);
    return { kind: 'mock', scenario };
  }

  throw new Error(`NEXT_PUBLIC_DATA_SOURCE inválido: ${kind}`);
}
