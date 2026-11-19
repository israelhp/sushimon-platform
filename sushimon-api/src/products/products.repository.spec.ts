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
