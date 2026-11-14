import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import { codedException } from '../common/errors/coded-exception.js';
import type { StaffContext } from '../identity/identity.types.js';
import { MS_PER_DAY } from './business-time.js';
import { BranchScheduleRepository, type ScheduleTx } from './branch-schedule.repository.js';
import { BUSINESS_TIMEZONE, CLOCK, type Clock } from './clock.js';
import type {
  AdminBranchHoursDto,
  PublicBranchHoursDto,
} from './dto/branch-schedule-responses.dto.js';
import type { ReplaceBranchHoursRequest } from './dto/branch-schedule-requests.dto.js';
import { translateScheduleDbError } from './schedule-db-errors.js';
import { diffHours, hoursVersion, normalizeHours, rowsToDays } from './schedule-policy.js';

const NOT_FOUND = 'Sucursal no encontrada';
const READ = 'branches.read';
const MANAGE = 'branches.manage_hours';
const PUBLIC_CLOSURES_DAYS = 30;
const PUBLIC_CLOSURES_MAX = 10;

/** Horario semanal: lectura pública/admin y reemplazo atómico con concurrencia optimista (D5, D6, D12-D14). */
@Injectable()
export class BranchHoursService {
  private readonly logger = new Logger(BranchHoursService.name);

  constructor(
    @Inject(BranchScheduleRepository) private readonly repo: BranchScheduleRepository,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BUSINESS_TIMEZONE) private readonly timeZone: string,
  ) {}

  /**
   * Público: solo sucursales activas (inexistente = inactiva = 404). UNA consulta (estado + horario + cierres
   * próximos). Sin motivo de los cierres.
   */
  async getPublic(branchId: string): Promise<PublicBranchHoursDto> {
    const now = this.clock.now();
    const [snapshot] = await this.repo.loadSchedule(
      [branchId],
      now,
      new Date(now.getTime() + PUBLIC_CLOSURES_DAYS * MS_PER_DAY),
      { closureLimit: PUBLIC_CLOSURES_MAX },
    );
    if (!snapshot?.active) throw new NotFoundException(NOT_FOUND);
    return {
      branchId,
      timezone: this.timeZone,
      days: rowsToDays(snapshot.hours),
      upcomingClosures: snapshot.closures.map((w) => ({
        startsAt: new Date(w.startsAt).toISOString(),
        endsAt: new Date(w.endsAt).toISOString(),
      })),
    };
  }

  /** Admin: fuera de alcance = inexistente (404). Una sucursal inactiva SÍ se puede consultar. */
  async getAdmin(staff: StaffContext, branchId: string): Promise<AdminBranchHoursDto> {
    await this.requireVisible(staff, READ, branchId);
    return this.view(branchId, rowsToDays(await this.repo.readHours(branchId)));
  }

  async replace(
    staff: StaffContext,
    branchId: string,
    input: ReplaceBranchHoursRequest,
  ): Promise<AdminBranchHoursDto> {
    if (!this.authorization.canAccess(staff, MANAGE, branchId)) {
      throw new NotFoundException(NOT_FOUND);
    }
    const next = normalizeHours(input.days);
    try {
      return await this.repo.transaction(async (tx) => {
        // Bloqueo de la fila de la sucursal: serializa PUT concurrentes; la versión se calcula tras el bloqueo.
        if (!(await this.repo.lockBranch(tx, branchId))) throw new NotFoundException(NOT_FOUND);
        const before = rowsToDays(await this.repo.readHours(branchId, tx));
        if (hoursVersion(before) !== input.expectedVersion) {
          throw codedException(
            HttpStatus.CONFLICT,
            'HOURS_VERSION_CONFLICT',
            'El horario cambió desde que se leyó; recarga e inténtalo de nuevo',
          );
        }
        const diff = diffHours(before, next);
        if (!diff) return this.view(branchId, before); // idempotente: ni escritura ni auditoría
        await this.repo.replaceHours(tx, branchId, next);
        await this.record(tx, staff, branchId, diff);
        this.logger.log(`Horario actualizado (branch=${branchId}, staff=${staff.staffId})`);
        return this.view(branchId, next);
      });
    } catch (error) {
      throw translateScheduleDbError(error, 'hours');
    }
  }

  private async record(
    tx: ScheduleTx,
    staff: StaffContext,
    branchId: string,
    diff: NonNullable<ReturnType<typeof diffHours>>,
  ): Promise<void> {
    await this.audit.record(tx, {
      actorId: staff.staffId,
      branchId,
      entityType: 'branch_hours',
      entityId: branchId,
      action: 'branch.hours_updated',
      oldValues: diff.oldValues,
      newValues: diff.newValues,
    });
  }

  private view(branchId: string, days: ReturnType<typeof rowsToDays>): AdminBranchHoursDto {
    return { branchId, timezone: this.timeZone, version: hoursVersion(days), days };
  }

  private async requireVisible(
    staff: StaffContext,
    permission: string,
    branchId: string,
  ): Promise<void> {
    if (
      !this.authorization.canAccess(staff, permission, branchId) ||
      !(await this.branches.getStatus(branchId))
    ) {
      throw new NotFoundException(NOT_FOUND);
    }
  }
}
