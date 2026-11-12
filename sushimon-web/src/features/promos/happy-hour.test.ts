import { describe, expect, it } from 'vitest';
import type { Promotion } from '@/lib/data-access/models';
import { PROMOTION_SEEDS } from '@/mocks/fixtures/promotions';
import { fromLocal } from '@/lib/time';
import {
  daysLabel,
  groupHappyHourItems,
  happyHourPhase,
  hoursLabel,
  pickHappyHour,
  shortHoursLabel,
} from './happy-hour';

const seed = PROMOTION_SEEDS.find((p) => p.id === 'happy-hour')!;
const happy: Promotion = { ...seed, status: 'current' };
const at = (date: string, time: string) => fromLocal(date, time);
const range = (a: string, b: string) => `${a} to ${b}`;

describe('happyHourPhase (lunes a jueves, 15:00–18:00)', () => {
  it('antes de abrir el miércoles: "hoy a partir de las 15:00" (reloj de la demo 14:25)', () => {
    expect(happyHourPhase(happy, at('2026-11-11', '14:25'))).toEqual({
      kind: 'today',
      startsAt: '15:00',
    });
  });

  it('en curso entre 15:00 y 18:00 (el cierre es exclusivo)', () => {
    expect(happyHourPhase(happy, at('2026-11-11', '15:00'))).toEqual({
      kind: 'live',
      endsAt: '18:00',
    });
    expect(happyHourPhase(happy, at('2026-11-11', '17:59')).kind).toBe('live');
    expect(happyHourPhase(happy, at('2026-11-11', '18:00')).kind).toBe('upcoming');
  });

  it('terminado el miércoles, la próxima es el jueves', () => {
    expect(happyHourPhase(happy, at('2026-11-11', '19:00'))).toEqual({
      kind: 'upcoming',
      date: '2026-11-12',
      startsAt: '15:00',
    });
  });

  it('jueves tarde, viernes y fin de semana: la próxima es el lunes', () => {
    for (const [date, time] of [
      ['2026-11-12', '18:30'],
      ['2026-11-13', '16:00'],
      ['2026-11-14', '10:00'],
      ['2026-11-15', '16:00'],
    ] as const) {
      expect(happyHourPhase(happy, at(date, time))).toEqual({
        kind: 'upcoming',
        date: '2026-11-16',
        startsAt: '15:00',
      });
    }
  });

  it('sin más días antes de que venza, la promoción se considera finalizada', () => {
    const ending = { ...happy, validTo: '2026-11-12' };
    expect(happyHourPhase(ending, at('2026-11-12', '19:00'))).toEqual({
      kind: 'expired',
      on: '2026-11-12',
    });
  });

  it('respeta el estado calculado por el servidor', () => {
    expect(happyHourPhase({ ...happy, status: 'expired' }, at('2026-11-11', '16:00')).kind).toBe(
      'expired',
    );
    expect(happyHourPhase({ ...happy, status: 'inactive' }, at('2026-11-11', '16:00')).kind).toBe(
      'inactive',
    );
    expect(happyHourPhase({ ...happy, status: 'scheduled' }, at('2026-11-11', '16:00'))).toEqual({
      kind: 'scheduled',
      date: happy.validFrom,
    });
  });
});

describe('textos de días y horas', () => {
  it('días en español e inglés (largo y corto)', () => {
    expect(daysLabel([1, 2, 3, 4], 'es', 'long', (a, b) => `${a} a ${b}`)).toBe('Lunes a jueves');
    expect(daysLabel([1, 2, 3, 4], 'en', 'long', range)).toBe('Monday to Thursday');
    expect(daysLabel([1, 2, 3, 4], 'es', 'short', range)).toBe('Lun–Jue');
    expect(daysLabel([1, 2, 3, 4], 'en', 'short', range)).toBe('Mon–Thu');
  });

  it('días no contiguos se listan', () => {
    expect(daysLabel([2, 5], 'en', 'long', range)).toBe('Tuesday and Friday');
  });

  it('horas con el formato del prototipo', () => {
    expect(hoursLabel('15:00', '18:00', 'es')).toBe('3:00 p. m. – 6:00 p. m.');
    expect(hoursLabel('15:00', '18:00', 'en')).toBe('3:00 p.m. – 6:00 p.m.');
    expect(shortHoursLabel('15:00', '18:00', 'es')).toBe('3:00–6:00 p. m.');
    expect(shortHoursLabel('11:00', '15:00', 'en')).toBe('11:00 a.m.–3:00 p.m.');
  });
});

describe('selección y grupos', () => {
  it('pickHappyHour prefiere la promoción "happy-hour" y, si no, la que trae ítems', () => {
    const other: Promotion = { ...happy, id: 'otra', items: [] };
    expect(pickHappyHour([other, happy])?.id).toBe('happy-hour');
    expect(pickHappyHour([other])).toBeUndefined();
    expect(pickHappyHour([other, { ...happy, id: 'x' }])?.id).toBe('x');
  });

  it('agrupa en orden Entradas, Rolls, Cervezas y deja al final los grupos nuevos', () => {
    const items = [
      { id: '1', name: 'a', priceLabel: 'Q1', group: 'Cervezas', illustration: 'beer' },
      { id: '2', name: 'b', priceLabel: 'Q1', group: 'Postres', illustration: 'icecream' },
      { id: '3', name: 'c', priceLabel: 'Q1', group: 'Entradas', illustration: 'fries' },
    ];
    expect(groupHappyHourItems(items).map((g) => g.group)).toEqual([
      'Entradas',
      'Cervezas',
      'Postres',
    ]);
    expect(groupHappyHourItems(happy.items).map((g) => [g.group, g.items.length])).toEqual([
      ['Entradas', 2],
      ['Rolls', 5],
      ['Cervezas', 1],
    ]);
  });
});
