import { HttpException, HttpStatus } from '@nestjs/common';
import { dbErrorCodes, isRetryableDbError } from '../common/db/db-error-codes.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import type { RiderIneligibleReason } from '../riders/rider-eligibility.service.js';
import type { OrderEligibilityCode } from './delivery-policy.js';

/** Token del semáforo de BD de las entregas (singleton por proceso). */
export const DELIVERIES_DB_GATE = Symbol('DELIVERIES_DB_GATE');

export const DELIVERIES_BUSY_RETRY_AFTER_S = 2;

/** 404 ÚNICO para entrega inexistente y fuera del alcance de `deliveries.read` (anti-IDOR): mismo cuerpo. */
export const deliveryNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'DELIVERY_NOT_FOUND', 'Entrega no encontrada');

export const deliveryActionForbidden = () =>
  codedException(
    HttpStatus.FORBIDDEN,
    'DELIVERY_ACTION_FORBIDDEN',
    'No tienes permiso para esta acción en la sucursal de la entrega',
  );

export const deliveryReasonRequired = () =>
  codedException(
    HttpStatus.BAD_REQUEST,
    'DELIVERY_REASON_REQUIRED',
    'El motivo es obligatorio o inválido (3 a 280 caracteres, sin caracteres de control)',
  );

export const deliveryCursorInvalid = () =>
  codedException(HttpStatus.BAD_REQUEST, 'DELIVERY_CURSOR_INVALID', 'Cursor inválido');

/** Estado vigente de la entrega que viaja en 409 (`current`, contrato `AdminDeliveryStateSnapshot`). */
export interface DeliveryCurrent {
  status: string;
  version: number;
}

/** 409 con el estado ACTUAL para refrescar la vista sin otra consulta. */
export const deliveryStateConflict = (current: DeliveryCurrent) =>
  new HttpException(
    {
      message: 'La entrega cambió mientras la veías',
      code: 'DELIVERY_STATE_CONFLICT',
      extra: { current: { status: current.status, version: current.version } },
    },
    HttpStatus.CONFLICT,
  );

const ORDER_VIOLATION_MESSAGES: Readonly<Record<OrderEligibilityCode, string>> = {
  ORDER_STATUS_NOT_DISPATCHABLE: 'El pedido debe estar aceptado, en preparación o listo',
  ORDER_NOT_DELIVERY: 'El pedido no es a domicilio',
  ORDER_PROVIDER_NOT_OWN: 'El pedido no usa reparto propio',
};

export const deliveryOrderNotEligible = (codes: OrderEligibilityCode[]) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DELIVERY_ORDER_NOT_ELIGIBLE',
    'El pedido no admite una entrega propia',
    codes.map((code): ErrorViolation => ({
      path: 'orderId',
      code,
      message: ORDER_VIOLATION_MESSAGES[code],
    })),
  );

const RIDER_VIOLATION_MESSAGES: Readonly<
  Record<Exclude<RiderIneligibleReason, 'NOT_FOUND'>, string>
> = {
  INACTIVE: 'El motorista está inactivo',
  WRONG_BRANCH: 'El motorista no es de la sucursal del pedido',
  UNAVAILABLE: 'El motorista no está marcado como disponible',
  BUSY: 'El motorista ya tiene una entrega activa',
  OWN_DELIVERY_DISABLED: 'El reparto propio no está habilitado en la sucursal',
};

/** 422 con `violations[].code`; NUNCA incluye la sucursal del motorista ni ningún otro dato suyo (F27 obligación 2). */
export const riderNotEligible = (reasons: Exclude<RiderIneligibleReason, 'NOT_FOUND'>[]) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'RIDER_NOT_ELIGIBLE',
    'El motorista no puede tomar esta entrega',
    reasons.map((code): ErrorViolation => ({
      path: 'riderId',
      code,
      message: RIDER_VIOLATION_MESSAGES[code],
    })),
  );

/** 503 reintentable; mensaje fijo; en `PUBLIC_5XX_CODES`; `Retry-After: 2`. */
export const deliveriesBusy = () =>
  new HttpException(
    {
      message: 'No podemos procesar la solicitud ahora mismo; inténtalo de nuevo',
      code: 'DELIVERIES_BUSY',
      retryAfter: DELIVERIES_BUSY_RETRY_AFTER_S,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/** SQLSTATE de la migración 0022 que la API traduce (mensajes internos del trigger NUNCA se devuelven). */
export type DeliveryDbFailure = 'rider_busy' | 'guard' | 'order_has_active_delivery' | null;

/**
 * Clasifica un error de BD de las operaciones de entregas:
 * - `23505` (único): en la asignación solo puede ser `deliveries_one_active_per_rider_idx` => `rider_busy` (la carrera pierde);
 * - `23514` (CHECK/trigger de guarda o coherencia diferida) y `42501` (inmutables/DELETE/historial) => `guard`: la escritura
 *   perdió una carrera o violó una regla que la API ya valida; el servicio relee y responde 409 con `current` (o 503);
 * - `23001` (`restrict_violation`, guarda de `orders`) => `order_has_active_delivery`.
 */
export function classifyDeliveryDbError(
  error: unknown,
  ctx: { assign?: boolean } = {},
): DeliveryDbFailure {
  if (typeof error !== 'object' || error === null || error instanceof HttpException) return null;
  const codes = dbErrorCodes(error);
  if (ctx.assign === true && (codes.includes('23505') || codes.includes('P2002'))) {
    return 'rider_busy';
  }
  if (codes.includes('23001')) return 'order_has_active_delivery';
  if (codes.includes('23514') || codes.includes('42501')) return 'guard';
  return null;
}

/**
 * Traduce SOLO «ocupado / sin conexión / lock_timeout» a 503 `DELIVERIES_BUSY`; un error HTTP ya construido pasa tal cual y
 * cualquier otro vuelve igual (el filtro global lo trata como 500 genérico, sin mensajes internos).
 */
export function translateDeliveriesDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  if (error instanceof HttpException) return error;
  return isRetryableDbError(error) ? deliveriesBusy() : error;
}
