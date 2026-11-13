import type { components } from '@sushimon/contracts';
import type { DataClient } from '@/lib/data-access/types';
import { paths } from '@/lib/data-access/paths';

export type AuthContext = components['schemas']['AuthContextResponse'];
export type MeResponse = components['schemas']['MeResponse'];

/** Contexto de identidad y autorización (`GET /v1/auth/context`). La UI lo usa solo para mostrar/ocultar. */
export const getAuthContext = (client: DataClient, signal?: AbortSignal) =>
  client.get<AuthContext>(paths.authContext(), { signal });

/** Perfil del cliente autenticado (`GET /v1/me`). Crea el perfil de cliente en el primer acceso. */
export const getIdentity = (client: DataClient, signal?: AbortSignal) =>
  client.get<MeResponse>(paths.me(), { signal });
