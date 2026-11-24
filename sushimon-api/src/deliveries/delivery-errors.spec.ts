import { HttpException } from '@nestjs/common';
import {
  classifyDeliveryDbError,
  deliveriesBusy,
  deliveryActionForbidden,
  deliveryCursorInvalid,
  deliveryNotFound,
  deliveryOrderNotEligible,
  deliveryReasonRequired,
  deliveryStateConflict,
  DELIVERIES_DB_GATE,
  riderNotEligible,
  translateDeliveriesDbError,
} from './delivery-errors.js';

const body = (e: HttpException) => e.getResponse() as Record<string, unknown>;

describe('errores de entregas (F28)', () => {
  it('códigos y estados estables', () => {
    const table: [HttpException, number, string][] = [
      [deliveryNotFound(), 404, 'DELIVERY_NOT_FOUND'],
      [deliveryActionForbidden(), 403, 'DELIVERY_ACTION_FORBIDDEN'],
      [deliveryReasonRequired(), 400, 'DELIVERY_REASON_REQUIRED'],
      [deliveryCursorInvalid(), 400, 'DELIVERY_CURSOR_INVALID'],
      [deliveryStateConflict({ status: 'assigned', version: 3 }), 409, 'DELIVERY_STATE_CONFLICT'],
      [deliveryOrderNotEligible(['ORDER_NOT_DELIVERY']), 422, 'DELIVERY_ORDER_NOT_ELIGIBLE'],
      [riderNotEligible(['BUSY']), 422, 'RIDER_NOT_ELIGIBLE'],
      [deliveriesBusy(), 503, 'DELIVERIES_BUSY'],
    ];
    for (const [e, status, code] of table) {
      expect([e.getStatus(), body(e)['code']]).toEqual([status, code]);
    }
    expect(typeof DELIVERIES_DB_GATE).toBe('symbol');
  });

  it('409 trae `current` (estado y versión) en `extra` para el filtro global', () => {
    expect(body(deliveryStateConflict({ status: 'assigned', version: 3 }))['extra']).toEqual({
      current: { status: 'assigned', version: 3 },
    });
  });

  it('503 declara Retry-After de 2 s y mensaje fijo', () => {
    expect(body(deliveriesBusy())).toMatchObject({ retryAfter: 2, code: 'DELIVERIES_BUSY' });
  });

  it('RIDER_NOT_ELIGIBLE: una violación por razón y NINGÚN dato del motorista (ni sucursal)', () => {
    const e = riderNotEligible(['INACTIVE', 'WRONG_BRANCH', 'BUSY']);
    expect((body(e)['violations'] as { path: string; code: string }[]).map((v) => v.code)).toEqual([
      'INACTIVE',
      'WRONG_BRANCH',
      'BUSY',
    ]);
    expect(JSON.stringify(body(e))).not.toMatch(/riderBranchId|branch_id|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('DELIVERY_ORDER_NOT_ELIGIBLE: violaciones por código del pedido', () => {
    const e = deliveryOrderNotEligible(['ORDER_STATUS_NOT_DISPATCHABLE', 'ORDER_PROVIDER_NOT_OWN']);
    expect((body(e)['violations'] as { code: string }[]).map((v) => v.code)).toEqual([
      'ORDER_STATUS_NOT_DISPATCHABLE',
      'ORDER_PROVIDER_NOT_OWN',
    ]);
  });

  describe('classifyDeliveryDbError', () => {
    it('23505 solo es «motorista ocupado» en la asignación', () => {
      expect(classifyDeliveryDbError({ code: '23505' }, { assign: true })).toBe('rider_busy');
      expect(classifyDeliveryDbError({ meta: { code: '23505' } }, { assign: true })).toBe(
        'rider_busy',
      );
      expect(classifyDeliveryDbError({ code: 'P2002' }, { assign: true })).toBe('rider_busy');
      expect(classifyDeliveryDbError({ code: '23505' })).toBeNull();
    });
    it('23514 y 42501 => guarda; 23001 => entrega abierta; el resto => null', () => {
      expect(classifyDeliveryDbError({ code: '23514' })).toBe('guard');
      expect(classifyDeliveryDbError({ cause: { originalCode: '42501' } })).toBe('guard');
      expect(classifyDeliveryDbError({ code: '23001' })).toBe('order_has_active_delivery');
      expect(classifyDeliveryDbError({ code: '55P03' })).toBeNull();
      expect(classifyDeliveryDbError(new Error('x'))).toBeNull();
      expect(classifyDeliveryDbError('texto')).toBeNull();
      expect(classifyDeliveryDbError(deliveriesBusy())).toBeNull();
    });
  });

  describe('translateDeliveriesDbError', () => {
    it.each(['P2028', 'P2024', '55P03', '40P01', '40001', '57014', '53300', 'P1001'])(
      '%s => 503 DELIVERIES_BUSY',
      (code) => {
        const e = translateDeliveriesDbError({ code }) as HttpException;
        expect([e.getStatus(), body(e)['code']]).toEqual([503, 'DELIVERIES_BUSY']);
      },
    );
    it('un error desconocido, una HttpException o un valor no objeto vuelven iguales', () => {
      const unknown = new Error('otro');
      expect(translateDeliveriesDbError(unknown)).toBe(unknown);
      const http = deliveryNotFound();
      expect(translateDeliveriesDbError(http)).toBe(http);
      expect(translateDeliveriesDbError('texto')).toBe('texto');
    });
  });
});
