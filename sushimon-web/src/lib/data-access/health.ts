import type { components } from '@sushimon/contracts';
import type { DataClient } from './types';

export type HealthResponse = components['schemas']['HealthResponse'];
export type ReadyResponse = components['schemas']['ReadyResponse'];

/** Liveness de la API (público). Solo tiene sentido con DATA_SOURCE=http. */
export function getHealth(client: DataClient, signal?: AbortSignal): Promise<HealthResponse> {
  return client.get<HealthResponse>('/v1/health', { signal });
}
