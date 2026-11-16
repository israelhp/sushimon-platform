import {
  analyzeTiming,
  HORIZON_MS,
  isInSchedule,
  isLive,
  lifecycleOf,
} from './promotion-schedule.js';
import type { ScheduleSlot } from './promotions.types.js';

const TZ = 'America/Guatemala';
/** Instante a partir de la hora local de Guatemala (UTC-6, sin horario de verano). */
const local = (iso: string): number => Date.parse(`${iso}-06:00`);
const D = (ms: number) => new Date(ms);
const slot = (weekday: number, startsAt: string, endsAt: string): ScheduleSlot => ({
  weekday,
  startsAt,
  endsAt,
});

const promo = (over: Partial<Parameters<typeof isLive>[0]> = {}) => ({
  startsAt: D(local('2026-01-01T00:00:00')),
  endsAt: D(local('2027-12-31T00:00:00')),
  active: true,
  schedule: [] as ScheduleSlot[],
  ...over,
});

// 2026-11-16 es lunes; 2026-11-20 viernes; 2026-11-21 sábado; 2026-11-15 domingo.
describe('vigencia y horario (T1-T15)', () => {
  const monday = promo({ schedule: [slot(1, '15:00', '18:00')] });

  it('T1: inicio inclusivo', () => {
    expect(isLive(monday, local('2026-11-16T15:00:00'), TZ)).toBe(true);
    expect(isLive(monday, local('2026-11-16T14:59:59'), TZ)).toBe(false);
  });

  it('T2: fin exclusivo del tramo', () => {
    expect(isLive(monday, local('2026-11-16T17:59:59'), TZ)).toBe(true);
    expect(isLive(monday, local('2026-11-16T18:00:00'), TZ)).toBe(false);
  });

  it('T3: ends_at exclusivo (EXPIRED)', () => {
    const p = promo({ endsAt: D(Date.parse('2026-12-31T06:00:00Z')) });
    expect(isLive(p, local('2026-12-30T23:59:59'), TZ)).toBe(true);
    expect(isLive(p, local('2026-12-31T00:00:00'), TZ)).toBe(false);
    expect(lifecycleOf(p, local('2026-12-31T00:00:00'))).toBe('EXPIRED');
    expect(lifecycleOf(p, local('2026-12-30T23:59:59'))).toBe('RUNNING');
  });

  it('T4: starts_at futuro por 1 s: no vigente, SCHEDULED y en próximas', () => {
    const now = local('2026-11-16T10:00:00');
    const p = promo({ startsAt: D(now + 1000) });
    expect(isLive(p, now, TZ)).toBe(false);
    expect(lifecycleOf(p, now)).toBe('SCHEDULED');
    const t = analyzeTiming(p, now, TZ);
    expect(t.live).toBe(false);
    expect(t.upcoming).toBe(true);
    expect(t.nextStartsAt).toBe(now + 1000);
  });

  it('T5: 2026-11-16T03:00:00Z es domingo 21:00 local (día ISO 7), no lunes', () => {
    const at = Date.parse('2026-11-16T03:00:00Z');
    expect(isInSchedule([slot(1, '00:00', '24:00')], at, TZ)).toBe(false);
    expect(isInSchedule([slot(7, '20:00', '22:00')], at, TZ)).toBe(true);
  });

  it('T6: 2026-11-16T06:00:00Z es lunes 00:00:00 local (día ISO 1)', () => {
    const at = Date.parse('2026-11-16T06:00:00Z');
    expect(isInSchedule([slot(1, '00:00', '01:00')], at, TZ)).toBe(true);
    expect(isInSchedule([slot(7, '00:00', '24:00')], at, TZ)).toBe(false);
  });

  const friSat = promo({ schedule: [slot(5, '22:00', '24:00'), slot(6, '00:00', '02:00')] });

  it('T7: franja que cruza la medianoche dividida en dos días', () => {
    expect(isLive(friSat, local('2026-11-20T23:59:59'), TZ)).toBe(true);
    expect(isLive(friSat, local('2026-11-21T00:00:00'), TZ)).toBe(true);
    expect(isLive(friSat, local('2026-11-21T01:59:59'), TZ)).toBe(true);
    expect(isLive(friSat, local('2026-11-21T02:00:00'), TZ)).toBe(false);
    expect(isLive(friSat, local('2026-11-20T21:59:59'), TZ)).toBe(false);
  });

  it('T8: nextEndsAt fusiona los tramos contiguos (sáb 02:00, no vie 24:00)', () => {
    const now = local('2026-11-20T23:00:00');
    const t = analyzeTiming(friSat, now, TZ);
    expect(t.live).toBe(true);
    expect(t.nextEndsAt).toBe(local('2026-11-21T02:00:00'));
    expect(t.nextChangeAt).toBe(local('2026-11-21T02:00:00'));
    // el siguiente inicio es el viernes siguiente, no medianoche
    expect(t.nextStartsAt).toBe(local('2026-11-27T22:00:00'));
  });

  it('T9: domingo 22:00-24:00 + lunes 00:00-01:00 (7 -> 1)', () => {
    const p = promo({ schedule: [slot(7, '22:00', '24:00'), slot(1, '00:00', '01:00')] });
    expect(isLive(p, local('2026-11-15T23:59:59'), TZ)).toBe(true);
    expect(isLive(p, local('2026-11-16T00:00:00'), TZ)).toBe(true);
    expect(isLive(p, local('2026-11-16T01:00:00'), TZ)).toBe(false);
    expect(analyzeTiming(p, local('2026-11-15T23:00:00'), TZ).nextEndsAt).toBe(
      local('2026-11-16T01:00:00'),
    );
  });

  it('T10: la vigencia corta el tramo en su instante exacto', () => {
    const p = promo({
      schedule: friSat.schedule,
      endsAt: D(local('2026-11-21T00:30:00')),
    });
    expect(isLive(p, local('2026-11-21T00:29:59'), TZ)).toBe(true);
    expect(isLive(p, local('2026-11-21T00:30:00'), TZ)).toBe(false);
    expect(analyzeTiming(p, local('2026-11-20T23:00:00'), TZ).nextEndsAt).toBe(
      local('2026-11-21T00:30:00'),
    );
  });

  it('T13: sin tramos rige todo el día dentro de la vigencia', () => {
    const p = promo();
    for (const at of ['2026-11-16T00:00:00', '2026-11-16T12:00:00', '2026-11-16T23:59:59']) {
      expect(isLive(p, local(at), TZ)).toBe(true);
    }
  });

  it('T14: la vigencia no consulta el horario de apertura (sin dependencia alguna de F08)', () => {
    // El módulo es puro: no recibe sucursal ni horarios; solo vigencia y tramos.
    expect(isLive(promo(), local('2026-11-16T03:00:00'), TZ)).toBe(true);
  });

  it('T15: inactiva nunca vigente y sin próximos cambios', () => {
    const p = promo({ active: false, schedule: [slot(1, '00:00', '24:00')] });
    expect(isLive(p, local('2026-11-16T10:00:00'), TZ)).toBe(false);
    expect(lifecycleOf(p, local('2026-11-16T10:00:00'))).toBe('INACTIVE');
    const t = analyzeTiming(p, local('2026-11-16T10:00:00'), TZ);
    expect(t).toEqual({
      live: false,
      upcoming: false,
      nextStartsAt: null,
      nextEndsAt: null,
      nextChangeAt: null,
    });
  });

  it('precedencia del ciclo de vida: INACTIVE > EXPIRED > SCHEDULED > RUNNING', () => {
    const now = local('2026-11-16T10:00:00');
    const expired = { startsAt: D(now - 2000), endsAt: D(now - 1000) };
    expect(lifecycleOf({ ...expired, active: false }, now)).toBe('INACTIVE');
    expect(lifecycleOf({ ...expired, active: true }, now)).toBe('EXPIRED');
  });
});

describe('analyzeTiming', () => {
  const now = local('2026-11-16T10:00:00'); // lunes

  it('consistente con isLive en una malla de instantes (cada 7 min durante 3 semanas)', () => {
    const p = promo({
      schedule: [slot(1, '15:00', '18:00'), slot(5, '22:00', '24:00'), slot(6, '00:00', '02:00')],
      startsAt: D(local('2026-11-10T00:00:00')),
      endsAt: D(local('2026-12-04T13:17:00')),
    });
    const start = local('2026-11-09T00:00:00');
    for (let t = start; t < start + 21 * 86_400_000; t += 7 * 60_000) {
      expect(analyzeTiming(p, t, TZ).live).toBe(isLive(p, t, TZ));
    }
  }, 60_000);

  it('próxima futura dentro del horizonte; fuera de 14 días no es upcoming', () => {
    const near = promo({ startsAt: D(now + 13 * 86_400_000) });
    const far = promo({ startsAt: D(now + 15 * 86_400_000) });
    expect(analyzeTiming(near, now, TZ).upcoming).toBe(true);
    expect(analyzeTiming(far, now, TZ).upcoming).toBe(false);
    expect(analyzeTiming(far, now, TZ).nextChangeAt).toBeNull();
    expect(HORIZON_MS).toBe(14 * 86_400_000);
  });

  it('vigente sin tramos: nextEndsAt = endsAt solo si está dentro del horizonte', () => {
    expect(analyzeTiming(promo({ endsAt: D(now + 3600_000) }), now, TZ).nextEndsAt).toBe(
      now + 3600_000,
    );
    expect(analyzeTiming(promo(), now, TZ).nextEndsAt).toBeNull();
  });

  it('vigente con tramo: nextEndsAt = fin del tramo y nextStartsAt = siguiente inicio', () => {
    const p = promo({ schedule: [slot(1, '09:00', '12:00'), slot(1, '15:00', '18:00')] });
    const t = analyzeTiming(p, now, TZ);
    expect(t.live).toBe(true);
    expect(t.nextEndsAt).toBe(local('2026-11-16T12:00:00'));
    expect(t.nextStartsAt).toBe(local('2026-11-16T15:00:00'));
    expect(t.nextChangeAt).toBe(local('2026-11-16T12:00:00'));
  });

  it('tramos contiguos del mismo día se fusionan', () => {
    const p = promo({ schedule: [slot(1, '09:00', '12:00'), slot(1, '12:00', '15:00')] });
    expect(analyzeTiming(p, now, TZ).nextEndsAt).toBe(local('2026-11-16T15:00:00'));
  });

  it('no vigente (fuera de tramo): upcoming con nextStartsAt y sin nextEndsAt', () => {
    const p = promo({ schedule: [slot(1, '15:00', '18:00')] });
    const t = analyzeTiming(p, now, TZ);
    expect(t.live).toBe(false);
    expect(t.upcoming).toBe(true);
    expect(t.nextStartsAt).toBe(local('2026-11-16T15:00:00'));
    expect(t.nextEndsAt).toBeNull();
  });

  it('T17: nextChangeAt del conjunto = el menor de los cambios', () => {
    const a = analyzeTiming(promo({ endsAt: D(now + 5000) }), now, TZ).nextChangeAt;
    const b = analyzeTiming(promo({ endsAt: D(now + 3000) }), now, TZ).nextChangeAt;
    expect(Math.min(a as number, b as number)).toBe(now + 3000);
  });
});
