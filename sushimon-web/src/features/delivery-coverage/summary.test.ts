import { describe, expect, it } from 'vitest';
import type { DeliveryCoverageCheckResponse } from '@/lib/data-access/models';
import { bestOutcome, compareFee, outcomeOf, type CoverageOutcome } from './summary';

const response = (
  branchId: string,
  eligibility: DeliveryCoverageCheckResponse['eligibility'],
  ownFee: string | null = null,
): DeliveryCoverageCheckResponse => ({
  branchId,
  municipalityId: 'm',
  zone: null,
  checkedAt: '2026-11-11T20:25:00.000Z',
  providers: {
    PEDIDOSYA: {
      enabled: true,
      coverageStatus: 'UNKNOWN',
      integrationStatus: 'BLOCKED_EXTERNAL',
      quoteStatus: 'NOT_AVAILABLE',
    },
    OWN: {
      enabled: true,
      coverageStatus: ownFee ? 'AVAILABLE' : 'UNAVAILABLE',
      deliveryZoneId: ownFee ? 'z' : null,
      baseFee: ownFee,
      currency: 'GTQ',
      matchedBy: ownFee ? 'ZONE' : null,
    },
  },
  eligibility,
});

const own = (id: string, fee: string) =>
  outcomeOf(
    response(
      id,
      {
        status: 'CONFIRMED',
        confirmedProviders: ['OWN'],
        pendingProviders: ['PEDIDOSYA'],
        simulated: false,
      },
      fee,
    ),
  );

describe('lectura de la elegibilidad del servidor', () => {
  it('F: propios confirmados + PedidosYa pendiente => confirmado con la tarifa propia', () => {
    expect(own('s1', '15.00')).toEqual({
      kind: 'confirmed',
      branchId: 's1',
      provider: 'OWN',
      fee: '15.00',
      simulated: false,
    });
  });

  it('E/G: sin confirmados y PedidosYa UNKNOWN => pendiente (no «sin cobertura»)', () => {
    expect(
      outcomeOf(
        response('s1', {
          status: 'PENDING',
          confirmedProviders: [],
          pendingProviders: ['PEDIDOSYA'],
          simulated: false,
        }),
      ),
    ).toEqual({ kind: 'pending', branchId: 's1', simulated: false });
  });

  it('D: nada confirmado ni pendiente => sin cobertura', () => {
    expect(
      outcomeOf(
        response('s1', {
          status: 'NONE',
          confirmedProviders: [],
          pendingProviders: [],
          simulated: false,
        }),
      ),
    ).toEqual({ kind: 'none', branchId: 's1' });
  });

  it('A: solo PedidosYa confirmado (simulado) => confirmado SIN tarifa y marcado como simulación', () => {
    expect(
      outcomeOf(
        response('s1', {
          status: 'CONFIRMED',
          confirmedProviders: ['PEDIDOSYA'],
          pendingProviders: [],
          simulated: true,
        }),
      ),
    ).toEqual({
      kind: 'confirmed',
      branchId: 's1',
      provider: 'PEDIDOSYA',
      fee: null,
      simulated: true,
    });
  });
});

describe('mejor resultado entre sucursales', () => {
  const pending: CoverageOutcome = { kind: 'pending', branchId: 'p', simulated: false };
  const none: CoverageOutcome = { kind: 'none', branchId: 'n' };

  it('elige la tarifa propia confirmada más barata (comparación decimal exacta)', () => {
    expect(bestOutcome([own('s1', '25.00'), own('s2', '9.99'), own('s3', '10.00')])).toMatchObject({
      branchId: 's2',
    });
    expect(compareFee('9.99', '10.00')).toBeLessThan(0);
    expect(compareFee('15', '15.00')).toBe(0);
  });

  it('con empate gana la primera sucursal (orden estable)', () => {
    expect(bestOutcome([own('s1', '15.00'), own('s2', '15.00')])).toMatchObject({ branchId: 's1' });
  });

  it('propio confirmado > PedidosYa simulado > pendiente > nada', () => {
    const py: CoverageOutcome = {
      kind: 'confirmed',
      branchId: 'y',
      provider: 'PEDIDOSYA',
      fee: null,
      simulated: true,
    };
    expect(bestOutcome([none, pending, py, own('s1', '30.00')])).toMatchObject({ branchId: 's1' });
    expect(bestOutcome([none, pending, py])).toBe(py);
    expect(bestOutcome([none, pending])).toBe(pending);
    expect(bestOutcome([none])).toBe(none);
    expect(bestOutcome([])).toBeNull();
  });
});
