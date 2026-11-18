import { displayNumberOf, toOrderDetail } from './order-mapper.js';
import { buildOrderRecord } from './order-record.js';
import type { NewOrder } from './orders.types.js';

const order: NewOrder = {
  orderId: '00000000-0000-4000-8000-0000000000aa',
  customerId: null,
  branchId: '00000000-0000-4000-8000-0000000000bb',
  customerName: 'Ana Pérez',
  customerPhone: '+50255551234',
  customerEmail: 'ana@example.com',
  fulfillmentType: 'DELIVERY',
  deliveryProvider: 'OWN',
  notes: 'sin wasabi',
  subtotal: '185.00',
  extrasTotal: '15.00',
  discountTotal: '17.00',
  deliveryFee: '15.00',
  total: '183.00',
  paymentMethodPreference: 'cash',
  address: {
    municipalityName: 'Guatemala',
    zone: 'Zona 10',
    addressLine: '6a avenida 12-34',
    referenceNote: null,
    latitude: 14.6,
    longitude: -90.5,
  },
  lines: [
    {
      lineNo: 1,
      productId: 'p1',
      productName: 'Roll California',
      quantity: 2,
      unitPrice: '85.00',
      extrasPerUnit: '7.50',
      lineDiscount: '17.00',
      modifiers: [
        { modifierId: 'm2', modifierName: 'Queso', unitExtraPrice: '2.50' },
        { modifierId: 'm1', modifierName: 'Aguacate', unitExtraPrice: '5.00' },
      ],
    },
  ],
  promotions: [{ promotionId: 'pr', promotionName: 'Diez', amount: '17.00' }],
  guestToken: null,
  itemCount: 1,
};
const placedAt = new Date('2026-11-16T22:00:00Z');

describe('mapeo de respuesta de pedidos (F20)', () => {
  it('número visible MON-000000 con 6 dígitos; nunca es una credencial', () => {
    expect(displayNumberOf(1001n)).toBe('MON-001001');
    expect(displayNumberOf(42n)).toBe('MON-000042');
    expect(displayNumberOf(1234567n)).toBe('MON-1234567');
  });

  it('OrderDetail: importes de 2 decimales, derivados en centavos, teléfono enmascarado, sin correo ni coordenadas', () => {
    const dto = toOrderDetail(
      buildOrderRecord(order, { orderNumber: 1042n, placedAt, updatedAt: placedAt }),
    );
    expect(dto).toMatchObject({
      orderNumber: 1042,
      displayNumber: 'MON-001042',
      status: 'pending',
      subtotal: '185.00',
      total: '183.00',
      contact: { fullName: 'Ana Pérez', phoneMasked: '****1234' },
      payment: { methodPreference: 'cash', status: 'NOT_STARTED' },
      placedAt: '2026-11-16T22:00:00.000Z',
    });
    expect(dto.lines[0]).toMatchObject({
      lineSubtotal: '185.00',
      discount: '17.00',
      lineTotal: '168.00',
      modifiers: [
        { name: 'Aguacate', extraPrice: '5.00' },
        { name: 'Queso', extraPrice: '2.50' },
      ],
      notes: null,
    });
    expect(dto.address).toEqual({
      municipalityName: 'Guatemala',
      zone: 'Zona 10',
      addressLine: '6a avenida 12-34',
      referenceNote: null,
    });
    const json = JSON.stringify(dto);
    expect(json).not.toMatch(
      /ana@example|14\.6|-90\.5|latitude|longitude|\+50255551234|customerId/,
    );
  });

  it('PICKUP: sin dirección ni proveedor; preferencia nula', () => {
    const dto = toOrderDetail(
      buildOrderRecord(
        {
          ...order,
          fulfillmentType: 'PICKUP',
          deliveryProvider: null,
          address: null,
          deliveryFee: '0.00',
          paymentMethodPreference: null,
        },
        { orderNumber: 1001n, placedAt, updatedAt: placedAt },
      ),
    );
    expect(dto).toMatchObject({
      address: null,
      deliveryProvider: null,
      payment: { methodPreference: null, status: 'NOT_STARTED' },
    });
  });

  it('precisión: 99 x 9999.99 se calcula exacto en centavos (sin flotantes)', () => {
    const dto = toOrderDetail(
      buildOrderRecord(
        {
          ...order,
          lines: [
            {
              ...(order.lines[0] as NewOrder['lines'][number]),
              quantity: 99,
              unitPrice: '9999.99',
              extrasPerUnit: '0.00',
              lineDiscount: '0.00',
              modifiers: [],
            },
          ],
        },
        { orderNumber: 1n, placedAt, updatedAt: placedAt },
      ),
    );
    expect(dto.lines[0]?.lineSubtotal).toBe('989999.01');
    expect(dto.lines[0]?.lineTotal).toBe('989999.01');
  });
});
