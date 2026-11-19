import type { OrderSource } from '../../src/orders/order-source.repository.js';

/** Pedido de ejemplo (snapshots) para pruebas del recibo y de la vista previa (F23). */
export const source = (over: Partial<OrderSource> = {}): OrderSource => ({
  id: '7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c',
  orderNumber: 1042n,
  status: 'delivered',
  fulfillmentType: 'DELIVERY',
  deliveryProvider: 'OWN',
  branchId: '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b',
  branchName: 'Sushi Mon Zona 10',
  branchAddress: '5a Av. 10-20 Zona 10',
  branchPhone: '2222-3333',
  customerName: 'Ana Pérez',
  customerPhone: '55551234',
  notes: 'sin wasabi',
  subtotal: '170.00',
  extrasTotal: '10.00',
  discountTotal: '20.00',
  deliveryFee: '15.00',
  total: '165.00',
  paymentMethodPreference: 'cash',
  placedAt: new Date('2026-11-18T19:42:10.000Z'),
  updatedAt: new Date('2026-11-18T20:15:44.000Z'),
  address: {
    municipalityName: 'Guatemala',
    zone: 'Zona 10',
    addressLine: '12 calle 3-45',
    referenceNote: 'portón negro',
  },
  lines: [
    {
      lineNo: 1,
      productId: '00000000-0000-4000-8000-000000000a01',
      productName: 'Roll California',
      quantity: 2,
      unitPrice: '80.00',
      extrasPerUnit: '5.00',
      lineDiscount: '20.00',
      notes: 'bien frío',
      modifiers: [
        {
          modifierId: '00000000-0000-4000-8000-0000000000c1',
          modifierName: 'Soya extra',
          unitExtraPrice: '5.00',
        },
      ],
    },
  ],
  promotions: [{ promotionName: 'Martes 2x1', amount: '20.00' }],
  ...over,
});
