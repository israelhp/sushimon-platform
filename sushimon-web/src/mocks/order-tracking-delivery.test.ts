import { describe, expect, it } from 'vitest';
import { publicDeliveryStatus } from './admin-deliveries';
import type { AdminDeliveryCommandResult } from '@/lib/data-access/models';
import { quoteCheckout } from '@/services/checkout';
import { createOrder, getOrderTracking } from '@/services/orders';
import { createHarness, type TestHarness } from './testing';

/**
 * F28 (spec 029 §12): `OrderTracking.delivery.status` pasa de `null` a un estado público GRUESO de la entrega propia, sin datos del
 * motorista. Cancelada, PedidosYa o sin entrega => `null`.
 */
describe('publicDeliveryStatus', () => {
  it('mapea los estados de la entrega a los cuatro públicos (el retorno es interno)', () => {
    expect(publicDeliveryStatus('pending')).toBe('PENDING');
    expect(publicDeliveryStatus('assigned')).toBe('ASSIGNED');
    expect(publicDeliveryStatus('picked_up')).toBe('PICKED_UP');
    expect(publicDeliveryStatus('delivered')).toBe('DELIVERED');
    expect(publicDeliveryStatus('returned')).toBe('DELIVERED');
    expect(publicDeliveryStatus('cancelled')).toBeNull();
    expect(publicDeliveryStatus(null)).toBeNull();
    expect(publicDeliveryStatus('algo-futuro')).toBeNull();
  });
});

describe('seguimiento del cliente con una entrega propia (flujo completo, mock)', () => {
  const cart = {
    branchId: 'sucursal-1',
    lines: [{ productId: 'dumplings', quantity: 2, selections: [] }],
  };

  async function placeDelivery(h: TestHarness) {
    const fulfillment = {
      type: 'DELIVERY',
      municipalityId: 'mun-guatemala-guatemala',
      zone: 'Zona 10',
    } as const;
    const quote = await quoteCheckout(h.client, { cart, fulfillment });
    return createOrder(
      h.client,
      {
        cart,
        fulfillment,
        quoteToken: quote.quote.token as string,
        contact: { fullName: 'Ana López', phone: '5555-1234' },
        deliveryAddress: { addressLine: '6a avenida 10-50' },
        paymentMethodPreference: 'cash',
      },
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  }

  it('null → PENDING → ASSIGNED → PICKED_UP → DELIVERED, sin ningún dato del motorista', async () => {
    const h = createHarness();
    const created = await placeDelivery(h);
    const id = created.order.id;
    const code = created.order.displayNumber; // el backoffice simulado usa el número del pedido
    const track = async () =>
      (
        await getOrderTracking(h.client, id, {
          guestToken: created.access?.guestToken,
        })
      ).delivery;
    expect(await track()).toEqual({ provider: 'OWN', status: null });

    h.asStaff('admin');
    const order = (route: string, from: string) =>
      h.client.post(`/v1/admin/orders/${code}/${route}`, { expectedStatus: from });
    await order('accept', 'pending');
    await order('start-preparing', 'accepted');
    await order('mark-ready', 'preparing');
    const d = await h.client.post<AdminDeliveryCommandResult>('/v1/admin/deliveries', {
      orderId: code,
    });
    expect(await track()).toEqual({ provider: 'OWN', status: 'PENDING' });
    await h.client.post(`/v1/admin/deliveries/${d.delivery.id}/assign-own-rider`, {
      riderId: 'rider-1',
      expectedVersion: 1,
    });
    expect(await track()).toEqual({ provider: 'OWN', status: 'ASSIGNED' });
    await h.client.post(`/v1/admin/deliveries/${d.delivery.id}/mark-picked-up`, {
      expectedVersion: 2,
    });
    expect(await track()).toEqual({ provider: 'OWN', status: 'PICKED_UP' });
    await h.client.post(`/v1/admin/deliveries/${d.delivery.id}/mark-delivered`, {
      expectedVersion: 3,
    });
    const delivered = await getOrderTracking(h.client, id, {
      guestToken: created.access?.guestToken,
    });
    expect(delivered.delivery).toEqual({ provider: 'OWN', status: 'DELIVERED' });
    expect(delivered.status).toBe('delivered');
    // El retorno es interno: el cliente sigue viendo DELIVERED.
    await h.client.post(`/v1/admin/deliveries/${d.delivery.id}/return-to-branch`, {
      expectedVersion: 4,
    });
    expect(await track()).toEqual({ provider: 'OWN', status: 'DELIVERED' });
    expect(JSON.stringify(delivered)).not.toMatch(
      /rider|motorista|Juan Carlos|phoneMasked|fullName/i,
    );
  });
});
