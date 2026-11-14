import { HttpException, type HttpStatus } from '@nestjs/common';

/** Violación estructurada de una regla de negocio (contrato: `ErrorViolation`). */
export interface ErrorViolation {
  path: string;
  code: string;
  message: string;
}

/**
 * Error de negocio con `code` estable y `violations[]` opcionales. `AllExceptionsFilter` los propaga tal cual
 * (solo esos campos); `error` sigue siendo el nombre HTTP (`CONFLICT`, `UNPROCESSABLE_ENTITY`).
 */
export function codedException(
  status: HttpStatus,
  code: string,
  message: string,
  violations?: ErrorViolation[],
): HttpException {
  return new HttpException(
    { message, code, ...(violations && violations.length > 0 ? { violations } : {}) },
    status,
  );
}
