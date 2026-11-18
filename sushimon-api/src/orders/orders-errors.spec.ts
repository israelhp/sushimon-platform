import { HttpException } from '@nestjs/common';
import {
  idempotencyInProgress,
  isLockTimeout,
  ORDERS_DB_GATE,
  ordersBusy,
  ordersUnavailable,
  translateOrdersDbError,
} from './orders-errors.js';

describe('errores de pedidos (F20)', () => {
  it('ORDERS_BUSY 503 y ORDERS_UNAVAILABLE 503 con código estable y mensaje fijo', () => {
    expect([ordersBusy().getStatus(), ordersBusy().getResponse()]).toMatchObject([
      503,
      { code: 'ORDERS_BUSY' },
    ]);
    expect(ordersUnavailable().getResponse()).toMatchObject({ code: 'ORDERS_UNAVAILABLE' });
  });

  it('los 503 declaran Retry-After (1-3 s) para que el filtro lo emita', () => {
    expect(ordersBusy().getResponse()).toMatchObject({ retryAfter: 2 });
    expect(ordersUnavailable().getResponse()).toMatchObject({ retryAfter: 3 });
    expect(typeof ORDERS_DB_GATE).toBe('symbol');
  });

  it('IDEMPOTENCY_IN_PROGRESS: 409 con Retry-After de 1 s', () => {
    expect(idempotencyInProgress().getStatus()).toBe(409);
    expect(idempotencyInProgress().getResponse()).toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      retryAfter: 1,
    });
  });

  it.each(['P2028', 'P2024', '40P01', '57014', '53300', 'P1001'])(
    'código de BD %s => 503 ORDERS_BUSY',
    (code) => {
      const e = translateOrdersDbError({ code });
      expect((e as HttpException).getStatus()).toBe(503);
    },
  );

  it('lock_timeout (55P03) se detecta aparte; un error desconocido o una HttpException vuelven iguales', () => {
    expect(isLockTimeout({ meta: { code: '55P03' } })).toBe(true);
    expect(isLockTimeout({ code: 'P2002' })).toBe(false);
    const unknown = new Error('otro');
    expect(translateOrdersDbError(unknown)).toBe(unknown);
    const http = ordersUnavailable();
    expect(translateOrdersDbError(http)).toBe(http);
    expect(translateOrdersDbError('texto')).toBe('texto');
  });
});
