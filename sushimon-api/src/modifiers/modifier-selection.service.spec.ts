import {
  FakeModifiersRepo,
  G,
  groupRow,
  optionRow,
  OPT,
  P,
} from '../../test/support/fake-modifiers-repo.js';
import { ModifierSelectionService } from './modifier-selection.service.js';
import type { ModifiersRepository } from './modifiers.repository.js';

function setup() {
  const repo = new FakeModifiersRepo();
  // salsas: obligatoria 1..2 (soya 1.50, picante 0.10, vieja inactiva); extras: opcional 0..2 (queso 0.20)
  repo.seedGroup(groupRow(G.salsas, { name: 'Salsas', minSelect: 1, maxSelect: 2 }), [
    optionRow(OPT(1), G.salsas, { name: 'Soya', extraPrice: '1.50', sortOrder: 0 }),
    optionRow(OPT(2), G.salsas, { name: 'Picante', extraPrice: '0.10', sortOrder: 1 }),
    optionRow(OPT(3), G.salsas, { name: 'Vieja', extraPrice: '9.00', sortOrder: 2, active: false }),
  ]);
  repo.seedGroup(groupRow(G.extras, { name: 'Extras', maxSelect: 2 }), [
    optionRow(OPT(4), G.extras, { name: 'Queso', extraPrice: '0.20' }),
  ]);
  repo.seedGroup(groupRow(G.vacio, { name: 'Ajeno' }), [optionRow(OPT(5), G.vacio)]);
  repo.seedProduct(P.roll, [G.salsas, G.extras]);
  repo.seedProduct(P.sin, []);
  return { repo, service: new ModifierSelectionService(repo as unknown as ModifiersRepository) };
}

const violationsOf = async (p: Promise<unknown>) => {
  const e = (await p.then(
    () => null,
    (err: unknown) => err,
  )) as {
    status: number;
    response: { code: string; violations: { path: string; code: string }[] };
  };
  expect(e.status).toBe(422);
  expect(e.response.code).toBe('MODIFIER_SELECTION_INVALID');
  return e.response.violations.map((v) => `${v.code}@${v.path}`);
};

describe('ModifierSelectionService.validate', () => {
  it('selección válida: extraTotal exacto, items canónicos desde la BD, UNA consulta', async () => {
    const { service, repo } = setup();
    const r = await service.validate(P.roll, [
      { groupId: G.salsas, modifierIds: [OPT(2), OPT(1)] },
      { groupId: G.extras, modifierIds: [OPT(4)] },
    ]);
    expect(r.ok).toBe(true);
    expect(r.extraTotal).toBe('1.80');
    expect(r.items).toEqual([
      { groupId: G.salsas, modifierId: OPT(2), name: 'Picante', extraPrice: '0.10' },
      { groupId: G.salsas, modifierId: OPT(1), name: 'Soya', extraPrice: '1.50' },
      { groupId: G.extras, modifierId: OPT(4), name: 'Queso', extraPrice: '0.20' },
    ]);
    expect(repo.calls).toEqual(['findOffer']);
  });

  it('0.10 + 0.20 = 0.30', async () => {
    const { service } = setup();
    const r = await service.validate(P.roll, [
      { groupId: G.salsas, modifierIds: [OPT(2)] },
      { groupId: G.extras, modifierIds: [OPT(4)] },
    ]);
    expect(r.extraTotal).toBe('0.30');
  });

  it('producto inexistente => 404 PRODUCT_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(
      service.validate('00000000-0000-4000-8000-000000009999', []),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('producto sin grupos y selección vacía es válida (total 0.00)', async () => {
    const { service } = setup();
    expect(await service.validate(P.sin, [])).toEqual({ ok: true, extraTotal: '0.00', items: [] });
  });

  it('MODIFIER_REQUIRED: grupo obligatorio ausente o con pocas opciones', async () => {
    const { service } = setup();
    expect(await violationsOf(service.validate(P.roll, []))).toEqual([
      `MODIFIER_REQUIRED@groups/${G.salsas}`,
    ]);
    expect(
      await violationsOf(service.validate(P.roll, [{ groupId: G.salsas, modifierIds: [] }])),
    ).toEqual(['MODIFIER_REQUIRED@selections[0]']);
  });

  it('MODIFIER_TOO_MANY', async () => {
    const { service } = setup();
    expect(
      await violationsOf(
        service.validate(P.roll, [{ groupId: G.salsas, modifierIds: [OPT(1), OPT(2), OPT(3)] }]),
      ),
    ).toContain('MODIFIER_TOO_MANY@selections[0].modifierIds');
  });

  it('MODIFIER_NOT_IN_GROUP: ajena o inexistente', async () => {
    const { service } = setup();
    expect(
      await violationsOf(
        service.validate(P.roll, [
          {
            groupId: G.salsas,
            modifierIds: [OPT(1), OPT(5), '00000000-0000-4000-8000-000000009998'],
          },
        ]),
      ),
    ).toEqual([
      'MODIFIER_NOT_IN_GROUP@selections[0].modifierIds[1]',
      'MODIFIER_NOT_IN_GROUP@selections[0].modifierIds[2]',
    ]);
  });

  it('MODIFIER_GROUP_NOT_ON_PRODUCT: grupo no asociado', async () => {
    const { service } = setup();
    expect(
      await violationsOf(
        service.validate(P.roll, [
          { groupId: G.salsas, modifierIds: [OPT(1)] },
          { groupId: G.vacio, modifierIds: [OPT(5)] },
        ]),
      ),
    ).toEqual(['MODIFIER_GROUP_NOT_ON_PRODUCT@selections[1].groupId']);
  });

  it('MODIFIER_INACTIVE: opción inactiva y grupo asociado inactivo', async () => {
    const { service, repo } = setup();
    expect(
      await violationsOf(service.validate(P.roll, [{ groupId: G.salsas, modifierIds: [OPT(3)] }])),
    ).toContain('MODIFIER_INACTIVE@selections[0].modifierIds[0]');
    repo.patchGroup(G.extras, { active: false });
    expect(
      await violationsOf(
        service.validate(P.roll, [
          { groupId: G.salsas, modifierIds: [OPT(1)] },
          { groupId: G.extras, modifierIds: [OPT(4)] },
        ]),
      ),
    ).toEqual(['MODIFIER_INACTIVE@selections[1].groupId']);
  });

  it('MODIFIER_DUPLICATED: grupo y opción repetidos', async () => {
    const { service } = setup();
    expect(
      await violationsOf(
        service.validate(P.roll, [
          { groupId: G.salsas, modifierIds: [OPT(1), OPT(1)] },
          { groupId: G.salsas, modifierIds: [OPT(2)] },
        ]),
      ),
    ).toEqual([
      'MODIFIER_DUPLICATED@selections[0].modifierIds[1]',
      'MODIFIER_DUPLICATED@selections[1].groupId',
    ]);
  });

  it('formas inválidas => 422 MODIFIER_SELECTION_INVALID (no TypeError) y sin consultar la BD', async () => {
    const { service, repo } = setup();
    const bad = (v: unknown) => violationsOf(service.validate(P.roll, v as never));
    expect(await bad(null)).toEqual(['MODIFIER_SELECTION_INVALID@selections']);
    expect(await bad({ length: 1 })).toEqual(['MODIFIER_SELECTION_INVALID@selections']);
    expect(await bad('x')).toEqual(['MODIFIER_SELECTION_INVALID@selections']);
    expect(await bad([null, 3])).toEqual([
      'MODIFIER_SELECTION_INVALID@selections[0]',
      'MODIFIER_SELECTION_INVALID@selections[1]',
    ]);
    expect(await bad([{ groupId: 1, modifierIds: 'abc' }])).toEqual([
      'MODIFIER_SELECTION_INVALID@selections[0].groupId',
      'MODIFIER_SELECTION_INVALID@selections[0].modifierIds',
    ]);
    expect(await bad([{ groupId: G.salsas }])).toEqual([
      'MODIFIER_SELECTION_INVALID@selections[0].modifierIds',
    ]);
    expect(await bad([{ groupId: G.salsas, modifierIds: [1, null] }])).toEqual([
      'MODIFIER_SELECTION_INVALID@selections[0].modifierIds[0]',
      'MODIFIER_SELECTION_INVALID@selections[0].modifierIds[1]',
    ]);
    expect(repo.calls).toEqual([]);
  });

  it('máximos defensivos: > 10 selecciones o > 20 ids por selección => 422', async () => {
    const { service, repo } = setup();
    const many = Array.from({ length: 11 }, () => ({ groupId: G.salsas, modifierIds: [] }));
    expect(await violationsOf(service.validate(P.roll, many))).toEqual([
      'MODIFIER_SELECTION_INVALID@selections',
    ]);
    const ids = Array.from({ length: 21 }, () => OPT(1));
    expect(
      await violationsOf(service.validate(P.roll, [{ groupId: G.salsas, modifierIds: ids }])),
    ).toEqual(['MODIFIER_SELECTION_INVALID@selections[0].modifierIds']);
    expect(repo.calls).toEqual([]);
  });

  it('informa varias violaciones a la vez', async () => {
    const { service } = setup();
    const v = await violationsOf(
      service.validate(P.roll, [{ groupId: G.extras, modifierIds: [OPT(4), OPT(4), OPT(1)] }]),
    );
    expect(v).toEqual([
      'MODIFIER_DUPLICATED@selections[0].modifierIds[1]',
      'MODIFIER_NOT_IN_GROUP@selections[0].modifierIds[2]',
      `MODIFIER_REQUIRED@groups/${G.salsas}`,
    ]);
  });

  it('grupo activo insatisfacible no se exige ni se acepta (no ofrecible)', async () => {
    const { service, repo } = setup();
    repo.patchOption(OPT(1), { active: false });
    repo.patchOption(OPT(2), { active: false });
    expect(await service.validate(P.roll, [])).toMatchObject({ ok: true, extraTotal: '0.00' });
    expect(
      await violationsOf(service.validate(P.roll, [{ groupId: G.salsas, modifierIds: [OPT(1)] }])),
    ).toEqual(['MODIFIER_GROUP_NOT_ON_PRODUCT@selections[0].groupId']);
  });
});
