import {
  addDays,
  formatClock,
  instantOf,
  exactOffsets,
  isoWeekdayOf,
  memoizedOffsets,
  parseClock,
  parseInstant,
  parsePgTime,
  toLocal,
  truncateToSecond,
} from './business-time.js';

const GT = 'America/Guatemala';

describe('business-time', () => {
  describe('isoWeekdayOf (ISO 1 = lunes … 7 = domingo, sin getDay)', () => {
    it('semana de referencia: 2026-11-16 es lunes', () => {
      const days = [16, 17, 18, 19, 20, 21, 22].map((day) =>
        isoWeekdayOf({ year: 2026, month: 11, day }),
      );
      expect(days).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('época (jueves) y fechas anteriores a 1970', () => {
      expect(isoWeekdayOf({ year: 1970, month: 1, day: 1 })).toBe(4);
      expect(isoWeekdayOf({ year: 1969, month: 12, day: 28 })).toBe(7);
      expect(isoWeekdayOf({ year: 2000, month: 2, day: 29 })).toBe(2);
    });
  });

  describe('addDays', () => {
    it('cruza mes, año y bisiesto', () => {
      expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
        year: 2027,
        month: 1,
        day: 1,
      });
      expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({
        year: 2026,
        month: 2,
        day: 28,
      });
      expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
        year: 2028,
        month: 2,
        day: 29,
      });
    });
  });

  describe('toLocal', () => {
    it('Guatemala = UTC-6 fijo, con día ISO y minuto del día', () => {
      const l = toLocal(Date.parse('2026-11-16T17:00:00.000Z'), GT);
      expect(l).toMatchObject({
        year: 2026,
        month: 11,
        day: 16,
        hour: 11,
        minute: 0,
        weekday: 1,
        minuteOfDay: 660,
      });
    });

    it('medianoche local: no devuelve hora 24 y el día corresponde a la zona, no a UTC', () => {
      const l = toLocal(Date.parse('2026-11-21T06:00:00.000Z'), GT); // sáb 00:00 local
      expect(l).toMatchObject({ day: 21, hour: 0, weekday: 6, minuteOfDay: 0 });
      const prev = toLocal(Date.parse('2026-11-21T05:59:59.999Z'), GT); // vie 23:59:59 local
      expect(prev).toMatchObject({ day: 20, hour: 23, minute: 59, second: 59, weekday: 5 });
    });

    it('otras zonas (con horario de verano) también convierten bien', () => {
      expect(toLocal(Date.parse('2026-07-01T16:00:00Z'), 'America/New_York').hour).toBe(12);
      expect(toLocal(Date.parse('2026-01-01T17:00:00Z'), 'America/New_York').hour).toBe(12);
      expect(toLocal(Date.parse('2026-11-16T17:00:00Z'), 'Asia/Tokyo')).toMatchObject({
        day: 17,
        hour: 2,
        weekday: 2,
      });
    });
  });

  describe('instantOf', () => {
    it('fecha local + minutos -> instante UTC', () => {
      const ms = instantOf({ year: 2026, month: 11, day: 16 }, 11 * 60, GT);
      expect(new Date(ms).toISOString()).toBe('2026-11-16T17:00:00.000Z');
    });

    it('24:00 (1440) es 00:00 del día siguiente', () => {
      const ms = instantOf({ year: 2026, month: 11, day: 20 }, 1440, GT);
      expect(new Date(ms).toISOString()).toBe('2026-11-21T06:00:00.000Z');
      expect(ms).toBe(instantOf({ year: 2026, month: 11, day: 21 }, 0, GT));
    });

    it('ida y vuelta con toLocal en zonas con DST', () => {
      for (const zone of [GT, 'America/New_York', 'Asia/Tokyo', 'UTC']) {
        for (const date of [
          { year: 2026, month: 1, day: 15 },
          { year: 2026, month: 7, day: 15 },
        ]) {
          const ms = instantOf(date, 18 * 60 + 30, zone);
          expect(toLocal(ms, zone)).toMatchObject({ ...date, hour: 18, minute: 30 });
        }
      }
    });
  });

  describe('parseClock / formatClock / parsePgTime', () => {
    it('HH:mm válidos, 24:00 solo exacto', () => {
      expect(parseClock('00:00')).toBe(0);
      expect(parseClock('23:59')).toBe(1439);
      expect(parseClock('24:00')).toBe(1440);
      for (const bad of ['24:01', '25:00', '12:60', '9:00', '12:00:00', '', 'ab:cd']) {
        expect(parseClock(bad)).toBeNull();
      }
    });

    it('formatClock es la inversa (incluye 24:00)', () => {
      expect(formatClock(0)).toBe('00:00');
      expect(formatClock(1439)).toBe('23:59');
      expect(formatClock(1440)).toBe('24:00');
    });

    it("parsePgTime lee el texto de PostgreSQL, incluido '24:00:00'", () => {
      expect(parsePgTime('11:00:00')).toBe(660);
      expect(parsePgTime('24:00:00')).toBe(1440);
      expect(() => parsePgTime('basura')).toThrow();
    });
  });

  describe('parseInstant (ISO 8601 con zona obligatoria)', () => {
    it('acepta Z y offsets; normaliza a UTC y trunca al segundo', () => {
      expect(parseInstant('2026-11-16T17:00:00Z')).toBe(Date.parse('2026-11-16T17:00:00Z'));
      expect(parseInstant('2026-11-16T11:00:00-06:00')).toBe(Date.parse('2026-11-16T17:00:00Z'));
      expect(parseInstant('2026-11-16T11:00-06:00')).toBe(Date.parse('2026-11-16T17:00:00Z'));
      expect(parseInstant('2026-11-17T02:30:00+09:30')).toBe(Date.parse('2026-11-16T17:00:00Z'));
      expect(parseInstant('2026-11-16T17:00:00.999Z')).toBe(Date.parse('2026-11-16T17:00:00Z'));
    });

    it('rechaza sin zona, formato inválido y fechas inexistentes', () => {
      for (const bad of [
        '2026-11-16T17:00:00',
        '2026-11-16',
        '2026-11-16 17:00:00Z',
        '2026-02-31T00:00:00Z',
        '2026-13-01T00:00:00Z',
        '2026-11-16T24:00:00Z',
        '2026-11-16T17:00:60Z',
        '2026-11-16T17:00:00+24:00',
        'hoy',
      ]) {
        expect(parseInstant(bad)).toBeNull();
      }
    });

    it('truncateToSecond', () => {
      expect(truncateToSecond(1_999)).toBe(1_000);
    });
  });

  describe('memoizedOffsets (una evaluación)', () => {
    it('da el mismo desfase que el cálculo exacto, también en días con cambio de horario', () => {
      for (const zone of [
        'America/Guatemala',
        'America/New_York',
        'Australia/Lord_Howe',
        'Asia/Tokyo',
      ]) {
        const memo = memoizedOffsets(zone);
        const exact = exactOffsets(zone);
        // Barrido de 2026-03-07 .. 2026-04-07 y 2026-10-30 .. 2026-11-03 cada 7 min.
        for (const [from, to] of [
          [Date.UTC(2026, 2, 7), Date.UTC(2026, 3, 7)],
          [Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 3)],
        ] as const) {
          for (let ms = from; ms < to; ms += 7 * 60_000) {
            expect(memo.offsetAt(ms)).toBe(exact.offsetAt(ms));
          }
        }
      }
      // Barrido exhaustivo (~38k comparaciones por zona con Intl): bajo carga supera los 5 s por defecto.
    }, 30_000);

    it('instantOf con resolver memoizado = sin resolver (incluida la medianoche 24:00)', () => {
      const memo = memoizedOffsets('America/New_York');
      for (const day of [
        { year: 2026, month: 3, day: 8 },
        { year: 2026, month: 11, day: 1 },
        { year: 2026, month: 7, day: 4 },
      ]) {
        for (const minute of [0, 90, 660, 1320, 1440]) {
          expect(instantOf(day, minute, 'America/New_York', memo)).toBe(
            instantOf(day, minute, 'America/New_York'),
          );
        }
      }
    });

    it('reduce las llamadas a Intl: un día UTC = 2 consultas como máximo', () => {
      const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
      try {
        const memo = memoizedOffsets('America/Guatemala');
        for (let i = 0; i < 500; i++) memo.offsetAt(Date.UTC(2026, 10, 16) + i * 60_000);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
