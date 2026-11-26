import { describe, expect, it } from 'vitest';
import { toQuoteInput, type CartLine, type CartState } from '@/lib/cart-rules';
import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutQuote } from '@/lib/data-access/models';
import {
  blockerMessageKey,
  buildClientView,
  buildQuoteRequest,
  centsToMoney,
  classifyQuoteError,
  moneyToCents,
  noticeMessageKey,
  normalizeCoupon,
  quoteFingerprint,
  quoteTtlMs,
  reasonMessageKey,
  shouldRetryQuote,
  type QuoteInputs,
} from './checkout-quote';

const line = (over: Partial<CartLine> & Pick<CartLine, 'productId'>): CartLine => ({
  lineId: `l-${over.productId}`,
  slug: over.productId,
  quantity: 1,
  note: '',
  selections: [],
  display: {
    name: over.productId,
    imageUrl: null,
    unitCents: 5300,
    currency: 'GTQ',
    seenAt: 0,
    options: [],
  },
  ...over,
});
const state = (lines: CartLine[], branchId = 'b1'): CartState => ({
  v: 2,
  branchId,
  updatedAt: 0,
  lines,
});
const inputs = (over: Partial<QuoteInputs> = {}): QuoteInputs => ({
  cart: toQuoteInput(state([line({ productId: 'a', quantity: 2 })]))!,
  fulfillment: { type: 'DELIVERY', municipalityId: 'm0', zone: null },
  couponCode: '',
  ...over,
});

describe('F19 · huella canónica de las entradas', () => {
  it('la misma entrada produce la misma huella, sin importar el orden de inserción del carrito', () => {
    const a = toQuoteInput(state([line({ productId: 'b' }), line({ productId: 'a' })]))!;
    const b = toQuoteInput(state([line({ productId: 'a' }), line({ productId: 'b' })]))!;
    expect(quoteFingerprint(inputs({ cart: a }))).toBe(quoteFingerprint(inputs({ cart: b })));
  });

  it('cambia con sucursal, producto, cantidad, extras, modalidad, dirección, zona, proveedor y cupón', () => {
    const base = quoteFingerprint(inputs());
    const sel = [{ groupId: 'g', optionId: 'o', quantity: 1 }];
    const variants: QuoteInputs[] = [
      inputs({ cart: toQuoteInput(state([line({ productId: 'a', quantity: 2 })], 'b2'))! }),
      inputs({ cart: toQuoteInput(state([line({ productId: 'z', quantity: 2 })]))! }),
      inputs({ cart: toQuoteInput(state([line({ productId: 'a', quantity: 3 })]))! }),
      inputs({
        cart: toQuoteInput(state([line({ productId: 'a', quantity: 2, selections: sel })]))!,
      }),
      inputs({ fulfillment: { type: 'DELIVERY', municipalityId: 'm', zone: 'Zona 1' } }),
      inputs({ couponCode: 'X' }),
    ];
    const prints = variants.map(quoteFingerprint);
    expect(new Set([base, ...prints]).size).toBe(prints.length + 1);
    const delivery = (f: object) =>
      quoteFingerprint(inputs({ fulfillment: { type: 'DELIVERY', ...f } }));
    expect(delivery({ municipalityId: 'm', zone: 'Zona 1' })).not.toBe(
      delivery({ municipalityId: 'm', zone: 'Zona 2' }),
    );
    expect(delivery({ municipalityId: 'm' })).not.toBe(delivery({ customerAddressId: 'a' }));
    expect(delivery({ municipalityId: 'm' })).not.toBe(
      delivery({ municipalityId: 'm', deliveryProvider: 'OWN' }),
    );
  });

  it('NO incluye clientView ni textos de presentación (nombre, imagen, nota)', () => {
    const a = quoteFingerprint(inputs());
    const b = quoteFingerprint(
      inputs({ clientView: { lines: [{ index: 0, unitPrice: '99.00' }], total: '1.00' } }),
    );
    expect(a).toBe(b);
    const renamed = toQuoteInput(
      state([
        line({
          productId: 'a',
          quantity: 2,
          note: 'sin picante',
          display: { ...line({ productId: 'a' }).display, name: 'Otro' },
        }),
      ]),
    )!;
    expect(quoteFingerprint(inputs({ cart: renamed }))).toBe(a);
  });

  it('el cupón se normaliza (espacios y mayúsculas) y no cambia la huella por formato', () => {
    expect(normalizeCoupon('  bienvenido10 ')).toBe('BIENVENIDO10');
    expect(normalizeCoupon('a   b')).toBe('A B');
    expect(normalizeCoupon('   ')).toBe('');
  });
});

describe('F19 · cuerpo de la solicitud (sin importes)', () => {
  it('lleva ids, cantidades, modalidad, cupón y pista; nunca precios, tarifas ni totales', () => {
    const body = buildQuoteRequest(
      inputs({
        couponCode: 'X',
        clientView: { lines: [{ index: 0, unitPrice: '53.00' }] },
      }),
    );
    expect(Object.keys(body).sort()).toEqual(['cart', 'clientView', 'couponCode', 'fulfillment']);
    const json = JSON.stringify(body.cart) + JSON.stringify(body.fulfillment);
    expect(json).not.toMatch(/price|fee|total|discount/i);
    expect(Object.keys(body.cart.lines[0]!).sort()).toEqual([
      'productId',
      'quantity',
      'selections',
    ]);
  });

  it('sin cupón ni pista las omite', () => {
    expect(Object.keys(buildQuoteRequest(inputs())).sort()).toEqual(['cart', 'fulfillment']);
  });

  it('`toQuoteInput` cumple la forma de `CheckoutQuoteRequest.cart` (fila 23)', () => {
    const cart = toQuoteInput(
      state([
        line({
          productId: 'a',
          quantity: 2,
          selections: [{ groupId: 'g', optionId: 'o', quantity: 1 }],
        }),
      ]),
    )!;
    expect(Object.keys(cart).sort()).toEqual(['branchId', 'lines']);
    expect(cart.lines.length).toBeLessThanOrEqual(30);
    for (const l of cart.lines) {
      expect(Object.keys(l).sort()).toEqual(['productId', 'quantity', 'selections']);
      expect(Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 99).toBe(true);
      for (const s of l.selections)
        expect(Object.keys(s).sort()).toEqual(['groupId', 'optionId', 'quantity']);
    }
  });

  it('clientView: precio unitario visto por línea cotizada (líneas fusionadas incluidas), en cadena canónica', () => {
    const lines = [
      line({
        productId: 'b',
        lineId: 'x1',
        display: { ...line({ productId: 'b' }).display, unitCents: 8550 },
      }),
      line({ productId: 'a', lineId: 'x2' }),
      line({ productId: 'a', lineId: 'x3', note: 'otra' }),
    ];
    const cart = toQuoteInput(state(lines))!;
    expect(cart.lines.map((l) => l.productId)).toEqual(['a', 'b']);
    expect(buildClientView(cart, lines, null)).toEqual({
      lines: [
        { index: 0, unitPrice: '53.00' },
        { index: 1, unitPrice: '85.50' },
      ],
    });
    expect(buildClientView(cart, lines, '10.00')?.total).toBe('10.00');
  });
});

describe('F19 · dinero en cadenas y centavos', () => {
  it('ida y vuelta sin coma flotante', () => {
    expect(centsToMoney(5)).toBe('0.05');
    expect(centsToMoney(10_000)).toBe('100.00');
    expect(moneyToCents('85.50')).toBe(8550);
    expect(moneyToCents('85.5')).toBeNull();
    expect(moneyToCents(null)).toBeNull();
    expect(moneyToCents('0.1' + '0')).toBe(10);
  });
});

describe('F19 · vigencia, avance y errores', () => {
  const quote = (over: Partial<CheckoutQuote> = {}): CheckoutQuote =>
    ({
      quote: {
        generatedAt: '2026-11-11T20:25:00.000Z',
        expiresAt: '2026-11-11T20:35:00.000Z',
        token: null,
      },
      canProceed: true,
      blockers: [],
      notices: [],
      ...over,
    }) as unknown as CheckoutQuote;

  it('la duración sale de expiresAt − generatedAt; fechas inválidas => null', () => {
    expect(quoteTtlMs(quote())).toBe(600_000);
    expect(
      quoteTtlMs(quote({ quote: { generatedAt: 'x', expiresAt: 'y', token: null } })),
    ).toBeNull();
    expect(
      quoteTtlMs(
        quote({
          quote: {
            generatedAt: '2026-11-11T20:25:00Z',
            expiresAt: '2026-11-11T20:25:00Z',
            token: null,
          },
        }),
      ),
    ).toBeNull();
  });

  it('clasifica errores por estado y código de negocio, y reintenta UNA vez solo 503/red', () => {
    const e = (status: number, businessCode?: string) =>
      new ApiError(status, 'x', 'm', undefined, undefined, businessCode);
    expect(classifyQuoteError(e(0))).toBe('offline');
    expect(classifyQuoteError(e(503, 'CHECKOUT_BUSY'))).toBe('busy');
    expect(classifyQuoteError(e(429))).toBe('rate-limited');
    expect(classifyQuoteError(e(422, 'BRANCH_NOT_AVAILABLE'))).toBe('branch-unavailable');
    expect(classifyQuoteError(e(422, 'MUNICIPALITY_NOT_FOUND'))).toBe('invalid');
    expect(classifyQuoteError(e(401))).toBe('session');
    expect(classifyQuoteError(e(404))).toBe('not-found');
    expect(classifyQuoteError(e(500))).toBe('unknown');
    expect(classifyQuoteError(new Error('x'))).toBe('unknown');
    expect(shouldRetryQuote(0, e(503))).toBe(true);
    expect(shouldRetryQuote(0, e(0))).toBe(true);
    expect(shouldRetryQuote(1, e(503))).toBe(false);
    for (const status of [400, 401, 404, 422, 429, 500])
      expect(shouldRetryQuote(0, e(status))).toBe(false);
  });

  it('los códigos desconocidos caen en un mensaje genérico (el contrato admite valores futuros)', () => {
    expect(blockerMessageKey('BRANCH_CLOSED')).toBe('checkout.quote.blockers.BRANCH_CLOSED');
    expect(blockerMessageKey('ALGO_NUEVO')).toBe('checkout.quote.blockers.UNKNOWN');
    expect(noticeMessageKey('PRICE_CHANGED')).toBe('checkout.quote.notices.PRICE_CHANGED');
    expect(noticeMessageKey('X')).toBe('checkout.quote.notices.UNKNOWN');
    expect(reasonMessageKey('SIMULATED')).toBe('checkout.quote.reasons.SIMULATED');
    expect(reasonMessageKey(undefined)).toBe('checkout.quote.reasons.UNKNOWN');
  });
});
