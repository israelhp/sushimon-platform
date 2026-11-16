import { Logger } from '@nestjs/common';
import { CatalogUnavailableError } from './catalog-products.port.js';
import { ProductsCatalogAdapter } from './products-catalog.adapter.js';
import type { ProductsQueryService } from '../products/products-query.service.js';
import type { VisibleProductSummary } from '../products/products.types.js';

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

const adapterWith = (impl: ProductsQueryService['findVisibleSummariesByIds']) => {
  const findVisibleSummariesByIds = vi.fn(impl);
  return {
    adapter: new ProductsCatalogAdapter({
      findVisibleSummariesByIds,
    } as unknown as ProductsQueryService),
    findVisibleSummariesByIds,
  };
};

describe('ProductsCatalogAdapter (puerto de favoritos, F11)', () => {
  it('mapea visibles a ACTIVE con nameEn=null e imageUrl/categoryId; un id ausente no aparece; una sola llamada por lote', async () => {
    const visible = new Map<string, VisibleProductSummary>([
      [P1, { id: P1, name: 'Roll', imageUrl: 'https://cdn.x.io/a.jpg', categoryId: 'c1' }],
    ]);
    const { adapter, findVisibleSummariesByIds } = adapterWith(() => Promise.resolve(visible));
    const out = await adapter.findPublicSummaries([P1, P2]);
    expect(findVisibleSummariesByIds).toHaveBeenCalledTimes(1);
    expect(findVisibleSummariesByIds).toHaveBeenCalledWith([P1, P2]);
    expect(out.get(P1)).toEqual({
      id: P1,
      name: 'Roll',
      nameEn: null,
      imageUrl: 'https://cdn.x.io/a.jpg',
      categoryId: 'c1',
      status: 'ACTIVE',
    });
    expect(out.has(P2)).toBe(false);
    expect(JSON.stringify([...out.values()])).not.toMatch(/price|sku|basePrice/i);
  });

  it('cualquier fallo de BD o timeout => CatalogUnavailableError sin filtrar la causa', async () => {
    const { adapter } = adapterWith(() =>
      Promise.reject(new Error('connect ECONNREFUSED db-prod:5432')),
    );
    const error = await adapter.findPublicSummaries([P1]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CatalogUnavailableError);
    expect((error as Error).message).not.toContain('db-prod');
  });

  it('registra warn con nombre y código del error, sin mensaje ni ids', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { adapter } = adapterWith(() =>
      Promise.reject(
        Object.assign(new Error('connect ECONNREFUSED db-prod:5432 user=secreto'), {
          name: 'PrismaClientKnownRequestError',
          code: 'P2024',
        }),
      ),
    );
    await adapter.findPublicSummaries([P1]).catch(() => undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0]?.[0]);
    expect(text).toContain('PrismaClientKnownRequestError');
    expect(text).toContain('P2024');
    expect(text).not.toMatch(/db-prod|secreto|ECONNREFUSED/);
    expect(text).not.toContain(P1);
    warn.mockRestore();
  });
});
