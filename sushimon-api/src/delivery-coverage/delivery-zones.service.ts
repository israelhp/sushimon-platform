import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService, type AuditValues } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import { codedException } from '../common/errors/coded-exception.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  DeliveryCoverageRepository,
  type CoverageTx,
  type ZoneRecord,
} from './delivery-coverage.repository.js';
import {
  duplicateZoneError,
  isZoneDuplicate,
  translateCheckError,
  versionConflictError,
} from './delivery-db-errors.js';
import type {
  CreateDeliveryZoneRequest,
  ListDeliveryZonesQuery,
  UpdateDeliveryZoneRequest,
  UpdateDeliveryZoneStatusRequest,
} from './dto/delivery-zone-requests.dto.js';
import type {
  AdminDeliveryZoneDto,
  AdminDeliveryZonePageDto,
} from './dto/delivery-zone-responses.dto.js';
import { normalizeMoney, normalizeZone, normalizeZoneLabel, zoneKeyOf } from './zone-policy.js';

const READ = 'branches.read';
const MANAGE = 'branches.manage_delivery_zones';
const ENTITY = 'delivery_zone';
const NOT_FOUND_BRANCH = 'Sucursal no encontrada';
const NOT_FOUND_ZONE = 'Zona no encontrada';

const view = (z: ZoneRecord): AdminDeliveryZoneDto => ({
  id: z.id,
  branchId: z.branchId,
  municipalityId: z.municipalityId,
  municipalityName: z.municipalityName,
  departmentId: z.departmentId,
  departmentName: z.departmentName,
  zoneLabel: z.zoneLabel,
  baseFee: z.baseFee,
  currency: 'GTQ',
  active: z.active,
  version: z.version,
  createdAt: z.createdAt.toISOString(),
  updatedAt: z.updatedAt.toISOString(),
});

/**
 * Zonas propias de entrega (admin). JWT → personal activo con el permiso → aal2 (guards) → alcance por sucursal con
 * `canAccess/scopeFor` (fuera de alcance o inexistente = 404). Sin borrado físico. Auditoría en la misma transacción.
 */
@Injectable()
export class DeliveryZonesService {
  private readonly logger = new Logger(DeliveryZonesService.name);

  constructor(
    @Inject(DeliveryCoverageRepository) private readonly repo: DeliveryCoverageRepository,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(
    staff: StaffContext,
    query: ListDeliveryZonesQuery,
  ): Promise<AdminDeliveryZonePageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    let branchId: string | null = null;
    let scope: string[] | null = null;
    if (query.branchId) {
      // `branchId` ajeno o inexistente: 404 (no se distingue; una inactiva SÍ se lista).
      if (
        !this.authorization.canAccess(staff, READ, query.branchId) ||
        !(await this.branches.getStatus(query.branchId))
      ) {
        throw new NotFoundException(NOT_FOUND_BRANCH);
      }
      branchId = query.branchId;
    } else {
      const s = this.authorization.scopeFor(staff, READ);
      if (!s.allBranches && s.branchIds.length === 0)
        return { items: [], page, pageSize, total: 0 };
      scope = s.allBranches ? null : s.branchIds;
    }
    const q = normalizeZone(query.q);
    const { items, total } = await this.repo.listZones({
      branchId,
      scope,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.municipalityId ? { municipalityId: query.municipalityId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(q.key !== '' ? { keyContains: q.key } : {}),
      sort: query.sort ?? 'municipality',
      order: query.order ?? 'asc',
      page,
      pageSize,
    });
    return { items: items.map(view), page, pageSize, total };
  }

  async get(staff: StaffContext, id: string): Promise<AdminDeliveryZoneDto> {
    const zone = await this.repo.findZone(id);
    if (!zone || !this.authorization.canAccess(staff, READ, zone.branchId)) {
      throw new NotFoundException(NOT_FOUND_ZONE);
    }
    return view(zone);
  }

  async create(
    staff: StaffContext,
    input: CreateDeliveryZoneRequest,
  ): Promise<AdminDeliveryZoneDto> {
    if (
      !this.authorization.canAccess(staff, MANAGE, input.branchId) ||
      !(await this.branches.getStatus(input.branchId)) // inactiva SÍ admite zonas
    ) {
      throw new NotFoundException(NOT_FOUND_BRANCH);
    }
    const { label, key } = normalizeZone(input.zoneLabel);
    const baseFee = normalizeMoney(input.baseFee);
    const active = input.active ?? true;
    const run = async (tx: CoverageTx): Promise<AdminDeliveryZoneDto> => {
      if (!(await this.repo.municipalityExists(input.municipalityId, tx))) {
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
      const existing = await this.repo.findZoneByKey(input.branchId, input.municipalityId, key, tx);
      if (existing) throw duplicateZoneError(existing.id);
      const created = await this.repo.insertZone(tx, {
        branchId: input.branchId,
        municipalityId: input.municipalityId,
        zoneLabel: label,
        zoneKey: key,
        baseFee,
        active,
      });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: input.branchId,
        entityType: ENTITY,
        entityId: created.id,
        action: 'delivery_zone.created',
        newValues: {
          zoneLabel: label,
          municipalityId: input.municipalityId,
          baseFee,
          active,
        },
      });
      this.logger.log(
        `Zona creada (id=${created.id}, branch=${input.branchId}, staff=${staff.staffId})`,
      );
      return view(created);
    };
    return this.inTransaction(run, () => ({
      branchId: input.branchId,
      municipalityId: input.municipalityId,
      key,
    }));
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdateDeliveryZoneRequest,
  ): Promise<AdminDeliveryZoneDto> {
    if (input.zoneLabel === undefined && input.baseFee === undefined) {
      throw new BadRequestException(['Indique al menos zoneLabel o baseFee']);
    }
    const nextLabelInput =
      input.zoneLabel === undefined ? undefined : normalizeZoneLabel(input.zoneLabel);
    const nextFeeInput = input.baseFee === undefined ? undefined : normalizeMoney(input.baseFee);
    let ctx: { branchId: string; municipalityId: string; key: string } | undefined;
    return this.inTransaction(
      async (tx) => {
        const current = await this.findManageable(staff, id, tx);
        if (input.expectedVersion !== current.version) throw versionConflictError();
        const label = nextLabelInput === undefined ? current.zoneLabel : nextLabelInput;
        const baseFee = nextFeeInput ?? current.baseFee;
        if (label === current.zoneLabel && baseFee === current.baseFee) return view(current);
        const key = zoneKeyOf(label);
        ctx = { branchId: current.branchId, municipalityId: current.municipalityId, key };
        if (key !== current.zoneKey) {
          const dup = await this.repo.findZoneByKey(
            current.branchId,
            current.municipalityId,
            key,
            tx,
          );
          if (dup && dup.id !== id) throw duplicateZoneError(dup.id);
        }
        const updated = await this.repo.updateZone(tx, id, input.expectedVersion, {
          zoneLabel: label,
          zoneKey: key,
          baseFee,
        });
        if (!updated) throw versionConflictError();
        const oldValues: AuditValues = {};
        const newValues: AuditValues = {};
        if (label !== current.zoneLabel) {
          oldValues['zoneLabel'] = current.zoneLabel;
          newValues['zoneLabel'] = label;
        }
        if (baseFee !== current.baseFee) {
          oldValues['baseFee'] = current.baseFee;
          newValues['baseFee'] = baseFee;
        }
        await this.audit.record(tx, {
          actorId: staff.staffId,
          branchId: current.branchId,
          entityType: ENTITY,
          entityId: id,
          action: 'delivery_zone.updated',
          oldValues,
          newValues,
        });
        this.logger.log(
          `Zona actualizada (id=${id}, branch=${current.branchId}, staff=${staff.staffId})`,
        );
        return view(updated);
      },
      () => ctx,
    );
  }

  async setStatus(
    staff: StaffContext,
    id: string,
    input: UpdateDeliveryZoneStatusRequest,
  ): Promise<AdminDeliveryZoneDto> {
    return this.inTransaction(async (tx) => {
      const current = await this.findManageable(staff, id, tx);
      if (current.active === input.active) return view(current); // idempotente: sin escritura ni auditoría
      // Último gana: sin `expectedVersion`; el cambio real sube `version`.
      const updated = await this.repo.updateZone(tx, id, null, { active: input.active });
      if (!updated) throw new NotFoundException(NOT_FOUND_ZONE);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: current.branchId,
        entityType: ENTITY,
        entityId: id,
        action: 'delivery_zone.status_changed',
        reason: input.reason?.trim() ? input.reason.trim() : null,
        oldValues: { active: current.active },
        newValues: { active: input.active },
      });
      this.logger.log(
        `Zona ${input.active ? 'activada' : 'desactivada'} (id=${id}, branch=${current.branchId}, staff=${staff.staffId})`,
      );
      return view(updated);
    });
  }

  /** Zona existente y dentro del alcance de `manage_delivery_zones`; si no, 404 (sin distinguir). */
  private async findManageable(
    staff: StaffContext,
    id: string,
    tx: CoverageTx,
  ): Promise<ZoneRecord> {
    const zone = await this.repo.findZone(id, tx);
    if (!zone || !this.authorization.canAccess(staff, MANAGE, zone.branchId)) {
      throw new NotFoundException(NOT_FOUND_ZONE);
    }
    return zone;
  }

  /**
   * Transacción de escritura. `23505` sobre la clave única (carrera de duplicados): 409 `DELIVERY_ZONE_DUPLICATE`
   * con la zona ganadora (se lee fuera de la transacción abortada). CHECK de BD: 400 genérico.
   */
  private async inTransaction<T>(
    fn: (tx: CoverageTx) => Promise<T>,
    keyOf?: () => { branchId: string; municipalityId: string; key: string } | undefined,
  ): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      if (isZoneDuplicate(error)) {
        const k = keyOf?.();
        const existing = k
          ? await this.repo.findZoneByKey(k.branchId, k.municipalityId, k.key).catch(() => null)
          : null;
        throw duplicateZoneError(existing?.id ?? null);
      }
      throw translateCheckError(error);
    }
  }
}
