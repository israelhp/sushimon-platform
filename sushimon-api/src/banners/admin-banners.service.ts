import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { safeErrorLabel } from '../media/guarded-storage.js';
import { AdminMediaService } from '../media/admin-media.service.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { translateBannerDbError } from './banner-db-errors.js';
import {
  bannerCodeOf,
  bannerNotFound,
  createdAudit,
  deletedAudit,
  diffState,
  imageInvalid,
  limitReached,
  normalizeAlt,
  PERMISSION_CREATE,
  PERMISSION_READ,
  PERMISSION_UPDATE,
  scopeForbidden,
  versionConflict,
} from './banner-policy.js';
import { bannerView } from './banner-views.js';
import { BannersRepository, type BannerTx } from './banners.repository.js';
import { MAX_BANNERS, type BannerRecord, type BannerState } from './banners.types.js';
import type { CreateBannerRequest, UpdateBannerRequest } from './dto/banner-requests.dto.js';
import type { AdminBannerDto, AdminBannerListDto } from './dto/banner-responses.dto.js';

const ENTITY = 'banner';

/** Lo único que F16 necesita de F14 para liberar la imagen (facilita el doble en pruebas). */
export type BannerImageReleaser = Pick<AdminMediaService, 'removeUnusedAsset'>;

/**
 * Backoffice de banners simplificado (ADR-0033). Un banner es de la CADENA: toda operación exige alcance GLOBAL del
 * permiso (403 genérico si es acotado, antes de leer). Orden en escrituras: alcance (403) → forma/alt (400/422) → candado
 * de fila → existencia (404) → versión (409) → reglas (422) → BD. El tope de 5 lo comprueba el servicio y lo garantiza
 * el trigger de BD (0023), que serializa las altas simultáneas; la API NO toma ese bloqueo. Cada escritura audita en su
 * transacción; sin cambio real no se escribe ni se audita (idempotente).
 */
@Injectable()
export class AdminBannersService {
  private readonly logger = new Logger(AdminBannersService.name);

  constructor(
    @Inject(BannersRepository) private readonly repo: BannersRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(MediaUrlService) private readonly urls: MediaUrlService,
    @Inject(AdminMediaService) private readonly media: BannerImageReleaser,
  ) {}

  // ---------- lecturas ----------

  async list(staff: StaffContext): Promise<AdminBannerListDto> {
    this.assertGlobal(staff, PERMISSION_READ);
    const records = await this.read(() => this.repo.findAll());
    return { items: records.map((r) => this.view(r)), limit: MAX_BANNERS };
  }

  async get(staff: StaffContext, id: string): Promise<AdminBannerDto> {
    this.assertGlobal(staff, PERMISSION_READ);
    const record = await this.read(() => this.repo.findById(id));
    if (!record) throw bannerNotFound();
    return this.view(record);
  }

  // ---------- escrituras ----------

  async create(staff: StaffContext, input: CreateBannerRequest): Promise<AdminBannerDto> {
    this.assertGlobal(staff, PERMISSION_CREATE);
    const state: BannerState = {
      imageAssetId: input.imageAssetId,
      imageAlt: normalizeAlt(input.imageAlt),
      active: input.active ?? true,
    };
    const id = randomUUID();
    const code = bannerCodeOf(id);
    const record = await this.inTransaction(async (tx) => {
      if ((await this.repo.count(tx)) >= MAX_BANNERS) throw limitReached();
      await this.assertImage(tx, state.imageAssetId);
      await this.repo.createBanner(tx, { id, code, ...state });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'banner.created',
        newValues: createdAudit(code, state),
      });
      return this.reload(tx, id);
    });
    this.logger.log(`Banner creado (id=${record.id}, staff=${staff.staffId})`);
    return this.view(record);
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdateBannerRequest,
  ): Promise<AdminBannerDto> {
    this.assertGlobal(staff, PERMISSION_UPDATE);
    const alt = input.imageAlt === undefined ? undefined : normalizeAlt(input.imageAlt);
    const now = new Date();
    const { record, changed } = await this.inTransaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      if (current.version !== input.expectedVersion) throw versionConflict();
      const before: BannerState = {
        imageAssetId: current.image.assetId,
        imageAlt: current.imageAlt,
        active: current.active,
      };
      const after: BannerState = {
        imageAssetId: input.imageAssetId ?? before.imageAssetId,
        imageAlt: alt ?? before.imageAlt,
        active: input.active ?? before.active,
      };
      const diff = diffState(before, after);
      if (!diff) return { record: current, changed: false };
      if (diff.scalars.imageAssetId !== undefined) await this.assertImage(tx, after.imageAssetId);
      await this.repo.saveBanner(tx, id, diff.scalars, now);
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
    return this.view(record);
  }

  /**
   * Borrado FÍSICO con versión (409) y auditoría en una transacción. DESPUÉS intenta liberar el asset (F14) solo si nadie
   * más lo usa; es de mejor esfuerzo: un fallo de almacenamiento no revierte ni falla el borrado (204 y advertencia).
   */
  async remove(staff: StaffContext, id: string, expectedVersion: number): Promise<void> {
    this.assertGlobal(staff, PERMISSION_UPDATE);
    const assetId = await this.inTransaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      if (current.version !== expectedVersion) throw versionConflict();
      await this.repo.deleteBanner(tx, id);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: null,
        entityType: ENTITY,
        entityId: id,
        action: 'banner.deleted',
        oldValues: deletedAudit(bannerCodeOf(id), {
          imageAssetId: current.image.assetId,
          active: current.active,
        }),
      });
      return current.image.assetId;
    });
    this.logger.log(`Banner eliminado (id=${id}, staff=${staff.staffId})`);
    await this.releaseImage(staff, assetId);
  }

  // ---------- helpers ----------

  /** Mejor esfuerzo: el banner YA no existe; cualquier fallo solo deja un asset libre en la biblioteca de medios. */
  private async releaseImage(staff: StaffContext, assetId: string): Promise<void> {
    try {
      await this.media.removeUnusedAsset(staff, assetId);
    } catch (error) {
      const code = (error as { response?: { code?: unknown } } | null)?.response?.code;
      if (code === 'MEDIA_IN_USE') return; // otro banner o producto la usa: se conserva (esperado)
      this.logger.warn(
        `Imagen de banner eliminado no liberada (asset=${assetId}, ${typeof code === 'string' ? code : safeErrorLabel(error)}); queda libre en la biblioteca de medios`,
      );
    }
  }

  /** Toda operación exige alcance GLOBAL (el banner no tiene sucursal): acotado => 403 genérico. */
  private assertGlobal(staff: StaffContext, permission: string): void {
    if (!this.authorization.scopeFor(staff, permission).allBranches) throw scopeForbidden();
  }

  /** Bloquea y relee el banner (404 si no existe). La versión la comprueba el llamador. */
  private async lockAndLoad(tx: BannerTx, id: string): Promise<BannerRecord> {
    if (!(await this.repo.lockBanner(tx, id))) throw bannerNotFound();
    const current = await this.repo.findById(id, tx);
    if (!current) throw bannerNotFound();
    return current;
  }

  private async reload(tx: BannerTx, id: string): Promise<BannerRecord> {
    const record = await this.repo.findById(id, tx);
    if (!record) throw new Error('Banner no encontrado tras escribirlo');
    return record;
  }

  private view(record: BannerRecord): AdminBannerDto {
    return bannerView(record, (key) => this.urls.tryPublicUrl(key));
  }

  /** Imagen: existe, es `BANNER_IMAGE` y está `READY` (422 `BANNER_IMAGE_INVALID` con el motivo). */
  private async assertImage(tx: BannerTx, assetId: string): Promise<void> {
    const asset = await this.repo.findAsset(assetId, tx);
    if (!asset) throw imageInvalid('ASSET_UNKNOWN');
    if (asset.kind !== 'BANNER_IMAGE') throw imageInvalid('ASSET_KIND_MISMATCH');
    if (asset.status !== 'READY') throw imageInvalid('ASSET_NOT_READY');
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
