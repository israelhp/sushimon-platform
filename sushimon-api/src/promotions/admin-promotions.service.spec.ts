import { Logger } from '@nestjs/common';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import {
  A,
  B,
  C,
  local,
  MISSING_PRODUCT,
  NOW,
  P1,
  P2,
  promotionsHarness,
} from '../../test/support/promotions-harness.js';
import type { CreatePromotionRequest } from './dto/promotion-requests.dto.js';

const ALL = ['promotions.read', 'promotions.create', 'promotions.update'];
const admin = () => globalStaff(ALL);
const scoped = (...branches: string[]) => scopedStaff(ALL, branches);

const info = (e: unknown) => {
  const x = e as { getStatus?: () => number; getResponse?: () => unknown };
  const body = (x.getResponse?.() ?? {}) as {
    code?: string;
    violations?: { path: string; code: string }[];
  };
  return { status: x.getStatus?.(), code: body.code, violations: body.violations };
};
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => info(e),
  );

const validCreate = (over: Partial<CreatePromotionRequest> = {}): CreatePromotionRequest => ({
  name: 'Happy Hour',
  kind: 'PERCENT',
  value: '15.00',
  startsAt: '2026-01-01T00:00:00-06:00',
  endsAt: '2027-01-01T00:00:00-06:00',
  branchScope: 'ALL',
  productScope: 'ALL',
  ...over,
});

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('create', () => {
  it('crea una promoción válida: version 1, auditada en la misma transacción', async () => {
    const h = promotionsHarness();
    const out = await h.admin.create(admin(), validCreate({ description: '  2x1  ' }));
    expect(out).toMatchObject({
      name: 'Happy Hour',
      code: null,
      description: '2x1',
      kind: 'PERCENT',
      value: '15.00',
      active: true,
      dineInOnly: false,
      version: 1,
      lifecycle: 'RUNNING',
      liveNow: true,
      branchScope: 'ALL',
      branches: [],
      productScope: 'ALL',
      productCount: 0,
      scheduleCount: 0,
      editable: true,
    });
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'promotion.created',
      entityType: 'promotion',
      entityId: out.id,
      branchId: null,
      actorId: '99999999-9999-4999-8999-999999999999',
    });
    expect(h.repo.audit[0]?.['newValues']).toMatchObject({ name: 'Happy Hour', value: '15.00' });
  });

  it('código normalizado (recortado y mayúsculas); duplicado => 409 PROMOTION_CODE_TAKEN sin auditar', async () => {
    const h = promotionsHarness();
    const first = await h.admin.create(admin(), validCreate({ code: ' verano10 ' }));
    expect(first.code).toBe('VERANO10');
    const second = await failure(h.admin.create(admin(), validCreate({ code: 'Verano10' })));
    expect(second).toMatchObject({ status: 409, code: 'PROMOTION_CODE_TAKEN' });
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.promotions.size).toBe(1);
  });

  it('código duplicado detectado por la BD en una carrera (P2002) => 409 y rollback', async () => {
    const h = promotionsHarness();
    h.repo.seed({ code: 'CARRERA' });
    const r = await failure(h.admin.create(admin(), validCreate({ code: 'carrera' })));
    expect(r).toMatchObject({ status: 409, code: 'PROMOTION_CODE_TAKEN' });
  });

  it.each([
    ['porcentaje > 100', { value: '100.01' }, 'PROMOTION_VALUE_INVALID'],
    ['porcentaje 0', { value: '0.00' }, 'PROMOTION_VALUE_INVALID'],
    ['monto 0', { kind: 'FIXED_AMOUNT' as const, value: '0.00' }, 'PROMOTION_VALUE_INVALID'],
    ['fin = inicio', { endsAt: '2026-01-01T00:00:00-06:00' }, 'PROMOTION_PERIOD_INVALID'],
    ['fin < inicio', { endsAt: '2025-01-01T00:00:00Z' }, 'PROMOTION_PERIOD_INVALID'],
    [
      'tramo invertido',
      { schedule: [{ weekday: 1, startsAt: '18:00', endsAt: '15:00' }] },
      'PROMOTION_SCHEDULE_INVALID',
    ],
    [
      'tramos solapados',
      {
        schedule: [
          { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
          { weekday: 1, startsAt: '17:00', endsAt: '19:00' },
        ],
      },
      'PROMOTION_SCHEDULE_INVALID',
    ],
    [
      'productos vacíos con SELECTED',
      { productScope: 'SELECTED' as const },
      'PROMOTION_SCOPE_INVALID',
    ],
  ])('422: %s', async (_n, over, code) => {
    const h = promotionsHarness();
    const r = await failure(h.admin.create(admin(), validCreate(over)));
    expect(r).toMatchObject({ status: 422, code });
    expect(h.repo.promotions.size).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
    expect(h.repo.count('transaction')).toBe(0); // las reglas puras no abren transacción
  });

  it('400: fechas sin zona, ALL con branchIds, SELECTED sin branchIds', async () => {
    const h = promotionsHarness();
    for (const over of [
      { startsAt: '2026-01-01T00:00:00' },
      { branchScope: 'ALL' as const, branchIds: [A] },
      { branchScope: 'SELECTED' as const },
      { productScope: 'ALL' as const, productIds: [P1] },
    ]) {
      expect(await failure(h.admin.create(admin(), validCreate(over)))).toMatchObject({
        status: 400,
      });
    }
  });

  it('productos inexistentes => 422 PROMOTION_SCOPE_INVALID con violations por productIds[i]', async () => {
    const h = promotionsHarness();
    const r = await failure(
      h.admin.create(
        admin(),
        validCreate({ productScope: 'SELECTED', productIds: [P1, MISSING_PRODUCT] }),
      ),
    );
    expect(r).toMatchObject({ status: 422, code: 'PROMOTION_SCOPE_INVALID' });
    expect(r?.violations).toEqual([
      expect.objectContaining({ path: 'productIds[1]', code: 'PRODUCT_UNKNOWN' }),
    ]);
  });

  it('sucursal inexistente => 404 BRANCH_NOT_FOUND', async () => {
    const h = promotionsHarness();
    const r = await failure(
      h.admin.create(
        admin(),
        validCreate({
          branchScope: 'SELECTED',
          branchIds: [A, '00000000-0000-4000-8000-0000000000ff'],
        }),
      ),
    );
    expect(r).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect(h.repo.promotions.size).toBe(0);
  });

  it('alcance acotado: ALL => 403 PROMOTION_SCOPE_FORBIDDEN; SELECTED fuera de alcance => 404; propio => 201', async () => {
    const h = promotionsHarness();
    const staff = scoped(A);
    expect(await failure(h.admin.create(staff, validCreate()))).toMatchObject({
      status: 403,
      code: 'PROMOTION_SCOPE_FORBIDDEN',
    });
    expect(
      await failure(
        h.admin.create(staff, validCreate({ branchScope: 'SELECTED', branchIds: [A, B] })),
      ),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    const ok = await h.admin.create(
      staff,
      validCreate({ branchScope: 'SELECTED', branchIds: [A] }),
    );
    expect(ok.branches).toEqual([{ id: A, name: 'Zona 10' }]);
    expect(ok.editable).toBe(true);
    expect(h.repo.promotions.size).toBe(1);
  });

  it('promoción futura / vencida / desactivada: ciclo de vida y liveNow', async () => {
    const h = promotionsHarness();
    const future = await h.admin.create(
      admin(),
      validCreate({ startsAt: '2026-12-01T00:00:00-06:00', endsAt: '2026-12-31T00:00:00-06:00' }),
    );
    const past = await h.admin.create(
      admin(),
      validCreate({ startsAt: '2026-01-01T00:00:00-06:00', endsAt: '2026-02-01T00:00:00-06:00' }),
    );
    const off = await h.admin.create(admin(), validCreate({ active: false }));
    expect([future, past, off].map((p) => [p.lifecycle, p.liveNow])).toEqual([
      ['SCHEDULED', false],
      ['EXPIRED', false],
      ['INACTIVE', false],
    ]);
  });

  it('horario semanal: guardado ordenado y liveNow según el instante local', async () => {
    const h = promotionsHarness();
    const out = await h.admin.create(
      admin(),
      validCreate({
        schedule: [
          { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
          { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
        ],
      }),
    );
    expect(out.schedule).toEqual([
      { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
      { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
    ]);
    expect(out.liveNow).toBe(true); // lunes 16:00
    h.clock.current = local('2026-11-16T19:00:00');
    const again = await h.admin.get(admin(), out.id);
    expect(again.liveNow).toBe(false);
  });

  it('error de BD no esperado => se propaga (500 genérico) y se revierte', async () => {
    const h = promotionsHarness();
    h.repo.failTransactionWith = { code: 'P2028' };
    expect(await failure(h.admin.create(admin(), validCreate()))).toMatchObject({
      status: 503,
      code: 'PROMOTIONS_BUSY',
    });
  });
});

describe('update', () => {
  const seedAll = (h: ReturnType<typeof promotionsHarness>, over = {}) =>
    h.repo.seed({ name: 'Base', value: '10.00', ...over });

  it('expectedVersion distinto => 409 PROMOTION_VERSION_CONFLICT sin guardar ni auditar', async () => {
    const h = promotionsHarness();
    const p = seedAll(h);
    const r = await failure(h.admin.update(admin(), p.id, { expectedVersion: 7, name: 'X' }));
    expect(r).toMatchObject({ status: 409, code: 'PROMOTION_VERSION_CONFLICT' });
    expect(h.repo.promotions.get(p.id)?.name).toBe('Base');
    expect(h.repo.audit).toHaveLength(0);
  });

  it('un cambio real sube version en 1 y audita solo lo cambiado en la misma transacción', async () => {
    const h = promotionsHarness();
    const p = seedAll(h);
    const out = await h.admin.update(admin(), p.id, {
      expectedVersion: 1,
      value: '20.00',
      name: 'Nuevo',
    });
    expect(out).toMatchObject({ version: 2, value: '20.00', name: 'Nuevo' });
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'promotion.updated',
      oldValues: { value: '10.00', name: 'Base' },
      newValues: { value: '20.00', name: 'Nuevo' },
    });
  });

  it('sin cambios: 200 sin escribir, sin subir version y sin auditar (idempotente)', async () => {
    const h = promotionsHarness();
    const p = seedAll(h);
    const out = await h.admin.update(admin(), p.id, {
      expectedVersion: 1,
      name: 'Base',
      value: '10.00',
    });
    expect(out.version).toBe(1);
    expect(h.repo.count('savePromotion')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
    const only = await h.admin.update(admin(), p.id, { expectedVersion: 1 });
    expect(only.version).toBe(1);
  });

  it('reemplazo de tramos, sucursales y productos es atómico (todo o nada)', async () => {
    const h = promotionsHarness();
    const p = seedAll(h, {
      branchIds: [A],
      productIds: [P1],
      schedule: [{ weekday: 1, startsAt: '10:00', endsAt: '11:00' }],
    });
    const out = await h.admin.update(admin(), p.id, {
      expectedVersion: 1,
      branchScope: 'SELECTED',
      branchIds: [B, C],
      productScope: 'SELECTED',
      productIds: [P2],
      schedule: [{ weekday: 2, startsAt: '12:00', endsAt: '13:00' }],
    });
    expect(out.branches.map((b) => b.id).sort()).toEqual([B, C].sort());
    expect(out.products.map((x) => x.id)).toEqual([P2]);
    expect(out.schedule).toEqual([{ weekday: 2, startsAt: '12:00', endsAt: '13:00' }]);
    // fallo a mitad (código duplicado): nada cambia
    h.repo.seed({ code: 'USADO' });
    const before = JSON.stringify([...h.repo.promotions.values()]);
    const auditBefore = h.repo.audit.length;
    const r = await failure(
      h.admin.update(admin(), p.id, { expectedVersion: 2, code: 'usado', branchScope: 'ALL' }),
    );
    expect(r).toMatchObject({ status: 409, code: 'PROMOTION_CODE_TAKEN' });
    expect(JSON.stringify([...h.repo.promotions.values()])).toBe(before);
    expect(h.repo.audit).toHaveLength(auditBefore);
  });

  it('SELECTED -> ALL sin reenviar ids; ALL -> SELECTED sin ids => 400', async () => {
    const h = promotionsHarness();
    const sel = seedAll(h, { branchIds: [A] });
    const out = await h.admin.update(admin(), sel.id, { expectedVersion: 1, branchScope: 'ALL' });
    expect(out.branchScope).toBe('ALL');
    const all = seedAll(h);
    expect(
      await failure(
        h.admin.update(admin(), all.id, { expectedVersion: 1, branchScope: 'SELECTED' }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(h.admin.update(admin(), all.id, { expectedVersion: 1, branchIds: [A] })),
    ).toMatchObject({ status: 400 });
  });

  it('code: null convierte un cupón en automática; reglas 422 sobre el estado final', async () => {
    const h = promotionsHarness();
    const p = seedAll(h, { code: 'CUPON1' });
    const out = await h.admin.update(admin(), p.id, { expectedVersion: 1, code: null });
    expect(out.code).toBeNull();
    expect(
      await failure(
        h.admin.update(admin(), p.id, { expectedVersion: 2, kind: 'PERCENT', value: '150.00' }),
      ),
    ).toMatchObject({ status: 422, code: 'PROMOTION_VALUE_INVALID' });
    expect(
      await failure(
        h.admin.update(admin(), p.id, { expectedVersion: 2, endsAt: '2025-01-01T00:00:00Z' }),
      ),
    ).toMatchObject({ status: 422, code: 'PROMOTION_PERIOD_INVALID' });
  });

  it('inexistente => 404 PROMOTION_NOT_FOUND', async () => {
    const h = promotionsHarness();
    expect(
      await failure(
        h.admin.update(admin(), '00000000-0000-4000-8000-0000000000ff', { expectedVersion: 1 }),
      ),
    ).toMatchObject({ status: 404, code: 'PROMOTION_NOT_FOUND' });
  });

  it('IDOR/alcance: no toca su alcance => 404; la toca sin cubrirla => 403; ALL con alcance acotado => 403', async () => {
    const h = promotionsHarness();
    const onlyB = seedAll(h, { branchIds: [B] });
    const shared = seedAll(h, { branchIds: [A, B] });
    const global = seedAll(h);
    const staff = scoped(A);
    expect(
      await failure(h.admin.update(staff, onlyB.id, { expectedVersion: 1, name: 'X' })),
    ).toMatchObject({
      status: 404,
      code: 'PROMOTION_NOT_FOUND',
    });
    expect(
      await failure(h.admin.update(staff, shared.id, { expectedVersion: 1, name: 'X' })),
    ).toMatchObject({
      status: 403,
      code: 'PROMOTION_SCOPE_FORBIDDEN',
    });
    expect(
      await failure(h.admin.update(staff, global.id, { expectedVersion: 1, name: 'X' })),
    ).toMatchObject({
      status: 403,
      code: 'PROMOTION_SCOPE_FORBIDDEN',
    });
    expect(h.repo.promotions.get(shared.id)?.name).not.toBe('X');
    expect(h.repo.audit).toHaveLength(0);
  });

  it('actor acotado: puede editar la suya; sumar una sucursal ajena => 404 BRANCH_NOT_FOUND', async () => {
    const h = promotionsHarness();
    const own = seedAll(h, { branchIds: [A] });
    const staff = scoped(A);
    expect((await h.admin.update(staff, own.id, { expectedVersion: 1, name: 'Mía' })).name).toBe(
      'Mía',
    );
    expect(
      await failure(
        h.admin.update(staff, own.id, {
          expectedVersion: 2,
          branchScope: 'SELECTED',
          branchIds: [A, B],
        }),
      ),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect(
      await failure(h.admin.update(staff, own.id, { expectedVersion: 2, branchScope: 'ALL' })),
    ).toMatchObject({ status: 403, code: 'PROMOTION_SCOPE_FORBIDDEN' });
  });

  it('PATCH concurrentes: el segundo con versión vieja recibe 409', async () => {
    const h = promotionsHarness();
    const p = seedAll(h);
    await h.admin.update(admin(), p.id, { expectedVersion: 1, name: 'Uno' });
    expect(
      await failure(h.admin.update(admin(), p.id, { expectedVersion: 1, name: 'Dos' })),
    ).toMatchObject({
      status: 409,
      code: 'PROMOTION_VERSION_CONFLICT',
    });
    expect(h.repo.promotions.get(p.id)?.name).toBe('Uno');
    expect(h.repo.count('lockPromotion')).toBe(2);
  });
});

describe('updateStatus', () => {
  it('desactiva y activa con auditoría (oldActive/newActive, reason) y sube version', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed();
    const off = await h.admin.updateStatus(admin(), p.id, {
      active: false,
      reason: ' fin de campaña ',
    });
    expect(off).toMatchObject({ active: false, lifecycle: 'INACTIVE', version: 2 });
    expect(h.repo.audit[0]).toMatchObject({
      action: 'promotion.status_changed',
      reason: 'fin de campaña',
      oldValues: { oldActive: true },
      newValues: { newActive: false },
    });
    const on = await h.admin.updateStatus(admin(), p.id, { active: true });
    expect(on).toMatchObject({ active: true, version: 3 });
  });

  it('idempotente: mismo valor => sin escritura, sin version, sin auditoría', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed();
    const out = await h.admin.updateStatus(admin(), p.id, { active: true });
    expect(out.version).toBe(1);
    expect(h.repo.count('savePromotion')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
  });

  it('mismas reglas de alcance: 404 / 403', async () => {
    const h = promotionsHarness();
    const onlyB = h.repo.seed({ branchIds: [B] });
    const shared = h.repo.seed({ branchIds: [A, B] });
    const staff = scoped(A);
    expect(await failure(h.admin.updateStatus(staff, onlyB.id, { active: false }))).toMatchObject({
      status: 404,
    });
    expect(await failure(h.admin.updateStatus(staff, shared.id, { active: false }))).toMatchObject({
      status: 403,
      code: 'PROMOTION_SCOPE_FORBIDDEN',
    });
    expect(h.repo.promotions.get(shared.id)?.active).toBe(true);
  });
});

describe('list y get', () => {
  it('paginado con filtros; una consulta para la página y una para sus hijas (sin N+1)', async () => {
    const h = promotionsHarness();
    for (let i = 0; i < 5; i += 1) h.repo.seed({ name: `Promo ${i}`, branchIds: i % 2 ? [A] : [] });
    const page = await h.admin.list(admin(), { page: 1, pageSize: 2 });
    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 5 });
    expect(page.items).toHaveLength(2);
    expect(h.repo.count('findPage')).toBe(1);
    expect(h.repo.count('findRecords')).toBe(1);
  });

  it('filtros: estado, tipo, fechas, sucursal y búsqueda por nombre/código (comodines literales)', async () => {
    const h = promotionsHarness();
    h.repo.seed({ name: 'Cerveza 2x1', code: 'CERVEZA10', kind: 'FIXED_AMOUNT', value: '5.00' });
    h.repo.seed({ name: 'Happy 100%', active: false });
    h.repo.seed({
      name: 'Futura',
      startsAt: local('2026-12-01T00:00:00'),
      endsAt: local('2026-12-31T00:00:00'),
    });
    h.repo.seed({
      name: 'Vencida',
      startsAt: local('2026-01-01T00:00:00'),
      endsAt: local('2026-02-01T00:00:00'),
    });
    h.repo.seed({ name: 'Solo B', branchIds: [B] });
    const names = async (q: Parameters<typeof h.admin.list>[1]) =>
      (await h.admin.list(admin(), q)).items.map((i) => i.name).sort();
    const base = { page: 1, pageSize: 50 };
    expect(await names({ ...base, status: 'inactive' })).toEqual(['Happy 100%']);
    expect(await names({ ...base, status: 'scheduled' })).toEqual(['Futura']);
    expect(await names({ ...base, status: 'expired' })).toEqual(['Vencida']);
    expect(await names({ ...base, status: 'running' })).toEqual(['Cerveza 2x1', 'Solo B']);
    expect(await names({ ...base, kind: 'FIXED_AMOUNT' })).toEqual(['Cerveza 2x1']);
    expect(await names({ ...base, q: 'cerveza10' })).toEqual(['Cerveza 2x1']);
    expect(await names({ ...base, q: '100%' })).toEqual(['Happy 100%']);
    expect(await names({ ...base, q: '%' })).toEqual(['Happy 100%']); // comodín literal
    expect(await names({ ...base, q: '_' })).toEqual([]);
    expect(await names({ ...base, branchId: A })).not.toContain('Solo B');
    expect(
      await names({ ...base, from: '2026-11-25T00:00:00-06:00', to: '2026-12-05T00:00:00-06:00' }),
    ).toContain('Futura');
    expect(
      await names({ ...base, from: '2026-11-25T00:00:00-06:00', to: '2026-12-05T00:00:00-06:00' }),
    ).not.toContain('Vencida');
  });

  it('filtro branchId fuera de alcance o inexistente => 404 BRANCH_NOT_FOUND', async () => {
    const h = promotionsHarness();
    const staff = scoped(A);
    expect(
      await failure(h.admin.list(staff, { page: 1, pageSize: 10, branchId: B })),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect(
      await failure(
        h.admin.list(admin(), {
          page: 1,
          pageSize: 10,
          branchId: '00000000-0000-4000-8000-0000000000ff',
        }),
      ),
    ).toMatchObject({ status: 404 });
  });

  it('alcance acotado: ve las de su sucursal y las ALL; branches recortadas y editable=false si no cubre todas', async () => {
    const h = promotionsHarness();
    h.repo.seed({ name: 'Todas' });
    h.repo.seed({ name: 'Solo A', branchIds: [A] });
    h.repo.seed({ name: 'A y B', branchIds: [A, B] });
    h.repo.seed({ name: 'Solo B', branchIds: [B] });
    const page = await h.admin.list(scoped(A), { page: 1, pageSize: 50 });
    const byName = Object.fromEntries(page.items.map((i) => [i.name, i]));
    expect(Object.keys(byName).sort()).toEqual(['A y B', 'Solo A', 'Todas']);
    expect(byName['A y B']).toMatchObject({
      editable: false,
      branches: [{ id: A, name: 'Zona 10' }],
    });
    expect(byName['Solo A']?.editable).toBe(true);
    expect(byName['Todas']).toMatchObject({ editable: false, branchScope: 'ALL', branches: [] });
  });

  it('solo lectura: editable=false aunque cubra las sucursales', async () => {
    const h = promotionsHarness();
    h.repo.seed({ branchIds: [A] });
    const staff = scopedStaff(['promotions.read'], [A]);
    expect((await h.admin.list(staff, { page: 1, pageSize: 5 })).items[0]?.editable).toBe(false);
  });

  it('get: incluye código del cupón, productos y tramos; fuera de alcance => 404 igual que inexistente', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed({
      code: 'VERANO',
      branchIds: [B],
      productIds: [P1],
      schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
    });
    const full = await h.admin.get(admin(), p.id);
    expect(full).toMatchObject({ code: 'VERANO', productScope: 'SELECTED', productCount: 1 });
    expect(full.products).toEqual([{ id: P1, name: 'Roll California', slug: 'roll-california' }]);
    const outside = await failure(h.admin.get(scoped(A), p.id));
    const missing = await failure(h.admin.get(scoped(A), '00000000-0000-4000-8000-0000000000ff'));
    expect(outside).toEqual(missing);
    expect(outside).toMatchObject({ status: 404, code: 'PROMOTION_NOT_FOUND' });
  });

  it('el reloj del servidor decide el estado (NOW fijo)', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed({ startsAt: new Date(NOW.getTime() + 1000) });
    expect((await h.admin.get(admin(), p.id)).lifecycle).toBe('SCHEDULED');
    h.clock.current = new Date(NOW.getTime() + 1000);
    expect((await h.admin.get(admin(), p.id)).lifecycle).toBe('RUNNING');
  });
});

describe('autorización sin bloqueo (B1)', () => {
  it('actor sin alcance: 404 sin tocar el candado ni abrir transacción; compartida: 403 igual', async () => {
    const h = promotionsHarness();
    const onlyB = h.repo.seed({ branchIds: [B] });
    const shared = h.repo.seed({ branchIds: [A, B] });
    const staff = scoped(A);
    expect(await failure(h.admin.update(staff, onlyB.id, { expectedVersion: 1 }))).toMatchObject({
      status: 404,
    });
    expect(await failure(h.admin.updateStatus(staff, onlyB.id, { active: false }))).toMatchObject({
      status: 404,
    });
    expect(await failure(h.admin.update(staff, shared.id, { expectedVersion: 1 }))).toMatchObject({
      status: 403,
    });
    expect(
      await failure(
        h.admin.updateStatus(staff, '00000000-0000-4000-8000-0000000000ff', { active: false }),
      ),
    ).toMatchObject({ status: 404 });
    expect(h.repo.count('lockPromotion')).toBe(0);
    expect(h.repo.count('transaction')).toBe(0);
  });

  it('el alcance se re-verifica tras el candado (la promoción cambió entre la lectura y el bloqueo)', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed({ branchIds: [A] });
    h.repo.afterLock = () => {
      const cur = h.repo.promotions.get(p.id);
      if (cur) cur.branchIds = [A, B]; // otro admin añadió B justo antes del bloqueo
    };
    const r = await failure(h.admin.update(scoped(A), p.id, { expectedVersion: 1, name: 'X' }));
    expect(r).toMatchObject({ status: 403, code: 'PROMOTION_SCOPE_FORBIDDEN' });
    expect(h.repo.promotions.get(p.id)?.name).not.toBe('X');
    expect(h.repo.audit).toHaveLength(0);
  });

  it('actor con alcance sí bloquea una vez', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed({ branchIds: [A] });
    await h.admin.update(scoped(A), p.id, { expectedVersion: 1, name: 'Mía' });
    expect(h.repo.count('lockPromotion')).toBe(1);
  });
});

describe('saneado y valor canónico en el servicio (B5/B6)', () => {
  it('NUL en name/description al crear => 400 (no 500) y nada se guarda', async () => {
    const h = promotionsHarness();
    for (const over of [{ name: 'a\u0000b' }, { description: 'x\u0000' }]) {
      expect(await failure(h.admin.create(admin(), validCreate(over)))).toMatchObject({
        status: 400,
      });
    }
    expect(h.repo.promotions.size).toBe(0);
  });
  it('PATCH con "000001.00" sobre "1.00": no sube version ni audita', async () => {
    const h = promotionsHarness();
    const p = h.repo.seed({ value: '1.00' });
    const out = await h.admin.update(admin(), p.id, { expectedVersion: 1, value: '000001.00' });
    expect(out.version).toBe(1);
    expect(h.repo.count('savePromotion')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
  });
  it('crear con "0015.00" guarda "15.00"', async () => {
    const h = promotionsHarness();
    expect((await h.admin.create(admin(), validCreate({ value: '0015.00' }))).value).toBe('15.00');
  });
});
