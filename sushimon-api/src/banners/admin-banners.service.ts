import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { buildSearchPattern } from '../products/product-policy.js';
import { translateBannerDbError } from './banner-db-errors.js';
import {
  applyTextPatch,
  assertScopeShape,
  bannerNotFound,
  branchNotFound,
  covers,
  createdAudit,
  ctaInvalid,
  diffDraft,
  imageInvalid,
  isExpired,
  isTextEmpty,
  limitReached,
  normalizeCode,
  normalizeReason,
  ORDER_AUDIT_ENTITY_ID,
  parseInstantOrNull,
  PERMISSION_CREATE,
  PERMISSION_READ,
  PERMISSION_UPDATE,
  promotionCoversBanner,
  promotionInvalid,
  rawCtaOf,
  reorderMismatch,
  scopeForbidden,
  SORT_ORDER_MAX,
  textFromInput,
  textPatchOf,
  touches,
  validateCta,
  validateDraft,
  versionConflict,
  type RawCta,
  type TextPatch,
} from './banner-policy.js';
import { detailOf, summaryOf, type ViewContext } from './banner-views.js';
import { BannersRepository, type BannerTx } from './banners.repository.js';
import { BannersTimeService } from './banners-time.service.js';
import {
  MAX_NON_EXPIRED_BANNERS,
  type BannerCta,
  type BannerDraft,
  type BannerLifecycle,
  type BannerRecord,
  type BannerScope,
  type BannerSort,
} from './banners.types.js';
import type {
  CreateBannerRequest,
  ReorderBannersRequest,
  UpdateBannerRequest,
  UpdateBannerStatusRequest,
} from './dto/banner-requests.dto.js';
import type {
  AdminBannerDto,
  AdminBannerOrderDto,
  AdminBannerPageDto,
} from './dto/banner-responses.dto.js';

const ENTITY = 'banner';

export interface AdminBannersQuery {
  branchId?: string;
  lifecycle?: BannerLifecycle;
  q?: string;
  sort?: BannerSort;
  order?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

interface Patch {
  imageAssetId?: string;
  translations?: { es?: TextPatch; en?: TextPatch | null };
  cta?: ReturnType<typeof rawCtaOf>;
  branchScope?: BannerScope;
  branchIds?: string[];
  promotionId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  sortOrder?: number;
}

const EMPTY = { title: null, subtitle: null, ctaLabel: null, imageAlt: null };

/** Borrador con el destino aún SIN validar (la página puede no estar en la lista blanca). */
type RawDraft = Omit<BannerDraft, 'cta'> & { cta: RawCta };

/**
 * Backoffice de banners (spec F16 D4, D8, D9). Un banner es de la CADENA: la lectura se acota por `banners.read`; la
 * escritura exige cubrir TODAS sus sucursales (`ALL` => alcance global). Orden en escrituras: forma (400) → alcance
 * (404/403 SIN candado) → candado y re-verificación → versión (409) → reglas (422) → BD (404/422/409). Cada escritura
 * audita en su transacción; sin cambio real no se escribe ni se audita (idempotente).
 */
@Injectable()
export class AdminBannersService {
  private readonly logger = new Logger(AdminBannersService.name);

  constructor(
    @Inject(BannersRepository) private readonly repo: BannersRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(BannersTimeService) private readonly time: BannersTimeService,
    @Inject(MediaUrlService) private readonly urls: MediaUrlService,
  ) {}

  // ---------- lecturas ----------

  async list(staff: StaffContext, query: AdminBannersQuery): Promise<AdminBannerPageDto> {
    const scope = this.authorization.scopeFor(staff, PERMISSION_READ);
    if (query.branchId !== undefined) {
      if (!this.authorization.canAccess(staff, PERMISSION_READ, query.branchId))
        throw branchNotFound();
      if (!(await this.read(() => this.repo.findBranchStatus(query.branchId as string))))
        throw branchNotFound();
    }
    const pattern = buildSearchPattern(query.q);
    const now = this.time.now();
    const page = await this.read(() =>
      this.repo.findPage({
        scopeBranchIds: scope.allBranches ? null : scope.branchIds,
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
        ...(query.lifecycle !== undefined ? { lifecycle: query.lifecycle } : {}),
        pattern,
        sort: query.sort ?? 'priority',
        order: query.order ?? 'asc',
        now,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
    const records = await this.read(() => this.repo.findRecords(page.ids));
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

  async get(staff: StaffContext, id: string): Promise<AdminBannerDto> {
    const [record] = await this.read(() => this.repo.findRecords([id]));
    const scope = this.authorization.scopeFor(staff, PERMISSION_READ);
    if (
      !record ||
      !touches(
        scope,
        record.branches.map((b) => b.id),
      )
    )
      throw bannerNotFound();
    return detailOf(record, this.context(staff, PERMISSION_READ, this.time.now()));
  }

  // ---------- escrituras ----------

  async create(staff: StaffContext, input: CreateBannerRequest): Promise<AdminBannerDto> {
    const raw = this.draftFromCreate(input); // forma: 400 (y 422 de forma de alcance)
    this.assertWriteScope(staff, PERMISSION_CREATE, raw); // alcance: 403/404
    const cta = validateCta(raw.cta); // reglas: 422
    const draft = validateDraft({ ...raw, cta });
    const now = this.time.now();
    const record = await this.inTransaction(async (tx) => {
      // Tope de 100: el candado de orden serializa el conteo con otros altas, reaperturas y reordenados.
      if (!isExpired(draft.endsAt, now.getTime())) await this.repo.lockOrder(tx);
      await this.assertBranchesExist(tx, draft.branchIds);
      await this.assertImage(tx, draft.imageAssetId);
      await this.assertCtaTargets(tx, draft.cta);
      await this.assertPromotion(tx, draft.promotionId, draft.branchScope, draft.branchIds);
      let sortOrder = input.sortOrder;
      if (!isExpired(draft.endsAt, now.getTime()) || sortOrder === undefined) {
        const stats = await this.repo.nonExpiredStats(tx, now);
        if (!isExpired(draft.endsAt, now.getTime()) && stats.count >= MAX_NON_EXPIRED_BANNERS)
          throw limitReached();
        sortOrder ??=
          stats.maxSortOrder === null ? 0 : Math.min(SORT_ORDER_MAX, stats.maxSortOrder + 1);
      }
      const valid: BannerDraft = { ...draft, sortOrder };
      const id = await this.repo.createBanner(tx, valid, now);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'banner.created',
        newValues: createdAudit(valid),
      });
      return this.reload(tx, id);
    });
    this.logger.log(`Banner creado (id=${record.id}, staff=${staff.staffId})`);
    return detailOf(record, this.context(staff, PERMISSION_CREATE, now));
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdateBannerRequest,
  ): Promise<AdminBannerDto> {
    const patch = this.parsePatch(input); // forma: 400
    const now = this.time.now();
    await this.authorizeUnlocked(staff, id); // 404/403 SIN tocar el candado
    // Un `endsAt` hacia el futuro (o sin fin) puede reabrir un banner vencido: se cuenta bajo el candado de orden. Orden de
    // candados SIEMPRE orden -> fila (el reordenado hace igual), así que no hay ciclos; se toma de forma conservadora
    // antes de conocer el estado bloqueado.
    const mayReopen =
      patch.endsAt !== undefined &&
      (patch.endsAt === null || patch.endsAt.getTime() > now.getTime());
    const { record, changed } = await this.inTransaction(async (tx) => {
      if (mayReopen) await this.repo.lockOrder(tx);
      const current = await this.lockAndLoad(tx, staff, id);
      if (current.version !== input.expectedVersion) throw versionConflict();
      const before = this.draftOf(current);
      const after = this.applyPatch(before, patch);
      this.assertWriteScope(staff, PERMISSION_UPDATE, after);
      const valid = validateDraft({ ...after, cta: validateCta(after.cta) });
      const diff = diffDraft(before, valid);
      if (!diff) return { record: current, changed: false };
      const branchesChanged = diff.branchIds !== undefined;
      await this.assertBranchesExist(
        tx,
        valid.branchIds.filter((b) => !before.branchIds.includes(b)),
      );
      if (diff.scalars.imageAssetId !== undefined) await this.assertImage(tx, valid.imageAssetId);
      if (diff.scalars.cta !== undefined) await this.assertCtaTargets(tx, valid.cta);
      if (diff.scalars.promotionId !== undefined || branchesChanged)
        await this.assertPromotion(tx, valid.promotionId, valid.branchScope, valid.branchIds);
      // Un banner que vuelve a ser «no vencido» (p. ej. ampliando `endsAt`) no puede rebasar el tope.
      if (
        isExpired(before.endsAt, now.getTime()) &&
        !isExpired(valid.endsAt, now.getTime()) &&
        (await this.repo.nonExpiredStats(tx, now, id)).count >= MAX_NON_EXPIRED_BANNERS
      )
        throw limitReached();
      await this.repo.saveBanner(
        tx,
        id,
        diff.scalars,
        {
          ...(diff.branchIds ? { branchIds: diff.branchIds } : {}),
          ...(diff.translations ? { translations: diff.translations } : {}),
        },
        now,
      );
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'banner.updated',
        oldValues: diff.oldValues,
        newValues: diff.newValues,
      });
      return { record: await this.reload(tx, id), changed: true };
    });
    if (changed) this.logger.log(`Banner actualizado (id=${id}, staff=${staff.staffId})`);
    return detailOf(record, this.context(staff, PERMISSION_UPDATE, now));
  }

  async updateStatus(
    staff: StaffContext,
    id: string,
    input: UpdateBannerStatusRequest,
  ): Promise<AdminBannerDto> {
    const reason = normalizeReason(input.reason); // forma: 400 (NUL/bidi)
    const now = this.time.now();
    await this.authorizeUnlocked(staff, id); // 404/403 SIN tocar el candado
    const { record, changed } = await this.inTransaction(async (tx) => {
      const current = await this.lockAndLoad(tx, staff, id);
      if (current.active === input.active) return { record: current, changed: false };
      await this.repo.saveBanner(tx, id, { active: input.active }, {}, now);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'banner.status_changed',
        reason,
        oldValues: { oldActive: current.active },
        newValues: { newActive: input.active },
      });
      return { record: await this.reload(tx, id), changed: true };
    });
    if (changed)
      this.logger.log(
        `Estado de banner cambiado (id=${id}, active=${String(input.active)}, staff=${staff.staffId})`,
      );
    return detailOf(record, this.context(staff, PERMISSION_UPDATE, now));
  }

  /**
   * Reordenado atómico de los banners NO vencidos (D4): alcance GLOBAL (403 antes que nada), candado de orden, conjunto
   * exacto (422 sin escribir), `0..n-1`, `version + 1` solo en los que cambian, una auditoría; idempotente.
   */
  async reorder(staff: StaffContext, input: ReorderBannersRequest): Promise<AdminBannerOrderDto> {
    if (!this.authorization.scopeFor(staff, PERMISSION_UPDATE).allBranches) throw scopeForbidden();
    const now = this.time.now();
    const orderedIds = [...input.orderedIds];
    const result = await this.inTransaction(async (tx) => {
      await this.repo.lockOrder(tx);
      const rows = await this.repo.findNonExpired(tx, now);
      const known = new Set(rows.map((r) => r.id));
      if (
        rows.length !== orderedIds.length ||
        new Set(orderedIds).size !== orderedIds.length ||
        !orderedIds.every((x) => known.has(x))
      )
        throw reorderMismatch();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const changes = orderedIds.flatMap((bid, index) =>
        (byId.get(bid) as { sortOrder: number }).sortOrder === index
          ? []
          : [{ id: bid, sortOrder: index }],
      );
      if (changes.length === 0) {
        return {
          items: orderedIds.map((bid, index) => ({
            id: bid,
            sortOrder: index,
            version: (byId.get(bid) as { version: number }).version,
          })),
          changed: false,
        };
      }
      const updated = new Map(
        (await this.repo.applySortOrders(tx, changes, now)).map((u) => [u.id, u.version]),
      );
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: ORDER_AUDIT_ENTITY_ID,
        action: 'banner.reordered',
        oldValues: { orderedIds: rows.map((r) => r.id) },
        newValues: { orderedIds, changedCount: changes.length },
      });
      return {
        items: orderedIds.map((bid, index) => ({
          id: bid,
          sortOrder: index,
          version: updated.get(bid) ?? (byId.get(bid) as { version: number }).version,
        })),
        changed: true,
      };
    });
    if (result.changed)
      this.logger.log(`Banners reordenados (n=${orderedIds.length}, staff=${staff.staffId})`);
    return { items: result.items };
  }

  // ---------- helpers ----------

  /** 404 si el banner no toca el alcance de escritura; 403 si lo toca sin cubrirlo entero. */
  private assertWritable(staff: StaffContext, current: BannerRecord): void {
    const scope = this.authorization.scopeFor(staff, PERMISSION_UPDATE);
    const branchIds = current.branches.map((b) => b.id);
    if (!touches(scope, branchIds)) throw bannerNotFound();
    if (!covers(scope, branchIds)) throw scopeForbidden();
  }

  /**
   * Autorización por lectura SIN bloqueo (antes de abrir la transacción): un actor sin alcance recibe 404/403 sin
   * esperar ni tocar el candado de la fila. Se REPITE tras el bloqueo, porque el alcance del banner pudo cambiar entre la
   * lectura y el candado (lección de F15).
   */
  private async authorizeUnlocked(staff: StaffContext, id: string): Promise<void> {
    const [current] = await this.read(() => this.repo.findRecords([id]));
    if (!current) throw bannerNotFound();
    this.assertWritable(staff, current);
  }

  /** Bloquea y relee el banner; re-verifica alcance (404/403). La versión la comprueba el llamador. */
  private async lockAndLoad(tx: BannerTx, staff: StaffContext, id: string): Promise<BannerRecord> {
    if (!(await this.repo.lockBanner(tx, id))) throw bannerNotFound();
    const [current] = await this.repo.findRecords([id], tx);
    if (!current) throw bannerNotFound();
    this.assertWritable(staff, current);
    return current;
  }

  private async reload(tx: BannerTx, id: string): Promise<BannerRecord> {
    const [record] = await this.repo.findRecords([id], tx);
    if (!record) throw new Error('Banner no encontrado tras escribirlo');
    return record;
  }

  private context(staff: StaffContext, permission: string, now: Date): ViewContext {
    // Si el actor no tiene lectura (p. ej. solo `create`), recorta por el permiso de la operación.
    const trimPermission = this.authorization.has(staff, PERMISSION_READ)
      ? PERMISSION_READ
      : permission;
    return {
      nowMs: now.getTime(),
      timeZone: this.time.timeZone,
      trimScope: this.authorization.scopeFor(staff, trimPermission),
      updateScope: this.authorization.scopeFor(staff, PERMISSION_UPDATE),
      imageUrl: (key) => this.urls.tryPublicUrl(key),
    };
  }

  /** `ALL` exige alcance global (403); `SELECTED`: toda sucursal debe estar en el alcance (si no, 404 sin distinguir). */
  private assertWriteScope(
    staff: StaffContext,
    permission: string,
    draft: Pick<BannerDraft, 'branchScope' | 'branchIds'>,
  ): void {
    const scope = this.authorization.scopeFor(staff, permission);
    if (draft.branchScope === 'ALL') {
      if (!scope.allBranches) throw scopeForbidden();
      return;
    }
    for (const branchId of draft.branchIds) {
      if (!this.authorization.canAccess(staff, permission, branchId)) throw branchNotFound();
    }
  }

  private async assertBranchesExist(tx: BannerTx, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.repo.findBranches(ids, tx);
    if (found.length !== new Set(ids).size) throw branchNotFound();
  }

  /** Imagen: existe, es `BANNER_IMAGE` y está `READY` (422 `BANNER_IMAGE_INVALID` con el motivo). */
  private async assertImage(tx: BannerTx, assetId: string): Promise<void> {
    const asset = await this.repo.findAsset(assetId, tx);
    if (!asset) throw imageInvalid('ASSET_UNKNOWN');
    if (asset.kind !== 'BANNER_IMAGE') throw imageInvalid('ASSET_KIND_MISMATCH');
    if (asset.status !== 'READY') throw imageInvalid('ASSET_NOT_READY');
  }

  /** Destino de catálogo: existe y está activo (422 `BANNER_CTA_INVALID`). */
  private async assertCtaTargets(tx: BannerTx, cta: BannerCta): Promise<void> {
    if (cta.type !== 'CATEGORY' && cta.type !== 'PRODUCT') return;
    const found = await this.repo.findCtaTargets(
      { categoryId: cta.categoryId, productId: cta.productId },
      tx,
    );
    const target = cta.type === 'CATEGORY' ? found.category : found.product;
    const path = cta.type === 'CATEGORY' ? 'cta.categoryId' : 'cta.productId';
    if (!target)
      throw ctaInvalid([{ path, code: 'TARGET_UNKNOWN', message: 'El destino no existe' }]);
    if (!target.active)
      throw ctaInvalid([{ path, code: 'TARGET_INACTIVE', message: 'El destino está inactivo' }]);
  }

  /** Promoción: existe y su alcance de sucursales cubre el del banner (422 `BANNER_PROMOTION_INVALID`). */
  private async assertPromotion(
    tx: BannerTx,
    promotionId: string | null,
    scope: BannerScope,
    branchIds: readonly string[],
  ): Promise<void> {
    if (promotionId === null) return;
    const promotion = await this.repo.findPromotionScope(promotionId, tx);
    if (!promotion) throw promotionInvalid('PROMOTION_UNKNOWN');
    if (!promotionCoversBanner(promotion.branchIds, scope, branchIds))
      throw promotionInvalid('BRANCH_SCOPE_MISMATCH');
  }

  private draftOf(r: BannerRecord): BannerDraft {
    return {
      code: r.code,
      imageAssetId: r.image.assetId,
      translations: { es: r.translations.es ?? { ...EMPTY }, en: r.translations.en },
      cta: {
        type: r.cta.type,
        categoryId: r.cta.categoryId,
        productId: r.cta.productId,
        page: r.cta.page,
      },
      branchScope: r.branches.length === 0 ? 'ALL' : 'SELECTED',
      branchIds: r.branches.map((b) => b.id),
      promotionId: r.promotion?.id ?? null,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      sortOrder: r.sortOrder,
      active: r.active,
    };
  }

  private draftFromCreate(input: CreateBannerRequest): RawDraft {
    const branchIds = input.branchIds ?? [];
    assertScopeShape(input.branchScope, branchIds);
    const en = input.translations.en ? textFromInput('en', input.translations.en) : null;
    return {
      code: normalizeCode(input.code),
      imageAssetId: input.imageAssetId,
      translations: {
        es: textFromInput('es', input.translations.es),
        en: en !== null && !isTextEmpty(en) ? en : null,
      },
      cta: rawCtaOf(input.cta),
      branchScope: input.branchScope,
      branchIds: [...branchIds],
      promotionId: input.promotionId ?? null,
      startsAt: parseInstantOrNull('startsAt', input.startsAt),
      endsAt: parseInstantOrNull('endsAt', input.endsAt),
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
    };
  }

  /** Normaliza lo enviado (sin conocer el estado actual); `undefined` = sin cambio. */
  private parsePatch(input: UpdateBannerRequest): Patch {
    const t = input.translations;
    return {
      ...(input.imageAssetId !== undefined ? { imageAssetId: input.imageAssetId } : {}),
      ...(t !== undefined
        ? {
            translations: {
              ...(t.es !== undefined ? { es: textPatchOf('es', t.es) } : {}),
              ...(t.en !== undefined ? { en: t.en === null ? null : textPatchOf('en', t.en) } : {}),
            },
          }
        : {}),
      ...(input.cta !== undefined ? { cta: rawCtaOf(input.cta) } : {}),
      ...(input.branchScope !== undefined ? { branchScope: input.branchScope } : {}),
      ...(input.branchIds !== undefined ? { branchIds: [...input.branchIds] } : {}),
      ...(input.promotionId !== undefined ? { promotionId: input.promotionId } : {}),
      ...(input.startsAt !== undefined
        ? { startsAt: parseInstantOrNull('startsAt', input.startsAt) }
        : {}),
      ...(input.endsAt !== undefined ? { endsAt: parseInstantOrNull('endsAt', input.endsAt) } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
  }

  /**
   * Aplica el parche al estado actual (lo omitido NO se reemplaza). Alcance efectivo = el enviado o el actual; con `ALL`
   * los ids actuales se descartan; con `SELECTED` se conservan los actuales si no se envían. `cta` reemplaza su bloque.
   */
  private applyPatch(before: BannerDraft, patch: Patch): RawDraft {
    const branchScope = patch.branchScope ?? before.branchScope;
    if (patch.branchIds !== undefined) assertScopeShape(branchScope, patch.branchIds);
    const branchIds =
      branchScope === 'ALL'
        ? []
        : (patch.branchIds ?? (before.branchScope === 'SELECTED' ? before.branchIds : []));
    const es =
      patch.translations?.es !== undefined
        ? applyTextPatch(before.translations.es, patch.translations.es)
        : before.translations.es;
    let en = before.translations.en;
    if (patch.translations?.en === null) en = null;
    else if (patch.translations?.en !== undefined) {
      const merged = applyTextPatch(before.translations.en, patch.translations.en);
      en = isTextEmpty(merged) ? null : merged;
    }
    return {
      code: before.code,
      imageAssetId: patch.imageAssetId ?? before.imageAssetId,
      translations: { es, en },
      cta: patch.cta !== undefined ? patch.cta : before.cta,
      branchScope,
      branchIds,
      promotionId: patch.promotionId !== undefined ? patch.promotionId : before.promotionId,
      startsAt: patch.startsAt !== undefined ? patch.startsAt : before.startsAt,
      endsAt: patch.endsAt !== undefined ? patch.endsAt : before.endsAt,
      sortOrder: patch.sortOrder ?? before.sortOrder,
      active: before.active,
    };
  }

  /** Lectura sin transacción: traduce timeouts/errores de BD igual que las escrituras. */
  private async read<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw translateBannerDbError(error);
    }
  }

  private async inTransaction<T>(fn: (tx: BannerTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateBannerDbError(error);
    }
  }
}
