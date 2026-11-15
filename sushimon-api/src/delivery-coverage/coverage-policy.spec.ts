import {
  candidateKeys,
  deriveEligibility,
  selectOwnMatch,
  type OwnCandidate,
} from './coverage-policy.js';
import type { CoverageStatus, ProviderIntegrationStatus } from './coverage.types.js';

const general: OwnCandidate = { id: 'g', zoneKey: '', baseFee: '20.00' };
const zone4: OwnCandidate = { id: 'z4', zoneKey: 'zona 4', baseFee: '15.00' };

describe('selectOwnMatch (D8)', () => {
  it('zona específica > general > ninguna', () => {
    expect(selectOwnMatch([general, zone4], 'zona 4')).toEqual({
      candidate: zone4,
      matchedBy: 'ZONE',
    });
    expect(selectOwnMatch([zone4, general], 'zona 4')?.candidate.id).toBe('z4'); // orden irrelevante
    expect(selectOwnMatch([general], 'zona 4')).toEqual({
      candidate: general,
      matchedBy: 'MUNICIPALITY',
    });
    expect(selectOwnMatch([zone4], 'zona 9')).toBeNull();
    expect(selectOwnMatch([], 'zona 4')).toBeNull();
  });

  it('sin zona solo puede aplicar la general (una zona específica no se elige «por ser la primera»)', () => {
    expect(selectOwnMatch([zone4, general], '')?.matchedBy).toBe('MUNICIPALITY');
    expect(selectOwnMatch([zone4], '')).toBeNull();
  });

  it('claves candidatas: específica y general, o solo general', () => {
    expect(candidateKeys('zona 4')).toEqual(['zona 4', '']);
    expect(candidateKeys('')).toEqual(['']);
  });
});

type Case = {
  name: string;
  py: CoverageStatus;
  ownOn: boolean;
  own: 'AVAILABLE' | 'UNAVAILABLE';
  confirmed: string[];
  pending: string[];
  status: string;
};

describe('deriveEligibility (D20): escenarios A–G con PedidosYa habilitado', () => {
  const cases: Case[] = [
    {
      name: 'A',
      py: 'AVAILABLE',
      ownOn: false,
      own: 'UNAVAILABLE',
      confirmed: ['PEDIDOSYA'],
      pending: [],
      status: 'CONFIRMED',
    },
    {
      name: 'B',
      py: 'AVAILABLE',
      ownOn: true,
      own: 'AVAILABLE',
      confirmed: ['PEDIDOSYA', 'OWN'],
      pending: [],
      status: 'CONFIRMED',
    },
    {
      name: 'C',
      py: 'UNAVAILABLE',
      ownOn: true,
      own: 'AVAILABLE',
      confirmed: ['OWN'],
      pending: [],
      status: 'CONFIRMED',
    },
    {
      name: 'D',
      py: 'UNAVAILABLE',
      ownOn: false,
      own: 'UNAVAILABLE',
      confirmed: [],
      pending: [],
      status: 'NONE',
    },
    {
      name: 'E',
      py: 'UNKNOWN',
      ownOn: false,
      own: 'UNAVAILABLE',
      confirmed: [],
      pending: ['PEDIDOSYA'],
      status: 'PENDING',
    },
    {
      name: 'F',
      py: 'UNKNOWN',
      ownOn: true,
      own: 'AVAILABLE',
      confirmed: ['OWN'],
      pending: ['PEDIDOSYA'],
      status: 'CONFIRMED',
    },
    {
      name: 'G',
      py: 'UNKNOWN',
      ownOn: true,
      own: 'UNAVAILABLE',
      confirmed: [],
      pending: ['PEDIDOSYA'],
      status: 'PENDING',
    },
  ];
  it.each(cases)('escenario $name', (c) => {
    const e = deriveEligibility({
      pedidosya: { enabled: true, coverageStatus: c.py, integrationStatus: 'BLOCKED_EXTERNAL' },
      own: { enabled: c.ownOn, coverageStatus: c.own },
    });
    expect(e).toEqual({
      status: c.status,
      confirmedProviders: c.confirmed,
      pendingProviders: c.pending,
      simulated: false,
    });
  });

  it('PedidosYa deshabilitado no entra en confirmados ni pendientes (aunque diga AVAILABLE/UNKNOWN)', () => {
    for (const status of ['AVAILABLE', 'UNKNOWN', 'UNAVAILABLE'] as CoverageStatus[]) {
      const e = deriveEligibility({
        pedidosya: { enabled: false, coverageStatus: status, integrationStatus: 'MOCK' },
        own: { enabled: false, coverageStatus: 'UNAVAILABLE' },
      });
      expect(e).toEqual({
        status: 'NONE',
        confirmedProviders: [],
        pendingProviders: [],
        simulated: false,
      });
    }
    const own = deriveEligibility({
      pedidosya: {
        enabled: false,
        coverageStatus: 'UNKNOWN',
        integrationStatus: 'BLOCKED_EXTERNAL',
      },
      own: { enabled: true, coverageStatus: 'AVAILABLE' },
    });
    expect(own).toMatchObject({
      status: 'CONFIRMED',
      confirmedProviders: ['OWN'],
      pendingProviders: [],
    });
  });

  it('OWN deshabilitado nunca es confirmado aunque el estado diga AVAILABLE', () => {
    const e = deriveEligibility({
      pedidosya: { enabled: true, coverageStatus: 'UNAVAILABLE', integrationStatus: 'LIVE' },
      own: { enabled: false, coverageStatus: 'AVAILABLE' },
    });
    expect(e.status).toBe('NONE');
  });

  it('simulated solo con integrationStatus MOCK y PedidosYa habilitado', () => {
    const sim = (integrationStatus: ProviderIntegrationStatus, enabled = true) =>
      deriveEligibility({
        pedidosya: { enabled, coverageStatus: 'AVAILABLE', integrationStatus },
        own: { enabled: false, coverageStatus: 'UNAVAILABLE' },
      }).simulated;
    expect(sim('MOCK')).toBe(true);
    expect(sim('BLOCKED_EXTERNAL')).toBe(false);
    expect(sim('LIVE')).toBe(false);
    expect(sim('MOCK', false)).toBe(false);
  });
});
