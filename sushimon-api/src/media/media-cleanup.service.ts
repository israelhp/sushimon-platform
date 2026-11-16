import { Inject, Injectable, Logger } from '@nestjs/common';
import { MediaRepository } from './media.repository.js';
import { safeErrorLabel } from './guarded-storage.js';
import { PURGE_BATCH, PURGE_BUDGET_MS, PURGE_GRACE_MS } from './media-policy.js';
import { MEDIA_STORAGE_PORT, type MediaStoragePort } from './media-storage.port.js';

const CONCURRENCY = 10;

/**
 * Purga de intents PENDING caducados (F14 D12). Perezosa al crear un intent y exportada para un job futuro (no hay
 * planificador en F14). Solo toca PENDING con `expires_at < now - 5 min` (margen = TTL máximo de la URL firmada): nunca
 * borra un objeto cuyo PUT firmado pueda seguir vigente. El borrado del objeto es best-effort: si falla se avisa con la
 * clave (sin secretos) y la fila se elimina igualmente. Acotada por lote y por presupuesto de tiempo.
 */
@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    @Inject(MediaRepository) private readonly repo: MediaRepository,
    @Inject(MEDIA_STORAGE_PORT) private readonly storage: MediaStoragePort,
  ) {}

  /** Devuelve cuántas filas se eliminaron (a lo sumo `limit`, 20 por defecto, y dentro de `budgetMs`). */
  async purgeExpired(
    limit: number = PURGE_BATCH,
    now: Date = new Date(),
    budgetMs: number = PURGE_BUDGET_MS,
  ): Promise<number> {
    const deadline = Date.now() + budgetMs;
    const before = new Date(now.getTime() - PURGE_GRACE_MS);
    const batch = await this.repo.findExpiredPending(
      before,
      Math.min(Math.max(1, limit), PURGE_BATCH),
    );
    let purged = 0;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      if (i > 0 && Date.now() >= deadline) break; // presupuesto agotado: el resto queda para la siguiente pasada
      const chunk = batch.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ({ objectKey }) => {
          try {
            await this.storage.deleteObject(objectKey);
          } catch (error) {
            this.logger.warn(
              `No se pudo borrar el objeto caducado ${objectKey} (${safeErrorLabel(error)}); revisar huérfanos`,
            );
          }
        }),
      );
      purged += await this.repo.deleteExpiredPending(
        chunk.map((b) => b.id),
        before,
      );
    }
    return purged;
  }
}
