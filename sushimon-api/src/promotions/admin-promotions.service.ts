import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { buildSearchPattern } from '../products/product-policy.js';
import type {
  CreatePromotionRequest,
  UpdatePromotionRequest,
  UpdatePromotionStatusRequest,
} from './dto/promotion-requests.dto.js';
import type { AdminPromotionDto, AdminPromotionPageDto } from './dto/promotion-responses.dto.js';
import { translatePromotionDbError } from './promotion-db-errors.js';
import {
  assertBranchShape,
  assertProductShape,
  branchNotFound,
  createdAudit,
  diffDraft,
  draftOf,
  normalizeCode,
  normalizeDescription,
  normalizeName,
  parseInstantField,
  PERMISSION_CREATE,
  PERMISSION_READ,
  PERMISSION_UPDATE,
  productViolations,
  promotionNotFound,
  scopeForbidden,
  scopeInvalid,
  validateDraft,
  versionConflict,
  type PromotionDraft,
} from './promotion-policy.js';
import { PromotionTimeService } from './promotion-time.service.js';
import { covers, detailOf, summaryOf, touches, type ViewContext } from './promotion-views.js';
import { PromotionsRepository, type PromotionTx } from './promotions.repository.js';
import type { PromotionRecord } from './promotions.types.js';

const ENTITY = 'promotion';

export interface AdminPromotionsQuery {
  branchId?: string;
  status?: 'active' | 'inactive' | 'scheduled' | 'running' | 'expired';
  kind?: 'PERCENT' | 'FIXED_AMOUNT';
  from?: string;
  to?: string;
  q?: string;
  sort?: 'startsAt' | 'endsAt' | 'name' | 'createdAt';
  order?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/**
 * Backoffice de promociones (spec F15 D5-D12). Una promoción es de la CADENA: la lectura se acota por
 * `promotions.read`; la escritura exige cubrir TODAS sus sucursales (`ALL` => alcance global). Orden en escrituras:
 * forma (400) → alcance (404/403) → versión (409) → reglas (422) → BD (404/422/409). Cada escritura audita en su
 * transacción; sin cambio real no se escribe ni se audita (idempotente).
 */
@Injectable()
export class AdminPromotionsService {
  private readonly logger = new Logger(AdminPromotionsService.name);

  constructor(
    @Inject(PromotionsRepository) private readonly repo: PromotionsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(PromotionTimeService) private readonly time: PromotionTimeService,
  ) {}

  async list(staff: StaffContext, query: AdminPromotionsQuery): Promise<AdminPromotionPageDto> {
    const scope = this.authorization.scopeFor(staff, PERMISSION_READ);
    if (query.branchId !== undefined) {
      if (!this.authorization.canAccess(staff, PERMISSION_READ, query.branchId))
        throw branchNotFound();
      if (!(await this.repo.findBranchStatus(query.branchId))) throw branchNotFound();
    }
    const pattern = buildSearchPattern(query.q);
    const now = this.time.now();
    const page = await this.repo.findPage({
      scopeBranchIds: scope.allBranches ? null : scope.branchIds,
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.from !== undefined ? { from: parseInstantField('from', query.from) } : {}),
      ...(query.to !== undefined ? { to: parseInstantField('to', query.to) } : {}),
      pattern,
      sort: query.sort ?? 'startsAt',
      order: query.order ?? 'desc',
      now,
      page: query.page,
      pageSize: query.pageSize,
    });
    const records = await this.repo.findRecords(page.ids, { withProducts: false });
    const byId = new Map(records.map((r) => [r.id, r]));
    const ctx = this.context(staff, PERMISSION_READ, now);
    return {
      items: page.ids.flatMap((id) => {
        const record = byId.get(id);
        return record ? [summaryOf(record, ctx)] : [];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
    };
  }

  async get(staff: StaffContext, id: string): Promise<AdminPromotionDto> {
    const [record] = await this.repo.findRecords([id], { withProducts: true });
    const scope = this.authorization.scopeFor(staff, PERMISSION_READ);
    if (
      !record ||
      !touches(
        scope,
        record.branches.map((b) => b.id),
      )
    )
      throw promotionNotFound();
    return detailOf(record, this.context(staff, PERMISSION_READ, this.time.now()));
  }

  async create(staff: StaffContext, input: CreatePromotionRequest): Promise<AdminPromotionDto> {
    const draft = this.draftFromCreate(input); // forma: 400
    this.assertWriteScope(staff, PERMISSION_CREATE, draft); // alcance: 403/404
    const valid = validateDraft(draft); // reglas: 422
    const now = this.time.now();
    const record = await this.inTransaction(async (tx) => {
      await this.assertBranchesExist(tx, valid.branchIds);
      await this.assertProductsExist(tx, valid.productIds);
      const id = await this.repo.createPromotion(
        tx,
        { ...valid, branchIds: valid.branchIds, productIds: valid.productIds },
        now,
      );
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'promotion.created',
        newValues: createdAudit(valid),
      });
      return this.reload(tx, id);
    });
    this.logger.log(`Promoción creada (id=${record.id}, staff=${staff.staffId})`);
    return detailOf(record, this.context(staff, PERMISSION_CREATE, now));
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdatePromotionRequest,
  ): Promise<AdminPromotionDto> {
    const patch = this.parsePatch(input); // forma: 400
    const now = this.time.now();
    await this.authorizeUnlocked(staff, id); // 404/403 SIN tocar el candado
    const { record, changed } = await this.inTransaction(async (tx) => {
      const current = await this.lockAndLoad(tx, staff, id);
      if (current.version !== input.expectedVersion) throw versionConflict();
      const before = draftOf(current);
      const after = this.applyPatch(before, patch);
      this.assertWriteScope(staff, PERMISSION_UPDATE, after);
      const valid = validateDraft(after);
      await this.assertBranchesExist(
        tx,
        valid.branchIds.filter((b) => !before.branchIds.includes(b)),
      );
      await this.assertProductsExist(
        tx,
        valid.productIds.filter((p) => !before.productIds.includes(p)),
      );
      const diff = diffDraft(before, valid);
      if (!diff) return { record: current, changed: false };
      await this.repo.savePromotion(
        tx,
        id,
        diff.scalars,
        {
          ...(diff.branchIds ? { branchIds: diff.branchIds } : {}),
          ...(diff.productIds ? { productIds: diff.productIds } : {}),
          ...(diff.schedule ? { schedule: diff.schedule } : {}),
        },
        now,
      );
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'promotion.updated',
        oldValues: diff.oldValues,
        newValues: diff.newValues,
      });
      return { record: await this.reload(tx, id), changed: true };
    });
    if (changed) this.logger.log(`Promoción actualizada (id=${id}, staff=${staff.staffId})`);
    return detailOf(record, this.context(staff, PERMISSION_UPDATE, now));
  }

  async updateStatus(
    staff: StaffContext,
    id: string,
    input: UpdatePromotionStatusRequest,
  ): Promise<AdminPromotionDto> {
    const now = this.time.now();
    await this.authorizeUnlocked(staff, id); // 404/403 SIN tocar el candado
    const { record, changed } = await this.inTransaction(async (tx) => {
      const current = await this.lockAndLoad(tx, staff, id);
      if (current.active === input.active) return { record: current, changed: false };
      await this.repo.savePromotion(tx, id, { active: input.active }, {}, now);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'promotion.status_changed',
        reason: input.reason?.trim() || null,
        oldValues: { oldActive: current.active },
        newValues: { newActive: input.active },
      });
      return { record: await this.reload(tx, id), changed: true };
    });
    if (changed)
      this.logger.log(
        `Estado de promoción cambiado (id=${id}, active=${String(input.active)}, staff=${staff.staffId})`,
      );
    return detailOf(record, this.context(staff, PERMISSION_UPDATE, now));
  }

  // ---------- helpers ----------

  /** 404 si la promoción no toca el alcance de escritura; 403 si lo toca sin cubrirla entera. */
  private assertWritable(staff: StaffContext, current: PromotionRecord): void {
    const scope = this.authorization.scopeFor(staff, PERMISSION_UPDATE);
    const branchIds = current.branches.map((b) => b.id);
    if (!touches(scope, branchIds)) throw promotionNotFound();
    if (!covers(scope, branchIds)) throw scopeForbidden();
  }

  /**
   * Autorización por lectura SIN bloqueo (antes de abrir la transacción): un actor sin alcance recibe 404/403 sin
   * esperar ni tocar el candado de la fila (no puede degradar la disponibilidad ni sondear con 503). Se REPITE tras el
   * bloqueo, porque el alcance de la promoción pudo cambiar entre la lectura y el candado.
   */
  private async authorizeUnlocked(staff: StaffContext, id: string): Promise<void> {
    const [current] = await this.repo.findRecords([id], { withProducts: false });
    if (!current) throw promotionNotFound();
    this.assertWritable(staff, current);
  }

  /** Bloquea y relee la promoción; re-verifica alcance (404/403). La versión la comprueba el llamador. */
  private async lockAndLoad(
    tx: PromotionTx,
    staff: StaffContext,
    id: string,
  ): Promise<PromotionRecord> {
    if (!(await this.repo.lockPromotion(tx, id))) throw promotionNotFound();
    const [current] = await this.repo.findRecords([id], { withProducts: true }, tx);
    if (!current) throw promotionNotFound();
    this.assertWritable(staff, current);
    return current;
  }

  private async reload(tx: PromotionTx, id: string): Promise<PromotionRecord> {
    const [record] = await this.repo.findRecords([id], { withProducts: true }, tx);
    if (!record) throw new Error('Promoción no encontrada tras escribirla');
    return record;
  }

  private context(staff: StaffContext, permission: string, now: Date): ViewContext {
    // Si el actor no tiene lectura (p. ej. solo `create`), recorta por el permiso de la operación.
    const trimPermission = this.authorization.has(staff, PERMISSION_READ)
      ? PERMISSION_READ
      : permission;
    return {
      nowMs: now.getTime(),
      clock: this.time.localClock(now.getTime()),
      time: this.time,
      trimScope: this.authorization.scopeFor(staff, trimPermission),
      updateScope: this.authorization.scopeFor(staff, PERMISSION_UPDATE),
    };
  }

  /** `ALL` exige alcance global (403); `SELECTED`: toda sucursal debe estar en el alcance (si no, 404 sin distinguir). */
  private assertWriteScope(staff: StaffContext, permission: string, draft: PromotionDraft): void {
    const scope = this.authorization.scopeFor(staff, permission);
    if (draft.branchScope === 'ALL') {
      if (!scope.allBranches) throw scopeForbidden();
      return;
    }
    for (const branchId of draft.branchIds) {
      if (!this.authorization.canAccess(staff, permission, branchId)) throw branchNotFound();
    }
  }

  private async assertBranchesExist(tx: PromotionTx, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.repo.findBranches(ids, tx);
    if (found.length !== new Set(ids).size) throw branchNotFound();
  }

  private async assertProductsExist(tx: PromotionTx, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const existing = new Set(await this.repo.findExistingProductIds(ids, tx));
    const violations = productViolations(ids, existing);
    if (violations.length > 0) throw scopeInvalid(violations);
  }

  private draftFromCreate(input: CreatePromotionRequest): PromotionDraft {
    const branchIds = input.branchIds ?? [];
    const productIds = input.productIds ?? [];
    assertBranchShape(input.branchScope, branchIds);
    assertProductShape(input.productScope, productIds);
    return {
      code: normalizeCode(input.code),
      name: normalizeName(input.name),
      description: normalizeDescription(input.description),
      kind: input.kind,
      value: input.value,
      startsAt: parseInstantField('startsAt', input.startsAt),
      endsAt: parseInstantField('endsAt', input.endsAt),
      dineInOnly: input.dineInOnly ?? false,
      active: input.active ?? true,
      branchScope: input.branchScope,
      branchIds: [...branchIds],
      productScope: input.productScope,
      productIds: [...productIds],
      schedule: (input.schedule ?? []).map((s) => ({
        weekday: s.weekday,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      })),
    };
  }

  /** Normaliza lo enviado (sin conocer el estado actual); `undefined` = sin cambio. */
  private parsePatch(input: UpdatePromotionRequest) {
    return {
      ...(input.name !== undefined ? { name: normalizeName(input.name) } : {}),
      ...(input.description !== undefined
        ? { description: normalizeDescription(input.description) }
        : {}),
      ...(input.code !== undefined ? { code: normalizeCode(input.code) } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.startsAt !== undefined
        ? { startsAt: parseInstantField('startsAt', input.startsAt) }
        : {}),
      ...(input.endsAt !== undefined ? { endsAt: parseInstantField('endsAt', input.endsAt) } : {}),
      ...(input.dineInOnly !== undefined ? { dineInOnly: input.dineInOnly } : {}),
      ...(input.branchScope !== undefined ? { branchScope: input.branchScope } : {}),
      ...(input.branchIds !== undefined ? { branchIds: [...input.branchIds] } : {}),
      ...(input.productScope !== undefined ? { productScope: input.productScope } : {}),
      ...(input.productIds !== undefined ? { productIds: [...input.productIds] } : {}),
      ...(input.schedule !== undefined
        ? {
            schedule: input.schedule.map((s) => ({
              weekday: s.weekday,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
            })),
          }
        : {}),
    };
  }

  /**
   * Aplica el parche al estado actual. Alcance efectivo = el enviado o el actual; con `ALL` los ids se descartan
   * (sustituir `SELECTED` por `ALL` sin reenviar ids es válido); con `SELECTED` se conservan los actuales si no se envían.
   */
  private applyPatch(
    before: PromotionDraft,
    patch: ReturnType<typeof this.parsePatch>,
  ): PromotionDraft {
    const branchScope = patch.branchScope ?? before.branchScope;
    const productScope = patch.productScope ?? before.productScope;
    const sentBranches = patch.branchIds;
    const sentProducts = patch.productIds;
    // Forma (400) respecto del alcance efectivo.
    if (sentBranches !== undefined) assertBranchShape(branchScope, sentBranches);
    if (sentProducts !== undefined) assertProductShape(productScope, sentProducts);
    const branchIds =
      branchScope === 'ALL'
        ? []
        : (sentBranches ?? (before.branchScope === 'SELECTED' ? before.branchIds : []));
    const productIds =
      productScope === 'ALL'
        ? []
        : (sentProducts ?? (before.productScope === 'SELECTED' ? before.productIds : []));
    assertBranchShape(branchScope, branchIds);
    return {
      code: patch.code !== undefined ? patch.code : before.code,
      name: patch.name ?? before.name,
      description: patch.description !== undefined ? patch.description : before.description,
      kind: patch.kind ?? before.kind,
      value: patch.value ?? before.value,
      startsAt: patch.startsAt ?? before.startsAt,
      endsAt: patch.endsAt ?? before.endsAt,
      dineInOnly: patch.dineInOnly ?? before.dineInOnly,
      active: before.active,
      branchScope,
      branchIds,
      productScope,
      productIds,
      schedule: patch.schedule ?? before.schedule,
    };
  }

  private async inTransaction<T>(fn: (tx: PromotionTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translatePromotionDbError(error);
    }
  }
}
