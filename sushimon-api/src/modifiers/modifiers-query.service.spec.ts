import { Logger } from '@nestjs/common';
import {
  FakeModifiersRepo,
  G,
  groupRow,
  mid,
  optionRow,
  OPT,
  P,
} from '../../test/support/fake-modifiers-repo.js';
import { ModifiersQueryService } from './modifiers-query.service.js';
import type { ModifiersRepository } from './modifiers.repository.js';

function setup() {
  const repo = new FakeModifiersRepo();
  repo.seedGroup(groupRow(G.salsas, { name: 'Salsas', minSelect: 1 }), [
    optionRow(OPT(1), G.salsas, { sortOrder: 0 }),
    optionRow(OPT(2), G.salsas, { sortOrder: 1, active: false }),
  ]);
  repo.seedGroup(groupRow(G.extras, { name: 'Ácidos', active: false }), []);
  repo.seedProduct(P.roll, [G.extras, G.salsas]);
  return { repo, service: new ModifiersQueryService(repo as unknown as ModifiersRepository) };
}

describe('ModifiersQueryService', () => {
  it('lista paginada con conteos, filtros q (sin acentos) y active, en UNA consulta de página', async () => {
    const { service, repo } = setup();
    const page = await service.listGroups({ page: 1, pageSize: 20 });
    expect(page.items.map((i) => i.name)).toEqual(['Salsas', 'Ácidos'].sort());
    expect(page.items.find((i) => i.name === 'Salsas')).toMatchObject({
      optionCount: 2,
      activeOptionCount: 1,
      productCount: 1,
      required: true,
    });
    expect(repo.count('findGroupPage')).toBe(1);
    expect((await service.listGroups({ q: 'acido', page: 1, pageSize: 20 })).total).toBe(1);
    expect((await service.listGroups({ active: true, page: 1, pageSize: 1 })).items).toHaveLength(
      1,
    );
    await expect(
      service.listGroups({ q: 'a'.repeat(81), page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('detalle con todas las opciones; 404 si no existe', async () => {
    const { service } = setup();
    expect((await service.getGroup(G.salsas)).options.map((o) => o.active)).toEqual([true, false]);
    await expect(service.getGroup(mid(999))).rejects.toMatchObject({ status: 404 });
  });

  it('grupos del producto en orden de asociación, 2 consultas máximo; 404 si el producto no existe', async () => {
    const { service, repo } = setup();
    const r = await service.getProductModifiers(P.roll);
    expect(r.groups.map((g) => g.id)).toEqual([G.extras, G.salsas]);
    expect(repo.calls).toEqual(['findProductGroupSummaries', 'findOptionsByGroupIds']);
    await expect(service.getProductModifiers(mid(999))).rejects.toMatchObject({ status: 404 });
  });

  it('ficha pública: warn (sin PII) solo para grupo activo insatisfacible; el producto sigue', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, repo } = setup();
    repo.patchOption(OPT(1), { active: false });
    expect(await service.findPublicGroupsForProduct(P.roll)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(G.salsas);
    expect(await service.findPublicGroupsForProduct(mid(999))).toEqual([]);
    warn.mockRestore();
  });
});
