import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { guarded, safeErrorLabel } from './guarded-storage.js';
import { MEDIA_CONFIG, type MediaConfig } from './media-config.js';
import { MediaCleanupService } from './media-cleanup.service.js';
import { isUniqueViolation, translateMediaDbError } from './media-db-errors.js';
import {
  MEDIA_CACHE_CONTROL,
  PENDING_LIMIT_PER_STAFF,
  SIGNATURE_BYTES,
  baseContentType,
  buildObjectKey,
  checksumHexToBase64,
  maxBytesFor,
  contentMismatch,
  mediaBusy,
  mediaInUse,
  mediaNotFound,
  objectMissing,
  pendingLimitReached,
  signatureMatches,
  storageUnavailable,
  uploadExpired,
  validateIntent,
} from './media-policy.js';
import { MediaQueryService } from './media-query.service.js';
import { MEDIA_STORAGE_PORT, type MediaStoragePort } from './media-storage.port.js';
import { MediaRepository, type MediaTx } from './media.repository.js';
import type {
  AdminMediaAssetView,
  AdminMediaUploadIntentView,
  MediaAssetRow,
  MediaKind,
} from './media.types.js';

const ENTITY = 'media_asset';

export interface UploadIntentInput {
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

type Rejection = 'size' | 'type' | 'checksum' | 'signature';

/**
 * Comandos de medios: intent, complete y borrado. Escrituras con alcance GLOBAL (403 antes de leer). Cada transacción
 * escribe y audita junta y es corta: NUNCA hay una transacción abierta durante una llamada al almacenamiento externo.
 * La URL firmada solo existe en la respuesta del intent: no se persiste, no se audita y no se registra.
 */
@Injectable()
export class AdminMediaService {
  private readonly logger = new Logger(AdminMediaService.name);

  constructor(
    @Inject(MediaRepository) private readonly repo: MediaRepository,
    @Inject(MEDIA_STORAGE_PORT) private readonly storage: MediaStoragePort,
    @Inject(MediaQueryService) private readonly queries: MediaQueryService,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  // ---------- intent ----------

  async createUpload(
    staff: StaffContext,
    input: UploadIntentInput,
  ): Promise<AdminMediaUploadIntentView> {
    this.assertGlobal(staff, 'catalog.update');
    // Orden (spec D6): almacenamiento -> MIME -> tamaño -> dedup -> límite de PENDING -> crear y firmar.
    if (this.storage.mode === 'UNAVAILABLE') throw storageUnavailable();
    const mime = validateIntent(input, maxBytesFor(input.kind, this.config.maxBytes));

    const existing = await this.read(() =>
      this.repo.findReadyByChecksum(input.kind, input.checksumSha256),
    );
    if (existing) {
      const asset = this.queries.view(existing);
      return {
        assetId: existing.id,
        deduplicated: true,
        uploadUrl: null,
        headers: null,
        expiresAt: null,
        storageMode: asset.storageMode,
        asset,
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.uploadTtlSeconds * 1000);
    const objectKey = buildObjectKey(mime, randomUUID(), now, input.kind);
    const bucket = this.config.bucket as string;
    const row = await this.inTransaction(async (tx) => {
      // Serializa los intents del mismo empleado: lock -> count -> insert (el tope no se rebasa por concurrencia).
      await this.repo.lockStaffIntents(tx, staff.staffId);
      const pending = await this.repo.countPendingByStaff(tx, staff.staffId, now);
      if (pending >= PENDING_LIMIT_PER_STAFF) throw pendingLimitReached();
      const created = await this.repo.insertPending(tx, {
        kind: input.kind,
        objectKey,
        bucket,
        mimeType: mime,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        createdByStaffId: staff.staffId,
        expiresAt,
      });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: created.id,
        action: 'media.upload_intent_created',
        newValues: { assetId: created.id, mimeType: mime, sizeBytes: input.sizeBytes },
      });
      return created;
    });

    // La firma es local (sin red), pero un fallo no debe dejar un PENDING sin URL.
    let presigned;
    try {
      presigned = await guarded(this.logger, 'presignPut', () =>
        this.storage.presignPut({
          objectKey,
          contentType: mime,
          sizeBytes: input.sizeBytes,
          checksumSha256Hex: input.checksumSha256,
          cacheControl: MEDIA_CACHE_CONTROL,
          expiresInSeconds: this.config.uploadTtlSeconds,
        }),
      );
    } catch (error) {
      await this.discardPending(row.id);
      throw error;
    }
    // Purga perezosa DESPUÉS de comprobar el tope y de crear el intent (acotada por lote y por tiempo).
    await this.lazyPurge();
    const asset = this.queries.view(row);
    this.logger.log(`Intent de subida creado (asset=${row.id}, staff=${staff.staffId})`);
    return {
      assetId: row.id,
      deduplicated: false,
      uploadUrl: presigned.url,
      headers: presigned.headers,
      expiresAt: expiresAt.toISOString(),
      storageMode: asset.storageMode,
      asset,
    };
  }

  // ---------- complete ----------

  async complete(staff: StaffContext, assetId: string): Promise<AdminMediaAssetView> {
    this.assertGlobal(staff, 'catalog.update');
    const row = await this.read(() => this.repo.findById(assetId));
    if (!row) throw mediaNotFound();
    if (row.status === 'READY') return this.queries.view(row); // idempotente: antes de caducidad y almacenamiento
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw uploadExpired();
    if (this.storage.mode === 'UNAVAILABLE') throw storageUnavailable();

    const head = await guarded(this.logger, 'headObject', () =>
      this.storage.headObject(row.objectKey),
    );
    if (!head) throw objectMissing();

    const rejection = this.rejectionOfHead(row, head);
    if (rejection) return this.reject(staff, row.id, row.objectKey, rejection);

    const bytes = await guarded(this.logger, 'readRange', () =>
      this.storage.readRange(row.objectKey, SIGNATURE_BYTES),
    );
    if (!bytes) throw objectMissing();
    if (!signatureMatches(row.mimeType, bytes)) {
      return this.reject(staff, row.id, row.objectKey, 'signature');
    }

    try {
      const confirmed = await this.inTransaction(async (tx) => {
        const changed = await this.repo.markReady(tx, row.id, new Date());
        if (changed) {
          await this.audit.record(tx, {
            actorId: staff.staffId,
            entityType: ENTITY,
            entityId: row.id,
            action: 'media.confirmed',
            newValues: { assetId: row.id },
          });
        }
        return { changed, current: await this.repo.findById(row.id, tx) };
      });
      // No cambió: otro `complete` ya lo confirmó (idempotente) o el intent caducó entre la lectura y el UPDATE (purga).
      if (!confirmed.changed && confirmed.current?.status !== 'READY') throw uploadExpired();
      this.logger.log(`Medio confirmado (asset=${row.id}, staff=${staff.staffId})`);
      return this.queries.view(confirmed.current as MediaAssetRow);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.reuseWinner(row.id, row.objectKey, row.kind, row.checksumSha256);
    }
  }

  /** Discrepancia entre lo declarado y lo que R2 informa en `HeadObject`. */
  private rejectionOfHead(
    row: { kind: MediaKind; sizeBytes: number; mimeType: string; checksumSha256: string },
    head: { sizeBytes: number; contentType: string | null; checksumSha256Base64: string | null },
  ): Rejection | null {
    if (
      head.sizeBytes !== row.sizeBytes ||
      head.sizeBytes > maxBytesFor(row.kind, this.config.maxBytes)
    )
      return 'size';
    if (baseContentType(head.contentType) !== row.mimeType) return 'type';
    // Sin checksum informado no se puede verificar: se falla cerrado (ver docs/integrations/cloudflare-r2.md).
    if (head.checksumSha256Base64 !== checksumHexToBase64(row.checksumSha256)) return 'checksum';
    return null;
  }

  /**
   * Borra el objeto YA (contenido no válido: no debe quedar público), deja la fila PENDING caducada (no confirmable) para
   * que la purga, pasado el margen del TTL, vuelva a borrar el objeto por si el PUT firmado aún vigente lo recrea; audita
   * `media.rejected` (sin PII) y responde 422 `MEDIA_CONTENT_MISMATCH`.
   */
  private async reject(
    staff: StaffContext,
    assetId: string,
    objectKey: string,
    reason: Rejection,
  ): Promise<never> {
    await this.deleteObjectBestEffort(objectKey);
    await this.inTransaction(async (tx) => {
      if (await this.repo.expirePending(tx, assetId, new Date())) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: ENTITY,
          entityId: assetId,
          action: 'media.rejected',
          reason,
          newValues: { assetId, reason },
        });
      }
    });
    this.logger.warn(`Subida rechazada (asset=${assetId}, motivo=${reason})`);
    throw contentMismatch();
  }

  /** Carrera por checksum: otro asset READY ganó. Se elimina el duplicado y se responde con el ganador. */
  private async reuseWinner(
    assetId: string,
    objectKey: string,
    kind: MediaKind,
    checksum: string,
  ): Promise<AdminMediaAssetView> {
    const winner = await this.inTransaction(async (tx) => {
      await this.repo.deletePending(tx, assetId);
      return this.repo.findReadyByChecksum(kind, checksum, tx);
    });
    await this.deleteObjectBestEffort(objectKey);
    if (!winner) throw mediaBusy();
    return this.queries.view(winner);
  }

  // ---------- borrado ----------

  async remove(staff: StaffContext, assetId: string): Promise<void> {
    this.assertGlobal(staff, 'catalog.update');
    // Sin almacenamiento no se toca la fila: evitaría dejar un objeto huérfano imposible de limpiar.
    if (this.storage.mode === 'UNAVAILABLE') throw storageUnavailable();
    const objectKey = await this.inTransaction(async (tx) => {
      const row = await this.repo.findById(assetId, tx);
      if (!row) throw mediaNotFound();
      if (row.usageCount > 0) throw mediaInUse();
      // La FK RESTRICT responde (23503 -> 409) si un adjuntar concurrente confirmó entre la lectura y el DELETE.
      if (!(await this.repo.deleteById(tx, assetId))) throw mediaNotFound();
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: ENTITY,
        entityId: assetId,
        action: 'media.deleted',
        newValues: { assetId },
      });
      return row.objectKey;
    });
    // La fila ya no existe: si el borrado del objeto falla solo queda un huérfano (se avisa), nunca una referencia colgante.
    await this.deleteObjectBestEffort(objectKey);
    this.logger.log(`Medio eliminado (asset=${assetId}, staff=${staff.staffId})`);
  }

  // ---------- utilidades ----------

  private async deleteObjectBestEffort(objectKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(objectKey);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar el objeto ${objectKey} (${safeErrorLabel(error)}); queda huérfano, revisar`,
      );
    }
  }

  private async discardPending(assetId: string): Promise<void> {
    try {
      await this.inTransaction((tx) => this.repo.deletePending(tx, assetId));
    } catch {
      // Caducará y la purga lo elimina.
    }
  }

  private async lazyPurge(): Promise<void> {
    try {
      await this.cleanup.purgeExpired();
    } catch (error) {
      this.logger.warn(`Purga perezosa omitida (${safeErrorLabel(error)})`);
    }
  }

  private assertGlobal(staff: StaffContext, permission: string): void {
    if (!this.authorization.scopeFor(staff, permission).allBranches) {
      throw new ForbiddenException('Acceso denegado');
    }
  }

  /** Lectura sin transacción: traduce timeouts/errores de BD igual que las escrituras. */
  private async read<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw translateMediaDbError(error);
    }
  }

  private async inTransaction<T>(fn: (tx: MediaTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateMediaDbError(error);
    }
  }
}
