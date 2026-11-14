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
  BranchScheduleRepository,
  MAX_OPEN_CLOSURES,
  type ScheduleTx,
} from './branch-schedule.repository.js';
import { CLOCK, type Clock } from './clock.js';
import {
  assertClosureRange,
  closureStatus,
  normalizeReason,
  parseClosureInstant,
  planClosurePatch,
  type ClosureRecord,
  type ClosureValues,
} from './closure-policy.js';
import type {
  CreateBranchClosureRequest,
  ListBranchClosuresQuery,
  UpdateBranchClosureRequest,
} from './dto/branch-schedule-requests.dto.js';
import type {
  BranchClosureDto,
  BranchClosureListDto,
} from './dto/branch-schedule-responses.dto.js';
import { translateScheduleDbError } from './schedule-db-errors.js';

const NOT_FOUND = 'Sucursal no encontrada';
const CLOSURE_NOT_FOUND = 'Cierre no encontrado';
const READ = 'branches.read';
const MANAGE = 'branches.manage_hours';
const ENTITY = 'branch_closure';

const iso = (ms: number): string => new Date(ms).toISOString();

const auditValues = (v: ClosureValues): AuditValues => ({
  startsAt: iso(v.startsAt),
  endsAt: iso(v.endsAt),
  reason: v.reason,
});

/** Diff real de un cierre: solo los campos que cambian. */
function diffClosure(before: ClosureValues, after: ClosureValues) {
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  const fields = ['startsAt', 'endsAt', 'reason'] as const;
  const all = { before: auditValues(before), after: auditValues(after) };
  for (const f of fields) {
    if (all.before[f] !== all.after[f]) {
      oldValues[f] = all.before[f] ?? null;
      newValues[f] = all.after[f] ?? null;
    }
  }
  return { oldValues, newValues };
}

/** Cierres extraordinarios: CRUD con las reglas D7/D8 y auditoría en la misma transacción (D14). */
@Injectable()
export class BranchClosuresService {
  private readonly logger = new Logger(BranchClosuresService.name);

  constructor(
    @Inject(BranchScheduleRepository) private readonly repo: BranchScheduleRepository,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    staff: StaffContext,
    branchId: string,
    query: ListBranchClosuresQuery,
  ): Promise<BranchClosureListDto> {
    if (
      !this.authorization.canAccess(staff, READ, branchId) ||
      !(await this.branches.getStatus(branchId))
    ) {
      throw new NotFoundException(NOT_FOUND);
    }
    const from = query.from === undefined ? undefined : parseClosureInstant(query.from, 'from');
    const to = query.to === undefined ? undefined : parseClosureInstant(query.to, 'to');
    if (from !== undefined && to !== undefined && to <= from) {
      throw new BadRequestException(['to debe ser posterior a from']);
    }
    const now = this.clock.now().getTime();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { items, total } = await this.repo.listClosures({
      branchId,
      status: query.status ?? 'current',
      now,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      page,
      pageSize,
    });
    return { items: items.map((c) => this.view(c, now)), page, pageSize, total };
  }

  async create(
    staff: StaffContext,
    branchId: string,
    input: CreateBranchClosureRequest,
  ): Promise<BranchClosureDto> {
    this.assertManage(staff, branchId);
    const now = this.clock.now().getTime();
    const values: ClosureValues = {
      startsAt: parseClosureInstant(input.startsAt, 'startsAt'),
      endsAt: parseClosureInstant(input.endsAt, 'endsAt'),
      reason: normalizeReason(input.reason) ?? null,
    };
    assertClosureRange(values, now);
    return this.inTransaction(async (tx) => {
      await this.lock(tx, branchId);
      await this.assertNoOverlap(tx, branchId, values);
      // Tope por sucursal, evaluado con el candado tomado (sin carreras): el cierre nuevo cuenta si terminará después de ahora.
      if ((await this.repo.countOpenClosures(tx, branchId, now)) >= MAX_OPEN_CLOSURES) {
        throw codedException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'CLOSURE_LIMIT_REACHED',
          `Una sucursal admite como máximo ${MAX_OPEN_CLOSURES} cierres vigentes o futuros`,
        );
      }
      const created = await this.repo.insertClosure(tx, { branchId, ...values });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId,
        entityType: ENTITY,
        entityId: created.id,
        action: 'branch_closure.created',
        newValues: auditValues(values),
      });
      this.logger.log(
        `Cierre creado (id=${created.id}, branch=${branchId}, staff=${staff.staffId})`,
      );
      return this.view(created, now);
    });
  }

  async update(
    staff: StaffContext,
    branchId: string,
    closureId: string,
    input: UpdateBranchClosureRequest,
  ): Promise<BranchClosureDto> {
    this.assertManage(staff, branchId);
    if (input.startsAt === undefined && input.endsAt === undefined && input.reason === undefined) {
      throw new BadRequestException(['Indique al menos un campo: startsAt, endsAt o reason']);
    }
    const now = this.clock.now().getTime();
    const reason = normalizeReason(input.reason);
    const patch = {
      ...(input.startsAt !== undefined
        ? { startsAt: parseClosureInstant(input.startsAt, 'startsAt') }
        : {}),
      ...(input.endsAt !== undefined
        ? { endsAt: parseClosureInstant(input.endsAt, 'endsAt') }
        : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
    return this.inTransaction(async (tx) => {
      await this.lock(tx, branchId);
      const current = await this.repo.findClosure(tx, branchId, closureId);
      if (!current) throw new NotFoundException(CLOSURE_NOT_FOUND);
      const { next, changed } = planClosurePatch(current, patch, now);
      if (!changed) return this.view(current, now); // sin cambios reales: ni escritura ni auditoría
      await this.assertNoOverlap(tx, branchId, next, closureId);
      const updated = await this.repo.updateClosure(tx, closureId, next);
      const diff = diffClosure(current, next);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId,
        entityType: ENTITY,
        entityId: closureId,
        action: 'branch_closure.updated',
        oldValues: diff.oldValues,
        newValues: diff.newValues,
      });
      this.logger.log(
        `Cierre actualizado (id=${closureId}, branch=${branchId}, staff=${staff.staffId})`,
      );
      return this.view(updated, now);
    });
  }

  async remove(staff: StaffContext, branchId: string, closureId: string): Promise<void> {
    this.assertManage(staff, branchId);
    const now = this.clock.now().getTime();
    await this.inTransaction(async (tx) => {
      await this.lock(tx, branchId);
      const current = await this.repo.findClosure(tx, branchId, closureId);
      if (!current) throw new NotFoundException(CLOSURE_NOT_FOUND);
      if (closureStatus(current, now) !== 'upcoming') {
        throw codedException(
          HttpStatus.CONFLICT,
          'CLOSURE_NOT_DELETABLE',
          'Solo se pueden eliminar cierres futuros; para uno en curso acorta su fin con PATCH',
        );
      }
      await this.repo.deleteClosure(tx, closureId);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId,
        entityType: ENTITY,
        entityId: closureId,
        action: 'branch_closure.cancelled',
        oldValues: auditValues(current),
      });
      this.logger.log(
        `Cierre cancelado (id=${closureId}, branch=${branchId}, staff=${staff.staffId})`,
      );
    });
  }

  /** Fuera del alcance de `branches.manage_hours` = inexistente (404), sin consultar la sucursal. */
  private assertManage(staff: StaffContext, branchId: string): void {
    if (!this.authorization.canAccess(staff, MANAGE, branchId)) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  private async lock(tx: ScheduleTx, branchId: string): Promise<void> {
    if (!(await this.repo.lockBranch(tx, branchId))) throw new NotFoundException(NOT_FOUND);
  }

  /** 409 `CLOSURE_OVERLAP` con el cierre en conflicto en `violations[0].path = closures/<id>`. */
  private async assertNoOverlap(
    tx: ScheduleTx,
    branchId: string,
    range: { startsAt: number; endsAt: number },
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.repo.findOverlap(
      tx,
      branchId,
      range.startsAt,
      range.endsAt,
      excludeId,
    );
    if (conflict) {
      throw codedException(
        HttpStatus.CONFLICT,
        'CLOSURE_OVERLAP',
        'El cierre se solapa con otro cierre de la sucursal',
        [
          {
            path: `closures/${conflict}`,
            code: 'CLOSURE_OVERLAP',
            message: 'Se solapa con este cierre',
          },
        ],
      );
    }
  }

  private async inTransaction<T>(fn: (tx: ScheduleTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateScheduleDbError(error, 'closure');
    }
  }

  private view(c: ClosureRecord, now: number): BranchClosureDto {
    return {
      id: c.id,
      branchId: c.branchId,
      startsAt: iso(c.startsAt),
      endsAt: iso(c.endsAt),
      reason: c.reason,
      status: closureStatus(c, now),
    };
  }
}
