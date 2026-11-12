/**
 * Error único de la capa de datos. Ambos adaptadores (mock y http) lanzan ApiError,
 * así las pantallas manejan errores igual sin saber de dónde vienen los datos.
 * `status = 0` significa sin conexión (red caída o escenario `offline`).
 */
export type ApiErrorCode =
  | 'offline'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'too_many_requests'
  | 'server_error'
  | (string & {});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  0: 'offline',
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'too_many_requests',
};

export function codeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'server_error' : 'bad_request');
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
