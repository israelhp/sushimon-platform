import { HttpException, HttpStatus } from '@nestjs/common';
import { dbErrorCodes, isRetryableDbError } from '../common/db/db-error-codes.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import type {
  CheckoutBlockerDto,
  CheckoutQuoteDto,
} from '../checkout/dto/checkout-quote-responses.dto.js';

/** Token del semáforo de BD de los pedidos (singleton por proceso; ADR-0026 D7). */
export const ORDERS_DB_GATE = Symbol('ORDERS_DB_GATE');

/** Cambio detectado entre la cotización aceptada y la recotización (contrato: `OrderQuoteChange`). */
export interface QuoteChange {
  field: 'provider' | 'subtotal' | 'discountTotal' | 'deliveryFee' | 'total' | 'lines';
  previous: string | null;
  current: string | null;
}

/** Segundos sugeridos en `Retry-After` de los 503 de pedidos (el filtro global fija la cabecera). */
export const ORDERS_BUSY_RETRY_AFTER_S = 2;
export const ORDERS_UNAVAILABLE_RETRY_AFTER_S = 3;

/** 503 reintentable con la MISMA clave; mensaje fijo, en `PUBLIC_5XX_CODES`; `Retry-After: 2`. */
export const ordersBusy = () =>
  new HttpException(
    {
      message: 'No podemos procesar tu pedido ahora mismo; reintenta con la misma solicitud',
      code: 'ORDERS_BUSY',
      retryAfter: ORDERS_BUSY_RETRY_AFTER_S,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/** 503 fail-closed: sin `CHECKOUT_QUOTE_SECRET` no se crea un pedido sin verificar la cotización; `Retry-After: 3`. */
export const ordersUnavailable = () =>
  new HttpException(
    {
      message: 'La recepción de pedidos no está disponible',
      code: 'ORDERS_UNAVAILABLE',
      retryAfter: ORDERS_UNAVAILABLE_RETRY_AFTER_S,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

export const idempotencyKeyInvalid = () =>
  codedException(
    HttpStatus.BAD_REQUEST,
    'IDEMPOTENCY_KEY_INVALID',
    'Idempotency-Key ausente o con formato inválido',
  );

export const idempotencyKeyReused = () =>
  codedException(
    HttpStatus.CONFLICT,
    'IDEMPOTENCY_KEY_REUSED',
    'La Idempotency-Key ya se usó con otra solicitud',
  );

/** 409 con `Retry-After: 1` (lo fija el filtro global a partir de `retryAfter`). */
export const idempotencyInProgress = () =>
  new HttpException(
    {
      message: 'Hay una solicitud igual en curso; reintenta con la misma clave',
      code: 'IDEMPOTENCY_IN_PROGRESS',
      retryAfter: 1,
    },
    HttpStatus.CONFLICT,
  );

const withExtra = (
  status: HttpStatus,
  code: string,
  message: string,
  extra: Record<string, unknown>,
) => new HttpException({ message, code, extra }, status);

export const quoteChanged = (changes: QuoteChange[], quote: CheckoutQuoteDto) =>
  withExtra(
    HttpStatus.CONFLICT,
    'QUOTE_CHANGED',
    'La cotización cambió; revisa y confirma de nuevo',
    {
      changes,
      quote,
    },
  );

export const quoteExpired = (quote: CheckoutQuoteDto) =>
  withExtra(HttpStatus.CONFLICT, 'QUOTE_EXPIRED', 'La cotización venció; confirma la nueva', {
    changes: [],
    quote,
  });

export const quoteInvalid = () =>
  codedException(HttpStatus.UNPROCESSABLE_ENTITY, 'QUOTE_INVALID', 'La cotización no es válida');

export const checkoutBlocked = (blockers: CheckoutBlockerDto[]) =>
  withExtra(HttpStatus.UNPROCESSABLE_ENTITY, 'CHECKOUT_BLOCKED', 'El pedido no se puede crear', {
    blockers,
  });

export const deliveryProviderNotSelectable = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DELIVERY_PROVIDER_NOT_SELECTABLE',
    'El proveedor de entrega elegido no está disponible',
    [
      {
        path: 'fulfillment.deliveryProvider',
        code: 'DELIVERY_PROVIDER_NOT_SELECTABLE',
        message: 'Proveedor de entrega no disponible',
      },
    ],
  );

export const contactIncomplete = (violations: ErrorViolation[]) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CONTACT_INCOMPLETE',
    'Faltan datos de contacto',
    violations,
  );

export const pendingOrdersLimit = () =>
  codedException(
    HttpStatus.TOO_MANY_REQUESTS,
    'PENDING_ORDERS_LIMIT',
    'Tienes demasiados pedidos pendientes; espera a que el restaurante los procese',
  );

/** ¿Es el `lock_timeout` (SQLSTATE 55P03) de la espera de una clave de idempotencia concurrente? */
export const isLockTimeout = (error: unknown): boolean => dbErrorCodes(error).includes('55P03');

/**
 * F28: SQLSTATE 23001 (`restrict_violation`) = el trigger `orders_open_delivery_guard` (migración 0022) rechazó cancelar o
 * rechazar un pedido con entrega abierta. El servicio de comandos lo traduce a 409 `ORDER_HAS_ACTIVE_DELIVERY` con `current`.
 */
export const isActiveDeliveryViolation = (error: unknown): boolean =>
  !(error instanceof HttpException) && dbErrorCodes(error).includes('23001');

/**
 * Traduce SOLO «ocupado o sin conexión» a 503 `ORDERS_BUSY`. El `lock_timeout` de la creación lo trata el servicio
 * (409 `IDEMPOTENCY_IN_PROGRESS`) ANTES de llamar aquí. Cualquier otro error vuelve igual (el filtro global lo trata).
 */
export function translateOrdersDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  if (error instanceof HttpException) return error;
  return isRetryableDbError(error) ? ordersBusy() : error;
}
