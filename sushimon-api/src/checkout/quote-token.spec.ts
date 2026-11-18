import { createHmac } from 'node:crypto';
import {
  inputHashOf,
  signQuoteToken,
  subjectOf,
  verifyQuoteToken,
  type QuoteTokenPayload,
} from './quote-token.js';

const SECRET = 'k'.repeat(40);
const NOW = Date.UTC(2026, 10, 16, 22, 0, 0);
const iat = Math.floor(NOW / 1000);

const payload = (over: Partial<QuoteTokenPayload> = {}): QuoteTokenPayload => ({
  v: 1,
  iat,
  exp: iat + 600,
  branchId: '00000000-0000-4000-8000-000000007001',
  type: 'DELIVERY',
  provider: 'OWN',
  subtotal: '170.00',
  discountTotal: '17.00',
  deliveryFee: '15.00',
  total: '168.00',
  inputHash: 'h',
  sub: 'guest',
  ...over,
});

/** Reemplaza un campo del payload SIN volver a firmar. */
function tamper(token: string, over: Record<string, unknown>): string {
  const [v, body, sig] = token.split('.') as [string, string, string];
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  return `${v}.${Buffer.from(JSON.stringify({ ...data, ...over })).toString('base64url')}.${sig}`;
}

describe('quote-token (F19, fila 21)', () => {
  it('firma válida: formato v1.<payload>.<firma> y verificación correcta', () => {
    const token = signQuoteToken(payload(), SECRET);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThan(1024);
    expect(verifyQuoteToken(token, SECRET, NOW)).toEqual({ ok: true, payload: payload() });
  });

  it('vigencia: válido hasta exp (exclusive); vencido después; emitido en el futuro se rechaza', () => {
    const token = signQuoteToken(payload(), SECRET);
    expect(verifyQuoteToken(token, SECRET, NOW + 599_000).ok).toBe(true);
    expect(verifyQuoteToken(token, SECRET, NOW + 600_000)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
    expect(verifyQuoteToken(token, SECRET, NOW - 60_000)).toEqual({
      ok: false,
      reason: 'NOT_YET_VALID',
    });
  });

  it.each([
    ['total', { total: '1.00' }],
    ['deliveryFee', { deliveryFee: '0.00' }],
    ['subtotal', { subtotal: '1.00' }],
    ['exp', { exp: iat + 99_999 }],
    ['branchId', { branchId: '00000000-0000-4000-8000-000000007002' }],
    ['sub', { sub: 'otro' }],
    ['provider', { provider: 'PEDIDOSYA' }],
  ])('manipular %s invalida la firma', (_field, over) => {
    const token = signQuoteToken(payload(), SECRET);
    expect(verifyQuoteToken(tamper(token, over), SECRET, NOW)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('otro secreto, firma truncada o versión distinta => rechazado', () => {
    const token = signQuoteToken(payload(), SECRET);
    expect(verifyQuoteToken(token, 'z'.repeat(40), NOW).ok).toBe(false);
    expect(verifyQuoteToken(token.slice(0, -4), SECRET, NOW).ok).toBe(false);
    expect(verifyQuoteToken(token.replace(/^v1/, 'v2'), SECRET, NOW)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it.each(['', 'a.b', 'v1..', 'v1.a.b.c', 'v1.!!!.???', `v1.${'a'.repeat(2000)}.b`])(
    'entrada malformada %j => MALFORMED/BAD_SIGNATURE sin lanzar',
    (token) => {
      expect(verifyQuoteToken(token, SECRET, NOW).ok).toBe(false);
    },
  );

  it('un payload bien firmado pero con forma inválida => MALFORMED', () => {
    const bad = signQuoteToken({ ...payload(), total: 5 as unknown as string }, SECRET);
    expect(verifyQuoteToken(bad, SECRET, NOW)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('un secreto corto no puede firmar', () => {
    expect(() => signQuoteToken(payload(), 'corto')).toThrow();
  });

  it('el sujeto distingue clientes e invitado; la huella es estable y con clave', () => {
    expect(subjectOf(SECRET, null)).toBe('guest');
    expect(subjectOf(SECRET, 'u1')).not.toBe(subjectOf(SECRET, 'u2'));
    expect(subjectOf(SECRET, 'u1')).toBe(subjectOf(SECRET, 'u1'));
    expect(subjectOf(SECRET, 'u1')).not.toContain('u1');
    expect(inputHashOf(SECRET, { a: 1 })).toBe(inputHashOf(SECRET, { a: 1 }));
    expect(inputHashOf(SECRET, { a: 1 })).not.toBe(inputHashOf(SECRET, { a: 2 }));
    expect(inputHashOf(SECRET, { a: 1 })).not.toBe(inputHashOf('z'.repeat(40), { a: 1 }));
  });

  it.each([
    ['la firma', 2],
    ['el payload', 1],
    ['la versión', 0],
  ])('cambiar UN carácter de %s => rechazado', (_name, part) => {
    const token = signQuoteToken(payload(), SECRET);
    const segs = token.split('.');
    const seg = segs[part] as string;
    const i = Math.floor(seg.length / 2);
    segs[part] = `${seg.slice(0, i)}${seg[i] === 'A' ? 'B' : 'A'}${seg.slice(i + 1)}`;
    expect(verifyQuoteToken(segs.join('.'), SECRET, NOW).ok).toBe(false);
  });

  it('la firma lleva separación de dominio: no es el HMAC simple del mensaje ni coincide con keyedHash', () => {
    const token = signQuoteToken(payload(), SECRET);
    const [v, body, sig] = token.split('.') as [string, string, string];
    const plain = createHmac('sha256', SECRET).update(`${v}.${body}`).digest('base64url');
    expect(sig).not.toBe(plain);
    const domain = createHmac('sha256', SECRET)
      .update(`token\u0000${v}.${body}`)
      .digest('base64url');
    expect(sig).toBe(domain);
    // Una firma de otro dominio (misma clave) sobre el mismo texto no valida como token.
    const forged = `${v}.${body}.${plain}`;
    expect(verifyQuoteToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
});
