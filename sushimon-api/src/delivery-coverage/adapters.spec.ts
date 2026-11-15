import { PEDIDOSYA_MOCK_SCENARIOS } from '../config/env.js';
import { MockPedidosYaCoverageAdapter } from './mock-pedidosya-coverage.adapter.js';
import { UnavailableIntegrationAdapter } from './unavailable-integration.adapter.js';

const REQ = { branchId: 'b', municipalityId: 'm', zone: null };

describe('UnavailableIntegrationAdapter', () => {
  it('siempre UNKNOWN / BLOCKED_EXTERNAL / INTEGRATION_NOT_CONFIGURED, sin red', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const adapter = new UnavailableIntegrationAdapter();
    expect(adapter.integrationStatus).toBe('BLOCKED_EXTERNAL');
    expect(await adapter.checkCoverage(REQ)).toEqual({
      provider: 'PEDIDOSYA',
      status: 'UNKNOWN',
      integrationStatus: 'BLOCKED_EXTERNAL',
      reason: 'INTEGRATION_NOT_CONFIGURED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('MockPedidosYaCoverageAdapter (determinista, sin red)', () => {
  const expected = {
    available: { status: 'AVAILABLE' },
    unavailable: { status: 'UNAVAILABLE' },
    unknown: { status: 'UNKNOWN', reason: 'PROVIDER_UNDETERMINED' },
    timeout: { status: 'UNKNOWN', reason: 'PROVIDER_TIMEOUT' },
    provider_error: { status: 'UNKNOWN', reason: 'PROVIDER_ERROR' },
    invalid_request: { status: 'UNKNOWN', reason: 'INVALID_REQUEST' },
  } as const;

  it('cubre los 6 escenarios, todos con integrationStatus MOCK', async () => {
    expect(Object.keys(expected).sort()).toEqual([...PEDIDOSYA_MOCK_SCENARIOS].sort());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const scenario of PEDIDOSYA_MOCK_SCENARIOS) {
      const adapter = new MockPedidosYaCoverageAdapter(scenario);
      expect(adapter.integrationStatus).toBe('MOCK');
      expect(await adapter.checkCoverage(REQ), scenario).toEqual({
        provider: 'PEDIDOSYA',
        integrationStatus: 'MOCK',
        ...expected[scenario],
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('determinista: misma entrada, misma salida, independiente de la entrada y del reloj', async () => {
    const adapter = new MockPedidosYaCoverageAdapter('available');
    const a = await adapter.checkCoverage(REQ);
    const b = await adapter.checkCoverage({
      branchId: 'otra',
      municipalityId: 'otro',
      zone: 'Zona 1',
    });
    expect(a).toEqual(b);
  });
});
