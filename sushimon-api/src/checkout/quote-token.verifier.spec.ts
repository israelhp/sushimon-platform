import { signQuoteToken } from './quote-token.js';
import { QuoteTokenVerifier } from './quote-token.verifier.js';

const SECRET = 'v'.repeat(40);
const NOW = Date.UTC(2026, 10, 16, 22, 0, 0);
const iat = Math.floor(NOW / 1000);

describe('QuoteTokenVerifier (F20)', () => {
  it('configured solo con secreto >= 32; sin él, usar el secreto lanza (nunca firma ni verifica en vacío)', () => {
    expect(new QuoteTokenVerifier(SECRET).configured).toBe(true);
    for (const s of [undefined, '', 'corto']) {
      const v = new QuoteTokenVerifier(s);
      expect(v.configured).toBe(false);
      expect(() => v.verify('x', NOW)).toThrow();
      expect(() => v.bodyHash({})).toThrow();
    }
  });

  it('verifica firma y vigencia con el secreto del módulo; el sujeto guest o HMAC del authUserId', () => {
    const v = new QuoteTokenVerifier(SECRET);
    const token = signQuoteToken(
      {
        v: 1,
        iat,
        exp: iat + 600,
        branchId: 'b',
        type: 'PICKUP',
        provider: null,
        subtotal: '1.00',
        discountTotal: '0.00',
        deliveryFee: '0.00',
        total: '1.00',
        inputHash: 'h',
        sub: v.subjectOf(undefined),
      },
      SECRET,
    );
    expect(v.verify(token, NOW).ok).toBe(true);
    expect(v.verify(token, NOW + 700_000)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(new QuoteTokenVerifier('w'.repeat(40)).verify(token, NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(v.subjectOf(undefined)).toBe('guest');
    const user = v.subjectOf({ authUserId: 'u-1' } as never);
    expect(user).not.toBe('guest');
    expect(user).not.toContain('u-1');
  });

  it('bodyHash: 32 bytes determinista', () => {
    const v = new QuoteTokenVerifier(SECRET);
    expect(v.bodyHash({ a: 1 })).toHaveLength(32);
    expect(v.bodyHash({ a: 1 }).equals(v.bodyHash({ a: 1 }))).toBe(true);
    expect(v.bodyHash({ a: 1 }).equals(v.bodyHash({ a: 2 }))).toBe(false);
  });
});
