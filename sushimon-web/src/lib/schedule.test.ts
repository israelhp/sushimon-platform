import { describe, expect, it } from 'vitest';
import { STORE_CONFIG_SEED } from '@/mocks/fixtures/store';
import { availableDates, isScheduleValid, isWithinHours, slotsFor } from './schedule';
import { fromLocal } from './time';

const rules = STORE_CONFIG_SEED.schedule;
const hours = STORE_CONFIG_SEED.weeklyHours;
const now = fromLocal('2026-11-11', '14:25'); // miércoles

describe('programación de pedidos', () => {
  it('hoy: desde ahora + 45 min redondeado a 30, hasta cierre − 30', () => {
    const slots = slotsFor(rules, hours, '2026-11-11', now);
    expect(slots[0]).toBe('15:30');
    expect(slots.at(-1)).toBe('19:30');
  });

  it('otro día: horario completo (viernes 12:00–21:30, domingo 12:00–17:30)', () => {
    expect(slotsFor(rules, hours, '2026-11-13', now)).toHaveLength(20);
    expect(slotsFor(rules, hours, '2026-11-15', now).at(-1)).toBe('17:30');
    expect(slotsFor(rules, hours, '2026-11-10', now)).toEqual([]);
  });

  it('7 días disponibles y validación', () => {
    expect(availableDates(rules, hours, now)).toHaveLength(7);
    expect(isScheduleValid(rules, hours, { kind: 'now' }, now)).toBe(true);
    expect(
      isScheduleValid(rules, hours, { kind: 'scheduled', date: '2026-11-11', time: '15:30' }, now),
    ).toBe(true);
    expect(
      isScheduleValid(rules, hours, { kind: 'scheduled', date: '2026-11-11', time: '15:00' }, now),
    ).toBe(false);
    expect(
      isScheduleValid(rules, hours, { kind: 'scheduled', date: '2026-11-18', time: '13:00' }, now),
    ).toBe(false);
    expect(
      isScheduleValid(rules, hours, { kind: 'scheduled', date: '2026-11-12', time: '13:15' }, now),
    ).toBe(false);
  });

  it('dentro del horario', () => {
    expect(isWithinHours(hours, now)).toBe(true);
    expect(isWithinHours(hours, fromLocal('2026-11-11', '20:00'))).toBe(false);
    expect(isWithinHours(hours, fromLocal('2026-11-11', '11:59'))).toBe(false);
  });
});
