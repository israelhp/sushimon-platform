import { afterEach, describe, expect, it } from 'vitest';
import {
  browserDateIsoWeekday,
  isoWeekdayFromJsDay,
  isoWeekdayOf,
  isoToLocalInput,
  localInputToIso,
  localIsoWeekday,
} from './time';

describe('día de la semana ISO (1 = lunes … 7 = domingo)', () => {
  it('convierte getDay (0 = domingo) a ISO en un único punto', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(isoWeekdayFromJsDay)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });
  it('fecha de calendario: 2026-11-16 es lunes y 2026-11-22 es domingo', () => {
    expect(isoWeekdayOf('2026-11-16')).toBe(1);
    expect(isoWeekdayOf('2026-11-22')).toBe(7);
    expect(isoWeekdayOf('2026-11-21')).toBe(6);
  });
  it('instante: usa el día LOCAL de Guatemala (UTC−6), no el UTC', () => {
    // 2026-11-17T04:00Z = lunes 22:00 en Guatemala (en UTC ya es martes).
    expect(localIsoWeekday(new Date('2026-11-17T04:00:00.000Z'))).toBe(1);
    // 2026-11-23T05:59:59Z = domingo 23:59:59 local.
    expect(localIsoWeekday(new Date('2026-11-23T05:59:59.000Z'))).toBe(7);
    expect(localIsoWeekday(new Date('2026-11-23T06:00:00.000Z'))).toBe(1);
  });
  it('Date del navegador: ISO sin importar el día numérico', () => {
    // Fecha local del dispositivo (constructor con componentes locales): lunes 16 y domingo 22.
    expect(browserDateIsoWeekday(new Date(2026, 10, 16, 12))).toBe(1);
    expect(browserDateIsoWeekday(new Date(2026, 10, 22, 12))).toBe(7);
  });

  describe('independiente de TZ del proceso', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });
    it.each(['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati'])('TZ=%s', (tz) => {
      process.env.TZ = tz;
      expect(localIsoWeekday(new Date('2026-11-17T04:00:00.000Z'))).toBe(1);
      expect(isoWeekdayOf('2026-11-22')).toBe(7);
    });
  });
});

describe('datetime-local ↔ instante UTC (hora de Guatemala)', () => {
  it('convierte a ISO UTC con Z y milisegundos', () => {
    expect(localInputToIso('2026-11-16T13:00')).toBe('2026-11-16T19:00:00.000Z');
    expect(localInputToIso('2026-11-16T18:30')).toBe('2026-11-17T00:30:00.000Z');
  });
  it('rechaza valores mal formados', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-11-16')).toBeNull();
  });
  it('ida y vuelta', () => {
    expect(isoToLocalInput('2026-11-16T19:00:00.000Z')).toBe('2026-11-16T13:00');
    expect(isoToLocalInput(localInputToIso('2026-12-24T23:45') as string)).toBe('2026-12-24T23:45');
  });
});
