import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import {
  MAX_TENDERED_CENTS,
  blockedKey,
  canSubmitCash,
  centsToMoney,
  classifyPaymentError,
  discardsKey,
  evaluateTendered,
  moneyToCents,
  newAttemptKey,
  parseTendered,
  readCurrentPayment,
} from './cash-payment-model';

describe('F24 · centavos enteros', () => {
  it('moneyToCents/centsToMoney son exactos y simétricos', () => {
    expect(moneyToCents('185.00')).toBe(18500);
    expect(moneyToCents('0.10')).toBe(10);
    expect(moneyToCents('185')).toBeNull();
    expect(moneyToCents(null)).toBeNull();
    expect(centsToMoney(18500)).toBe('185.00');
    expect(centsToMoney(5)).toBe('0.05');
    expect(centsToMoney(0)).toBe('0.00');
  });

  it('0.1 + 0.2 no produce errores de coma flotante (tabla de casos)', () => {
    const table: [string, string, string][] = [
      ['0.10', '0.20', '0.30'],
      ['0.07', '0.01', '0.08'],
      ['1.15', '2.30', '3.45'],
      ['4999.99', '0.01', '5000.00'],
    ];
    for (const [a, b, sum] of table) {
      expect(centsToMoney((moneyToCents(a) ?? 0) + (moneyToCents(b) ?? 0))).toBe(sum);
    }
  });
});

describe('F24 · parseTendered', () => {
  it('normaliza a 2 decimales y trata 100 = 100.00', () => {
    expect(parseTendered('100')).toEqual({ ok: true, cents: 10000, normalized: '100.00' });
    expect(parseTendered('100.00')).toEqual({ ok: true, cents: 10000, normalized: '100.00' });
    expect(parseTendered(' 200.5 ')).toEqual({ ok: true, cents: 20050, normalized: '200.50' });
    expect(parseTendered('0.01')).toEqual({ ok: true, cents: 1, normalized: '0.01' });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'format'],
    ['1e2', 'format'],
    ['-5', 'format'],
    ['+5', 'format'],
    ['1,000.00', 'format'],
    ['200,50', 'format'],
    ['NaN', 'format'],
    ['.5', 'format'],
    ['5.', 'format'],
    ['1234567890', 'format'],
    ['200.001', 'decimals'],
    ['0', 'zero'],
    ['0.00', 'zero'],
  ])('rechaza %j (%s) sin redondear', (raw, problem) => {
    expect(parseTendered(raw)).toEqual({ ok: false, problem });
  });
});

describe('F24 · evaluateTendered (cambio informativo)', () => {
  const due = 18500;
  it('pago exacto: cambio 0.00', () => {
    expect(evaluateTendered('185.00', due)).toMatchObject({ kind: 'ok', changeCents: 0 });
  });
  it('con cambio: 200.00 sobre 185.00 → 15.00', () => {
    const s = evaluateTendered('200', due);
    expect(s).toMatchObject({ kind: 'ok', changeCents: 1500, normalized: '200.00' });
    if (s.kind === 'ok') expect(centsToMoney(s.changeCents)).toBe('15.00');
  });
  it('insuficiente: 184.99 → falta 0.01', () => {
    expect(evaluateTendered('184.99', due)).toEqual({ kind: 'insufficient', missingCents: 1 });
  });
  it('tope: 5000.00 permitido, 5000.01 excede', () => {
    expect(evaluateTendered('5000.00', due).kind).toBe('ok');
    expect(MAX_TENDERED_CENTS).toBe(500_000);
    expect(evaluateTendered('5000.01', due)).toEqual({ kind: 'tooLarge' });
  });
  it('vacío e inválido', () => {
    expect(evaluateTendered('', due)).toEqual({ kind: 'empty' });
    expect(evaluateTendered('200.001', due)).toEqual({ kind: 'invalid', problem: 'decimals' });
    expect(evaluateTendered('0', due)).toEqual({ kind: 'invalid', problem: 'zero' });
  });
  it('«Registrar» exige importe válido Y casilla', () => {
    const ok = evaluateTendered('200', due);
    expect(canSubmitCash(ok, false)).toBe(false);
    expect(canSubmitCash(ok, true)).toBe(true);
    expect(canSubmitCash(evaluateTendered('100', due), true)).toBe(false);
    expect(canSubmitCash(evaluateTendered('', due), true)).toBe(false);
  });
});

const api = (
  status: number,
  code?: string,
  extra: Partial<{ body: unknown; retry: number; v: string }> = {},
) =>
  new ApiError(
    status,
    'x',
    'm',
    undefined,
    undefined,
    code,
    extra.v ? [{ path: 'p', code: extra.v, message: 'm' }] : undefined,
    extra.retry,
    extra.body,
  );

describe('F24 · classifyPaymentError', () => {
  it.each([
    [409, 'PAYMENT_ALREADY_REGISTERED', 'alreadyRegistered'],
    [409, 'ORDER_NOT_PAYABLE', 'notPayable'],
    [409, 'IDEMPOTENCY_KEY_REUSED', 'keyReused'],
    [422, 'CASH_AMOUNT_INSUFFICIENT', 'insufficient'],
    [422, 'CASH_TENDERED_TOO_LARGE', 'tooLarge'],
    [422, 'PAYMENT_NOT_COLLECTABLE', 'notCollectable'],
    [400, 'PAYMENT_AMOUNT_INVALID', 'invalidAmount'],
    [400, 'PAYMENT_CONFIRMATION_REQUIRED', 'confirmationRequired'],
    [400, 'IDEMPOTENCY_KEY_INVALID', 'invalidRequest'],
    [401, undefined, 'auth'],
    [403, 'MFA_REQUIRED', 'mfa'],
    [403, 'PAYMENT_ACTION_FORBIDDEN', 'forbidden'],
    [403, undefined, 'forbidden'],
    [404, 'ORDER_NOT_FOUND', 'notFound'],
    [429, 'RATE_LIMITED', 'rate'],
    [503, 'ORDERS_BUSY', 'busy'],
    [500, undefined, 'network'],
    [0, undefined, 'network'],
  ] as const)('%i %s → %s', (status, code, kind) => {
    expect(classifyPaymentError(api(status, code)).kind).toBe(kind);
  });

  it('una excepción que no es ApiError es desconocida y no reintenta con la misma clave', () => {
    const e = classifyPaymentError(new Error('x'));
    expect(e.kind).toBe('unknown');
    expect(e.retrySameKey).toBe(false);
  });

  it('red, 503 y 429 reintentan con la MISMA clave; los 4xx definitivos la descartan', () => {
    expect(discardsKey(classifyPaymentError(api(0)))).toBe(false);
    expect(discardsKey(classifyPaymentError(api(503, 'ORDERS_BUSY', { retry: 3 })))).toBe(false);
    expect(discardsKey(classifyPaymentError(api(429, 'RATE_LIMITED')))).toBe(false);
    expect(discardsKey(classifyPaymentError(api(422, 'CASH_AMOUNT_INSUFFICIENT')))).toBe(true);
    expect(discardsKey(classifyPaymentError(api(409, 'PAYMENT_ALREADY_REGISTERED')))).toBe(true);
  });

  it('trae retryAfter y la violación', () => {
    const e = classifyPaymentError(
      api(422, 'PAYMENT_NOT_COLLECTABLE', { v: 'PROVIDER_BLOCKED_EXTERNAL' }),
    );
    expect(e.violation).toBe('PROVIDER_BLOCKED_EXTERNAL');
    expect(classifyPaymentError(api(503, 'ORDERS_BUSY', { retry: 7 })).retryAfterSec).toBe(7);
  });

  it('lee `current` solo con la forma mínima de AdminOrderPayment', () => {
    const current = {
      orderId: 'o',
      amountDue: '185.00',
      status: 'PAID',
      registration: { allowed: false, blockedReason: 'ALREADY_PAID' },
    };
    expect(readCurrentPayment({ current })?.status).toBe('PAID');
    expect(readCurrentPayment({ current: { orderId: 'o' } })).toBeNull();
    expect(readCurrentPayment({ current: { ...current, status: 'HACKED' } })).toBeNull();
    expect(readCurrentPayment(null)).toBeNull();
    expect(
      classifyPaymentError(api(409, 'PAYMENT_ALREADY_REGISTERED', { body: { current } })).current,
    ).not.toBeNull();
  });
});

describe('F24 · utilidades', () => {
  it('blockedKey tolera valores futuros', () => {
    expect(blockedKey('ALREADY_PAID')).toBe('ALREADY_PAID');
    expect(blockedKey('SOMETHING_NEW')).toBe('UNKNOWN');
    expect(blockedKey(null)).toBe('UNKNOWN');
  });
  it('newAttemptKey cumple el patrón del contrato y es distinto cada vez', () => {
    const a = newAttemptKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
    expect(newAttemptKey()).not.toBe(a);
  });
});
