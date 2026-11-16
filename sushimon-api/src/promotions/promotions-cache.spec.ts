import { promotionsCacheControl } from './promotions-cache.js';

const T = Date.parse('2026-11-16T16:00:00Z');
const body = (nextInMs: number | null) => ({
  generatedAt: new Date(T).toISOString(),
  nextChangeAt: nextInMs === null ? null : new Date(T + nextInMs).toISOString(),
});

describe('promotionsCacheControl (T17)', () => {
  it('sin cambio próximo: 30 s', () => {
    expect(promotionsCacheControl(body(null))).toBe('public, max-age=5, s-maxage=30');
  });
  it('el navegador cachea como máximo 5 s; la caché compartida hasta N', () => {
    expect(promotionsCacheControl(body(20_000))).toBe('public, max-age=5, s-maxage=20');
    expect(promotionsCacheControl(body(3_000))).toBe('public, max-age=3, s-maxage=3');
  });
  it('acotado por nextChangeAt: floor de segundos, mínimo 1, máximo 30', () => {
    expect(promotionsCacheControl(body(7_900))).toBe('public, max-age=5, s-maxage=7');
    expect(promotionsCacheControl(body(1_000))).toBe('public, max-age=1, s-maxage=1');
    expect(promotionsCacheControl(body(500))).toBe('public, max-age=1, s-maxage=1');
    expect(promotionsCacheControl(body(30_000))).toBe('public, max-age=5, s-maxage=30');
    expect(promotionsCacheControl(body(3_600_000))).toBe('public, max-age=5, s-maxage=30');
  });
  it('si nextChangeAt ya pasó (o es ahora) => no-store', () => {
    expect(promotionsCacheControl(body(0))).toBe('no-store');
    expect(promotionsCacheControl(body(-5_000))).toBe('no-store');
  });
  it('sin stale-while-revalidate', () => {
    expect(promotionsCacheControl(body(10_000))).not.toContain('stale-while-revalidate');
  });
});
