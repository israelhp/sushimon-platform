import { describe, expect, it } from 'vitest';
import type { OrderTracking, OrderTrackingStep } from '@/lib/data-access/models';
import { KNOWN_PHASES, buildPhaseViews, isKnownPhase, phaseTextKey } from './tracking-model';

const T = (n: number) => `2026-11-18T${String(18 + n).padStart(2, '0')}:00:00.000Z`;
const steps = (...pairs: [OrderTrackingStep['phase'], number | null][]): OrderTrackingStep[] =>
  pairs.map(([phase, n]) => ({ phase, reachedAt: n === null ? null : T(n) }));
const view = (
  publicStatus: OrderTracking['publicStatus'],
  s: OrderTrackingStep[],
  terminal = false,
) => buildPhaseViews({ publicStatus, steps: s, terminal });

describe('phaseTextKey', () => {
  it('el texto depende del código y de la modalidad (ready, completed)', () => {
    expect(phaseTextKey('ready', 'PICKUP')).toBe('readyPickup');
    expect(phaseTextKey('ready', 'DELIVERY')).toBe('readyDelivery');
    expect(phaseTextKey('completed', 'PICKUP')).toBe('pickedUp');
    expect(phaseTextKey('completed', 'DELIVERY')).toBe('delivered');
    expect(phaseTextKey('on_the_way', 'DELIVERY')).toBe('onTheWay');
    expect(phaseTextKey('received', 'PICKUP')).toBe('received');
    expect(phaseTextKey('rejected', 'PICKUP')).toBe('rejected');
  });
  it('un código futuro desconocido usa la etiqueta neutra', () => {
    expect(phaseTextKey('refunded', 'PICKUP')).toBe('unknown');
    expect(isKnownPhase('refunded')).toBe(false);
    expect(KNOWN_PHASES.every(isKnownPhase)).toBe(true);
  });
});

describe('buildPhaseViews', () => {
  it('en curso: anteriores hechas con hora, actual destacada, futuras pendientes SIN hora', () => {
    const v = view(
      'preparing',
      steps(
        ['received', 0],
        ['accepted', 1],
        ['preparing', 2],
        ['ready', null],
        ['completed', null],
      ),
    );
    expect(v.map((x) => x.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);
    expect(v.map((x) => x.reachedAt)).toEqual([T(0), T(1), T(2), null, null]);
  });

  it('un salto en el historial: la fase omitida queda superada (skipped) y sin hora (no se inventa)', () => {
    const v = view(
      'preparing',
      steps(
        ['received', 0],
        ['accepted', null],
        ['preparing', 2],
        ['ready', null],
        ['completed', null],
      ),
    );
    expect(v[1]).toMatchObject({ phase: 'accepted', state: 'skipped', reachedAt: null });
  });

  it('terminado con éxito: todas hechas', () => {
    const v = view(
      'completed',
      steps(['received', 0], ['accepted', 1], ['preparing', 2], ['ready', 3], ['completed', 4]),
      true,
    );
    expect(v.every((x) => x.state === 'done')).toBe(true);
  });

  it('rechazado/cancelado cortan el recorrido: sin etapas futuras, la terminal destacada como negativa', () => {
    for (const phase of ['rejected', 'cancelled'] as const) {
      const v = view(phase, steps(['received', 0], ['accepted', 1], [phase, 2]), true);
      expect(v.map((x) => x.phase)).toEqual(['received', 'accepted', phase]);
      expect(v.at(-1)).toMatchObject({ state: 'current', negative: true });
      expect(v.some((x) => x.state === 'pending')).toBe(false);
    }
    // Aunque el servidor enviara etapas futuras, no se muestran.
    const defensive = view(
      'cancelled',
      steps(['received', 0], ['accepted', null], ['preparing', null], ['cancelled', 3]),
      true,
    );
    expect(defensive.map((x) => x.phase)).toEqual(['received', 'cancelled']);
  });

  it('steps vacío o con fase actual ausente no rompe', () => {
    expect(view('received', [])).toEqual([]);
    const v = view('on_the_way', steps(['received', 0], ['accepted', null]));
    expect(v.map((x) => x.state)).toEqual(['done', 'pending']);
  });
});
