import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminPromotion, CreatePromotionRequest } from '@/lib/data-access/models';
import { fromLocal } from '@/lib/time';
import * as promotions from '@/services/promotions';
import { createHarness, markSoldOutEverywhere, type TestHarness } from '../testing';

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) {
      return {
        status: e.status,
        code: e.businessCode,
        violations: e.violations?.map((v) => `${v.path}:${v.code}`),
      };
    }
    throw e;
  }
  throw new Error('Se esperaba un error');
}

const at = (date: string, time: string, seconds = 0) =>
  new Date(fromLocal(date, time).getTime() + seconds * 1000).toISOString();

const valid: CreatePromotionRequest = {
  name: 'Jueves de sake',
  kind: 'PERCENT',
  value: '15.00',
  startsAt: '2026-11-01T06:00:00.000Z',
  endsAt: '2026-12-01T06:00:00.000Z',
  dineInOnly: false,
  active: true,
  branchScope: 'SELECTED',
  branchIds: ['sucursal-1'],
  productScope: 'ALL',
  schedule: [{ weekday: 4, startsAt: '18:00', endsAt: '22:00' }],
};

const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};

/** El manager de la sucursal 1 con permisos de promociones (por defecto solo `admin` los tiene: P16). */
function scopedManager(): TestHarness {
  const h = createHarness();
  h.store.roles
    .find((r) => r.code === 'manager')
    ?.permissions.push('promotions.read', 'promotions.create', 'promotions.update');
  h.asStaff('manager', 'u2');
  return h;
}

describe('público: GET /v1/store/promotions', () => {
  it('vigentes AHORA (miércoles 14:25): el Happy Hour aún no; fin de mes y el cupón sí; sin vencidas ni inactivas', async () => {
    const h = createHarness();
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(live.items.map((p) => p.id)).toEqual(['bienvenida', 'fin-de-mes']);
    expect(live.items.every((p) => p.state === 'live')).toBe(true);
    expect(live.branchId).toBe('sucursal-1');
    expect(live.generatedAt).toBe('2026-11-11T20:25:00.000Z');
    expect(live.truncated).toBe(false);
  });

  it('próximas (≤ 14 días): Happy Hour hoy a las 15:00 y Navidad el 20; la lejana o vencida no', async () => {
    const h = createHarness();
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    expect(up.items.map((p) => p.id)).toEqual(['happy-hour', 'navidad-rolls']);
    const hh = up.items[0]!;
    expect(hh).toMatchObject({
      state: 'upcoming',
      isHappyHour: true,
      dineInOnly: true,
      requiresCode: false,
      nextStartsAt: at('2026-11-11', '15:00'),
      nextEndsAt: null,
    });
    expect(hh.schedule).toHaveLength(4);
    expect(hh.validFrom).toBe('2026-10-01T06:00:00.000Z');
    expect(hh.validUntil).toBe('2027-01-01T06:00:00.000Z');
    expect(up.nextChangeAt).toBe(at('2026-11-11', '15:00'));
  });

  it('`upcoming` = NO vigente ahora y con próximo inicio ≤ 14 días: una vigente con otro tramo próximo no entra', async () => {
    const h = createHarness();
    h.clock.set(at('2026-11-11', '16:00')); // Happy Hour vigente; su siguiente tramo es el jueves
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    expect(live.items.map((p) => p.id)).toContain('happy-hour');
    expect(up.items.map((p) => p.id)).not.toContain('happy-hour');
    // Una que empieza más allá de 14 días tampoco.
    h.store.promotions.find((p) => p.id === 'navidad-rolls')!.startsAt = at('2026-12-20', '00:00');
    const later = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    expect(later.items.map((p) => p.id)).not.toContain('navidad-rolls');
  });

  it('`state` es `live` por defecto', async () => {
    const h = createHarness();
    const a = await promotions.listStorePromotions(h.client, 'sucursal-1');
    const b = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(a).toEqual(b);
  });

  it('alcance por sucursal: «Fin de mes» solo en las sucursales 1 y 2; las `ALL` en todas', async () => {
    const h = createHarness();
    const ids = async (branch: string) =>
      (await promotions.listStorePromotions(h.client, branch, 'live')).items.map((p) => p.id);
    expect(await ids('sucursal-2')).toEqual(['bienvenida', 'fin-de-mes']);
    expect(await ids('sucursal-3')).toEqual(['bienvenida']);
  });

  it('un cupón nunca expone `code`, descuento, productos ni ítems; `description` sí', async () => {
    const h = createHarness();
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    const coupon = live.items.find((p) => p.id === 'bienvenida')!;
    expect(coupon.requiresCode).toBe(true);
    expect(coupon.description).toBeTruthy();
    for (const key of ['code', 'kind', 'value', 'productIds', 'items']) {
      expect(coupon).not.toHaveProperty(key);
    }
    // Ni siquiera como subcadena en toda la respuesta (de ninguno de los dos estados).
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    const all = JSON.stringify([live, up]);
    expect(all).not.toContain('BIENVENIDO10');
    expect(all).not.toContain('COMBOMON');
    expect(JSON.stringify(live.items.filter((p) => !p.requiresCode))).not.toContain('"code"');
  });

  it('`isHappyHour` es derivado: automática con horario semanal', async () => {
    const h = createHarness();
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(live.items.find((p) => p.id === 'fin-de-mes')?.isHappyHour).toBe(false);
    expect(live.items.find((p) => p.id === 'bienvenida')?.isHappyHour).toBe(false);
    // Un cupón CON horario tampoco es Happy Hour (no es automático).
    h.store.promotions.find((p) => p.id === 'bienvenida')!.schedule = [
      { weekday: 3, startsAt: '10:00', endsAt: '20:00' },
    ];
    const again = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(again.items.find((p) => p.id === 'bienvenida')?.isHappyHour).toBe(false);
  });

  it('precios indicativos: regular de sucursal y promocional con el evaluador (centavos), solo con la API', async () => {
    const h = createHarness();
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    const hh = up.items[0]!;
    expect(hh.items).toHaveLength(7);
    const dumplings = hh.items?.find((i) => i.productId === 'dumplings');
    expect(dumplings).toEqual({
      productId: 'dumplings',
      regularPrice: '53.00',
      promoPrice: '39.75',
    });
    // Ordenados por nombre y con 2 decimales siempre.
    expect(hh.items?.every((i) => /^\d+\.\d{2}$/.test(i.promoPrice))).toBe(true);
    // Un cupón y una automática con alcance ALL no traen ítems.
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(live.items.find((p) => p.id === 'fin-de-mes')?.items).toHaveLength(4);
  });

  it('el precio regular es el de la SUCURSAL (F13) y un producto agotado u oculto no sale', async () => {
    const h = createHarness();
    h.store.branchProducts.push({
      branchId: 'sucursal-1',
      productId: 'dumplings',
      priceOverride: '60.00',
      available: true,
      updatedAt: '2026-11-01T12:00:00.000Z',
    });
    markSoldOutEverywhere(h.store, 'loco-ribs');
    h.store.products.find((p) => p.id === 'moni-roll')!.active = false;
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    const items = up.items[0]!.items!;
    expect(items.find((i) => i.productId === 'dumplings')).toEqual({
      productId: 'dumplings',
      regularPrice: '60.00',
      promoPrice: '45.00',
    });
    expect(items.map((i) => i.productId)).not.toContain('loco-ribs');
    expect(items.map((i) => i.productId)).not.toContain('moni-roll');
    // En otra sucursal rige el precio base.
    const other = await promotions.listStorePromotions(h.client, 'sucursal-2', 'upcoming');
    expect(other.items[0]!.items!.find((i) => i.productId === 'dumplings')?.regularPrice).toBe(
      '53.00',
    );
  });

  it('T1/T2: el Happy Hour rige a las 15:00:00 y deja de regir a las 18:00:00 (fin exclusivo)', async () => {
    const h = createHarness();
    const hhState = async () => {
      const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
      const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
      return {
        live: live.items.find((p) => p.id === 'happy-hour'),
        up: up.items.find((p) => p.id === 'happy-hour'),
        change: live.nextChangeAt,
      };
    };
    h.clock.set(at('2026-11-11', '14:59', 59));
    expect((await hhState()).live).toBeUndefined();
    h.clock.set(at('2026-11-11', '15:00'));
    let s = await hhState();
    expect(s.live).toMatchObject({ state: 'live', nextEndsAt: at('2026-11-11', '18:00') });
    expect(s.live?.nextStartsAt).toBe(at('2026-11-12', '15:00'));
    expect(s.up).toBeUndefined();
    expect(s.change).toBe(at('2026-11-11', '18:00'));
    h.clock.set(at('2026-11-11', '17:59', 59));
    expect((await hhState()).live).toBeDefined();
    h.clock.set(at('2026-11-11', '18:00'));
    s = await hhState();
    expect(s.live).toBeUndefined();
    expect(s.up?.nextStartsAt).toBe(at('2026-11-12', '15:00'));
  });

  it('T5: domingo 21:00 local (ya lunes en UTC) no es día 1; el viernes siguiente salta al lunes', async () => {
    const h = createHarness();
    h.clock.set('2026-11-16T03:00:00Z');
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    expect(up.items.find((p) => p.id === 'happy-hour')?.nextStartsAt).toBe(
      at('2026-11-16', '15:00'),
    );
    h.clock.set(at('2026-11-13', '16:00')); // viernes
    const fri = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    expect(fri.items.find((p) => p.id === 'happy-hour')?.nextStartsAt).toBe(
      at('2026-11-16', '15:00'),
    );
  });

  it('medianoche (estrategia B): vie 22:00–24:00 + sáb 00:00–02:00 se fusionan en `nextEndsAt`', async () => {
    const h = createHarness();
    const hh = h.store.promotions.find((p) => p.id === 'happy-hour')!;
    hh.schedule = [
      { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
      { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
    ];
    h.clock.set(at('2026-11-13', '23:00'));
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(live.items.find((p) => p.id === 'happy-hour')?.nextEndsAt).toBe(
      at('2026-11-14', '02:00'),
    );
    h.clock.set(at('2026-11-14', '00:30'));
    expect(
      (await promotions.listStorePromotions(h.client, 'sucursal-1', 'live')).items.some(
        (p) => p.id === 'happy-hour',
      ),
    ).toBe(true);
    h.clock.set(at('2026-11-14', '02:00'));
    expect(
      (await promotions.listStorePromotions(h.client, 'sucursal-1', 'live')).items.some(
        (p) => p.id === 'happy-hour',
      ),
    ).toBe(false);
  });

  it('desactivar una promoción la quita de ambas listas; la vigencia vencida (T3) también', async () => {
    const h = admin();
    await promotions.updateAdminPromotionStatus(h.client, 'fin-de-mes', { active: false });
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(live.items.map((p) => p.id)).toEqual(['bienvenida']);
    h.clock.set(at('2027-01-01', '00:00')); // `endsAt` del Happy Hour (exclusivo)
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'upcoming');
    expect(up.items).toEqual([]);
  });

  it('escenario promotion-expired: ninguna vigente ni próxima', async () => {
    const h = createHarness('promotion-expired');
    for (const state of ['live', 'upcoming'] as const) {
      expect((await promotions.listStorePromotions(h.client, 'sucursal-1', state)).items).toEqual(
        [],
      );
    }
  });

  it('errores: 400 sin `branchId` o con `state` desconocido; 404 BRANCH_NOT_FOUND (inexistente o inactiva)', async () => {
    const h = createHarness();
    expect(await failure(h.client.get('/v1/store/promotions'))).toMatchObject({ status: 400 });
    expect(
      await failure(
        h.client.get('/v1/store/promotions', { query: { branchId: 'sucursal-1', state: 'x' } }),
      ),
    ).toMatchObject({ status: 400 });
    expect(await failure(promotions.listStorePromotions(h.client, 'zzz'))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
      violations: undefined,
    });
    expect(await failure(promotions.listStorePromotions(h.client, 'sucursal-4'))).toMatchObject({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });
});

describe('admin: lectura (GET /v1/admin/promotions[/{id}])', () => {
  it('401 sin sesión y 403 sin `promotions.read` (el manager no lo tiene por defecto)', async () => {
    const h = createHarness();
    expect(await failure(promotions.listAdminPromotions(h.client))).toMatchObject({ status: 401 });
    h.asStaff('manager');
    expect(await failure(promotions.listAdminPromotions(h.client))).toMatchObject({ status: 403 });
    expect(await failure(promotions.getAdminPromotion(h.client, 'happy-hour'))).toMatchObject({
      status: 403,
    });
  });

  it('lista con ciclo de vida, `liveNow`, `editable`, `version` y orden `startsAt` desc, `id`', async () => {
    const h = admin();
    const page = await promotions.listAdminPromotions(h.client);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 6 });
    expect(page.items.map((p) => p.id)).toEqual([
      'navidad-rolls',
      'bienvenida',
      'combo-mon-2',
      'fin-de-mes',
      'semana-cliente',
      'happy-hour',
    ]);
    const by = (id: string) => page.items.find((p) => p.id === id)!;
    expect(by('happy-hour')).toMatchObject({
      lifecycle: 'RUNNING',
      liveNow: false,
      editable: true,
      version: 1,
    });
    expect(by('bienvenida')).toMatchObject({
      lifecycle: 'RUNNING',
      liveNow: true,
      code: 'BIENVENIDO10',
    });
    expect(by('navidad-rolls').lifecycle).toBe('SCHEDULED');
    expect(by('semana-cliente').lifecycle).toBe('EXPIRED');
    expect(by('combo-mon-2')).toMatchObject({
      lifecycle: 'INACTIVE',
      active: false,
      liveNow: false,
    });
    expect(by('fin-de-mes')).toMatchObject({
      branchScope: 'SELECTED',
      productScope: 'SELECTED',
      productCount: 4,
      scheduleCount: 0,
    });
    expect(by('fin-de-mes').branches.map((b) => b.id)).toEqual(['sucursal-1', 'sucursal-2']);
    expect(by('bienvenida').branches).toEqual([]);
  });

  it('el detalle trae productos con nombre y tramos ordenados', async () => {
    const h = admin();
    const d = await promotions.getAdminPromotion(h.client, 'happy-hour');
    expect(d.products.map((p) => p.name)).toContain('Dumplings');
    expect(d.products).toHaveLength(7);
    expect(d.schedule.map((s) => s.weekday)).toEqual([1, 2, 3, 4]);
    expect(await failure(promotions.getAdminPromotion(h.client, 'zzz'))).toEqual({
      status: 404,
      code: 'PROMOTION_NOT_FOUND',
      violations: undefined,
    });
  });

  it('filtros: estado, tipo, búsqueda (nombre/código, sin acentos ni mayúsculas), sucursal y fechas', async () => {
    const h = admin();
    const ids = async (f: promotions.AdminPromotionFilters) =>
      (await promotions.listAdminPromotions(h.client, f)).items.map((p) => p.id).sort();
    expect(await ids({ status: 'inactive' })).toEqual(['combo-mon-2']);
    expect(await ids({ status: 'active' })).toHaveLength(5);
    expect(await ids({ status: 'expired' })).toEqual(['semana-cliente']);
    expect(await ids({ status: 'scheduled' })).toEqual(['navidad-rolls']);
    expect(await ids({ status: 'running' })).toEqual(['bienvenida', 'fin-de-mes', 'happy-hour']);
    expect(await ids({ kind: 'FIXED_AMOUNT' })).toEqual(['combo-mon-2']);
    expect(await ids({ q: 'BIENVENIDO' })).toEqual(['bienvenida']);
    expect(await ids({ q: 'cupon de bienvenida' })).toEqual(['bienvenida']);
    expect(await ids({ q: 'nada-de-esto' })).toEqual([]);
    expect(await ids({ branchId: 'sucursal-3' })).not.toContain('fin-de-mes');
    expect(await ids({ branchId: 'sucursal-2' })).toContain('fin-de-mes');
    // Solapa con [from, to): solo la vencida termina antes del 2026-11-02.
    expect(await ids({ from: '2026-10-16T06:00:00Z', to: '2026-10-20T06:00:00Z' })).toEqual([
      'happy-hour',
      'semana-cliente',
    ]);
    expect(await ids({ from: '2027-02-01T06:00:00Z' })).toEqual([]);
  });

  it('paginación y orden', async () => {
    const h = admin();
    const p2 = await promotions.listAdminPromotions(h.client, {
      pageSize: 2,
      page: 2,
      sort: 'name',
      order: 'asc',
    });
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: 6 });
    expect(p2.items.map((p) => p.name)).toEqual(['Fin de mes: bebidas', 'Happy Hour']);
    const none = await promotions.listAdminPromotions(h.client, { page: 9, pageSize: 20 });
    expect(none.items).toEqual([]);
  });

  it('400 de forma en la consulta; 404 BRANCH_NOT_FOUND con sucursal inexistente', async () => {
    const h = admin();
    for (const query of [
      { pageSize: 101 },
      { page: 0 },
      { status: 'x' },
      { kind: 'PORCIENTO' },
      { sort: 'zz' },
      { order: 'up' },
      { from: '2026-11-01T00:00:00' }, // sin zona
      { from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' },
      { q: 'x'.repeat(81) },
    ]) {
      expect(
        await failure(h.client.get('/v1/admin/promotions', { query })),
        JSON.stringify(query),
      ).toMatchObject({ status: 400 });
    }
    expect(
      await failure(promotions.listAdminPromotions(h.client, { branchId: 'zzz' })),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('alcance por sucursal: ve las suyas y las `ALL`, con `branches` recortado y `editable=false` si no cubre todas', async () => {
    const h = scopedManager();
    const page = await promotions.listAdminPromotions(h.client);
    const by = (id: string) => page.items.find((p) => p.id === id)!;
    // `fin-de-mes` (sucursales 1 y 2): la ve, pero recortada a la 1 y no la puede editar.
    expect(by('fin-de-mes').branches.map((b) => b.id)).toEqual(['sucursal-1']);
    expect(by('fin-de-mes').editable).toBe(false);
    // `ALL` exige alcance global para escribir.
    expect(by('bienvenida').editable).toBe(false);
    expect(page.items.length).toBe(6);
    // Una promoción solo de la sucursal 2 no la ve (404, sin distinguir).
    h.store.promotions.find((p) => p.id === 'fin-de-mes')!.branchIds = ['sucursal-2'];
    expect(await failure(promotions.getAdminPromotion(h.client, 'fin-de-mes'))).toMatchObject({
      status: 404,
      code: 'PROMOTION_NOT_FOUND',
    });
    expect((await promotions.listAdminPromotions(h.client)).items.map((p) => p.id)).not.toContain(
      'fin-de-mes',
    );
    // Filtrar por una sucursal fuera de alcance: 404 BRANCH_NOT_FOUND.
    expect(
      await failure(promotions.listAdminPromotions(h.client, { branchId: 'sucursal-2' })),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
  });
});

describe('admin: alta (POST /v1/admin/promotions)', () => {
  it('crea con version 1, id nuevo, tramos ordenados y la ve la tienda', async () => {
    const h = admin();
    const created = await promotions.createAdminPromotion(h.client, {
      ...valid,
      schedule: [
        { weekday: 4, startsAt: '18:00', endsAt: '22:00' },
        { weekday: 2, startsAt: '12:00', endsAt: '14:00' },
      ],
    });
    expect(created).toMatchObject({
      id: 'promo-1',
      version: 1,
      active: true,
      code: null,
      lifecycle: 'RUNNING',
      branches: [{ id: 'sucursal-1', name: 'Sucursal 1' }],
      editable: true,
    });
    expect(created.schedule.map((s) => s.weekday)).toEqual([2, 4]);
    expect(created.createdAt).toBe(created.updatedAt);
    const up = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(up.items.some((p) => p.id === 'promo-1')).toBe(false); // jueves 18:00; ahora es miércoles
    h.clock.set(at('2026-11-12', '19:00'));
    const thu = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    const mine = thu.items.find((p) => p.id === 'promo-1')!;
    expect(mine).toMatchObject({ isHappyHour: true, kind: 'PERCENT', value: '15.00' });
  });

  it('`code` se normaliza (espacios y mayúsculas) y es único sin distinguir mayúsculas (409)', async () => {
    const h = admin();
    const coupon = await promotions.createAdminPromotion(h.client, {
      ...valid,
      code: ' nuevo-10 ',
    });
    expect(coupon.code).toBe('NUEVO-10');
    expect(
      await failure(promotions.createAdminPromotion(h.client, { ...valid, code: 'Nuevo-10' })),
    ).toMatchObject({ status: 409, code: 'PROMOTION_CODE_TAKEN' });
    expect(
      await failure(promotions.createAdminPromotion(h.client, { ...valid, code: 'bienvenido10' })),
    ).toMatchObject({ status: 409, code: 'PROMOTION_CODE_TAKEN' });
    // Varias automáticas (`code` null) conviven.
    await promotions.createAdminPromotion(h.client, valid);
    await promotions.createAdminPromotion(h.client, { ...valid, code: null });
    expect(h.store.promotions.filter((p) => p.code === null).length).toBeGreaterThan(2);
  });

  it('400 de forma: campos desconocidos, faltantes, tipos, `value` sin 2 decimales, instante sin zona, `kind` desconocido', async () => {
    const h = admin();
    const post = (body: unknown) => failure(h.client.post('/v1/admin/promotions', body));
    for (const [label, body] of Object.entries({
      desconocido: { ...valid, extra: 1 },
      faltaNombre: { ...valid, name: undefined },
      faltaAlcance: { ...valid, branchScope: undefined },
      nombreVacio: { ...valid, name: '   ' },
      nombreLargo: { ...valid, name: 'x'.repeat(121) },
      descripcionLarga: { ...valid, description: 'x'.repeat(501) },
      codigoCorto: { ...valid, code: 'ab' },
      codigoInvalido: { ...valid, code: 'con espacio' },
      kind: { ...valid, kind: '2x1' },
      valorEntero: { ...valid, value: '15' },
      valorNumero: { ...valid, value: 15 },
      sinZona: { ...valid, startsAt: '2026-11-01T00:00:00' },
      branchIdsConAll: { ...valid, branchScope: 'ALL' },
      selectedVacio: { ...valid, branchIds: [] },
      repetidos: { ...valid, branchIds: ['sucursal-1', 'sucursal-1'] },
      weekday0: { ...valid, schedule: [{ weekday: 0, startsAt: '15:00', endsAt: '18:00' }] },
      weekday8: { ...valid, schedule: [{ weekday: 8, startsAt: '15:00', endsAt: '18:00' }] },
      inicio24: { ...valid, schedule: [{ weekday: 1, startsAt: '24:00', endsAt: '24:00' }] },
      hora75: { ...valid, schedule: [{ weekday: 1, startsAt: '7:5', endsAt: '18:00' }] },
      dineIn: { ...valid, dineInOnly: 'si' },
      masDe42Tramos: {
        ...valid,
        schedule: Array.from({ length: 43 }, (_, i) => ({
          weekday: (i % 7) + 1,
          startsAt: `${String(Math.floor(i / 7)).padStart(2, '0')}:00`,
          endsAt: `${String(Math.floor(i / 7)).padStart(2, '0')}:30`,
        })),
      },
    })) {
      expect(await post(body), label).toMatchObject({ status: 400 });
    }
    expect(await failure(h.client.post('/v1/admin/promotions', [] as never))).toMatchObject({
      status: 400,
    });
  });

  it('422 PROMOTION_VALUE_INVALID: PERCENT > 100 o 0.00; FIXED_AMOUNT 0.00 o > 999999.99; 100.00 sí vale', async () => {
    const h = admin();
    const code = async (body: Partial<CreatePromotionRequest>) =>
      (await failure(promotions.createAdminPromotion(h.client, { ...valid, ...body }))).code;
    expect(await code({ value: '100.01' })).toBe('PROMOTION_VALUE_INVALID');
    expect(await code({ value: '0.00' })).toBe('PROMOTION_VALUE_INVALID');
    expect(await code({ kind: 'FIXED_AMOUNT', value: '0.00' })).toBe('PROMOTION_VALUE_INVALID');
    expect(
      (await promotions.createAdminPromotion(h.client, { ...valid, value: '100.00' })).value,
    ).toBe('100.00');
    expect(
      (
        await promotions.createAdminPromotion(h.client, {
          ...valid,
          kind: 'FIXED_AMOUNT',
          value: '999999.99',
        })
      ).value,
    ).toBe('999999.99');
  });

  it('422 PROMOTION_PERIOD_INVALID cuando `endsAt <= startsAt`', async () => {
    const h = admin();
    for (const endsAt of [valid.startsAt, '2026-10-01T06:00:00.000Z']) {
      expect(
        await failure(promotions.createAdminPromotion(h.client, { ...valid, endsAt })),
      ).toMatchObject({ status: 422, code: 'PROMOTION_PERIOD_INVALID' });
    }
  });

  it('422 PROMOTION_SCHEDULE_INVALID con `violations` por tramo (T11, T12) y contiguos válidos', async () => {
    const h = admin();
    expect(
      await failure(
        promotions.createAdminPromotion(h.client, {
          ...valid,
          schedule: [
            { weekday: 1, startsAt: '18:00', endsAt: '15:00' },
            { weekday: 2, startsAt: '10:00', endsAt: '10:00' },
          ],
        }),
      ),
    ).toEqual({
      status: 422,
      code: 'PROMOTION_SCHEDULE_INVALID',
      violations: ['schedule[0]:SLOT_ENDS_BEFORE_START', 'schedule[1]:SLOT_ENDS_BEFORE_START'],
    });
    expect(
      (
        await failure(
          promotions.createAdminPromotion(h.client, {
            ...valid,
            schedule: [
              { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
              { weekday: 1, startsAt: '17:00', endsAt: '19:00' },
            ],
          }),
        )
      ).violations,
    ).toEqual(['schedule[1]:SLOT_OVERLAP']);
    const ok = await promotions.createAdminPromotion(h.client, {
      ...valid,
      schedule: [
        { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
        { weekday: 1, startsAt: '18:00', endsAt: '19:00' },
        { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
        { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
      ],
    });
    expect(ok.scheduleCount).toBe(4);
  });

  it('422 PROMOTION_SCOPE_INVALID: SELECTED sin productos o con inexistentes (`productIds[i]`); 400 si ALL trae productos', async () => {
    const h = admin();
    const err = (body: Partial<CreatePromotionRequest>) =>
      failure(promotions.createAdminPromotion(h.client, { ...valid, ...body }));
    expect(await err({ productScope: 'SELECTED' })).toMatchObject({
      status: 422,
      code: 'PROMOTION_SCOPE_INVALID',
    });
    expect(
      await err({ productScope: 'SELECTED', productIds: ['dumplings', 'nada', 'otra'] }),
    ).toMatchObject({
      code: 'PROMOTION_SCOPE_INVALID',
      violations: ['productIds[1]:PRODUCT_UNKNOWN', 'productIds[2]:PRODUCT_UNKNOWN'],
    });
    // `ALL` con ids es un error de FORMA (400), como `branchIds` con `ALL`.
    expect(await err({ productScope: 'ALL', productIds: ['dumplings'] })).toMatchObject({
      status: 400,
    });
    const ok = await promotions.createAdminPromotion(h.client, {
      ...valid,
      productScope: 'SELECTED',
      productIds: ['dumplings'],
    });
    expect(ok).toMatchObject({ productScope: 'SELECTED', productCount: 1 });
  });

  it('alcance de escritura: `ALL` exige alcance global (403); sucursal ajena o inexistente => 404 BRANCH_NOT_FOUND', async () => {
    const h = scopedManager();
    expect(
      await failure(
        promotions.createAdminPromotion(h.client, {
          ...valid,
          branchScope: 'ALL',
          branchIds: undefined,
        }),
      ),
    ).toMatchObject({ status: 403, code: 'PROMOTION_SCOPE_FORBIDDEN' });
    expect(
      await failure(
        promotions.createAdminPromotion(h.client, { ...valid, branchIds: ['sucursal-2'] }),
      ),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect(
      await failure(promotions.createAdminPromotion(h.client, { ...valid, branchIds: ['zzz'] })),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    const ok = await promotions.createAdminPromotion(h.client, valid);
    expect(ok.editable).toBe(true);
  });

  it('403 sin `promotions.create` aunque tenga `read`', async () => {
    const h = createHarness();
    h.store.roles.find((r) => r.code === 'manager')?.permissions.push('promotions.read');
    h.asStaff('manager', 'u2');
    expect(await failure(promotions.createAdminPromotion(h.client, valid))).toMatchObject({
      status: 403,
    });
  });

  it('503 PROMOTIONS_BUSY determinista y reintentable; no escribe', async () => {
    const h = admin();
    h.store.promotionsBusy = 1;
    expect(await failure(promotions.createAdminPromotion(h.client, valid))).toMatchObject({
      status: 503,
      code: 'PROMOTIONS_BUSY',
    });
    expect(h.store.promotions).toHaveLength(6);
    await promotions.createAdminPromotion(h.client, valid);
    expect(h.store.promotions).toHaveLength(7);
  });
});

describe('admin: edición (PATCH /v1/admin/promotions/{id}) y estado', () => {
  const create = async (
    h: TestHarness,
    over: Partial<CreatePromotionRequest> = {},
  ): Promise<AdminPromotion> => promotions.createAdminPromotion(h.client, { ...valid, ...over });

  it('parcial con `expectedVersion`: sube `version` en 1, conserva lo demás y rige de inmediato', async () => {
    const h = admin();
    const p = await create(h);
    const next = await promotions.updateAdminPromotion(h.client, p.id, {
      expectedVersion: 1,
      name: 'Jueves de sake y más',
      value: '20.00',
      schedule: [{ weekday: 3, startsAt: '12:00', endsAt: '24:00' }],
    });
    expect(next).toMatchObject({
      version: 2,
      name: 'Jueves de sake y más',
      value: '20.00',
      kind: 'PERCENT',
      branches: [{ id: 'sucursal-1', name: 'Sucursal 1' }],
      schedule: [{ weekday: 3, startsAt: '12:00', endsAt: '24:00' }],
    });
    expect(next.updatedAt >= next.createdAt).toBe(true);
    // Miércoles 14:25 cae en el nuevo tramo 12:00–24:00: ya rige en la tienda.
    const live = await promotions.listStorePromotions(h.client, 'sucursal-1', 'live');
    expect(live.items.find((x) => x.id === p.id)?.value).toBe('20.00');
  });

  it('`schedule: []` quita la restricción semanal; `code: null` la vuelve automática; `description: null`', async () => {
    const h = admin();
    const p = await create(h, { code: 'UNICO-1', description: 'Algo' });
    const next = await promotions.updateAdminPromotion(h.client, p.id, {
      expectedVersion: 1,
      schedule: [],
      code: null,
      description: null,
    });
    expect(next).toMatchObject({ code: null, description: null, scheduleCount: 0, schedule: [] });
  });

  it('sin cambios reales: 200 sin subir `version` ni tocar `updatedAt`', async () => {
    const h = admin();
    const p = await create(h);
    h.clock.advance(60_000);
    const same = await promotions.updateAdminPromotion(h.client, p.id, {
      expectedVersion: 1,
      name: p.name,
      branchScope: 'SELECTED',
      branchIds: ['sucursal-1'],
      schedule: p.schedule,
    });
    expect(same.version).toBe(1);
    expect(same.updatedAt).toBe(p.updatedAt);
  });

  it('409 PROMOTION_VERSION_CONFLICT con versión vieja: no guarda', async () => {
    const h = admin();
    const p = await create(h);
    await promotions.updateAdminPromotion(h.client, p.id, { expectedVersion: 1, name: 'A' });
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, p.id, { expectedVersion: 1, name: 'B' }),
      ),
    ).toMatchObject({ status: 409, code: 'PROMOTION_VERSION_CONFLICT' });
    expect((await promotions.getAdminPromotion(h.client, p.id)).name).toBe('A');
  });

  it('409 PROMOTION_CODE_TAKEN al cambiar a un código ajeno; el propio no choca', async () => {
    const h = admin();
    const p = await create(h, { code: 'MIO-1' });
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, p.id, {
          expectedVersion: 1,
          code: 'bienvenido10',
        }),
      ),
    ).toMatchObject({ status: 409, code: 'PROMOTION_CODE_TAKEN' });
    const same = await promotions.updateAdminPromotion(h.client, p.id, {
      expectedVersion: 1,
      code: 'mio-1',
      name: 'Otro nombre',
    });
    expect(same.code).toBe('MIO-1');
  });

  it('las reglas se validan sobre el estado RESULTANTE (cambiar `kind` revalida `value`)', async () => {
    const h = admin();
    const p = await create(h, { kind: 'FIXED_AMOUNT', value: '150.00' });
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, p.id, { expectedVersion: 1, kind: 'PERCENT' }),
      ),
    ).toMatchObject({ status: 422, code: 'PROMOTION_VALUE_INVALID' });
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, p.id, {
          expectedVersion: 1,
          endsAt: valid.startsAt,
        }),
      ),
    ).toMatchObject({ status: 422, code: 'PROMOTION_PERIOD_INVALID' });
    // Pasar a ALL con productos de antes sin ids: ok; SELECTED sin ids nuevos y sin previos: 422.
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, p.id, {
          expectedVersion: 1,
          productScope: 'SELECTED',
        }),
      ),
    ).toMatchObject({ status: 422, code: 'PROMOTION_SCOPE_INVALID' });
  });

  it('400: sin `expectedVersion`, sin campos, con `active` (usa /status) o con campos desconocidos', async () => {
    const h = admin();
    const p = await create(h);
    const patch = (body: unknown) => failure(h.client.patch(`/v1/admin/promotions/${p.id}`, body));
    expect(await patch({ name: 'x' })).toMatchObject({ status: 400 });
    expect(await patch({ expectedVersion: 1 })).toMatchObject({ status: 400 });
    expect(await patch({ expectedVersion: 1, active: false })).toMatchObject({ status: 400 });
    expect(await patch({ expectedVersion: 1, foo: 1 })).toMatchObject({ status: 400 });
    expect(await patch({ expectedVersion: 0, name: 'x' })).toMatchObject({ status: 400 });
    expect(
      await patch({ expectedVersion: 1, branchScope: 'ALL', branchIds: ['sucursal-1'] }),
    ).toMatchObject({
      status: 400,
    });
  });

  it('403 `promotions.update` ausente; 404 inexistente; 403 PROMOTION_SCOPE_FORBIDDEN si no cubre todas', async () => {
    const h = scopedManager();
    // `fin-de-mes` (sucursales 1 y 2): la toca pero no la cubre entera.
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, 'fin-de-mes', { expectedVersion: 1, name: 'x' }),
      ),
    ).toMatchObject({ status: 403, code: 'PROMOTION_SCOPE_FORBIDDEN' });
    expect(
      await failure(
        promotions.updateAdminPromotionStatus(h.client, 'bienvenida', { active: false }),
      ),
    ).toMatchObject({ status: 403, code: 'PROMOTION_SCOPE_FORBIDDEN' });
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, 'zzz', { expectedVersion: 1, name: 'x' }),
      ),
    ).toMatchObject({ status: 404, code: 'PROMOTION_NOT_FOUND' });
    // Propia (solo sucursal 1): puede editarla; ampliarla a una sucursal fuera de su alcance => 404.
    const mine = await promotions.createAdminPromotion(h.client, valid);
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, mine.id, {
          expectedVersion: 1,
          branchIds: ['sucursal-1', 'sucursal-2'],
        }),
      ),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect(
      await failure(
        promotions.updateAdminPromotion(h.client, mine.id, {
          expectedVersion: 1,
          branchScope: 'ALL',
        }),
      ),
    ).toMatchObject({ status: 403, code: 'PROMOTION_SCOPE_FORBIDDEN' });
    const ok = await promotions.updateAdminPromotion(h.client, mine.id, {
      expectedVersion: 1,
      name: 'Mía',
    });
    expect(ok.version).toBe(2);
  });

  it('estado: idempotente, sin `expectedVersion`, sube `version` solo si cambia; reactivar una vencida es válido', async () => {
    const h = admin();
    const off = await promotions.updateAdminPromotionStatus(h.client, 'fin-de-mes', {
      active: false,
      reason: 'Pausa',
    });
    expect(off).toMatchObject({ active: false, lifecycle: 'INACTIVE', version: 2 });
    const again = await promotions.updateAdminPromotionStatus(h.client, 'fin-de-mes', {
      active: false,
    });
    expect(again.version).toBe(2);
    expect(again.updatedAt).toBe(off.updatedAt);
    const on = await promotions.updateAdminPromotionStatus(h.client, 'fin-de-mes', {
      active: true,
    });
    expect(on).toMatchObject({ active: true, lifecycle: 'RUNNING', version: 3 });
    const expired = await promotions.updateAdminPromotionStatus(h.client, 'semana-cliente', {
      active: false,
    });
    const reactivated = await promotions.updateAdminPromotionStatus(h.client, 'semana-cliente', {
      active: true,
    });
    expect(expired.lifecycle).toBe('INACTIVE');
    expect(reactivated.lifecycle).toBe('EXPIRED'); // sigue vencida
  });

  it('estado: 400 (sin `active`, no booleano, `reason` largo, campos extra) y 503', async () => {
    const h = admin();
    const patch = (body: unknown) =>
      failure(h.client.patch('/v1/admin/promotions/fin-de-mes/status', body));
    expect(await patch({})).toMatchObject({ status: 400 });
    expect(await patch({ active: 'no' })).toMatchObject({ status: 400 });
    expect(await patch({ active: false, reason: 'x'.repeat(201) })).toMatchObject({ status: 400 });
    expect(await patch({ active: false, extra: 1 })).toMatchObject({ status: 400 });
    h.store.promotionsBusy = 1;
    expect(await patch({ active: false })).toMatchObject({ status: 503, code: 'PROMOTIONS_BUSY' });
    expect((await promotions.getAdminPromotion(h.client, 'fin-de-mes')).active).toBe(true);
  });
});
