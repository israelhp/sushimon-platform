import { CategoriesQueryService } from './categories-query.service.js';
import type { CategoriesRepository } from './categories.repository.js';
import type { CategoryRow } from './categories.types.js';

const row = (
  id: string,
  parentId: string | null,
  over: Partial<CategoryRow> = {},
): CategoryRow => ({
  id,
  parentId,
  slug: id,
  name: id,
  description: null,
  sortOrder: 0,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

function setup(rows: CategoryRow[]) {
  const repo = {
    findAllNodes: vi.fn(() => Promise.resolve(rows)),
    findAllRows: vi.fn(() => Promise.resolve(rows)),
  };
  return { service: new CategoriesQueryService(repo as unknown as CategoriesRepository), repo };
}

const data = () => [
  row('rolls', null, { sortOrder: 0 }),
  row('frios', 'rolls', { sortOrder: 0 }),
  row('veganos', 'frios'),
  row('bebidas', null, { sortOrder: 1, active: false }),
  row('te', 'bebidas'),
];

describe('CategoriesQueryService', () => {
  it('findVisibleTree: una sola consulta y solo la cadena toda activa', async () => {
    const { service, repo } = setup(data());
    const tree = await service.findVisibleTree();
    expect(repo.findAllNodes).toHaveBeenCalledTimes(1);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.children[0]?.id).toBe('veganos');
  });

  it('findVisibleBySlug: categoría con ancestros e hijas; oculta o inexistente => null', async () => {
    const { service } = setup(data());
    const found = await service.findVisibleBySlug('veganos');
    expect(found?.category.id).toBe('veganos');
    expect(found?.ancestors.map((a) => a.id)).toEqual(['rolls', 'frios']);
    expect((await service.findVisibleBySlug('frios'))?.category.children.map((c) => c.id)).toEqual([
      'veganos',
    ]);
    expect(await service.findVisibleBySlug('te')).toBeNull(); // activa, pero su padre no
    expect(await service.findVisibleBySlug('bebidas')).toBeNull();
    expect(await service.findVisibleBySlug('nada')).toBeNull();
  });

  it('getVisibleIds: todos o el subárbol de una raíz visible', async () => {
    const { service } = setup(data());
    expect(await service.getVisibleIds()).toEqual(['rolls', 'frios', 'veganos']);
    expect(await service.getVisibleIds('frios')).toEqual(['frios', 'veganos']);
    expect(await service.getVisibleIds('te')).toEqual([]);
  });

  it('listAdmin: incluye inactivas con effectivelyVisible y total', async () => {
    const { service } = setup(data());
    const res = await service.listAdmin({});
    expect(res.total).toBe(5);
    expect(res.items.map((i) => [i.id, i.effectivelyVisible])).toEqual([
      ['rolls', true],
      ['frios', true],
      ['veganos', true],
      ['bebidas', false],
      ['te', false],
    ]);
    expect((await service.listAdmin({ active: false })).items.map((i) => i.id)).toEqual([
      'bebidas',
    ]);
  });
});
