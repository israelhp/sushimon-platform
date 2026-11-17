import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ProductDetailCacheInterceptor, StoreCacheInterceptor } from './store-cache.interceptor.js';

const T = Date.parse('2026-11-16T16:00:00Z');
const iso = (offsetMs: number | null) =>
  offsetMs === null ? null : new Date(T + offsetMs).toISOString();

async function run(
  interceptor: StoreCacheInterceptor,
  body: Record<string, unknown>,
  query: Record<string, unknown> = {},
) {
  const headers = new Map<string, unknown>();
  const res = {
    setHeader: (n: string, v: unknown) => {
      headers.set(n.toLowerCase(), v);
      return res;
    },
  };
  const ctx = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext;
  const handler = { handle: () => of(body) } as CallHandler;
  await lastValueFrom(interceptor.intercept(ctx, handler));
  return { headers, res };
}
const base = (next: number | null, extra: Record<string, unknown> = {}) => ({
  generatedAt: iso(0),
  nextChangeAt: iso(next),
  ...extra,
});

describe('StoreCacheInterceptor (tope 15 s)', () => {
  const i = new StoreCacheInterceptor();
  it('sin cambio próximo: s-maxage=15, max-age=5', async () => {
    expect((await run(i, base(null))).headers.get('cache-control')).toBe(
      'public, max-age=5, s-maxage=15',
    );
  });
  it('N = clamp(floor(segundos), 1, 15)', async () => {
    const cc = async (ms: number) => (await run(i, base(ms))).headers.get('cache-control');
    expect(await cc(14_999)).toBe('public, max-age=5, s-maxage=14');
    expect(await cc(15_000)).toBe('public, max-age=5, s-maxage=15');
    expect(await cc(3_600_000)).toBe('public, max-age=5, s-maxage=15');
    expect(await cc(2_500)).toBe('public, max-age=2, s-maxage=2');
    expect(await cc(1)).toBe('public, max-age=1, s-maxage=1');
  });
  it('nextChangeAt ya pasado => no-store', async () => {
    expect((await run(i, base(0))).headers.get('cache-control')).toBe('no-store');
    expect((await run(i, base(-5000))).headers.get('cache-control')).toBe('no-store');
  });
  it('degraded no vacío => acotado (CDN 3 s, navegador 0); vacío => pública', async () => {
    expect((await run(i, base(null, { degraded: ['banners'] }))).headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=3',
    );
    expect((await run(i, base(null, { degraded: [] }))).headers.get('cache-control')).toBe(
      'public, max-age=5, s-maxage=15',
    );
  });
  it('suprime el ETag y nunca emite stale-while-revalidate', async () => {
    const { headers, res } = await run(i, base(null));
    res.setHeader('ETag', 'W/"x"');
    expect(headers.has('etag')).toBe(false);
    expect(String(headers.get('cache-control'))).not.toContain('stale-while-revalidate');
  });
});

describe('ProductDetailCacheInterceptor', () => {
  const i = new ProductDetailCacheInterceptor();
  it('sin branchId conserva la política de F11 (60 s + revalidación)', async () => {
    const out = await run(i, { id: 'x' }, {});
    expect(out.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
  });
  it('con branchId usa la política acotada y sin ETag', async () => {
    const out = await run(i, base(4_000), { branchId: 'b' });
    expect(out.headers.get('cache-control')).toBe('public, max-age=4, s-maxage=4');
    out.res.setHeader('ETag', 'W/"x"');
    expect(out.headers.has('etag')).toBe(false);
  });
});
