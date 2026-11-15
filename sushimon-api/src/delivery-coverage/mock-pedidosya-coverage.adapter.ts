import type { PedidosYaMockScenario } from '../config/env.js';
import type {
  CourierCoveragePort,
  CourierCoverageRequest,
  CourierCoverageResult,
} from './courier-coverage.port.js';

/**
 * Simulación DETERMINISTA (sin red, sin reloj, sin aleatoriedad) de la cobertura de PedidosYa. Solo desarrollo y
 * pruebas: la configuración impide arrancar con `NODE_ENV=production`. Siempre reporta `integrationStatus = MOCK`,
 * de modo que la elegibilidad queda marcada `simulated` y jamás autoriza una solicitud real. NO es PedidosYa: no
 * reproduce su API, tarifas ni estados.
 */
export class MockPedidosYaCoverageAdapter implements CourierCoveragePort {
  readonly integrationStatus = 'MOCK' as const;

  constructor(private readonly scenario: PedidosYaMockScenario) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la entrada es parte del puerto; este adaptador no la usa
  checkCoverage(_request: CourierCoverageRequest): Promise<CourierCoverageResult> {
    const base = { provider: 'PEDIDOSYA', integrationStatus: 'MOCK' } as const;
    switch (this.scenario) {
      case 'available':
        return Promise.resolve({ ...base, status: 'AVAILABLE' });
      case 'unavailable':
        return Promise.resolve({ ...base, status: 'UNAVAILABLE' });
      case 'unknown':
        return Promise.resolve({ ...base, status: 'UNKNOWN', reason: 'PROVIDER_UNDETERMINED' });
      case 'timeout':
        return Promise.resolve({ ...base, status: 'UNKNOWN', reason: 'PROVIDER_TIMEOUT' });
      case 'provider_error':
        return Promise.resolve({ ...base, status: 'UNKNOWN', reason: 'PROVIDER_ERROR' });
      case 'invalid_request':
        return Promise.resolve({ ...base, status: 'UNKNOWN', reason: 'INVALID_REQUEST' });
    }
  }
}
