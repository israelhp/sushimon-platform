import type { PrismaService } from '../database/prisma.service.js';
import { ProductsRepository } from './products.repository.js';

describe('ProductsRepository.findSlugsAndNamesByIds (F23, contrato de solo lectura)', () => {
  it('filtra `active: true` por ids, selecciona solo id/slug/name y no consulta con lista vacía', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'a', slug: 's', name: 'n' }]);
    const repo = new ProductsRepository({ product: { findMany } } as unknown as PrismaService);
    expect(await repo.findSlugsAndNamesByIds([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    await repo.findSlugsAndNamesByIds(['a', 'b']);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, active: true },
      select: { id: true, slug: true, name: true },
    });
  });
});

describe('ProductsRepository: borrado (ADR-0035)', () => {
  it('countUsage: pedidos DISTINTOS por SQL, promociones y banners por producto; dentro de tx usa la tx', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ total: 3 }]);
    const promoCount = vi.fn().mockResolvedValue(2);
    const bannerCount = vi.fn().mockResolvedValue(1);
    const client = {
      $queryRaw: queryRaw,
      promotionProduct: { count: promoCount },
      banner: { count: bannerCount },
    };
    const repo = new ProductsRepository({} as PrismaService);
    expect(await repo.countUsage('p1', client as never)).toEqual({
      orders: 3,
      promotions: 2,
      banners: 1,
    });
    const sql = (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/count\(DISTINCT order_id\)/);
    expect(sql).toMatch(/app\.order_items/);
    expect(promoCount).toHaveBeenCalledWith({ where: { productId: 'p1' } });
    expect(bannerCount).toHaveBeenCalledWith({ where: { ctaProductId: 'p1' } });
  });

  it('countUsage sin tx usa el cliente global; sin filas de pedidos => 0', async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      promotionProduct: { count: vi.fn().mockResolvedValue(0) },
      banner: { count: vi.fn().mockResolvedValue(0) },
    };
    const repo = new ProductsRepository(client as unknown as PrismaService);
    expect(await repo.countUsage('p1')).toEqual({ orders: 0, promotions: 0, banners: 0 });
  });

  it('findBranchOffers formatea el precio a 2 decimales; deleteBranchOffers devuelve el conteo; delete borra por id', async () => {
    const tx = {
      branchProduct: {
        findMany: vi.fn().mockResolvedValue([
          {
            branchId: 'b1',
            priceOverride: { toFixed: (n: number) => (90).toFixed(n) },
            available: true,
          },
          { branchId: 'b2', priceOverride: null, available: false },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      product: { delete: vi.fn().mockResolvedValue({ id: 'p1' }) },
    };
    const repo = new ProductsRepository({} as PrismaService);
    expect(await repo.findBranchOffers(tx as never, 'p1')).toEqual([
      { branchId: 'b1', priceOverride: '90.00', available: true },
      { branchId: 'b2', priceOverride: null, available: false },
    ]);
    expect(await repo.deleteBranchOffers(tx as never, 'p1')).toBe(2);
    expect(tx.branchProduct.deleteMany).toHaveBeenCalledWith({ where: { productId: 'p1' } });
    await repo.delete(tx as never, 'p1');
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 'p1' }, select: { id: true } });
  });
});
