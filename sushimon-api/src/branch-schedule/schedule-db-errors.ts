import { BadRequestException, HttpStatus } from '@nestjs/common';
import { codedException } from '../common/errors/coded-exception.js';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';

export type ScheduleDbContext = 'hours' | 'closure';

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return `${message} ${uniqueTarget(error) ?? ''}`;
}

/**
 * Traduce errores de BD esperables a HTTP; devuelve el mismo error si no son del dominio (→ 500 genérico).
 * - EXCLUDE (23P01): `branch_closures_no_overlap` → 409 `CLOSURE_OVERLAP`; `branch_hours_no_overlap` → 422
 *   `SCHEDULE_INVALID` (`INTERVAL_OVERLAP`). Si el driver no informa la restricción se usa el `context`.
 *   La verificación previa de la API da el detalle (`closures/<id>`); esto es la red de seguridad.
 * - Lock timeout (55P03) / transacción agotada (P2028): 409 `BRANCH_SCHEDULE_BUSY` (reintentable, sin detalle).
 * - CHECK (P2004/23514): 400 genérico (no se filtra el nombre de la restricción).
 */
export function translateScheduleDbError(error: unknown, context: ScheduleDbContext): unknown {
  const found = codes(error);
  const text = errorText(error);
  if (found.includes('23P01') || /branch_closures_no_overlap|branch_hours_no_overlap/.test(text)) {
    const closure = /branch_closures_no_overlap/.test(text)
      ? true
      : /branch_hours_no_overlap/.test(text)
        ? false
        : context === 'closure';
    return closure
      ? codedException(HttpStatus.CONFLICT, 'CLOSURE_OVERLAP', 'El cierre se solapa con otro')
      : codedException(HttpStatus.UNPROCESSABLE_ENTITY, 'SCHEDULE_INVALID', 'Horario inválido', [
          {
            path: 'days',
            code: 'INTERVAL_OVERLAP',
            message: 'Hay intervalos que se solapan en un mismo día',
          },
        ]);
  }
  // Espera de candado agotada (lock_timeout, 55P03) o transacción interactiva sin conexión/tiempo (P2028).
  if (found.includes('55P03') || found.includes('P2028')) {
    return codedException(
      HttpStatus.CONFLICT,
      'BRANCH_SCHEDULE_BUSY',
      'La sucursal está siendo modificada; reintenta en unos segundos',
    );
  }
  if (found.includes('P2004') || found.includes('23514')) {
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
