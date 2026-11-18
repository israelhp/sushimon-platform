import { randomUUID } from 'node:crypto';
import { QuoteTokenVerifier } from '../checkout/quote-token.verifier.js';
import {
  canonicalOrderBody,
  type CanonicalOrderBodyInput,
  hashesEqual,
  IDEMPOTENCY_TTL_MS,
  keyHashOf,
  MIN_DISTINCT_KEY_CHARS,
  parseIdempotencyKey,
  scopeOf,
} from './order-idempotency.js';

const SECRET = 'k'.repeat(40);
const U = '00000000-0000-4000-8000-000000000001';
const V = '00000000-0000-4000-8000-000000000002';
const contact = { fullName: 'Ana', phone: '+50255551234', email: null };
const input = (over: Partial<CanonicalOrderBodyInput['body']> = {}): CanonicalOrderBodyInput => ({
  body: {
    cart: {
      branchId: U.toUpperCase(),
      lines: [
        { productId: V, quantity: 1, selections: [] },
        { productId: U, quantity: 2, selections: [] },
      ],
    },
    fulfillment: { type: 'PICKUP' as const },
    ...over,
  },
  contact,
  address: null,
  notes: null,
  paymentMethodPreference: null,
});

describe('idempotencia de pedidos (F20)', () => {
  it('acepta UUID v4 y base64url de 22 a 128; rechaza el resto', () => {
    for (const ok of [
      'a1b2c3d4-e5f6-4789-8abc-def012345678',
      'AbCdEfGhIjKlMnOpQrStUv',
      `x_-${'0123456789abcdef'.repeat(7)}`,
    ]) {
      expect(parseIdempotencyKey(ok)).toBe(ok);
    }
    for (const bad of [
      undefined,
      null,
      5,
      '',
      'a'.repeat(21),
      'a'.repeat(129),
      `${'AbCdEfGhIjKlMnOpQrStUv'} `,
      `AbCdEfGhIjKlMnOpQrStUv, AbCdEfGhIjKlMnOpQrStUv`,
      'a'.repeat(22),
      'ab'.repeat(11),
      '123456789'.repeat(3),
      'ñ'.repeat(22),
    ]) {
      expect(() => parseIdempotencyKey(bad)).toThrow();
    }
  });

  it('entropía mínima: 10 caracteres distintos; un UUID v4 aleatorio nunca se rechaza', () => {
    expect(MIN_DISTINCT_KEY_CHARS).toBe(10);
    expect(() => parseIdempotencyKey('0123456789'.repeat(3))).not.toThrow(); // exactamente 10 distintos
    expect(() => parseIdempotencyKey('012345678'.repeat(3))).toThrow(); // 9
    for (let i = 0; i < 2000; i += 1) expect(() => parseIdempotencyKey(randomUUID())).not.toThrow();
  });

  it('hash de la clave: sha256 de 32 bytes, estable y nunca la clave en claro', () => {
    const h = keyHashOf('AbCdEfGhIjKlMnOpQrStUv');
    expect(h).toHaveLength(32);
    expect(hashesEqual(h, keyHashOf('AbCdEfGhIjKlMnOpQrStUv'))).toBe(true);
    expect(hashesEqual(h, keyHashOf('BbCdEfGhIjKlMnOpQrStUv'))).toBe(false);
    expect(h.toString('utf8')).not.toContain('AbCdEf');
  });

  it('alcance: customer:<id> o guest; TTL de 24 h', () => {
    expect(scopeOf(null)).toBe('guest');
    expect(scopeOf(U)).toBe(`customer:${U}`);
    expect(IDEMPOTENCY_TTL_MS).toBe(86_400_000);
  });

  describe('huella del cuerpo (request_hash)', () => {
    const verifier = new QuoteTokenVerifier(SECRET);
    const hash = (i: CanonicalOrderBodyInput) => verifier.bodyHash(canonicalOrderBody(i));

    it('es una HMAC de 32 bytes, estable y NO depende del orden de las líneas ni de mayúsculas', () => {
      const a = hash(input());
      expect(a).toHaveLength(32);
      const swapped = input({
        cart: {
          branchId: U,
          lines: [
            { productId: U, quantity: 2, selections: [] },
            { productId: V, quantity: 1, selections: [] },
          ],
        },
      });
      expect(hashesEqual(a, hash(swapped))).toBe(true);
    });

    it.each([
      [
        'cantidad',
        { cart: { branchId: U, lines: [{ productId: V, quantity: 2, selections: [] }] } },
      ],
      ['cupón', { couponCode: 'X' }],
      ['modalidad', { fulfillment: { type: 'DELIVERY' as const, municipalityId: U } }],
    ])('cambia si cambia %s', (_n, over) => {
      expect(hashesEqual(hash(input()), hash(input(over)))).toBe(false);
    });

    it('cambia con contacto, dirección, notas o preferencia; un cupón con otro formato es el mismo', () => {
      const base = hash(input());
      for (const over of [
        { contact: { ...contact, phone: '+50244445555' } },
        { address: { addressLine: 'Calle 1-23', referenceNote: null } },
        { notes: 'x' },
        { paymentMethodPreference: 'cash' },
      ]) {
        expect(hashesEqual(base, hash({ ...input(), ...over }))).toBe(false);
      }
      expect(
        hashesEqual(hash(input({ couponCode: ' abc ' })), hash(input({ couponCode: 'ABC' }))),
      ).toBe(true);
    });

    it('NO incluye el quoteToken: un reintento con token renovado es el mismo intento', () => {
      const json = JSON.stringify(
        canonicalOrderBody({ ...input(), quoteToken: 'v1.x.y' } as never),
      );
      expect(json).not.toContain('v1.x.y');
    });

    it('depende del secreto (no es verificable sin él)', () => {
      const other = new QuoteTokenVerifier('z'.repeat(40));
      expect(hashesEqual(hash(input()), other.bodyHash(canonicalOrderBody(input())))).toBe(false);
    });
  });
});
