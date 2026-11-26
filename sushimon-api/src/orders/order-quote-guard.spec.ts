import type {
  CheckoutQuoteService,
  QuoteWithEvidence,
} from '../checkout/checkout-quote.service.js';
import type { CheckoutQuoteDto } from '../checkout/dto/checkout-quote-responses.dto.js';
import {
  signQuoteToken,
  subjectOf,
  type QuoteEvidence,
  type QuoteTokenPayload,
} from '../checkout/quote-token.js';
import { QuoteTokenVerifier } from '../checkout/quote-token.verifier.js';
import { diffQuote, OrderQuoteGuard, type OrderQuoteBody } from './order-quote-guard.js';

const SECRET = 'g'.repeat(40);
const NOW = new Date('2026-11-16T22:00:00Z');
const iat = Math.floor(NOW.getTime() / 1000);
const U = '00000000-0000-4000-8000-000000000001';
const principal = {
  authUserId: 'user-1',
  email: null,
  provider: null,
  googleOAuth: false,
  aal: 'aal1' as const,
  displayName: null,
  avatarUrl: null,
};

const evidence = (over: Partial<QuoteEvidence> = {}): QuoteEvidence => ({
  branchId: U,
  type: 'DELIVERY',
  provider: null,
  subtotal: '170.00',
  discountTotal: '0.00',
  deliveryFee: '0.00',
  total: '170.00',
  inputHash: 'in',
  sub: subjectOf(SECRET, null),
  linesHash: 'lh',
  ...over,
});
const payloadOf = (
  ev: QuoteEvidence,
  over: Partial<QuoteTokenPayload> = {},
): QuoteTokenPayload => ({
  v: 1,
  iat,
  exp: iat + 600,
  ...ev,
  ...over,
});
const quoteDto = (over: Partial<CheckoutQuoteDto> = {}): CheckoutQuoteDto =>
  ({
    quote: { generatedAt: NOW.toISOString(), expiresAt: NOW.toISOString(), token: 'nuevo' },
    currency: 'GTQ',
    fulfillment: { type: 'DELIVERY', delivery: null },
    canProceed: true,
    blockers: [],
    lines: [],
    ...over,
  }) as unknown as CheckoutQuoteDto;

const body: OrderQuoteBody = {
  cart: { branchId: U, lines: [{ productId: U, quantity: 1, selections: [] }] },
  fulfillment: { type: 'DELIVERY', municipalityId: U },
};

function setup(current: QuoteWithEvidence | Error, secret: string | undefined = SECRET) {
  const quotes = {
    quoteWithEvidence: vi.fn(() =>
      current instanceof Error ? Promise.reject(current) : Promise.resolve(current),
    ),
  };
  const guard = new OrderQuoteGuard(
    new QuoteTokenVerifier(secret),
    quotes as unknown as CheckoutQuoteService,
    { now: () => NOW },
  );
  return { guard, quotes };
}
const run = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as { getStatus: () => number; getResponse: () => Record<string, unknown> },
  );
const tokenFor = (ev: QuoteEvidence, over: Partial<QuoteTokenPayload> = {}) =>
  signQuoteToken(payloadOf(ev, over), SECRET);
const ok = (ev: QuoteEvidence, over: Partial<CheckoutQuoteDto> = {}): QuoteWithEvidence => ({
  quote: quoteDto(over),
  evidence: ev,
  resolved: { place: null },
});

describe('OrderQuoteGuard (F20: revalidación de la cotización)', () => {
  it('cotización idéntica => pasa y devuelve la evidencia y el lugar', async () => {
    const { guard, quotes } = setup(ok(evidence()));
    const result = await guard.check(undefined, body, tokenFor(evidence()));
    expect(result.evidence).toEqual(evidence());
    expect(quotes.quoteWithEvidence).toHaveBeenCalledTimes(1);
  });

  it('recotiza UNA sola vez y sin `clientView`', async () => {
    const { guard, quotes } = setup(ok(evidence()));
    await guard.check(undefined, body, tokenFor(evidence()));
    const [, arg] = quotes.quoteWithEvidence.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(Object.keys(arg).sort()).toEqual(['cart', 'fulfillment']);
  });

  it('token con firma mala / malformado / aún no válido => 422 QUOTE_INVALID sin recotizar', async () => {
    const { guard, quotes } = setup(ok(evidence()));
    const good = tokenFor(evidence());
    for (const t of [
      'basura',
      `${good.slice(0, -3)}AAA`,
      tokenFor(evidence(), { iat: iat + 3600, exp: iat + 4200 }),
    ]) {
      const e = await run(guard.check(undefined, body, t));
      expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([422, 'QUOTE_INVALID']);
    }
    expect(quotes.quoteWithEvidence).not.toHaveBeenCalled();
  });

  it('token firmado con OTRO secreto => 422 QUOTE_INVALID', async () => {
    const { guard } = setup(ok(evidence()));
    const forged = signQuoteToken(payloadOf(evidence()), 'x'.repeat(40));
    const e = await run(guard.check(undefined, body, forged));
    expect(e?.getResponse()['code']).toBe('QUOTE_INVALID');
  });

  it('vencido => 409 QUOTE_EXPIRED con la cotización NUEVA y `changes: []`', async () => {
    const { guard } = setup(ok(evidence()));
    const expired = tokenFor(evidence(), { iat: iat - 1000, exp: iat - 400 });
    const e = await run(guard.check(undefined, body, expired));
    expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([409, 'QUOTE_EXPIRED']);
    expect(e?.getResponse()['extra']).toEqual({ changes: [], quote: quoteDto() });
  });

  it('sujeto distinto => 422 QUOTE_INVALID (invitado con sesión y a la inversa)', async () => {
    const { guard } = setup(ok(evidence()));
    const e1 = await run(guard.check(principal, body, tokenFor(evidence())));
    expect(e1?.getResponse()['code']).toBe('QUOTE_INVALID');
    const asUser = evidence({ sub: subjectOf(SECRET, 'user-1') });
    const e2 = await run(guard.check(undefined, body, tokenFor(asUser)));
    expect(e2?.getResponse()['code']).toBe('QUOTE_INVALID');
    await expect(guard.check(principal, body, tokenFor(asUser))).resolves.toBeDefined();
  });

  it('huella de entrada distinta => 422 QUOTE_INVALID (no QUOTE_CHANGED)', async () => {
    const { guard } = setup(ok(evidence({ inputHash: 'otra' })));
    const e = await run(guard.check(undefined, body, tokenFor(evidence())));
    expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([422, 'QUOTE_INVALID']);
  });

  it('canProceed=false => 422 CHECKOUT_BLOCKED con los bloqueos', async () => {
    const blockers = [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }];
    const { guard } = setup({
      quote: quoteDto({ canProceed: false, blockers } as never),
      evidence: null,
      resolved: { place: null },
    });
    const e = await run(guard.check(undefined, body, tokenFor(evidence())));
    expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([422, 'CHECKOUT_BLOCKED']);
    expect(e?.getResponse()['extra']).toEqual({ blockers });
  });

  describe('invariante PedidosYa (aunque el cotizador mienta)', () => {
    it('proveedor pedido PEDIDOSYA => 422 sin recotizar', async () => {
      const { guard, quotes } = setup(ok(evidence()));
      const e = await run(
        guard.check(
          undefined,
          {
            ...body,
            fulfillment: { type: 'DELIVERY', municipalityId: U, deliveryProvider: 'PEDIDOSYA' },
          },
          tokenFor(evidence()),
        ),
      );
      expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([
        422,
        'DELIVERY_PROVIDER_NOT_SELECTABLE',
      ]);
      expect(quotes.quoteWithEvidence).not.toHaveBeenCalled();
    });

    it('el cotizador devuelve PEDIDOSYA con canProceed => 422 DELIVERY_PROVIDER_NOT_SELECTABLE', async () => {
      const lying = ok(evidence({ type: 'DELIVERY', provider: 'PEDIDOSYA' }), {
        fulfillment: { type: 'DELIVERY', delivery: { selectedProvider: 'PEDIDOSYA', options: [] } },
      });
      const { guard } = setup(lying);
      const e = await run(
        guard.check(
          undefined,
          { ...body, fulfillment: { type: 'DELIVERY', municipalityId: U } },
          tokenFor(evidence({ type: 'DELIVERY', provider: 'PEDIDOSYA' })),
        ),
      );
      expect(e?.getResponse()['code']).toBe('DELIVERY_PROVIDER_NOT_SELECTABLE');
    });

    it('la violación del invariante gana a `CHECKOUT_BLOCKED`', async () => {
      const { guard } = setup({
        quote: quoteDto({
          canProceed: false,
          blockers: [{ code: 'DELIVERY_UNVERIFIED', scope: 'FULFILLMENT' }],
          fulfillment: {
            type: 'DELIVERY',
            delivery: { selectedProvider: 'PEDIDOSYA', options: [] },
          },
        } as never),
        evidence: null,
        resolved: { place: null },
      });
      const e = await run(guard.check(undefined, body, tokenFor(evidence())));
      expect(e?.getResponse()['code']).toBe('DELIVERY_PROVIDER_NOT_SELECTABLE');
    });
  });

  describe('QUOTE_CHANGED: cualquier diferencia, también las mejoras (P52)', () => {
    it.each([
      ['subtotal sube', { subtotal: '180.00', total: '180.00' }, ['subtotal', 'total']],
      ['mejora de precio (baja)', { subtotal: '160.00', total: '160.00' }, ['subtotal', 'total']],
      ['descuento', { discountTotal: '10.00', total: '160.00' }, ['discountTotal', 'total']],
      ['tarifa', { deliveryFee: '15.00', total: '185.00' }, ['deliveryFee', 'total']],
      ['solo el total', { total: '171.00' }, ['total']],
      ['proveedor', { provider: 'OWN' as const }, ['provider']],
      ['líneas con el MISMO total', { linesHash: 'cambiado' }, ['lines']],
    ])('%s => 409 con `changes` y la cotización nueva', async (_n, over, fields) => {
      const { guard } = setup(ok(evidence(over)));
      const e = await run(guard.check(undefined, body, tokenFor(evidence())));
      expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([409, 'QUOTE_CHANGED']);
      const extra = e?.getResponse()['extra'] as { changes: { field: string }[]; quote: unknown };
      expect(extra.changes.map((c) => c.field)).toEqual(fields);
      expect(extra.quote).toEqual(quoteDto());
    });

    it('un token anterior a F20 (sin linesHash) sigue siendo válido y no compara líneas', async () => {
      const legacy = { ...payloadOf(evidence()) } as Partial<QuoteTokenPayload>;
      delete legacy.linesHash;
      const { guard } = setup(ok(evidence({ linesHash: 'cualquiera' })));
      await expect(
        guard.check(undefined, body, signQuoteToken(legacy as QuoteTokenPayload, SECRET)),
      ).resolves.toBeDefined();
    });
  });

  it('sin secreto utilizable => 503 ORDERS_UNAVAILABLE (fail-closed) sin recotizar', async () => {
    for (const secret of ['', 'corto']) {
      const { guard, quotes } = setup(ok(evidence()), secret);
      const e = await run(guard.check(undefined, body, 'v1.a.b'));
      expect([e?.getStatus(), e?.getResponse()['code']]).toEqual([503, 'ORDERS_UNAVAILABLE']);
      expect(quotes.quoteWithEvidence).not.toHaveBeenCalled();
    }
  });

  it('los errores de la recotización (404 dirección, 422 sucursal) se propagan tal cual', async () => {
    const boom = Object.assign(new Error('x'), { status: 404 });
    const { guard } = setup(boom);
    await expect(guard.check(undefined, body, tokenFor(evidence()))).rejects.toBe(boom);
  });

  it('diffQuote: sin diferencias => []', () => {
    expect(diffQuote(payloadOf(evidence()), evidence())).toEqual([]);
  });
});
