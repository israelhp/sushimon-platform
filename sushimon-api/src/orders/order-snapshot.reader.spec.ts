import type { PrismaService } from '../database/prisma.service.js';
import { OrderSnapshotReader } from './order-snapshot.reader.js';

function fakePrisma() {
  const calls: { model: string; ids: string[] }[] = [];
  const model = (name: string) => ({
    findMany: vi.fn((args: { where: { id: { in: string[] } } }) => {
      calls.push({ model: name, ids: args.where.id.in });
      return Promise.resolve(args.where.id.in.map((id) => ({ id, name: `${name}-${id}` })));
    }),
  });
  return { calls, prisma: { product: model('p'), modifier: model('m'), promotion: model('x') } };
}

describe('OrderSnapshotReader (F20, sin N+1)', () => {
  it('30 líneas => EXACTAMENTE 3 consultas por lote (productos, extras, promociones)', async () => {
    const { calls, prisma } = fakePrisma();
    const reader = new OrderSnapshotReader(prisma as unknown as PrismaService);
    const productIds = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const names = await reader.read({
      productIds,
      modifierIds: ['m1', 'm2'],
      promotionIds: ['x1'],
    });
    expect(calls.map((c) => c.model).sort()).toEqual(['m', 'p', 'x']);
    expect(calls.find((c) => c.model === 'p')?.ids).toHaveLength(30);
    expect(names.products.get('p7')).toBe('p-p7');
    expect(names.modifiers.get('m2')).toBe('m-m2');
    expect(names.promotions.get('x1')).toBe('x-x1');
  });

  it('sin extras ni promociones omite esas consultas', async () => {
    const { calls, prisma } = fakePrisma();
    await new OrderSnapshotReader(prisma as unknown as PrismaService).read({
      productIds: ['p1'],
      modifierIds: [],
      promotionIds: [],
    });
    expect(calls.map((c) => c.model)).toEqual(['p']);
  });

  it('solo lee nombres (ningún precio): el `select` no pide importes', async () => {
    const { prisma } = fakePrisma();
    await new OrderSnapshotReader(prisma as unknown as PrismaService).read({
      productIds: ['p1'],
      modifierIds: ['m1'],
      promotionIds: ['x1'],
    });
    for (const m of [prisma.product, prisma.modifier, prisma.promotion]) {
      const arg = m.findMany.mock.calls[0]?.[0] as unknown as { select: Record<string, boolean> };
      expect(Object.keys(arg.select).sort()).toEqual(['id', 'name']);
    }
  });
});
