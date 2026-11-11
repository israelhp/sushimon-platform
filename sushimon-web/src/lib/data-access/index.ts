import { resolveDataSource } from './config';
import { createHttpClient } from './http-client';
import type { DataClient } from './types';

export type { DataClient } from './types';
export { HttpError } from './http-client';

/**
 * Cliente de datos activo. El adaptador mock se implementa en feature/ui-first-mock-platform;
 * hasta entonces, pedir mock lanza un error explícito en lugar de simular datos.
 */
export function getDataClient(env: Record<string, string | undefined> = process.env): DataClient {
  const source = resolveDataSource(env);
  if (source.kind === 'http') return createHttpClient(source.baseUrl);
  throw new Error('Adaptador mock aún no implementado (Etapa 1: UI First).');
}
