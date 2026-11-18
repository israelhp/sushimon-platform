import { ValidationPipe } from '@nestjs/common';
import { OrderCreateRequestDto } from './order-create-request.dto.js';

const U = '00000000-0000-4000-8000-000000000001';
const valid = () => ({
  cart: { branchId: U, lines: [{ productId: U, quantity: 1, selections: [] }] },
  fulfillment: { type: 'PICKUP' },
  quoteToken: 'v1.a.b',
  contact: { fullName: 'Ana Pérez', phone: '5555 1234', email: 'ana@example.com' },
  notes: 'sin wasabi',
  paymentMethodPreference: 'cash',
});
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const check = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: OrderCreateRequestDto }).then(
    () => null,
    (e: { getStatus: () => number }) => e.getStatus(),
  );

describe('OrderCreateRequestDto (lista blanca; contrato OrderCreateRequest)', () => {
  it('un cuerpo válido pasa', async () => {
    expect(await check(valid())).toBeNull();
    expect(
      await check({ ...valid(), couponCode: 'SUSHI10', deliveryAddress: undefined }),
    ).toBeNull();
  });

  it.each([
    'price',
    'total',
    'subtotal',
    'deliveryFee',
    'discount',
    'status',
    'paid',
    'coverage',
    'customerId',
    'clientView',
    'currency',
    'orderNumber',
  ])('campo no permitido `%s` en la raíz => 400', async (field) => {
    expect(await check({ ...valid(), [field]: field === 'paid' ? true : '1.00' })).toBe(400);
  });

  it('campos económicos anidados (línea, cotización, entrega, contacto) => 400', async () => {
    const v = valid();
    expect(
      await check({
        ...v,
        cart: { ...v.cart, lines: [{ ...v.cart.lines[0], unitPrice: '1.00' }] },
      }),
    ).toBe(400);
    expect(await check({ ...v, fulfillment: { type: 'PICKUP', deliveryFee: '0.00' } })).toBe(400);
    expect(await check({ ...v, contact: { ...v.contact, customerId: U } })).toBe(400);
    expect(await check({ ...v, deliveryAddress: { addressLine: 'Calle 1-23', lat: 1 } })).toBe(400);
  });

  it.each([
    ['sin quoteToken', { quoteToken: undefined }],
    ['quoteToken vacío', { quoteToken: '' }],
    ['quoteToken > 1024', { quoteToken: 'x'.repeat(1025) }],
    ['notas > 280', { notes: 'x'.repeat(281) }],
    ['correo inválido', { contact: { email: 'nope' } }],
    ['teléfono > 20', { contact: { phone: '5'.repeat(21) } }],
    ['nombre > 120', { contact: { fullName: 'x'.repeat(121) } }],
    ['preferencia desconocida', { paymentMethodPreference: 'bitcoin' }],
    ['`null` en un opcional', { notes: null }],
    ['dirección corta', { deliveryAddress: { addressLine: 'abc' } }],
    ['sin cart', { cart: undefined }],
    ['sin fulfillment', { fulfillment: undefined }],
  ])('%s => 400', async (_n, over) => {
    expect(await check({ ...valid(), ...over })).toBe(400);
  });

  it('`card` se acepta en la forma (el servicio responde 422 PAYMENT_METHOD_UNAVAILABLE)', async () => {
    expect(await check({ ...valid(), paymentMethodPreference: 'card' })).toBeNull();
  });
});
