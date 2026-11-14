import { availabilityCacheControl } from './availability-cache.interceptor.js';

const at = '2026-11-16T18:00:00.000Z';
const plus = (ms: number) => new Date(Date.parse(at) + ms).toISOString();

describe('availabilityCacheControl (M2: nunca cruza una transición)', () => {
  it('lejos de la transición: 10 s, sin stale-while-revalidate', () => {
    expect(availabilityCacheControl({ serverTime: at, nextTransitionAt: plus(3_600_000) })).toBe(
      'public, max-age=10, s-maxage=10',
    );
    expect(availabilityCacheControl({ serverTime: at, nextTransitionAt: null })).toBe(
      'public, max-age=10, s-maxage=10',
    );
  });

  it('cerca: segundos enteros hasta la transición (por debajo)', () => {
    expect(availabilityCacheControl({ serverTime: at, nextTransitionAt: plus(10_000) })).toBe(
      'public, max-age=10, s-maxage=10',
    );
    expect(availabilityCacheControl({ serverTime: at, nextTransitionAt: plus(7_999) })).toBe(
      'public, max-age=7, s-maxage=7',
    );
    expect(availabilityCacheControl({ serverTime: at, nextTransitionAt: plus(1_000) })).toBe(
      'public, max-age=1, s-maxage=1',
    );
  });

  it('a menos de 1 s (o ya vencida): no-store', () => {
    for (const ms of [999, 1, 0, -5_000]) {
      expect(availabilityCacheControl({ serverTime: at, nextTransitionAt: plus(ms) })).toBe(
        'no-store',
      );
    }
  });

  it('nunca incluye stale-while-revalidate ni excede 10 s', () => {
    for (const ms of [0, 500, 5_000, 10_000, 60_000, 86_400_000]) {
      const v = availabilityCacheControl({ serverTime: at, nextTransitionAt: plus(ms) });
      expect(v).not.toContain('stale-while-revalidate');
      const n = Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0);
      expect(n).toBeLessThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(Math.floor(ms / 1000));
    }
  });
});
