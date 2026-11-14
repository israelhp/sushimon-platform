import { describe, expect, it } from 'vitest';
import { clockOf, isNotAccepting, relativeDay, statusKind } from './availability-view';

describe('availability-view', () => {
  it('categoriza reason en 4 estados visuales', () => {
    expect(statusKind({ reason: 'OPEN' })).toBe('open');
    expect(statusKind({ reason: 'OUTSIDE_BUSINESS_HOURS' })).toBe('closed');
    expect(statusKind({ reason: 'EXCEPTIONAL_CLOSURE' })).toBe('closure');
    expect(statusKind({ reason: 'SCHEDULE_NOT_CONFIGURED' })).toBe('notConfigured');
  });

  const server = '2026-11-11T20:25:00.000Z'; // mié 11, 14:25 GT
  it('día relativo en hora de Guatemala (no UTC)', () => {
    expect(relativeDay('2026-11-12T03:00:00.000Z', server)).toEqual({ kind: 'today' }); // mié 21:00 GT
    expect(relativeDay('2026-11-12T06:00:00.000Z', server)).toEqual({ kind: 'tomorrow' }); // jue 00:00 GT
    expect(relativeDay('2026-11-14T18:00:00.000Z', server)).toEqual({
      kind: 'weekday',
      weekday: 6,
    });
    expect(relativeDay('2026-11-16T18:00:00.000Z', server)).toEqual({
      kind: 'weekday',
      weekday: 1,
    });
    expect(relativeDay('2026-11-15T18:00:00.000Z', server)).toEqual({
      kind: 'weekday',
      weekday: 7,
    });
  });
  it('hora local', () => {
    expect(clockOf('2026-11-12T04:00:00.000Z')).toBe('22:00');
  });
  it('isNotAccepting no asume cerrada sin datos', () => {
    expect(isNotAccepting(undefined)).toBeUndefined();
  });
});
