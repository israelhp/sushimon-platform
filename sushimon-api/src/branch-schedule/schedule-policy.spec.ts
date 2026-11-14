import { createHash } from 'node:crypto';
import { BadRequestException, HttpException } from '@nestjs/common';
import {
  diffHours,
  hoursVersion,
  normalizeHours,
  rowsToDays,
  toWeeklyIntervals,
  type HoursDay,
  type HoursDayInput,
} from './schedule-policy.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Semana de 7 días vacíos; `over` sustituye días por `weekday`. */
function week(over: Record<number, [string, string][]> = {}, order = [1, 2, 3, 4, 5, 6, 7]) {
  return order.map((weekday): HoursDayInput => ({
    weekday,
    intervals: (over[weekday] ?? []).map(([opensAt, closesAt]) => ({ opensAt, closesAt })),
  }));
}

function failure(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}

describe('schedule-policy', () => {
  describe('normalizeHours', () => {
    it('devuelve siempre 7 días ordenados con intervalos ordenados; acepta contiguos y 24:00', () => {
      const out = normalizeHours(
        week(
          {
            5: [
              ['15:00', '24:00'],
              ['11:00', '15:00'],
            ],
            6: [['00:00', '02:00']],
          },
          [7, 3, 5, 1, 6, 2, 4],
        ),
      );
      expect(out.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(out[4]?.intervals).toEqual([
        { opensAt: '11:00', closesAt: '15:00' },
        { opensAt: '15:00', closesAt: '24:00' },
      ]);
      expect(out[0]?.intervals).toEqual([]);
    });

    it('semana vacía es válida', () => {
      expect(normalizeHours(week()).every((d) => d.intervals.length === 0)).toBe(true);
    });

    it('422 SCHEDULE_INVALID con violations por día/intervalo (índices del arreglo recibido)', () => {
      const error = failure(() =>
        normalizeHours(
          week({
            5: [
              ['11:00', '15:00'],
              ['14:00', '18:00'],
            ],
            6: [['18:00', '02:00']],
          }),
        ),
      );
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({
        code: 'SCHEDULE_INVALID',
        violations: [
          {
            path: 'days[4].intervals[1]',
            code: 'INTERVAL_OVERLAP',
            message: 'Se solapa con days[4].intervals[0] (11:00-15:00)',
          },
          { path: 'days[5].intervals[0]', code: 'INTERVAL_RANGE_INVALID' },
        ],
      });
    });

    it('opensAt == closesAt, opensAt 24:00 y cierre <= apertura son INTERVAL_RANGE_INVALID', () => {
      for (const iv of [
        ['11:00', '11:00'],
        ['24:00', '24:00'],
        ['22:00', '02:00'],
      ] as [string, string][]) {
        const error = failure(() => normalizeHours(week({ 1: [iv] })));
        expect(error.getResponse()).toMatchObject({
          violations: [{ path: 'days[0].intervals[0]', code: 'INTERVAL_RANGE_INVALID' }],
        });
      }
    });

    it('detecta solape anidado y duplicado exacto; la violación va en el posterior', () => {
      const nested = failure(() =>
        normalizeHours(
          week({
            2: [
              ['10:00', '20:00'],
              ['12:00', '13:00'],
              ['14:00', '15:00'],
            ],
          }),
        ),
      );
      expect(
        (nested.getResponse() as { violations: { path: string }[] }).violations.map((v) => v.path),
      ).toEqual(['days[1].intervals[1]', 'days[1].intervals[2]']);
      const dup = failure(() =>
        normalizeHours(
          week({
            2: [
              ['10:00', '12:00'],
              ['10:00', '12:00'],
            ],
          }),
        ),
      );
      expect(dup.getResponse()).toMatchObject({
        violations: [{ path: 'days[1].intervals[1]', code: 'INTERVAL_OVERLAP' }],
      });
    });

    it('400: weekday repetido, faltante o fuera de rango; >6 intervalos; formato', () => {
      const dup = week({}, [1, 1, 3, 4, 5, 6, 7]);
      expect(failure(() => normalizeHours(dup))).toBeInstanceOf(BadRequestException);
      expect(failure(() => normalizeHours(week().slice(0, 6)))).toBeInstanceOf(BadRequestException);
      expect(failure(() => normalizeHours(week({}, [0, 2, 3, 4, 5, 6, 7])))).toBeInstanceOf(
        BadRequestException,
      );
      const seven = week({
        1: Array.from({ length: 7 }, (_, i) => [`0${i}:00`, `0${i}:30`] as [string, string]),
      });
      expect(failure(() => normalizeHours(seven))).toBeInstanceOf(BadRequestException);
      expect(failure(() => normalizeHours(week({ 1: [['9:00', '10:00']] })))).toBeInstanceOf(
        BadRequestException,
      );
    });

    it('6 intervalos por día es el máximo permitido', () => {
      const six = Array.from(
        { length: 6 },
        (_, i) =>
          [`${String(i * 2).padStart(2, '0')}:00`, `${String(i * 2 + 1).padStart(2, '0')}:00`] as [
            string,
            string,
          ],
      );
      expect(normalizeHours(week({ 1: six }))[0]?.intervals).toHaveLength(6);
    });
  });

  describe('hoursVersion', () => {
    it('semana vacía = SHA-256 de la cadena vacía', () => {
      expect(hoursVersion(rowsToDays([]))).toBe(sha(''));
    });

    it('SHA-256 de weekday|opensAt|closesAt unidos con \\n (orden weekday, opensAt; 24:00 sin normalizar)', () => {
      const days = normalizeHours(
        week({
          6: [
            ['11:00', '24:00'],
            ['00:00', '02:00'],
          ],
          1: [['11:00', '15:00']],
        }),
      );
      expect(hoursVersion(days)).toBe(sha('1|11:00|15:00\n6|00:00|02:00\n6|11:00|24:00'));
    });

    it('no depende del orden de entrada y cambia con cualquier cambio', () => {
      const a = rowsToDays([
        { weekday: 2, opensAt: '11:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '11:00', closesAt: '12:00' },
      ]);
      const b = rowsToDays([
        { weekday: 1, opensAt: '11:00', closesAt: '12:00' },
        { weekday: 2, opensAt: '11:00', closesAt: '12:00' },
      ]);
      expect(hoursVersion(a)).toBe(hoursVersion(b));
      const c = rowsToDays([{ weekday: 1, opensAt: '11:00', closesAt: '12:01' }]);
      expect(hoursVersion(c)).not.toBe(hoursVersion(b));
    });

    it('contiguos se guardan tal cual: no se fusionan (la versión los distingue)', () => {
      const split = normalizeHours(
        week({
          1: [
            ['11:00', '15:00'],
            ['15:00', '21:00'],
          ],
        }),
      );
      const merged = normalizeHours(week({ 1: [['11:00', '21:00']] }));
      expect(hoursVersion(split)).not.toBe(hoursVersion(merged));
    });
  });

  describe('diffHours', () => {
    const before: HoursDay[] = normalizeHours(
      week({ 1: [['11:00', '22:00']], 2: [['11:00', '22:00']] }),
    );

    it('null si no hay cambios reales', () => {
      expect(
        diffHours(
          before,
          normalizeHours(week({ 2: [['11:00', '22:00']], 1: [['11:00', '22:00']] })),
        ),
      ).toBeNull();
    });

    it('solo los días que cambian, más la versión', () => {
      const after = normalizeHours(
        week({
          1: [['11:00', '22:00']],
          2: [['12:00', '22:00']],
          3: [
            ['11:00', '15:00'],
            ['15:00', '24:00'],
          ],
        }),
      );
      const diff = diffHours(before, after);
      expect(diff?.oldValues).toEqual({
        weekday_2: '11:00-22:00',
        weekday_3: '',
        version: hoursVersion(before),
      });
      expect(diff?.newValues).toEqual({
        weekday_2: '12:00-22:00',
        weekday_3: '11:00-15:00,15:00-24:00',
        version: hoursVersion(after),
      });
    });
  });

  it('toWeeklyIntervals convierte a minutos (24:00 = 1440)', () => {
    expect(toWeeklyIntervals(normalizeHours(week({ 5: [['11:00', '24:00']] })))).toEqual([
      { weekday: 5, opensMin: 660, closesMin: 1440 },
    ]);
  });
});
