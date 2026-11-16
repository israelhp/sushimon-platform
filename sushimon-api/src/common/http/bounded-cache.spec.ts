import { boundedCacheControl } from './bounded-cache.js';

const T = Date.parse('2026-11-16T16:00:00Z');
const body = (nextInMs: number | null) => ({
  generatedAt: new Date(T).toISOString(),
  nextChangeAt: nextInMs === null ? null : new Date(T + nextInMs).toISOString(),
});

describe('boundedCacheControl (compartido por F15 y F16)', () => {
  it('sin cambio próximo: 30 s en compartida y 5 s en navegador', () => {
    expect(boundedCacheControl(body(null))).toBe('public, max-age=5, s-maxage=30');
  });
  it('N = clamp(floor(segundos hasta nextChangeAt), 1, 30); max-age = min(N, 5)', () => {
    expect(boundedCacheControl(body(29_999))).toBe('public, max-age=5, s-maxage=29');
    expect(boundedCacheControl(body(30_000))).toBe('public, max-age=5, s-maxage=30');
    expect(boundedCacheControl(body(30_001))).toBe('public, max-age=5, s-maxage=30');
    expect(boundedCacheControl(body(2_000))).toBe('public, max-age=2, s-maxage=2');
    expect(boundedCacheControl(body(999))).toBe('public, max-age=1, s-maxage=1');
    expect(boundedCacheControl(body(1))).toBe('public, max-age=1, s-maxage=1');
  });
  it('nextChangeAt ya pasado (o ahora) o inválido => no-store; nunca stale-while-revalidate ni ETag', () => {
    expect(boundedCacheControl(body(0))).toBe('no-store');
    expect(boundedCacheControl(body(-1))).toBe('no-store');
    expect(boundedCacheControl({ generatedAt: 'x', nextChangeAt: 'y' })).toBe('no-store');
    expect(boundedCacheControl(body(10_000))).not.toContain('stale-while-revalidate');
  });
});
