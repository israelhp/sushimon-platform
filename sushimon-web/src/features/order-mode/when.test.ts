import { describe, expect, it } from 'vitest';
import { BRANCH_HOURS_SEEDS } from '@/mocks/fixtures/schedule';
import { dateOptions, firstSlot, formatWhen } from './when';

const labels = { asap: 'Lo antes posible', today: 'Hoy', tomorrow: 'Mañana' };
const rules = { stepMinutes: 30, lastOrderBeforeClose: 30, minLeadMinutes: 45, days: 7 };
// Miércoles 11/11/2026 14:25 en Guatemala.
const now = new Date('2026-11-11T20:25:00Z');

describe('etiquetas de "cuándo"', () => {
  it('ahora, hoy, mañana y otros días', () => {
    expect(formatWhen({ kind: 'now' }, '2026-11-11', 'es', labels)).toBe('Lo antes posible');
    expect(
      formatWhen(
        { kind: 'scheduled', date: '2026-11-11', time: '15:30' },
        '2026-11-11',
        'es',
        labels,
      ),
    ).toBe('Hoy, 3:30 p. m.');
    expect(
      formatWhen(
        { kind: 'scheduled', date: '2026-11-12', time: '19:00' },
        '2026-11-11',
        'es',
        labels,
      ),
    ).toBe('Mañana, 7:00 p. m.');
    expect(
      formatWhen(
        { kind: 'scheduled', date: '2026-11-14', time: '12:00' },
        '2026-11-11',
        'es',
        labels,
      ),
    ).toMatch(/^Sáb.*14 nov, 12:00 p\. m\.$/);
    expect(
      formatWhen({ kind: 'scheduled', date: '2026-11-12', time: '19:00' }, '2026-11-11', 'en', {
        ...labels,
        tomorrow: 'Tomorrow',
      }),
    ).toBe('Tomorrow, 7:00 p.m.');
  });

  it('ofrece 7 días con etiqueta y el primer horario respeta la anticipación', () => {
    const days = dateOptions(rules, BRANCH_HOURS_SEEDS['sucursal-1']!, now, 'es', labels);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: '2026-11-11', label: 'Hoy', sub: '11 nov' });
    expect(days[1]).toMatchObject({ date: '2026-11-12', label: 'Mañana' });
    expect(firstSlot(rules, BRANCH_HOURS_SEEDS['sucursal-1']!, '2026-11-11', now)).toBe('15:30');
    expect(firstSlot(rules, BRANCH_HOURS_SEEDS['sucursal-1']!, '2026-11-12', now)).toBe('12:00');
  });
});
