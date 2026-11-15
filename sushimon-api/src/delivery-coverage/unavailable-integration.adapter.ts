import type {
  CourierCoveragePort,
  CourierCoverageRequest,
  CourierCoverageResult,
} from './courier-coverage.port.js';

/**
 * Adaptador por defecto y ÚNICO posible en producción mientras PedidosYa no tenga documentación, sandbox ni
 * credenciales (BLOCKED_EXTERNAL). No hace red: responde `UNKNOWN` (no verificable, distinto de UNAVAILABLE).
 */
export class UnavailableIntegrationAdapter implements CourierCoveragePort {
  readonly integrationStatus = 'BLOCKED_EXTERNAL' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la entrada es parte del puerto; este adaptador no la usa
  checkCoverage(_request: CourierCoverageRequest): Promise<CourierCoverageResult> {
    return Promise.resolve({
      provider: 'PEDIDOSYA',
      status: 'UNKNOWN',
      integrationStatus: 'BLOCKED_EXTERNAL',
      reason: 'INTEGRATION_NOT_CONFIGURED',
    });
  }
}
