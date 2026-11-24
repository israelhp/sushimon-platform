import type { PrismaService } from '../../database/prisma.service.js';
import { DeliveriesFulfillmentAdapter } from './deliveries-fulfillment.adapter.js';
import { NoDeliveryFulfillment } from './order-fulfillment.port.js';

const ORDER = 'c0000000-0000-4000-8000-000000000001';
const make = (rows: { status: string }[]) => {
  const $queryRaw = vi.fn<(sql: unknown) => Promise<{ status: string }[]>>(() =>
    Promise.resolve(rows),
  );
  return {
    adapter: new DeliveriesFulfillmentAdapter({ $queryRaw } as unknown as PrismaService),
    $queryRaw,
  };
};
const own = {
  orderId: ORDER,
  branchId: 'b',
  fulfillmentType: 'DELIVERY' as const,
  deliveryProvider: 'OWN' as const,
  status: 'cancelled' as const,
};

describe('DeliveriesFulfillmentAdapter (F28, R32)', () => {
  it.each([
    ['pending', true],
    ['assigned', true],
    ['picked_up', true],
    ['delivered', false],
    ['returned', false],
    ['cancelled', false],
  ])('entrega %s => activeDelivery=%s y pendingActions vacío (OWN)', async (status, active) => {
    const { adapter } = make([{ status }]);
    expect(await adapter.inspect(own)).toEqual({ activeDelivery: active, pendingActions: [] });
  });

  it('sin entrega => activeDelivery=false; UNA sentencia por order_id parametrizado', async () => {
    const { adapter, $queryRaw } = make([]);
    expect(await adapter.inspect(own)).toEqual({ activeDelivery: false, pendingActions: [] });
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const arg = $queryRaw.mock.calls[0]?.[0] as { sql?: string; values?: unknown[] };
    expect(arg.sql).toContain('FROM app.deliveries WHERE order_id');
    expect(arg.values).toEqual([ORDER]);
  });

  it('PICKUP y PEDIDOSYA no consultan la BD (F29 reservará `delivery_cancellation`)', async () => {
    const { adapter, $queryRaw } = make([{ status: 'pending' }]);
    expect(
      await adapter.inspect({ ...own, fulfillmentType: 'PICKUP', deliveryProvider: null }),
    ).toEqual({
      activeDelivery: false,
      pendingActions: [],
    });
    expect(await adapter.inspect({ ...own, deliveryProvider: 'PEDIDOSYA' })).toEqual({
      activeDelivery: false,
      pendingActions: [],
    });
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('es una implementación DISTINTA de NoDeliveryFulfillment (que se conserva para dobles de F22)', async () => {
    const { adapter } = make([{ status: 'assigned' }]);
    expect(adapter).not.toBeInstanceOf(NoDeliveryFulfillment);
    expect((await new NoDeliveryFulfillment().inspect()).activeDelivery).toBe(false);
    expect((await adapter.inspect(own)).activeDelivery).toBe(true);
  });
});
