import { describe, expect, it } from 'vitest';
import type { PromotionScheduleSlot, StorePromotion } from '@/lib/data-access/models';
import {
  clockLabel,
  daysLabel,
  groupByCategory,
  groupSchedule,
  happyHourPhase,
  hoursLabel,
  instantClock,
  lastIncludedInstant,
  percentText,
  pickHappyHour,
  sameLocalDay,
  shortHoursLabel,
} from './happy-hour';

const range = (a: string, b: string) => `${a} to ${b}`;
const slot = (weekday: number, startsAt: string, endsAt: string): PromotionScheduleSlot => ({
  weekday,
  startsAt,
  endsAt,
});

function promo(overrides: Partial<StorePromotion> = {}): StorePromotion {
  return {
    id: 'p1',
    name: 'Happy Hour',
    description: null,
    requiresCode: false,
    isHappyHour: true,
    dineInOnly: true,
    state: 'live',
    validFrom: '2026-10-01T06:00:00.000Z',
    validUntil: '2027-01-01T06:00:00.000Z',
    schedule: [1, 2, 3, 4].map((d) => slot(d, '15:00', '18:00')),
    nextStartsAt: null,
    nextEndsAt: null,
    productScope: 'ALL',
    ...overrides,
  };
}

describe('fase del Happy Hour (la decide el servidor, no el dispositivo)', () => {
  it('vigente: usa `nextEndsAt` del servidor; próxima: `nextStartsAt`', () => {
    expect(
      happyHourPhase(promo({ state: 'live', nextEndsAt: '2026-11-11T00:00:00.000Z' })),
    ).toEqual({ kind: 'live', endsAt: '2026-11-11T00:00:00.000Z' });
    expect(happyHourPhase(promo({ state: 'live' }))).toEqual({ kind: 'live', endsAt: null });
    expect(
      happyHourPhase(promo({ state: 'upcoming', nextStartsAt: '2026-11-11T21:00:00.000Z' })),
    ).toEqual({ kind: 'upcoming', startsAt: '2026-11-11T21:00:00.000Z' });
    expect(happyHourPhase(promo({ state: 'upcoming' }))).toBeNull();
  });

  it('pickHappyHour: la vigente gana; si no, la próxima que empieza antes; ignora las que no son Happy Hour', () => {
    const live = promo({ id: 'live' });
    const early = promo({ id: 'early', state: 'upcoming', nextStartsAt: '2026-11-12T21:00:00Z' });
    const late = promo({ id: 'late', state: 'upcoming', nextStartsAt: '2026-11-14T21:00:00Z' });
    const plain = promo({ id: 'plain', isHappyHour: false });
    expect(pickHappyHour([plain, live], [early])?.id).toBe('live');
    expect(pickHappyHour([plain], [late, early])?.id).toBe('early');
    expect(pickHappyHour([plain], [plain])).toBeUndefined();
  });
});

describe('textos de días y horas', () => {
  it('días en español e inglés (largo y corto)', () => {
    expect(daysLabel([1, 2, 3, 4], 'es', 'long', (a, b) => `${a} a ${b}`)).toBe('Lunes a jueves');
    expect(daysLabel([1, 2, 3, 4], 'en', 'long', range)).toBe('Monday to Thursday');
    expect(daysLabel([1, 2, 3, 4], 'es', 'short', range)).toBe('Lun–Jue');
    expect(daysLabel([1, 2, 3, 4], 'en', 'short', range)).toBe('Mon–Thu');
    expect(daysLabel([2, 5], 'en', 'long', range)).toBe('Tuesday and Friday');
  });

  it('horas con el formato del prototipo; 24:00 se lee como medianoche', () => {
    expect(hoursLabel('15:00', '18:00', 'es')).toBe('3:00 p. m. – 6:00 p. m.');
    expect(hoursLabel('15:00', '18:00', 'en')).toBe('3:00 p.m. – 6:00 p.m.');
    expect(shortHoursLabel('15:00', '18:00', 'es')).toBe('3:00–6:00 p. m.');
    expect(shortHoursLabel('11:00', '15:00', 'en')).toBe('11:00 a.m.–3:00 p.m.');
    expect(clockLabel('24:00', 'es')).toBe('12:00 a. m.');
    expect(hoursLabel('22:00', '24:00', 'es')).toBe('10:00 p. m. – 12:00 a. m.');
  });

  it('instantes del servidor en hora de Guatemala (no la del dispositivo)', () => {
    expect(instantClock('2026-11-11T21:00:00.000Z')).toBe('15:00');
    expect(sameLocalDay('2026-11-11T20:25:00.000Z', '2026-11-11T21:00:00.000Z')).toBe(true);
    // 2026-11-12T03:00Z = miércoles 21:00 local; 2026-11-12T06:00Z = jueves 00:00 local.
    expect(sameLocalDay('2026-11-12T03:00:00.000Z', '2026-11-12T06:00:00.000Z')).toBe(false);
  });

  it('`validUntil` es exclusivo: el último día incluido es el del instante anterior', () => {
    expect(lastIncludedInstant('2027-01-01T06:00:00.000Z').toISOString()).toBe(
      '2027-01-01T05:59:00.000Z',
    );
  });

  it('muestra el porcentaje que dio la API sin ceros sobrantes', () => {
    expect(percentText('25.00')).toBe('25');
    expect(percentText('12.50')).toBe('12.5');
    expect(percentText('33.33')).toBe('33.33');
  });
});

describe('agrupación del horario y de los ítems', () => {
  it('agrupa los días con los mismos tramos y deja los distintos aparte', () => {
    const groups = groupSchedule([
      slot(1, '15:00', '18:00'),
      slot(2, '15:00', '18:00'),
      slot(5, '12:00', '14:00'),
      slot(3, '15:00', '18:00'),
    ]);
    expect(groups).toEqual([
      { days: [1, 2, 3], ranges: [{ startsAt: '15:00', endsAt: '18:00' }] },
      { days: [5], ranges: [{ startsAt: '12:00', endsAt: '14:00' }] },
    ]);
    expect(groupSchedule([])).toEqual([]);
  });

  it('fusiona los tramos contiguos del mismo día', () => {
    expect(groupSchedule([slot(1, '12:00', '15:00'), slot(1, '15:00', '18:00')])).toEqual([
      { days: [1], ranges: [{ startsAt: '12:00', endsAt: '18:00' }] },
    ]);
  });

  it('agrupa por categoría conservando el orden de aparición', () => {
    const entries = [
      { n: 'a', c: 'Entradas' },
      { n: 'b', c: 'Rolls' },
      { n: 'c', c: 'Entradas' },
    ];
    expect(groupByCategory(entries, (e) => e.c).map((g) => [g.category, g.items.length])).toEqual([
      ['Entradas', 2],
      ['Rolls', 1],
    ]);
  });
});
