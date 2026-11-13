import { createMockDataClient } from '@/mocks';
import { resolveDataSource } from './config';
import { createHttpClient } from './http-client';
import type { DataClient } from './types';

export type { DataClient, RequestOptions, Query } from './types';
export { ApiError, isApiError } from './errors';
export { HttpError } from './http-client';
export { paths } from './paths';

type Env = Record<string, string | undefined>;

/**
 * Variables públicas leídas de forma literal: Next solo inyecta `NEXT_PUBLIC_*` en el navegador
 * cuando se acceden como `process.env.NEXT_PUBLIC_X` (pasar `process.env` entero no funciona).
 */
export function publicEnv(): Env {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE,
    NEXT_PUBLIC_MOCK_SCENARIO: process.env.NEXT_PUBLIC_MOCK_SCENARIO,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION: process.env.NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION,
    NEXT_PUBLIC_AUTH_SOURCE: process.env.NEXT_PUBLIC_AUTH_SOURCE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

/**
 * Crea el cliente de datos activo según la configuración. Sin fallback silencioso:
 * una configuración inválida lanza error (ver `resolveDataSource`).
 */
export function getDataClient(env: Env = publicEnv()): DataClient {
  const source = resolveDataSource(env);
  if (source.kind === 'http') return createHttpClient(source.baseUrl);
  return createMockDataClient({ scenario: source.scenario });
}
