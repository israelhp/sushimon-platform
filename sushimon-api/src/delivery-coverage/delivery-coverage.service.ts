import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { codedException } from '../common/errors/coded-exception.js';
import { deriveEligibility } from './coverage-policy.js';
import {
  COVERAGE_REASONS,
  type CoverageReason,
  type CoverageStatus,
  type DeliveryCoverageResult,
  type OwnCoverageView,
  type PedidosYaCoverageView,
} from './coverage.types.js';
import {
  COURIER_COVERAGE_PORT,
  type CourierCoveragePort,
  type CourierCoverageResult,
} from './courier-coverage.port.js';
import { COVERAGE_TIMEOUT_MS } from './coverage-config.js';
import { DeliveryCoverageRepository, type CoverageTx } from './delivery-coverage.repository.js';
import { OwnDeliveryCoverageService } from './own-delivery-coverage.service.js';
import { normalizeZone } from './zone-policy.js';

/** Token del puerto de dominio que consumen F19/F20 (`DeliveryCoverageService`). */
export const DELIVERY_COVERAGE_PORT = Symbol('DELIVERY_COVERAGE_PORT');

export interface DeliveryCoverageInput {
  branchId: string;
  municipalityId: string;
  zone?: string | null;
  tx?: CoverageTx;
}

export interface DeliveryCoveragePort {
  check(input: DeliveryCoverageInput): Promise<DeliveryCoverageResult>;
}

const STATUSES: readonly CoverageStatus[] = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'];

class DeadlineExceeded extends Error {}

/** Resuelve o rechaza (`DeadlineExceeded`) antes de `ms`; siempre limpia el temporizador. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * ALGORITMO ÚNICO de cobertura (D16/D18/D19/D20). El endpoint público y F19/F20 llaman a `check`; nadie lo
 * reimplementa. No depende de horarios (F08). Presupuesto: 1 consulta de contexto + 1 de zonas (solo si `OWN` está
 * habilitado); PedidosYa es una llamada al puerto (sin red en F09). Nunca 5xx ni UNAVAILABLE por fallo del proveedor.
 */
@Injectable()
export class DeliveryCoverageService implements DeliveryCoveragePort {
  private readonly logger = new Logger(DeliveryCoverageService.name);

  constructor(
    @Inject(DeliveryCoverageRepository) private readonly repo: DeliveryCoverageRepository,
    @Inject(OwnDeliveryCoverageService) private readonly own: OwnDeliveryCoverageService,
    @Inject(COURIER_COVERAGE_PORT) private readonly courier: CourierCoveragePort,
    @Inject(COVERAGE_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  async check(input: DeliveryCoverageInput): Promise<DeliveryCoverageResult> {
    const { label: zone } = normalizeZone(input.zone);
    const context = await this.repo.loadCoverageContext(
      input.branchId,
      input.municipalityId,
      input.tx,
    );
    // Inexistente e inactiva no se distinguen (no se revela el estado interno de una sucursal).
    if (context.branchActive !== true) {
      throw codedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BRANCH_NOT_AVAILABLE',
        'La sucursal no está disponible',
        [{ path: 'branchId', code: 'BRANCH_NOT_AVAILABLE', message: 'Sucursal no disponible' }],
      );
    }
    if (!context.municipalityExists) {
      throw codedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MUNICIPALITY_NOT_FOUND',
        'El municipio no existe',
        [
          {
            path: 'municipalityId',
            code: 'MUNICIPALITY_NOT_FOUND',
            message: 'Municipio inexistente',
          },
        ],
      );
    }
    const { ownDeliveryZonesEnabled, pedidosyaEnabled } = context.settings;

    // OWN y PEDIDOSYA en paralelo; OWN se evalúa aunque PedidosYa falle.
    const [ownEval, pedidosya] = await Promise.all([
      this.own.evaluate({
        branchId: input.branchId,
        municipalityId: input.municipalityId,
        zone,
        ownEnabled: ownDeliveryZonesEnabled,
        ...(input.tx ? { tx: input.tx } : {}),
      }),
      this.pedidosya(
        { branchId: input.branchId, municipalityId: input.municipalityId, zone },
        pedidosyaEnabled,
      ),
    ]);

    const ownView: OwnCoverageView = {
      enabled: ownDeliveryZonesEnabled,
      coverageStatus: ownEval.status,
      deliveryZoneId: ownEval.deliveryZoneId,
      baseFee: ownEval.baseFee,
      currency: ownEval.currency,
      matchedBy: ownEval.matchedBy,
      ...(ownEval.reason ? { reason: ownEval.reason } : {}),
    };
    return {
      branchId: input.branchId,
      municipalityId: input.municipalityId,
      zone,
      checkedAt: new Date().toISOString(),
      providers: { PEDIDOSYA: pedidosya, OWN: ownView },
      eligibility: deriveEligibility({ pedidosya, own: ownView }),
    };
  }

  /** PedidosYa deshabilitado => no se consulta. Timeout/excepción/respuesta inválida => `UNKNOWN` con motivo. */
  private async pedidosya(
    request: { branchId: string; municipalityId: string; zone: string | null },
    enabled: boolean,
  ): Promise<PedidosYaCoverageView> {
    const base = {
      quoteStatus: 'NOT_AVAILABLE',
      integrationStatus: this.courier.integrationStatus,
    } as const;
    if (!enabled) {
      return { enabled, coverageStatus: 'UNKNOWN', ...base, reason: 'PROVIDER_DISABLED' };
    }
    const unknown = (reason: CoverageReason): PedidosYaCoverageView => ({
      enabled,
      coverageStatus: 'UNKNOWN',
      ...base,
      reason,
    });
    let result: CourierCoverageResult;
    try {
      result = await withDeadline(this.courier.checkCoverage(request), this.timeoutMs);
    } catch (error) {
      // Solo el nombre de la clase de error: jamás cuerpo, mensaje ni payload del proveedor.
      const kind =
        error instanceof DeadlineExceeded ? 'timeout' : ((error as Error)?.name ?? 'error');
      this.logger.warn(`Cobertura PedidosYa sin resultado (${kind})`);
      return unknown(error instanceof DeadlineExceeded ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR');
    }
    if (!result || !STATUSES.includes(result.status)) return unknown('PROVIDER_ERROR');
    const reason =
      result.reason && COVERAGE_REASONS.includes(result.reason) ? result.reason : undefined;
    return {
      enabled,
      coverageStatus: result.status,
      integrationStatus: result.integrationStatus ?? this.courier.integrationStatus,
      quoteStatus: 'NOT_AVAILABLE',
      ...(reason ? { reason } : {}),
    };
  }
}
