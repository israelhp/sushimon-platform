import { isApiError } from '@/lib/data-access/errors';

/** Mensaje legible de un error de la capa de datos (los de la API/mock ya vienen en español). */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return error instanceof Error ? error.message : 'Error desconocido';
}

export function isForbidden(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}
