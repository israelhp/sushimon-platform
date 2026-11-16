import { describe, expect, it } from 'vitest';
import { msUntilNextChange } from './hooks';

describe('msUntilNextChange: refetch en `nextChangeAt` con el reloj del SERVIDOR', () => {
  const list = {
    generatedAt: '2026-11-11T20:25:00.000Z',
    nextChangeAt: '2026-11-11T21:00:00.000Z',
  };

  it('espera lo que falta según el servidor (35 min) más 1 s de holgura', () => {
    expect(msUntilNextChange(list, 1_000, 1_000)).toBe(35 * 60_000 + 1_000);
  });

  it('descuenta lo transcurrido desde que llegó la respuesta, sin mirar la fecha del dispositivo', () => {
    // El dispositivo cree que es 2030: solo importa el transcurso (10 min).
    const received = Date.parse('2030-01-01T00:00:00Z');
    expect(msUntilNextChange(list, received, received + 10 * 60_000)).toBe(25 * 60_000 + 1_000);
  });

  it('si ya pasó, vuelve a pedir tras la holgura; sin próximo cambio no programa nada', () => {
    expect(msUntilNextChange(list, 0, 3 * 3_600_000)).toBe(1_000);
    expect(msUntilNextChange({ ...list, nextChangeAt: null }, 0, 0)).toBeNull();
  });

  it('acota al máximo de setTimeout', () => {
    expect(
      msUntilNextChange(
        { generatedAt: list.generatedAt, nextChangeAt: '2036-11-11T20:25:00Z' },
        0,
        0,
      ),
    ).toBe(2_147_000_000);
  });
});
