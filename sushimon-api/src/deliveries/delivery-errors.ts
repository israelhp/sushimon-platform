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
    'El motivo es obligatorio o inválido (3 a 280 caracteres, sin caracteres de control, teléfonos ni correos)',
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

/** Resultado de clasificar un error de BD de las entregas (`null` = no reconocido: error interno, nunca se filtra el mensaje). */
export type DeliveryDbFailure = 'rider_busy' | 'guard' | 'order_has_active_delivery' | null;

/** Nombres de restricción/trigger de la migración 0022 que la API reconoce (por NOMBRE, no solo por SQLSTATE). */
const RIDER_BUSY_NAMES = ['deliveries_one_active_per_rider_idx'] as const;
const DUPLICATE_DELIVERY_NAMES = ['deliveries_order_id_key'] as const;
const GUARD_NAMES = [
  'deliveries_guard',
  'deliveries_order_coherence',
  'orders_delivery_coherence',
  'deliveries_lifecycle_chk',
  'deliveries_status_chk',
  'deliveries_version_chk',
  'deliveries_order_times_chk',
] as const;
const ORDER_OPEN_DELIVERY_NAMES = [
  'orders_open_delivery_guard',
  'orders_open_delivery_identity_guard',
] as const;

/**
 * Texto técnico del error de BD donde viaja el NOMBRE de la restricción o del trigger (mensaje de Prisma/pg, `constraint` y la
 * causa del adaptador). Solo se COMPARA con los nombres conocidos; jamás se devuelve ni se registra.
 */
function dbErrorText(error: unknown): string {
  const e = error as {
    message?: unknown;
    constraint?: unknown;
    meta?: {
      message?: unknown;
      constraint?: unknown;
      target?: unknown;
      driverAdapterError?: { cause?: unknown };
    };
    cause?: { message?: unknown; constraint?: unknown };
  };
  const parts: unknown[] = [
    e.message,
    e.constraint,
    e.meta?.message,
    e.meta?.constraint,
    e.meta?.target,
    e.cause?.message,
    e.cause?.constraint,
  ];
  let text = '';
  const add = (value: unknown): void => {
    if (value === undefined || value === null) return;
    try {
      text += ` ${typeof value === 'string' ? value : JSON.stringify(value)}`;
    } catch {
      // estructura circular: se ignora
    }
  };
  parts.forEach(add);
  add(e.meta?.driverAdapterError?.cause);
  return text;
}

const mentions = (text: string, names: readonly string[]): boolean =>
  names.some((name) => new RegExp(`(?<![\\w])${name}(?![\\w])`).test(text));

/**
 * Clasifica un error de BD de las operaciones de entregas por SQLSTATE Y por NOMBRE de la restricción/trigger (S4: un 23505,
 * 23514, 42501 o 23001 de otro origen NO se confunde con una carrera de entregas):
 * - `23505` + `deliveries_one_active_per_rider_idx` (solo en la asignación) => `rider_busy` (la carrera pierde);
 *   `23505` + `deliveries_order_id_key` => `guard` (otra transacción creó la entrega);
 * - `23514` (CHECK/trigger de guarda o coherencia diferida) y `42501` (`deliveries_guard`: inmutables/DELETE) con un nombre
 *   conocido => `guard`: perdió una carrera o violó una regla que la API ya valida; el servicio relee y responde 409 o 503;
 * - `23001` (`restrict_violation`) + `orders_open_delivery_guard`/`orders_open_delivery_identity_guard` =>
 *   `order_has_active_delivery`.
 * Todo lo demás (incluido el historial solo-añadir) => `null`: error interno sin filtrar mensajes.
 */
export function classifyDeliveryDbError(
  error: unknown,
  ctx: { assign?: boolean } = {},
): DeliveryDbFailure {
  if (typeof error !== 'object' || error === null || error instanceof HttpException) return null;
  const codes = dbErrorCodes(error);
  const text = dbErrorText(error);
  if (codes.includes('23505') || codes.includes('P2002')) {
    if (ctx.assign === true && mentions(text, RIDER_BUSY_NAMES)) return 'rider_busy';
    if (mentions(text, DUPLICATE_DELIVERY_NAMES)) return 'guard';
    return null;
  }
  if (codes.includes('23001')) {
    return mentions(text, ORDER_OPEN_DELIVERY_NAMES) ? 'order_has_active_delivery' : null;
  }
  if ((codes.includes('23514') || codes.includes('42501')) && mentions(text, GUARD_NAMES)) {
    return 'guard';
  }
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
