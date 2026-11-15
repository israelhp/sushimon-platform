import type {
  CoverageReason,
  CoverageStatus,
  ProviderIntegrationStatus,
} from './coverage.types.js';

/** Token de inyección del puerto de cobertura del proveedor externo (PedidosYa). */
export const COURIER_COVERAGE_PORT = Symbol('COURIER_COVERAGE_PORT');

/**
 * Entrada deliberadamente MÍNIMA y neutral: F29 la ampliará de forma aditiva cuando exista documentación del
 * proveedor (coordenadas, etc.). No se asume nada de PedidosYa.
 */
export interface CourierCoverageRequest {
  branchId: string;
  municipalityId: string;
  zone?: string | null;
}

export interface CourierCoverageResult {
  provider: 'PEDIDOSYA';
  status: CoverageStatus;
  integrationStatus: ProviderIntegrationStatus;
  reason?: CoverageReason;
}

/**
 * Puerto de cobertura de un proveedor de reparto externo. Los adaptadores NUNCA reenvían texto, códigos ni payload
 * del proveedor: solo los enums propios. `UNAVAILABLE` solo puede venir de una respuesta de cobertura válida.
 */
export interface CourierCoveragePort {
  /** Estado de la integración de este adaptador (estático): lo muestran los settings aunque el proveedor esté apagado. */
  readonly integrationStatus: ProviderIntegrationStatus;
  checkCoverage(request: CourierCoverageRequest): Promise<CourierCoverageResult>;
}
