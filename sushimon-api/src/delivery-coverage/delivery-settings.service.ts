import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService, type AuditValues } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettingsValues } from './coverage.types.js';
import { COURIER_COVERAGE_PORT, type CourierCoveragePort } from './courier-coverage.port.js';
import { DeliveryCoverageRepository, type SettingsRecord } from './delivery-coverage.repository.js';
import { translateCheckError } from './delivery-db-errors.js';
import type { UpdateBranchDeliverySettingsRequest } from './dto/delivery-zone-requests.dto.js';
import type { BranchDeliverySettingsDto } from './dto/delivery-zone-responses.dto.js';

const READ = 'branches.read';
const MANAGE = 'branches.manage_delivery_zones';
const NOT_FOUND = 'Sucursal no encontrada';
const FLAGS = ['ownDeliveryZonesEnabled', 'pedidosyaEnabled'] as const;

/** Configuración logística por sucursal (D4). Fila ausente = defaults (`isDefault`, `updatedAt = null`). */
@Injectable()
export class DeliverySettingsService {
  private readonly logger = new Logger(DeliverySettingsService.name);

  constructor(
    @Inject(DeliveryCoverageRepository) private readonly repo: DeliveryCoverageRepository,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(COURIER_COVERAGE_PORT) private readonly courier: CourierCoveragePort,
  ) {}

  async get(staff: StaffContext, branchId: string): Promise<BranchDeliverySettingsDto> {
    if (
      !this.authorization.canAccess(staff, READ, branchId) ||
      !(await this.branches.getStatus(branchId)) // una sucursal inactiva SÍ se consulta
    ) {
      throw new NotFoundException(NOT_FOUND);
    }
    return this.view(branchId, await this.repo.findSettings(branchId));
  }

  async update(
    staff: StaffContext,
    branchId: string,
    input: UpdateBranchDeliverySettingsRequest,
  ): Promise<BranchDeliverySettingsDto> {
    if (
      !this.authorization.canAccess(staff, MANAGE, branchId) ||
      !(await this.branches.getStatus(branchId))
    ) {
      throw new NotFoundException(NOT_FOUND);
    }
    const patch: Partial<DeliverySettingsValues> = {};
    for (const f of FLAGS) if (input[f] !== undefined) patch[f] = input[f];
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException([
        'Indique al menos ownDeliveryZonesEnabled o pedidosyaEnabled',
      ]);
    }
    try {
      return await this.repo.transaction(async (tx) => {
        const current = await this.repo.findSettings(branchId, tx);
        const before: DeliverySettingsValues = current ?? DEFAULT_DELIVERY_SETTINGS;
        const oldValues: AuditValues = {};
        const newValues: AuditValues = {};
        for (const f of FLAGS) {
          const next = patch[f];
          if (next !== undefined && next !== before[f]) {
            oldValues[f] = before[f];
            newValues[f] = next;
          }
        }
        // Sin cambios reales (también sobre defaults sin fila): ni escritura ni auditoría.
        if (Object.keys(newValues).length === 0) return this.view(branchId, current);
        const saved = await this.repo.upsertSettings(tx, branchId, patch);
        await this.audit.record(tx, {
          actorId: staff.staffId,
          branchId,
          entityType: 'branch_delivery_settings',
          entityId: branchId,
          action: 'branch_delivery_settings.updated',
          oldValues,
          newValues,
        });
        this.logger.log(
          `Settings de entrega actualizados (branch=${branchId}, staff=${staff.staffId})`,
        );
        return this.view(branchId, saved);
      });
    } catch (error) {
      throw translateCheckError(error);
    }
  }

  private view(branchId: string, row: SettingsRecord | null): BranchDeliverySettingsDto {
    const values: DeliverySettingsValues = row ?? DEFAULT_DELIVERY_SETTINGS;
    return {
      branchId,
      ownDeliveryZonesEnabled: values.ownDeliveryZonesEnabled,
      pedidosyaEnabled: values.pedidosyaEnabled,
      pedidosyaIntegrationStatus: this.courier.integrationStatus,
      isDefault: row === null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }
}
