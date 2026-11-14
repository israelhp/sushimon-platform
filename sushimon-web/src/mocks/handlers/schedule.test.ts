import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { BranchHoursDay } from '@/lib/data-access/models';
import * as svc from '@/services/branch-schedule';
import { createHarness } from '../testing';

async function fail(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

const iv = (opensAt: string, closesAt: string) => ({ opensAt, closesAt });
const withDay = (days: BranchHoursDay[], weekday: number, intervals: ReturnType<typeof iv>[]) =>
  days.map((d) => (d.weekday === weekday ? { ...d, intervals } : d));
const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};

describe('F08 público: horario y disponibilidad', () => {
  it('horario semanal: 7 días ISO, zona y cierres próximos SIN motivo', async () => {
    const h = createHarness();
    const hours = await svc.getBranchHours(h.client, 'sucursal-1');
    expect(hours.timezone).toBe('America/Guatemala');
    expect(hours.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(hours.days[0]!.intervals).toEqual([iv('12:00', '22:00')]);
    // cierre-1 empieza dentro de 30 días; cierre-2 (pasado) no aparece
    expect(hours.upcomingClosures).toEqual([
      { startsAt: '2026-11-18T18:00:00.000Z', endsAt: '2026-11-18T22:00:00.000Z' },
    ]);
    expect(JSON.stringify(hours)).not.toMatch(/reason|Mantenimiento/);
  });

  it('sucursal con turno nocturno dividido y día sin atención', async () => {
    const h = createHarness();
    const s2 = await svc.getBranchHours(h.client, 'sucursal-2');
    expect(s2.days[5]!.intervals).toEqual([iv('00:00', '01:00'), iv('12:00', '24:00')]);
    const s3 = await svc.getBranchHours(h.client, 'sucursal-3');
    expect(s3.days[0]!.intervals).toEqual([]);
  });

  it('inexistente o inactiva => 404 (INACTIVE nunca se expone por HTTP)', async () => {
    const h = createHarness();
    expect((await fail(svc.getBranchHours(h.client, 'nope'))).status).toBe(404);
    expect((await fail(svc.getBranchHours(h.client, 'sucursal-4'))).status).toBe(404);
    expect((await fail(svc.getBranchAvailability(h.client, 'sucursal-4'))).status).toBe(404);
  });

  it('disponibilidad con el reloj del servidor (miércoles 14:25 = abierta)', async () => {
    const h = createHarness();
    const a = await svc.getBranchAvailability(h.client, 'sucursal-1');
    expect(a).toMatchObject({
      timezone: 'America/Guatemala',
      serverTime: '2026-11-11T20:25:00.000Z',
      isOpenNow: true,
      isAcceptingOrders: true,
      reason: 'OPEN',
      nextOpensAt: null,
      nextClosesAt: '2026-11-12T04:00:00.000Z',
      nextTransitionAt: '2026-11-12T04:00:00.000Z',
    });
    h.clock.set('2026-11-12T04:00:00.000Z'); // 22:00 local: cierra (fin excluido)
    expect(await svc.getBranchAvailability(h.client, 'sucursal-1')).toMatchObject({
      reason: 'OUTSIDE_BUSINESS_HOURS',
      isOpenNow: false,
      nextOpensAt: '2026-11-12T18:00:00.000Z',
    });
  });

  it('lunes: sucursal-3 cierra ese día; sucursal-2 abre sábado de madrugada', async () => {
    const h = createHarness();
    h.clock.set('2026-11-16T18:00:00.000Z'); // lunes 12:00 local
    expect((await svc.getBranchAvailability(h.client, 'sucursal-3')).reason).toBe(
      'OUTSIDE_BUSINESS_HOURS',
    );
    expect((await svc.getBranchAvailability(h.client, 'sucursal-3')).nextOpensAt).toBe(
      '2026-11-17T18:00:00.000Z',
    );
    h.clock.set('2026-11-21T06:30:00.000Z'); // sábado 00:30 local
    expect((await svc.getBranchAvailability(h.client, 'sucursal-2')).isOpenNow).toBe(true);
  });

  it('escenario branch-closed: cierre extraordinario en curso, sin motivo público', async () => {
    const h = createHarness('branch-closed');
    const a = await svc.getBranchAvailability(h.client, 'sucursal-1');
    expect(a).toMatchObject({
      reason: 'EXCEPTIONAL_CLOSURE',
      isOpenNow: false,
      isAcceptingOrders: false,
    });
    expect(a.nextOpensAt).toBe('2026-11-12T19:00:00.000Z');
    expect(JSON.stringify(await svc.getBranchHours(h.client, 'sucursal-1'))).not.toMatch(
      /Escenario de prueba/,
    );
  });
});

describe('F08 admin: horario semanal', () => {
  it('GET devuelve la version (SHA-256 hex) y los 7 días', async () => {
    const h = admin();
    const w = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    expect(w.version).toMatch(/^[0-9a-f]{64}$/);
    expect(w.days).toHaveLength(7);
    // semana vacía = hash de la cadena vacía
    const empty = await svc.getAdminBranchHours(h.client, 'sucursal-4');
    expect(empty.version).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('PUT guarda, cambia la versión y se refleja en lo público; sin cambios es idempotente', async () => {
    const h = admin();
    const before = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    const days = withDay(before.days, 7, [iv('10:00', '14:00'), iv('18:00', '22:00')]);
    const saved = await svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
      expectedVersion: before.version,
      days,
    });
    expect(saved.version).not.toBe(before.version);
    expect(saved.days[6]!.intervals).toEqual([iv('10:00', '14:00'), iv('18:00', '22:00')]);
    expect((await svc.getBranchHours(h.client, 'sucursal-1')).days[6]!.intervals).toHaveLength(2);
    const again = await svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
      expectedVersion: saved.version,
      days,
    });
    expect(again.version).toBe(saved.version);
  });

  it('dos PUT con la misma versión: el segundo => 409 HOURS_VERSION_CONFLICT sin guardar', async () => {
    const h = admin();
    const v0 = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    await svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
      expectedVersion: v0.version,
      days: withDay(v0.days, 1, [iv('13:00', '20:00')]),
    });
    const e = await fail(
      svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
        expectedVersion: v0.version,
        days: withDay(v0.days, 2, []),
      }),
    );
    expect(e).toMatchObject({ status: 409, businessCode: 'HOURS_VERSION_CONFLICT' });
    const now = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    expect(now.days[1]!.intervals).toHaveLength(1); // el martes no se tocó
  });

  it('422 SCHEDULE_INVALID con violations por día/intervalo (solape y rango)', async () => {
    const h = admin();
    const v = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    let days = withDay(v.days, 5, [iv('11:00', '15:00'), iv('14:00', '18:00')]);
    days = withDay(days, 6, [iv('18:00', '02:00')]);
    const e = await fail(
      svc.replaceAdminBranchHours(h.client, 'sucursal-1', { expectedVersion: v.version, days }),
    );
    expect(e).toMatchObject({ status: 422, businessCode: 'SCHEDULE_INVALID' });
    expect(e.violations).toEqual([
      {
        path: 'days[4].intervals[1]',
        code: 'INTERVAL_OVERLAP',
        message: 'Se solapa con days[4].intervals[0] (11:00-15:00)',
      },
      expect.objectContaining({ path: 'days[5].intervals[0]', code: 'INTERVAL_RANGE_INVALID' }),
    ]);
  });

  it('400 por forma (formato, >6 intervalos, días repetidos, versión malformada)', async () => {
    const h = admin();
    const v = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    const bad = (input: unknown) =>
      fail(svc.replaceAdminBranchHours(h.client, 'sucursal-1', input as never));
    expect(
      (await bad({ expectedVersion: v.version, days: withDay(v.days, 1, [iv('9:00', '12:00')]) }))
        .status,
    ).toBe(400);
    expect((await bad({ expectedVersion: 'abc', days: v.days })).details?.join()).toMatch(
      /expectedVersion/,
    );
    expect((await bad({ expectedVersion: v.version, days: v.days.slice(0, 6) })).status).toBe(400);
    const seven = Array.from({ length: 7 }, (_, k) =>
      iv(`${String(k * 3).padStart(2, '0')}:00`, `${String(k * 3 + 1).padStart(2, '0')}:00`),
    );
    expect(
      (await bad({ expectedVersion: v.version, days: withDay(v.days, 3, seven) })).status,
    ).toBe(400);
  });

  it('semana vacía es válida y deja SCHEDULE_NOT_CONFIGURED', async () => {
    const h = admin();
    const v = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    await svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
      expectedVersion: v.version,
      days: v.days.map((d) => ({ ...d, intervals: [] })),
    });
    expect((await svc.getBranchAvailability(h.client, 'sucursal-1')).reason).toBe(
      'SCHEDULE_NOT_CONFIGURED',
    );
  });

  it('se puede preparar el horario de una sucursal inactiva', async () => {
    const h = admin();
    const v = await svc.getAdminBranchHours(h.client, 'sucursal-4');
    const saved = await svc.replaceAdminBranchHours(h.client, 'sucursal-4', {
      expectedVersion: v.version,
      days: v.days.map((d) => ({ ...d, intervals: [iv('12:00', '22:00')] })),
    });
    expect(saved.days.every((d) => d.intervals.length === 1)).toBe(true);
  });
});

describe('F08 admin: permisos y alcance', () => {
  it('sin sesión 401; sin permiso 403 (manager lee pero no edita)', async () => {
    const h = createHarness();
    expect((await fail(svc.getAdminBranchHours(h.client, 'sucursal-1'))).status).toBe(401);
    h.asStaff('kitchen');
    expect((await fail(svc.getAdminBranchHours(h.client, 'sucursal-1'))).status).toBe(403);
    h.asStaff('manager');
    const own = (await svc.getAdminBranchHours(h.client, 'sucursal-1')).version;
    const e = await fail(
      svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
        expectedVersion: own,
        days: [] as never,
      }),
    );
    expect(e.status).toBe(403);
    expect(
      (
        await fail(
          svc.createAdminBranchClosure(h.client, 'sucursal-1', {
            startsAt: '2026-12-01T10:00:00Z',
            endsAt: '2026-12-01T12:00:00Z',
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('otra sucursal fuera de alcance => 404 (no se revela)', async () => {
    const h = createHarness();
    h.asStaff('manager');
    expect((await fail(svc.getAdminBranchHours(h.client, 'sucursal-3'))).status).toBe(404);
    expect((await fail(svc.listAdminBranchClosures(h.client, 'sucursal-3'))).status).toBe(404);
    // con manage_hours concedido solo a su sucursal, tampoco puede editar otra
    h.store.roles.find((r) => r.code === 'manager')!.permissions.push('branches.manage_hours');
    const e = await fail(
      svc.createAdminBranchClosure(h.client, 'sucursal-3', {
        startsAt: '2026-12-01T10:00:00Z',
        endsAt: '2026-12-01T12:00:00Z',
      }),
    );
    expect(e.status).toBe(404);
  });
});

describe('F08 admin: cierres', () => {
  const create = (
    h: ReturnType<typeof admin>,
    startsAt: string,
    endsAt: string,
    extra: object = {},
  ) => svc.createAdminBranchClosure(h.client, 'sucursal-1', { startsAt, endsAt, ...extra });

  it('lista: current (activos + futuros) por defecto, past descendente, motivo incluido', async () => {
    const h = admin();
    const cur = await svc.listAdminBranchClosures(h.client, 'sucursal-1');
    expect(cur.items.map((c) => [c.id, c.status])).toEqual([['cierre-1', 'upcoming']]);
    expect(cur.items[0]!.reason).toBe('Mantenimiento de campana extractora');
    const past = await svc.listAdminBranchClosures(h.client, 'sucursal-1', { status: 'past' });
    expect(past.items.map((c) => c.id)).toEqual(['cierre-2']);
    const all = await svc.listAdminBranchClosures(h.client, 'sucursal-1', { status: 'all' });
    expect(all.items.map((c) => c.id)).toEqual(['cierre-1', 'cierre-2']);
    expect(all.total).toBe(2);
    expect(
      (await fail(svc.listAdminBranchClosures(h.client, 'sucursal-1', { status: 'x' as never })))
        .status,
    ).toBe(400);
  });

  it('crea (normaliza offset a UTC y trunca al segundo) y calcula el estado con el reloj del servidor', async () => {
    const h = admin();
    const c = await create(h, '2026-12-01T10:00:30.900-06:00', '2026-12-01T12:00:00-06:00', {
      reason: '  Feriado  ',
    });
    expect(c).toMatchObject({
      startsAt: '2026-12-01T16:00:30.000Z',
      endsAt: '2026-12-01T18:00:00.000Z',
      reason: 'Feriado',
      status: 'upcoming',
    });
    // empieza ya: cierre de emergencia en curso
    const live = await create(h, '2026-11-11T20:00:00Z', '2026-11-11T23:00:00Z');
    expect(live.status).toBe('active');
    expect((await svc.getBranchAvailability(h.client, 'sucursal-1')).reason).toBe(
      'EXCEPTIONAL_CLOSURE',
    );
  });

  it('400: instantes sin zona o motivo demasiado largo', async () => {
    const h = admin();
    expect((await fail(create(h, '2026-12-01T10:00:00', '2026-12-01T12:00:00Z'))).status).toBe(400);
    expect(
      (
        await fail(
          create(h, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z', { reason: 'x'.repeat(201) }),
        )
      ).details?.join(),
    ).toMatch(/reason/);
  });

  it('422 CLOSURE_RANGE_INVALID: vacío, duración, horizonte y ya terminado', async () => {
    const h = admin();
    const codes = async (s: string, e: string) =>
      (await fail(create(h, s, e))).violations?.map((v) => v.code);
    expect(await codes('2026-12-01T10:00:00Z', '2026-12-01T10:00:00Z')).toEqual(['RANGE_EMPTY']);
    expect(await codes('2026-12-01T10:00:00Z', '2027-12-03T10:00:00Z')).toEqual([
      'DURATION_EXCEEDED',
    ]);
    expect(await codes('2029-12-01T10:00:00Z', '2029-12-02T10:00:00Z')).toEqual(['STARTS_TOO_FAR']);
    expect(await codes('2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z')).toEqual([
      'STARTS_TOO_EARLY',
      'ALREADY_ENDED',
    ]);
    expect(
      (await fail(create(h, '2026-12-01T10:00:00Z', '2026-12-01T10:00:00Z'))).businessCode,
    ).toBe('CLOSURE_RANGE_INVALID');
  });

  it('409 CLOSURE_OVERLAP; contiguos permitidos', async () => {
    const h = admin();
    const e = await fail(create(h, '2026-11-18T20:00:00Z', '2026-11-18T23:00:00Z')); // solapa cierre-1
    expect(e).toMatchObject({ status: 409, businessCode: 'CLOSURE_OVERLAP' });
    expect(e.violations?.[0]?.path).toBe('closures/cierre-1');
    // contiguo: empieza justo cuando termina cierre-1
    expect((await create(h, '2026-11-18T22:00:00Z', '2026-11-18T23:00:00Z')).status).toBe(
      'upcoming',
    );
  });

  it('PATCH futuro: edita rango y motivo; no puede solaparse con otro', async () => {
    const h = admin();
    const c = await create(h, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z');
    const upd = await svc.updateAdminBranchClosure(h.client, 'sucursal-1', c.id, {
      endsAt: '2026-12-02T12:00:00Z',
      reason: null,
    });
    expect(upd).toMatchObject({ endsAt: '2026-12-02T12:00:00.000Z', reason: null });
    const e = await fail(
      svc.updateAdminBranchClosure(h.client, 'sucursal-1', c.id, {
        startsAt: '2026-11-18T19:00:00Z',
      }),
    );
    expect(e).toMatchObject({ status: 409, businessCode: 'CLOSURE_OVERLAP' });
    expect(
      (await fail(svc.updateAdminBranchClosure(h.client, 'sucursal-1', c.id, {}))).status,
    ).toBe(400);
  });

  describe('cierre en curso', () => {
    it('solo se acorta el fin; alargar o cambiar inicio => 409 CLOSURE_NOT_EDITABLE', async () => {
      const h = admin();
      const live = await create(h, '2026-11-11T20:00:00Z', '2026-11-11T23:00:00Z');
      const short = await svc.updateAdminBranchClosure(h.client, 'sucursal-1', live.id, {
        endsAt: '2026-11-11T22:00:00Z',
        reason: 'ajustado',
      });
      expect(short).toMatchObject({
        endsAt: '2026-11-11T22:00:00.000Z',
        reason: 'ajustado',
        status: 'active',
      });
      for (const input of [
        { endsAt: '2026-11-11T23:30:00Z' },
        { startsAt: '2026-11-11T19:30:00Z' },
      ]) {
        expect(
          await fail(svc.updateAdminBranchClosure(h.client, 'sucursal-1', live.id, input)),
        ).toMatchObject({ status: 409, businessCode: 'CLOSURE_NOT_EDITABLE' });
      }
    });

    it('terminar ahora: PATCH endsAt <= ahora lo fija a «ahora» y la sucursal vuelve a abrir', async () => {
      const h = admin();
      const live = await create(h, '2026-11-11T20:00:00Z', '2026-11-11T23:00:00Z');
      const ended = await svc.updateAdminBranchClosure(h.client, 'sucursal-1', live.id, {
        endsAt: '2026-11-11T19:00:00Z',
      });
      expect(ended).toMatchObject({ endsAt: '2026-11-11T20:25:00.000Z', status: 'past' });
      expect((await svc.getBranchAvailability(h.client, 'sucursal-1')).reason).toBe('OPEN');
    });

    it('si «ahora» coincide con el inicio => 422 RANGE_EMPTY (el reintento posterior funciona)', async () => {
      const h = admin();
      const live = await create(h, '2026-11-11T20:25:00Z', '2026-11-11T23:00:00Z');
      const e = await fail(
        svc.updateAdminBranchClosure(h.client, 'sucursal-1', live.id, {
          endsAt: '2026-11-11T20:00:00Z',
        }),
      );
      expect(e).toMatchObject({ status: 422, businessCode: 'CLOSURE_RANGE_INVALID' });
      h.clock.advance(5_000);
      expect(
        (
          await svc.updateAdminBranchClosure(h.client, 'sucursal-1', live.id, {
            endsAt: '2026-11-11T20:00:00Z',
          })
        ).status,
      ).toBe('past');
    });
  });

  it('terminado: inmutable (409 en PATCH y DELETE)', async () => {
    const h = admin();
    const patch = await fail(
      svc.updateAdminBranchClosure(h.client, 'sucursal-1', 'cierre-2', { reason: 'x' }),
    );
    expect(patch).toMatchObject({ status: 409, businessCode: 'CLOSURE_NOT_EDITABLE' });
    const del = await fail(svc.deleteAdminBranchClosure(h.client, 'sucursal-1', 'cierre-2'));
    expect(del).toMatchObject({ status: 409, businessCode: 'CLOSURE_NOT_DELETABLE' });
  });

  it('DELETE: futuro se elimina (204); en curso => 409; inexistente/otra sucursal => 404', async () => {
    const h = admin();
    await svc.deleteAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1');
    expect(
      (await svc.listAdminBranchClosures(h.client, 'sucursal-1', { status: 'all' })).items.map(
        (c) => c.id,
      ),
    ).toEqual(['cierre-2']);
    const live = await create(h, '2026-11-11T20:00:00Z', '2026-11-11T23:00:00Z');
    expect(await fail(svc.deleteAdminBranchClosure(h.client, 'sucursal-1', live.id))).toMatchObject(
      { status: 409, businessCode: 'CLOSURE_NOT_DELETABLE' },
    );
    expect((await fail(svc.deleteAdminBranchClosure(h.client, 'sucursal-1', 'nope'))).status).toBe(
      404,
    );
    expect(
      (await fail(svc.deleteAdminBranchClosure(h.client, 'sucursal-2', 'cierre-1'))).status,
    ).toBe(404);
  });

  it('paginación', async () => {
    const h = admin();
    const page = await svc.listAdminBranchClosures(h.client, 'sucursal-1', {
      status: 'all',
      page: 2,
      pageSize: 1,
    });
    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(page.items).toHaveLength(1);
  });
});

describe('F08 ronda de correcciones: STARTS_TOO_EARLY, CLOSURE_LIMIT_REACHED y BRANCH_SCHEDULE_BUSY', () => {
  const create = (h: ReturnType<typeof admin>, startsAt: string, endsAt: string) =>
    svc.createAdminBranchClosure(h.client, 'sucursal-1', { startsAt, endsAt });

  it('startsAt no puede ser anterior a ahora − 1 h (límite exacto permitido)', async () => {
    const h = admin(); // ahora = 20:25:00Z
    expect((await create(h, '2026-11-11T19:25:00Z', '2026-11-11T21:00:00Z')).status).toBe('active');
    const e = await fail(create(h, '2026-11-11T19:24:59Z', '2026-11-11T21:00:00Z'));
    expect(e).toMatchObject({ status: 422, businessCode: 'CLOSURE_RANGE_INVALID' });
    expect(e.violations?.map((v) => [v.path, v.code])).toEqual([['startsAt', 'STARTS_TOO_EARLY']]);
  });

  it('el PATCH de un cierre futuro también valida STARTS_TOO_EARLY; el de uno en curso no mueve startsAt', async () => {
    const h = admin();
    const e = await fail(
      svc.updateAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1', {
        startsAt: '2026-11-11T19:00:00Z',
      }),
    );
    expect(e.violations?.map((v) => v.code)).toEqual(['STARTS_TOO_EARLY']);
    const ok = await svc.updateAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1', {
      startsAt: '2026-11-11T19:30:00Z',
    });
    expect(ok.startsAt).toBe('2026-11-11T19:30:00.000Z');
  });

  it('tope de 100 cierres con endsAt > ahora: el 101.º => 422 CLOSURE_LIMIT_REACHED; los terminados no cuentan', async () => {
    const h = admin();
    for (let i = 0; i < 99; i++) {
      const start = new Date(Date.UTC(2027, 0, 1) + i * 86_400_000);
      h.store.closures.push({
        id: `x-${i}`,
        branchId: 'sucursal-1',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
        reason: null,
      });
    }
    // 99 + cierre-1 = 100 vigentes/futuros; cierre-2 (terminado) no cuenta
    const e = await fail(create(h, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z'));
    expect(e).toMatchObject({ status: 422, businessCode: 'CLOSURE_LIMIT_REACHED' });
    await svc.deleteAdminBranchClosure(h.client, 'sucursal-1', 'x-0');
    expect((await create(h, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z')).status).toBe(
      'upcoming',
    );
    // otra sucursal no se ve afectada
    expect(
      (
        await svc.createAdminBranchClosure(h.client, 'sucursal-2', {
          startsAt: '2026-12-01T10:00:00Z',
          endsAt: '2026-12-01T12:00:00Z',
        })
      ).status,
    ).toBe('upcoming');
  });

  it('BRANCH_SCHEDULE_BUSY: 409 reintentable en PUT/POST/PATCH/DELETE, sin guardar nada', async () => {
    const busy = (h: ReturnType<typeof admin>) => {
      h.store.scheduleBusy = { 'sucursal-1': 1 };
    };
    // PUT
    let h = admin();
    const v = await svc.getAdminBranchHours(h.client, 'sucursal-1');
    const days = v.days.map((d) =>
      d.weekday === 1 ? { ...d, intervals: [iv('13:00', '20:00')] } : d,
    );
    busy(h);
    let e = await fail(
      svc.replaceAdminBranchHours(h.client, 'sucursal-1', { expectedVersion: v.version, days }),
    );
    expect(e).toMatchObject({ status: 409, businessCode: 'BRANCH_SCHEDULE_BUSY' });
    expect((await svc.getAdminBranchHours(h.client, 'sucursal-1')).version).toBe(v.version);
    expect(
      (
        await svc.replaceAdminBranchHours(h.client, 'sucursal-1', {
          expectedVersion: v.version,
          days,
        })
      ).version,
    ).not.toBe(v.version);
    // POST
    h = admin();
    busy(h);
    e = await fail(create(h, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z'));
    expect(e.businessCode).toBe('BRANCH_SCHEDULE_BUSY');
    expect((await svc.listAdminBranchClosures(h.client, 'sucursal-1')).total).toBe(1);
    expect((await create(h, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z')).status).toBe(
      'upcoming',
    );
    // PATCH
    h = admin();
    busy(h);
    e = await fail(
      svc.updateAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1', { reason: 'x' }),
    );
    expect(e.businessCode).toBe('BRANCH_SCHEDULE_BUSY');
    expect(
      (await svc.updateAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1', { reason: 'x' }))
        .reason,
    ).toBe('x');
    // DELETE
    h = admin();
    busy(h);
    e = await fail(svc.deleteAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1'));
    expect(e.businessCode).toBe('BRANCH_SCHEDULE_BUSY');
    await svc.deleteAdminBranchClosure(h.client, 'sucursal-1', 'cierre-1');
  });

  it('la ocupación simulada es por sucursal y determinista: sucursal-5 la trae sembrada una vez', async () => {
    const h = admin();
    expect(h.store.scheduleBusy).toEqual({ 'sucursal-5': 1 });
    const v = await svc.getAdminBranchHours(h.client, 'sucursal-5');
    const days = v.days.map((d) => ({ ...d, intervals: [iv('12:00', '22:00')] }));
    const first = await fail(
      svc.replaceAdminBranchHours(h.client, 'sucursal-5', { expectedVersion: v.version, days }),
    );
    expect(first.businessCode).toBe('BRANCH_SCHEDULE_BUSY');
    expect(
      (
        await svc.replaceAdminBranchHours(h.client, 'sucursal-5', {
          expectedVersion: v.version,
          days,
        })
      ).days[0]!.intervals,
    ).toHaveLength(1);
  });
});
