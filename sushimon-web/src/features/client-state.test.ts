import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER_MODE, normalizeSchedule, parseOrderMode } from './order-mode/order-mode';

describe('modo de pedido', () => {
  it('lee preferencias válidas y descarta basura', () => {
    expect(parseOrderMode(null)).toEqual(DEFAULT_ORDER_MODE);
    expect(parseOrderMode('{"type":"x"}')).toEqual(DEFAULT_ORDER_MODE);
    expect(
      parseOrderMode(
        '{"type":"delivery","when":{"kind":"scheduled","date":"2026-11-12","time":"13:00"},"branchId":"sucursal-1","address":{"department":"Guatemala","municipality":"Guatemala","zone":"10"}}',
      ),
    ).toEqual({
      type: 'delivery',
      when: { kind: 'scheduled', date: '2026-11-12', time: '13:00' },
      branchId: 'sucursal-1',
      address: {
        department: 'Guatemala',
        municipality: 'Guatemala',
        zone: '10',
        line: '',
        references: '',
      },
    });
  });

  it('vuelve a "ahora" si el horario programado ya no es válido', () => {
    const mode = {
      ...DEFAULT_ORDER_MODE,
      type: 'pickup' as const,
      when: { kind: 'scheduled' as const, date: '2026-11-01', time: '13:00' },
    };
    expect(normalizeSchedule(mode, () => false).when).toEqual({ kind: 'now' });
    expect(normalizeSchedule(mode, () => true)).toBe(mode);
  });
});
