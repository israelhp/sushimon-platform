import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { classifyPlaceError, discardsAttempt, isAutoRetryable } from './place-order-errors';

const err = (status: number, code?: string, body?: unknown, retryAfter?: number) =>
  new ApiError(status, 'x', 'm', undefined, undefined, code, undefined, retryAfter, body);
const quote = {
  quote: { token: 't2', generatedAt: 'a', expiresAt: 'b' },
  total: '90.00',
  lines: [],
};

describe('classifyPlaceError (F20 §2.3)', () => {
  it.each([
    [err(0), 'ambiguous'],
    [err(500), 'ambiguous'],
    [err(502), 'ambiguous'],
    [err(409, 'IDEMPOTENCY_IN_PROGRESS'), 'ambiguous'],
    [err(503, 'ORDERS_BUSY'), 'busy'],
    [err(503), 'busy'],
    [err(503, 'ORDERS_UNAVAILABLE'), 'unavailable'],
    [err(409, 'QUOTE_EXPIRED', { quote, changes: [] }), 'quoteExpired'],
    [err(409, 'IDEMPOTENCY_KEY_REUSED'), 'keyReused'],
    [err(422, 'QUOTE_INVALID'), 'quoteInvalid'],
    // F24: `PAYMENT_METHOD_UNAVAILABLE` se retiró del contrato: un 422 desconocido es «inválido».
    [err(422, 'PAYMENT_METHOD_UNAVAILABLE'), 'invalid'],
    [err(422, 'CONTACT_INCOMPLETE'), 'contactIncomplete'],
    [err(422, 'DELIVERY_PROVIDER_NOT_SELECTABLE'), 'providerNotSelectable'],
    [err(422, 'BRANCH_NOT_AVAILABLE'), 'invalid'],
    [err(429, 'PENDING_ORDERS_LIMIT'), 'pendingLimit'],
    [err(401), 'address'],
    [err(404), 'address'],
    [err(400), 'invalid'],
    [new Error('boom'), 'unknown'],
  ])('%#', (error, kind) => {
    expect(classifyPlaceError(error).kind).toBe(kind);
  });

  it('QUOTE_CHANGED trae los cambios y la cotización nueva; sin cotización cae a «vencida» (recotiza)', () => {
    const changes = [{ field: 'total', previous: '85.00', current: '90.00' }];
    expect(classifyPlaceError(err(409, 'QUOTE_CHANGED', { quote, changes }))).toEqual({
      kind: 'quoteChanged',
      changes,
      quote,
    });
    expect(classifyPlaceError(err(409, 'QUOTE_CHANGED', { changes })).kind).toBe('quoteExpired');
    expect(classifyPlaceError(err(409, 'QUOTE_CHANGED', { quote: { total: 1 } })).kind).toBe(
      'quoteExpired',
    );
  });

  it('CHECKOUT_BLOCKED trae los bloqueos; 429 RATE_LIMITED trae Retry-After', () => {
    const blockers = [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }];
    expect(classifyPlaceError(err(422, 'CHECKOUT_BLOCKED', { blockers }))).toEqual({
      kind: 'blocked',
      blockers,
    });
    expect(classifyPlaceError(err(429, 'RATE_LIMITED', undefined, 7))).toEqual({
      kind: 'rateLimited',
      retryAfterSec: 7,
    });
  });

  it('reintento automático solo ante red/5xx/ocupado; la clave se descarta ante cotización/clave', () => {
    expect(isAutoRetryable({ kind: 'ambiguous' })).toBe(true);
    expect(isAutoRetryable({ kind: 'busy' })).toBe(true);
    for (const kind of [
      'unavailable',
      'rateLimited',
      'quoteExpired',
      'invalid',
      'blocked',
    ] as const) {
      expect(isAutoRetryable({ kind } as never)).toBe(false);
    }
    for (const kind of ['quoteChanged', 'quoteExpired', 'quoteInvalid', 'keyReused'] as const) {
      expect(discardsAttempt({ kind } as never)).toBe(true);
    }
    for (const kind of ['ambiguous', 'busy', 'unavailable', 'blocked'] as const) {
      expect(discardsAttempt({ kind } as never)).toBe(false);
    }
  });
});
