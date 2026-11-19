import { describe, expect, it } from 'vitest';
import type { MyOrderSummary } from '@/lib/data-access/models';
import {
  ACTIVE_STATUSES,
  HISTORY_STATUSES,
  defaultHistoryFilters,
  hasActiveFilters,
  mergePages,
  nextDay,
  rangeProblem,
  rowActions,
  toListFilters,
} from './history-model';

const row = (id: string): MyOrderSummary =>
  ({ id, displayNumber: `MON-${id}`, terminal: false }) as MyOrderSummary;

describe('F23 · modelo del historial', () => {
  it('las pestañas envían los estados esperados al servidor (en curso / historial)', () => {
    expect(toListFilters(defaultHistoryFilters('active')).status).toEqual([
      'pending',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
    ]);
    expect(toListFilters(defaultHistoryFilters('history')).status).toEqual([
      'delivered',
      'picked_up',
      'rejected',
      'cancelled',
    ]);
    expect([...ACTIVE_STATUSES, ...HISTORY_STATUSES]).toHaveLength(9);
    expect(toListFilters(defaultHistoryFilters()).limit).toBe(20);
  });

  it('las fechas se envían como instantes con zona de Guatemala; `to` es exclusivo (día siguiente)', () => {
    const f = toListFilters({
      tab: 'history',
      branchId: 'b1',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(f).toMatchObject({
      branchId: 'b1',
      from: '2026-11-01T00:00:00-06:00',
      to: '2026-12-01T00:00:00-06:00',
    });
    expect(
      toListFilters({ ...defaultHistoryFilters(), from: '2026-12-31', to: '2026-12-31' }).to,
    ).toBe('2027-01-01T00:00:00-06:00');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(nextDay('nope')).toBeNull();
  });

  it('valida el rango: invertido, > 366 días e inválido no se envían; un solo extremo es válido', () => {
    expect(rangeProblem('2026-11-10', '2026-11-01')).toBe('inverted');
    expect(rangeProblem('2025-01-01', '2026-01-02')).toBe('tooLong');
    expect(rangeProblem('2025-01-01', '2025-12-31')).toBeNull();
    expect(rangeProblem('2026-02-31x', null)).toBe('invalid');
    expect(rangeProblem('2026-11-01', null)).toBeNull();
    const bad = toListFilters({ ...defaultHistoryFilters(), from: '2026-11-10', to: '2026-11-01' });
    expect(bad.from).toBeUndefined();
    expect(bad.to).toBeUndefined();
  });

  it('mergePages conserva el orden del servidor y no repite ids', () => {
    const rows = mergePages([{ items: [row('3'), row('2')] }, { items: [row('2'), row('1')] }]);
    expect(rows.map((r) => r.id)).toEqual(['3', '2', '1']);
    expect(mergePages(undefined)).toEqual([]);
  });

  it('acciones por fila: seguimiento solo si no es terminal; detalle, recibo y reorden siempre', () => {
    expect(rowActions({ terminal: false })).toEqual({
      tracking: true,
      detail: true,
      receipt: true,
      reorder: true,
    });
    expect(rowActions({ terminal: true }).tracking).toBe(false);
    expect(hasActiveFilters(defaultHistoryFilters())).toBe(false);
    expect(hasActiveFilters({ ...defaultHistoryFilters(), branchId: 'x' })).toBe(true);
  });
});
