import { NotFoundException } from '@nestjs/common';
import { A, B, MISSING, scheduleHarness } from '../../test/support/schedule-harness.js';
import { normalizeHours } from './schedule-policy.js';

/** Semana S de la spec (lun-jue 11-15 y 15-22, vie 11-24, sáb 00-02 y 11-24, dom 00-02 y 12-21). */
const S = normalizeHours(
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    intervals:
      weekday <= 4
        ? [
            { opensAt: '11:00', closesAt: '15:00' },
            { opensAt: '15:00', closesAt: '22:00' },
          ]
        : weekday === 5
          ? [{ opensAt: '11:00', closesAt: '24:00' }]
          : weekday === 6
            ? [
                { opensAt: '00:00', closesAt: '02:00' },
                { opensAt: '11:00', closesAt: '24:00' },
              ]
            : [
                { opensAt: '00:00', closesAt: '02:00' },
                { opensAt: '12:00', closesAt: '21:00' },
              ],
  })),
);

const at = (iso: string) => new Date(iso);

describe('BranchAvailabilityService (puerto)', () => {
  it('sucursal inexistente => NotFoundException', async () => {
    const { availability } = scheduleHarness();
    await expect(
      availability.getAvailability({ branchId: MISSING, at: at('2026-11-16T17:00:00Z') }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('inactiva => INACTIVE sin consultar horarios ni cierres', async () => {
    const h = scheduleHarness();
    h.repo.addBranch(B, false).setHours(B, S);
    const r = await h.availability.getAvailability({ branchId: B, at: at('2026-11-16T17:00:00Z') });
    expect(r).toMatchObject({ reason: 'INACTIVE', isOpenNow: false, isAcceptingOrders: false });
    expect(h.repo.queries).toMatchObject({ loadSchedule: 1, readHours: 0 }); // una sola consulta, sin horarios
  });

  it('sin horario configurado => SCHEDULE_NOT_CONFIGURED (no se asume abierta)', async () => {
    const h = scheduleHarness();
    const r = await h.availability.getAvailability({ branchId: A, at: at('2026-11-16T17:00:00Z') });
    expect(r).toMatchObject({ reason: 'SCHEDULE_NOT_CONFIGURED', isOpenNow: false });
  });

  it('abierta: devuelve Dates, zona y transiciones; una consulta de horario y una de cierres', async () => {
    const h = scheduleHarness();
    h.repo.setHours(A, S);
    const r = await h.availability.getAvailability({
      branchId: A,
      at: at('2026-11-16T17:00:00.000Z'),
    });
    expect(r).toEqual({
      branchId: A,
      timezone: 'America/Guatemala',
      at: at('2026-11-16T17:00:00.000Z'),
      isOpenNow: true,
      isAcceptingOrders: true,
      reason: 'OPEN',
      nextOpensAt: null,
      nextClosesAt: at('2026-11-17T04:00:00.000Z'),
      nextTransitionAt: at('2026-11-17T04:00:00.000Z'),
    });
    expect(h.repo.queries).toMatchObject({ loadSchedule: 1, readHours: 0 }); // UNA consulta: estado + horario + cierres
  });

  it('cierre excepcional: reason y apertura al fin del cierre', async () => {
    const h = scheduleHarness();
    h.repo.setHours(A, S).addClosure(A, '2026-11-16T19:00:00Z', '2026-11-16T23:00:00Z', 'Evento');
    const r = await h.availability.getAvailability({ branchId: A, at: at('2026-11-16T19:00:00Z') });
    expect(r).toMatchObject({
      reason: 'EXCEPTIONAL_CLOSURE',
      nextOpensAt: at('2026-11-16T23:00:00Z'),
    });
  });

  it('cierres de OTRA sucursal no afectan', async () => {
    const h = scheduleHarness();
    h.repo.setHours(A, S).addClosure(B, '2026-11-16T19:00:00Z', '2026-11-16T23:00:00Z');
    const r = await h.availability.getAvailability({ branchId: A, at: at('2026-11-16T19:30:00Z') });
    expect(r.reason).toBe('OPEN');
  });

  it('`at` programado (pedido futuro) se evalúa tal cual, sin usar el reloj', async () => {
    const h = scheduleHarness('2030-01-01T00:00:00Z');
    h.repo.setHours(A, S);
    expect(
      await h.availability.canAcceptOrder({ branchId: A, at: at('2026-11-17T04:00:00Z') }),
    ).toEqual({
      accepted: false,
      reason: 'OUTSIDE_BUSINESS_HOURS',
      nextOpensAt: at('2026-11-17T17:00:00Z'),
    });
    expect(
      await h.availability.canAcceptOrder({ branchId: A, at: at('2026-11-17T03:59:59.999Z') }),
    ).toMatchObject({
      accepted: true,
      reason: 'OPEN',
    });
  });

  it('orderCutoffMinutes (extensión): sin valor por defecto; con valor deja de aceptar antes del cierre', async () => {
    const h = scheduleHarness();
    h.repo.setHours(A, S);
    const input = { branchId: A, at: at('2026-11-17T03:45:00Z') };
    expect(await h.availability.getAvailability(input)).toMatchObject({
      isOpenNow: true,
      isAcceptingOrders: true,
    });
    const cut = await h.availability.getAvailability({ ...input, orderCutoffMinutes: 30 });
    expect(cut).toMatchObject({ reason: 'OPEN', isOpenNow: true, isAcceptingOrders: false });
    for (const orderCutoffMinutes of [-1, 1441, Number.NaN]) {
      await expect(
        h.availability.getAvailability({ ...input, orderCutoffMinutes }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('`at` inválido o fuera de rango => error de dominio controlado (400 INVALID_AVAILABILITY_INPUT), no RangeError', async () => {
    const h = scheduleHarness();
    for (const bad of [
      new Date('x'),
      new Date('1999-12-31T23:59:59Z'),
      new Date('2100-01-01T00:00:00Z'),
    ]) {
      const e = await h.availability
        .getAvailability({ branchId: A, at: bad })
        .catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 400 });
      expect((e as { getResponse(): unknown }).getResponse()).toMatchObject({
        code: 'INVALID_AVAILABILITY_INPUT',
      });
    }
    await expect(
      h.availability.getAvailability({ branchId: A, at: 'ayer' as unknown as Date }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.repo.queries.loadSchedule).toBe(0); // se valida antes de ir a la BD
  });

  it('canAcceptOrderNow usa el reloj del servidor; getAvailabilityMany evalúa varias sucursales en UNA consulta', async () => {
    const h = scheduleHarness('2026-11-17T03:59:59.999Z');
    h.repo.setHours(A, S).setHours(B, []);
    expect(await h.availability.canAcceptOrderNow(A)).toMatchObject({
      accepted: true,
      reason: 'OPEN',
    });
    h.clock.set('2026-11-17T04:00:00.000Z');
    expect(await h.availability.canAcceptOrderNow(A)).toMatchObject({
      accepted: false,
      reason: 'OUTSIDE_BUSINESS_HOURS',
    });
    h.repo.queries.loadSchedule = 0;
    const many = await h.availability.getAvailabilityMany({
      branchIds: [A, B, A],
      at: at('2026-11-16T17:00:00Z'),
    });
    expect(many.map((r) => [r.branchId, r.reason])).toEqual([
      [A, 'OPEN'],
      [B, 'SCHEDULE_NOT_CONFIGURED'],
      [A, 'OPEN'],
    ]);
    expect(h.repo.queries.loadSchedule).toBe(1);
    await expect(
      h.availability.getAvailabilityMany({
        branchIds: [A, MISSING],
        at: at('2026-11-16T17:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('usa el cliente de transacción recibido (tx) en la lectura', async () => {
    const h = scheduleHarness();
    const spy = vi.spyOn(h.repo, 'loadSchedule');
    const tx = { marker: 1 } as never;
    await h.availability.canAcceptOrder({ branchId: A, at: at('2026-11-16T17:00:00Z'), tx });
    expect(spy.mock.calls[0]?.[3]).toEqual({ tx });
  });

  it('getPublic: reloj del servidor, ISO con ms, sin motivos de cierre; inactiva e inexistente => 404', async () => {
    const h = scheduleHarness('2026-11-16T17:00:00.000Z');
    h.repo.setHours(A, S).addBranch(B, false);
    const r = await h.availability.getPublic(A);
    expect(r).toEqual({
      branchId: A,
      timezone: 'America/Guatemala',
      serverTime: '2026-11-16T17:00:00.000Z',
      isOpenNow: true,
      isAcceptingOrders: true,
      reason: 'OPEN',
      nextOpensAt: null,
      nextClosesAt: '2026-11-17T04:00:00.000Z',
      nextTransitionAt: '2026-11-17T04:00:00.000Z',
    });
    await expect(h.availability.getPublic(B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.availability.getPublic(MISSING)).rejects.toBeInstanceOf(NotFoundException);
  });
});
