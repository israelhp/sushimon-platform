import type {
  CourierProvider,
  CoverageStatus,
  DeliveryEligibilityView,
  ProviderIntegrationStatus,
} from './coverage.types.js';

export interface OwnCandidate {
  id: string;
  zoneKey: string;
  baseFee: string;
}

/**
 * Prioridad D8 sobre candidatas YA filtradas por (sucursal, municipio, activas): zona específica > cobertura
 * general (`zone_key = ''`) > ninguna. Por la unicidad D7 hay a lo sumo una candidata por clave, así que no se
 * elige «la primera»: se busca por clave exacta.
 */
export function selectOwnMatch(
  candidates: readonly OwnCandidate[],
  zoneKey: string,
): { candidate: OwnCandidate; matchedBy: 'ZONE' | 'MUNICIPALITY' } | null {
  if (zoneKey !== '') {
    const specific = candidates.find((c) => c.zoneKey === zoneKey);
    if (specific) return { candidate: specific, matchedBy: 'ZONE' };
  }
  const general = candidates.find((c) => c.zoneKey === '');
  return general ? { candidate: general, matchedBy: 'MUNICIPALITY' } : null;
}

/** Claves de zona a consultar: la específica (si la hay) y la general. */
export const candidateKeys = (zoneKey: string): string[] => (zoneKey === '' ? [''] : [zoneKey, '']);

export interface EligibilityInput {
  pedidosya: {
    enabled: boolean;
    coverageStatus: CoverageStatus;
    integrationStatus: ProviderIntegrationStatus;
  };
  own: { enabled: boolean; coverageStatus: 'AVAILABLE' | 'UNAVAILABLE' };
}

/**
 * Elegibilidad derivada (D20). `confirmed` = habilitado y AVAILABLE; `pending` = PedidosYa habilitado y UNKNOWN.
 * Un proveedor deshabilitado no entra en ninguna lista. `simulated` = el dato de PedidosYa viene del mock
 * (solo si se consultó, es decir, habilitado): nunca autoriza operaciones reales.
 */
export function deriveEligibility(input: EligibilityInput): DeliveryEligibilityView {
  const confirmedProviders: CourierProvider[] = [];
  const pendingProviders: CourierProvider[] = [];
  const { pedidosya, own } = input;
  if (pedidosya.enabled && pedidosya.coverageStatus === 'AVAILABLE') {
    confirmedProviders.push('PEDIDOSYA');
  }
  if (own.enabled && own.coverageStatus === 'AVAILABLE') confirmedProviders.push('OWN');
  if (pedidosya.enabled && pedidosya.coverageStatus === 'UNKNOWN')
    pendingProviders.push('PEDIDOSYA');
  const status =
    confirmedProviders.length > 0 ? 'CONFIRMED' : pendingProviders.length > 0 ? 'PENDING' : 'NONE';
  return {
    status,
    confirmedProviders,
    pendingProviders,
    simulated: pedidosya.enabled && pedidosya.integrationStatus === 'MOCK',
  };
}
