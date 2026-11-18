import type { HttpException } from '@nestjs/common';
import { LocationsService, sortByName } from './locations.service.js';
import type { LocationsRepository } from './locations.repository.js';

const item = (id: string, name: string) => ({ id, name });

describe('sortByName', () => {
  it('orden español sin distinguir acentos ni mayúsculas, con desempate por id', () => {
    const sorted = sortByName([
      item('5', 'Zacapa'),
      item('4', 'Sololá'),
      item('3', 'Sacatepéquez'),
      item('2', 'Quiché'),
      item('1', 'quetzaltenango'),
      item('7', 'Alta Verapaz'),
      item('6', 'Escuintla'),
    ]);
    expect(sorted.map((x) => x.name)).toEqual([
      'Alta Verapaz',
      'Escuintla',
      'quetzaltenango',
      'Quiché',
      'Sacatepéquez',
      'Sololá',
      'Zacapa',
    ]);
  });

  it('empates de nombre (solo difieren en acento) se resuelven por id y no mutan la entrada', () => {
    const input = [item('b', 'Peten'), item('a', 'Petén')];
    expect(sortByName(input).map((x) => x.id)).toEqual(['a', 'b']);
    expect(input[0]?.id).toBe('b');
  });

  it('Ñ ordena junto a N en español (Ñ después de N)', () => {
    expect(
      sortByName([item('1', 'Nz'), item('2', 'Ñu'), item('3', 'Na'), item('4', 'O')]).map(
        (x) => x.name,
      ),
    ).toEqual(['Na', 'Nz', 'Ñu', 'O']);
  });
});

describe('LocationsService', () => {
  const svc = (repo: Partial<LocationsRepository>) =>
    new LocationsService(repo as LocationsRepository);

  it('departamentos ordenados', async () => {
    const s = svc({
      listDepartments: () => Promise.resolve([item('2', 'Zacapa'), item('1', 'Alta Verapaz')]),
    });
    expect((await s.listDepartments()).items.map((d) => d.name)).toEqual([
      'Alta Verapaz',
      'Zacapa',
    ]);
  });

  it('departamento inexistente => 404 DEPARTMENT_NOT_FOUND; existente sin municipios => []', async () => {
    const s = svc({
      listMunicipalities: (id: string) => Promise.resolve(id === 'vacio' ? [] : null),
    });
    expect(await s.listMunicipalities('vacio')).toEqual({ items: [] });
    let err: HttpException | undefined;
    try {
      await s.listMunicipalities('nope');
    } catch (e) {
      err = e as HttpException;
    }
    expect(err?.getStatus()).toBe(404);
    expect((err?.getResponse() as { code: string }).code).toBe('DEPARTMENT_NOT_FOUND');
  });
});

describe('LocationsService.findMunicipality (memo, F19)', () => {
  const row = { id: 'm1', name: 'Mixco', departmentName: 'Guatemala' };
  const setup = (found: typeof row | null) => {
    const repo = { findMunicipality: vi.fn().mockResolvedValue(found) };
    return { repo, service: new LocationsService(repo as unknown as LocationsRepository) };
  };

  it('memoriza los encontrados: una sola consulta', async () => {
    const { repo, service } = setup(row);
    expect(await service.findMunicipality('m1')).toEqual(row);
    expect(await service.findMunicipality('m1')).toEqual(row);
    expect(repo.findMunicipality).toHaveBeenCalledTimes(1);
  });

  it('NO memoriza los inexistentes (sin crecimiento por entradas hostiles)', async () => {
    const { repo, service } = setup(null);
    expect(await service.findMunicipality('x')).toBeNull();
    expect(await service.findMunicipality('x')).toBeNull();
    expect(repo.findMunicipality).toHaveBeenCalledTimes(2);
  });
});
