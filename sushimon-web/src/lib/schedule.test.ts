import { describe, expect, it } from 'vitest';
import type { BranchHoursDay } from '@/lib/data-access/models';
import { STORE_CONFIG_SEED } from '@/mocks/fixtures/store';
import { availableDates, intervalsForDate, isScheduleValid, slotsFor } from './schedule';
import { fromLocal } from './time';

const rules = STORE_CONFIG_SEED.schedule;
const iv = (opensAt: string, closesAt: string) => ({ opensAt, closesAt });
/** lun–jue 12–20, vie–sáb 12–22, dom 12–18 (ISO 1–7). */
const days: BranchHoursDay[] = [
  { weekday: 1, intervals: [iv('12:00', '20:00')] },
  { weekday: 2, intervals: [iv('12:00', '20:00')] },
  { weekday: 3, intervals: [iv('12:00', '20:00')] },
  { weekday: 4, intervals: [iv('12:00', '20:00')] },
  { weekday: 5, intervals: [iv('12:00', '22:00')] },
  { weekday: 6, intervals: [iv('12:00', '22:00')] },
  { weekday: 7, intervals: [iv('12:00', '18:00')] },
];
const now = fromLocal('2026-11-11', '14:25'); // miércoles

describe('programación de pedidos', () => {
  it('hoy: desde ahora + 45 min redondeado a 30, hasta cierre − 30', () => {
    const slots = slotsFor(rules, days, '2026-11-11', now);
    expect(slots[0]).toBe('15:30');
    expect(slots.at(-1)).toBe('19:30');
  });

  it('otro día: horario completo (viernes 12:00–21:30, domingo 12:00–17:30)', () => {
    expect(slotsFor(rules, days, '2026-11-13', now)).toHaveLength(20);
    expect(slotsFor(rules, days, '2026-11-15', now).at(-1)).toBe('17:30');
    expect(slotsFor(rules, days, '2026-11-10', now)).toEqual([]);
  });

  it('el día se resuelve con ISO 1–7 (domingo = 7, no 0)', () => {
    expect(intervalsForDate(days, '2026-11-15')).toEqual([iv('12:00', '18:00')]);
    expect(intervalsForDate(days, '2026-11-16')).toEqual([iv('12:00', '20:00')]);
  });

  it('7 días disponibles y validación', () => {
    expect(availableDates(rules, days, now)).toHaveLength(7);
    expect(isScheduleValid(rules, days, { kind: 'now' }, now)).toBe(true);
    expect(
      isScheduleValid(rules, days, { kind: 'scheduled', date: '2026-11-11', time: '15:30' }, now),
    ).toBe(true);
    expect(
      isScheduleValid(rules, days, { kind: 'scheduled', date: '2026-11-11', time: '15:00' }, now),
    ).toBe(false);
    expect(
      isScheduleValid(rules, days, { kind: 'scheduled', date: '2026-11-18', time: '13:00' }, now),
    ).toBe(false);
  });

  it('varios intervalos: sin horarios en el hueco; contiguos se fusionan', () => {
    const split: BranchHoursDay[] = days.map((d) =>
      d.weekday === 5
        ? { weekday: 5, intervals: [iv('12:00', '15:00'), iv('18:00', '22:00')] }
        : d.weekday === 6
          ? { weekday: 6, intervals: [iv('12:00', '15:00'), iv('15:00', '22:00')] }
          : d,
    );
    const friday = slotsFor(rules, split, '2026-11-13', now);
    expect(friday).toContain('14:30');
    expect(friday).not.toContain('15:00');
    expect(friday).not.toContain('17:30');
    expect(friday).toContain('18:00');
    expect(slotsFor(rules, split, '2026-11-14', now)).toContain('15:00');
  });

  it('un día sin atención no ofrece horarios', () => {
    const closedFriday = days.map((d) =>
      d.weekday === 5 ? { weekday: 5 as const, intervals: [] } : d,
    );
    expect(slotsFor(rules, closedFriday, '2026-11-13', now)).toEqual([]);
    expect(availableDates(rules, closedFriday, now)).not.toContain('2026-11-13');
  });

  it('excluye horarios dentro de un cierre próximo', () => {
    const closure = [{ startsAt: '2026-11-13T20:00:00.000Z', endsAt: '2026-11-13T22:00:00.000Z' }]; // vie 14:00–16:00
    const friday = slotsFor(rules, days, '2026-11-13', now, closure);
    expect(friday).not.toContain('14:00');
    expect(friday).not.toContain('15:30');
    expect(friday).toContain('16:00');
    expect(friday).toContain('13:30');
  });
});
