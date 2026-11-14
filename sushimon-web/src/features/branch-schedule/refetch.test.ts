import { describe, expect, it } from 'vitest';
import {
  MAX_REFETCH_DELAY_MS,
  MIN_REFETCH_DELAY_MS,
  REFETCH_GRACE_MS,
  nextRefetchDelay,
} from './refetch';

const base = { serverTime: '2026-11-11T20:25:00.000Z' };

describe('nextRefetchDelay', () => {
  it('sin transición no hay temporizador', () => {
    expect(nextRefetchDelay({ ...base, nextTransitionAt: null }, 0)).toBeNull();
    expect(nextRefetchDelay(undefined, 0)).toBeNull();
  });
  it('usa la diferencia entre horas del servidor más un margen', () => {
    expect(nextRefetchDelay({ ...base, nextTransitionAt: '2026-11-11T20:25:30.000Z' }, 0)).toBe(
      30_000 + REFETCH_GRACE_MS,
    );
  });
  it('descuenta el tiempo transcurrido desde la respuesta', () => {
    expect(
      nextRefetchDelay({ ...base, nextTransitionAt: '2026-11-11T20:25:30.000Z' }, 10_000),
    ).toBe(20_000 + REFETCH_GRACE_MS);
  });
  it('tope: una transición lejana se refresca antes', () => {
    expect(nextRefetchDelay({ ...base, nextTransitionAt: '2026-11-12T20:25:00.000Z' }, 0)).toBe(
      MAX_REFETCH_DELAY_MS,
    );
  });
  it('piso: una transición vencida no genera un bucle', () => {
    expect(nextRefetchDelay({ ...base, nextTransitionAt: '2026-11-11T20:24:00.000Z' }, 0)).toBe(
      MIN_REFETCH_DELAY_MS,
    );
  });
});
