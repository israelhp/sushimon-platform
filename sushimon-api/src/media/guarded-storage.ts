import { HttpException, type Logger } from '@nestjs/common';
import { storageUnavailable } from './media-policy.js';

/** Etiqueta segura de un fallo del proveedor: solo nombre/código/estado HTTP, nunca el mensaje ni URL ni credenciales. */
export function safeErrorLabel(error: unknown): string {
  const e = error as { name?: unknown; providerCode?: unknown; httpStatus?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : 'Error';
  const code = typeof e?.providerCode === 'string' ? ` code=${e.providerCode}` : '';
  const status = typeof e?.httpStatus === 'number' ? ` http=${e.httpStatus}` : '';
  return `${name}${code}${status}`;
}

/**
 * Ejecuta una llamada al almacenamiento: los errores HTTP de dominio pasan tal cual; cualquier otro fallo del proveedor
 * se registra con etiqueta segura y se traduce a 503 `MEDIA_STORAGE_UNAVAILABLE` con mensaje fijo (sin fugas).
 */
export async function guarded<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    logger.warn(`Fallo del almacenamiento en ${operation} (${safeErrorLabel(error)})`);
    throw storageUnavailable();
  }
}
