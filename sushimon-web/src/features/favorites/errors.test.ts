import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { favoriteErrorKind } from './errors';

const api = (status: number, code?: string, message = 'x') =>
  new ApiError(status, 'x', message, undefined, undefined, code);

describe('favoriteErrorKind: por code/estado, nunca por message', () => {
  it('clasifica por `code` de negocio', () => {
    expect(favoriteErrorKind(api(422, 'FAVORITES_LIMIT_REACHED'))).toBe('limit');
    expect(favoriteErrorKind(api(503, 'CATALOG_UNAVAILABLE'))).toBe('catalog');
    expect(favoriteErrorKind(api(503, 'FAVORITES_BUSY'))).toBe('busy');
    expect(favoriteErrorKind(api(404, 'PRODUCT_NOT_FOUND'))).toBe('notFound');
    expect(favoriteErrorKind(api(429, 'RATE_LIMITED'))).toBe('rateLimited');
  });

  it('sin `code`: por estado HTTP', () => {
    expect(favoriteErrorKind(api(401))).toBe('unauthorized');
    expect(favoriteErrorKind(api(429))).toBe('rateLimited');
    expect(favoriteErrorKind(api(0))).toBe('offline');
    expect(favoriteErrorKind(api(500))).toBe('generic');
  });

  it('el texto del mensaje no decide nada', () => {
    expect(favoriteErrorKind(api(500, undefined, 'FAVORITES_LIMIT_REACHED'))).toBe('generic');
    expect(favoriteErrorKind(new Error('CATALOG_UNAVAILABLE'))).toBe('generic');
  });
});
