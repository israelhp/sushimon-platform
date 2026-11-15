import { Inject, Injectable } from '@nestjs/common';
import { candidateKeys, selectOwnMatch } from './coverage-policy.js';
import { DEFAULT_DELIVERY_SETTINGS, type OwnCoverageEvaluation } from './coverage.types.js';
import { DeliveryCoverageRepository, type CoverageTx } from './delivery-coverage.repository.js';
import { normalizeZone } from './zone-policy.js';

export interface OwnCoverageInput {
  branchId: string;
  municipalityId: string;
  /** Etiqueta ya normalizada o cruda: se reduce a su clave con la misma función que las zonas (D6). */
  zone?: string | null;
  /** Para consumidores que ya leyeron el flag (el orquestador): evita una segunda lectura. */
  ownEnabled?: boolean;
  tx?: CoverageTx;
}

const NONE = { deliveryZoneId: null, baseFee: null, currency: 'GTQ', matchedBy: null } as const;

/**
 * Cobertura PROPIA (D16/D8). Asume `branchId` y `municipalityId` ya validados. Con el flag apagado NO consulta
 * zonas. Con el flag encendido hace UNA consulta acotada por clave: zona específica > cobertura general > nada.
 * Una zona inactiva no existe para esta evaluación.
 */
@Injectable()
export class OwnDeliveryCoverageService {
  constructor(
    @Inject(DeliveryCoverageRepository) private readonly repo: DeliveryCoverageRepository,
  ) {}

  async evaluate(input: OwnCoverageInput): Promise<OwnCoverageEvaluation> {
    const enabled =
      input.ownEnabled ??
      (await this.repo.findSettings(input.branchId, input.tx))?.ownDeliveryZonesEnabled ??
      DEFAULT_DELIVERY_SETTINGS.ownDeliveryZonesEnabled;
    if (!enabled) return { status: 'UNAVAILABLE', ...NONE, reason: 'PROVIDER_DISABLED' };

    const zoneKey = normalizeZone(input.zone).key;
    const candidates = await this.repo.findOwnCandidates(
      input.branchId,
      input.municipalityId,
      candidateKeys(zoneKey),
      input.tx,
    );
    const match = selectOwnMatch(candidates, zoneKey);
    if (!match) return { status: 'UNAVAILABLE', ...NONE, reason: 'NO_ZONE_COVERAGE' };
    return {
      status: 'AVAILABLE',
      deliveryZoneId: match.candidate.id,
      baseFee: match.candidate.baseFee,
      currency: 'GTQ',
      matchedBy: match.matchedBy,
    };
  }
}
