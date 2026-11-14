import { describe, expect, it } from 'vitest';
import type { BranchHoursDay } from '@/lib/data-access/models';
import {
  emptyWeek,
  formatHm,
  formatInterval,
  isValidHm,
  isWeekEmpty,
  mergeIntervals,
  normalizeWeek,
  splitOvernight,
  validateWeek,
  weeksEqual,
} from './branch-hours';

const iv = (opensAt: string, closesAt: string) => ({ opensAt, closesAt });
const withDay = (weekday: number, intervals: ReturnType<typeof iv>[]): BranchHoursDay[] =>
  emptyWeek().map((d) => (d.weekday === weekday ? { ...d, intervals } : d));

describe('validateWeek (mismos criterios que el servidor)', () => {
  it('semana vacía es válida (sin horario configurado)', () => {
    expect(validateWeek(emptyWeek())).toEqual([]);
  });
  it('intervalos contiguos son válidos (no se solapan)', () => {
    expect(validateWeek(withDay(1, [iv('11:00', '15:00'), iv('15:00', '21:00')]))).toEqual([]);
  });
  it('24:00 solo como cierre', () => {
    expect(validateWeek(withDay(5, [iv('11:00', '24:00')]))).toEqual([]);
    const issues = validateWeek(withDay(5, [iv('24:00', '24:00')]));
    expect(issues).toMatchObject([{ code: 'INTERVAL_RANGE_INVALID', kind: 'business' }]);
  });
  it('apertura >= cierre => INTERVAL_RANGE_INVALID (sin cruce de medianoche)', () => {
    const issues = validateWeek(withDay(6, [iv('18:00', '02:00'), iv('10:00', '10:00')]));
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['days[5].intervals[0]', 'INTERVAL_RANGE_INVALID'],
      ['days[5].intervals[1]', 'INTERVAL_RANGE_INVALID'],
    ]);
    expect(issues[0]!.message).toMatch(/divide el turno en dos días/);
  });
  it('solape => INTERVAL_OVERLAP con la ruta del intervalo posterior', () => {
    const issues = validateWeek(withDay(5, [iv('11:00', '15:00'), iv('14:00', '18:00')]));
    expect(issues).toEqual([
      {
        path: 'days[4].intervals[1]',
        code: 'INTERVAL_OVERLAP',
        message: 'Se solapa con days[4].intervals[0] (11:00-15:00)',
        kind: 'business',
      },
    ]);
  });
  it('un intervalo contenido en otro también se solapa; el orden de entrada no importa', () => {
    const issues = validateWeek(withDay(2, [iv('18:00', '20:00'), iv('12:00', '22:00')]));
    expect(issues).toMatchObject([{ path: 'days[1].intervals[1]', code: 'INTERVAL_OVERLAP' }]);
  });
  it('formato inválido y más de 6 intervalos son errores de forma (400)', () => {
    const bad = validateWeek(withDay(3, [iv('9:00', '12:00'), iv('25:00', '26:00'), iv('', '')]));
    expect(bad.every((i) => i.kind === 'shape' && i.code === 'INTERVAL_FORMAT')).toBe(true);
    const seven = Array.from({ length: 7 }, (_, k) =>
      iv(`${String(k * 3).padStart(2, '0')}:00`, `${String(k * 3 + 1).padStart(2, '0')}:00`),
    );
    expect(validateWeek(withDay(3, seven))).toMatchObject([
      { code: 'TOO_MANY_INTERVALS', kind: 'shape', path: 'days[2].intervals' },
    ]);
    expect(validateWeek(withDay(3, seven.slice(0, 6)))).toEqual([]);
  });
  it('exige 7 días ISO distintos', () => {
    expect(validateWeek(emptyWeek().slice(0, 6))[0]).toMatchObject({ path: 'days', kind: 'shape' });
    const dup = emptyWeek();
    dup[6] = { weekday: 1, intervals: [] };
    expect(validateWeek(dup)).toMatchObject([{ path: 'days[6].weekday' }]);
    const zero = emptyWeek();
    (zero[0] as { weekday: number }).weekday = 0;
    expect(validateWeek(zero)).toMatchObject([{ path: 'days[0].weekday' }]);
  });
});

describe('splitOvernight (D4: dividir)', () => {
  it('viernes 18:00 → 02:00 = viernes 18:00–24:00 + sábado 00:00–02:00', () => {
    expect(splitOvernight(5, '18:00', '02:00')).toEqual({
      first: { weekday: 5, interval: iv('18:00', '24:00') },
      second: { weekday: 6, interval: iv('00:00', '02:00') },
    });
  });
  it('domingo → lunes es cíclico', () => {
    expect(splitOvernight(7, '20:00', '01:30')?.second.weekday).toBe(1);
  });
  it('no divide lo que no cruza medianoche ni formatos inválidos', () => {
    expect(splitOvernight(5, '10:00', '18:00')).toBeNull();
    expect(splitOvernight(5, '18:00', '18:00')).toBeNull();
    expect(splitOvernight(5, '18:00', '00:00')).toBeNull();
    expect(splitOvernight(5, '18:00', '24:00')).toBeNull();
    expect(splitOvernight(5, 'x', '02:00')).toBeNull();
  });
});

describe('utilidades', () => {
  it('isValidHm', () => {
    expect(['00:00', '23:59', '24:00'].every(isValidHm)).toBe(true);
    expect(['24:01', '9:00', '12:60', '', '1200'].some(isValidHm)).toBe(false);
  });
  it('mergeIntervals fusiona contiguos solo para mostrar', () => {
    expect(mergeIntervals([iv('15:00', '21:00'), iv('11:00', '15:00')])).toEqual([
      iv('11:00', '21:00'),
    ]);
    expect(mergeIntervals([iv('11:00', '14:00'), iv('15:00', '21:00')])).toHaveLength(2);
  });
  it('normalizeWeek completa 7 días ISO ascendentes y ordena intervalos', () => {
    const w = normalizeWeek([
      { weekday: 3, intervals: [iv('18:00', '22:00'), iv('12:00', '15:00')] },
    ]);
    expect(w.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(w[2]!.intervals[0]).toEqual(iv('12:00', '15:00'));
    expect(isWeekEmpty(w)).toBe(false);
    expect(isWeekEmpty(emptyWeek())).toBe(true);
  });
  it('weeksEqual ignora el orden de los intervalos', () => {
    expect(
      weeksEqual(
        withDay(1, [iv('11:00', '12:00'), iv('13:00', '14:00')]),
        withDay(1, [iv('13:00', '14:00'), iv('11:00', '12:00')]),
      ),
    ).toBe(true);
    expect(weeksEqual(withDay(1, [iv('11:00', '12:00')]), emptyWeek())).toBe(false);
  });
  it('formatea 24:00 como fin del día (12:00 a. m.)', () => {
    expect(formatHm('24:00', 'es')).toBe('12:00 a. m.');
    expect(formatHm('15:30', 'en')).toBe('3:30 p.m.');
    expect(formatInterval(iv('12:00', '22:00'), 'es')).toBe('12:00 p. m. – 10:00 p. m.');
  });
});
