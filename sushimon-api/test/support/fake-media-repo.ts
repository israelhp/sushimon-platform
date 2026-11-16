import type { MediaRepository, MediaTx } from '../../src/media/media.repository.js';
import type {
  MediaAssetRow,
  MediaBannerUsageRow,
  MediaPageFilter,
  MediaUsageRow,
  NewPendingAsset,
} from '../../src/media/media.types.js';

export const uniqueViolation23505 = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: 'P2002',
    meta: { target: ['media_assets_ready_checksum_key'] },
  });

export const fkViolation = () =>
  Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' });

/**
 * Doble en memoria de `MediaRepository` (misma superficie). Emula COMMIT/ROLLBACK por instantánea, el UNIQUE parcial de
 * checksum READY y la FK RESTRICT (a través de `usageOf`). Captura la auditoría que `AuditService` escribe en `tx`.
 */
export class FakeMediaRepo {
  assets = new Map<string, MediaAssetRow>();
  /** Eventos `tx.auditEvent.create` (se revierten con el ROLLBACK). */
  audit: Record<string, unknown>[] = [];
  calls: string[] = [];
  /** Usos de un asset (de `product_media`). Por defecto, ninguno. */
  usageOf: (assetId: string) => MediaUsageRow[] = () => [];
  /** Usos de un asset por banners (F16, `banners.image_asset_id`). Por defecto, ninguno. */
  bannerUsageOf: (assetId: string) => MediaBannerUsageRow[] = () => [];
  failTransactionWith: unknown = null;
  /** La próxima llamada a `markReady` lanza este error (carrera 23505). */
  failNextMarkReadyWith: unknown = null;
  private counter = 0;

  count = (name: string) => this.calls.filter((c) => c === name).length;

  seed(over: Partial<MediaAssetRow> & { id: string }): MediaAssetRow {
    this.counter += 1;
    const row: MediaAssetRow = {
      kind: 'PRODUCT_IMAGE',
      objectKey: `products/2026/${over.id}.png`,
      bucket: 'bucket-test',
      mimeType: 'image/png',
      sizeBytes: 1000,
      checksumSha256: String(this.counter).padStart(64, 'a'),
      status: 'READY',
      createdByStaffId: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.counter)),
      confirmedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      usageCount: 0,
      ...over,
    };
    this.assets.set(row.id, row);
    return row;
  }

  private withUsage(row: MediaAssetRow): MediaAssetRow {
    return {
      ...row,
      usageCount: this.usageOf(row.id).length + this.bannerUsageOf(row.id).length,
    };
  }

  async transaction<T>(fn: (tx: MediaTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const snapshot = new Map([...this.assets].map(([k, v]) => [k, { ...v }]));
    const auditLength = this.audit.length;
    const tx = {
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as MediaTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.audit.length = auditLength;
      this.assets = snapshot;
      throw error;
    }
  }

  findById(id: string): Promise<MediaAssetRow | null> {
    this.calls.push('findById');
    const row = this.assets.get(id);
    return Promise.resolve(row ? this.withUsage(row) : null);
  }

  findReadyByChecksum(kind: string, checksum: string): Promise<MediaAssetRow | null> {
    this.calls.push('findReadyByChecksum');
    const row = [...this.assets.values()].find(
      (a) => a.kind === kind && a.checksumSha256 === checksum && a.status === 'READY',
    );
    return Promise.resolve(row ? this.withUsage(row) : null);
  }

  lockStaffIntents(): Promise<void> {
    this.calls.push('lockStaffIntents');
    return Promise.resolve();
  }

  countPendingByStaff(_tx: MediaTx, staffId: string, now: Date): Promise<number> {
    this.calls.push('countPending');
    return Promise.resolve(
      [...this.assets.values()].filter(
        (a) =>
          a.createdByStaffId === staffId &&
          a.status === 'PENDING' &&
          a.expiresAt !== null &&
          a.expiresAt > now,
      ).length,
    );
  }

  insertPending(_tx: MediaTx, data: NewPendingAsset): Promise<MediaAssetRow> {
    this.calls.push('insertPending');
    this.counter += 1;
    const row: MediaAssetRow = {
      id: `00000000-0000-4000-8000-${String(this.counter + 5000).padStart(12, '0')}`,
      ...data,
      status: 'PENDING',
      createdAt: new Date(),
      confirmedAt: null,
      usageCount: 0,
    };
    this.assets.set(row.id, row);
    return Promise.resolve({ ...row });
  }

  markReady(_tx: MediaTx, id: string, now: Date): Promise<boolean> {
    this.calls.push('markReady');
    if (this.failNextMarkReadyWith) {
      const error = this.failNextMarkReadyWith;
      this.failNextMarkReadyWith = null;
      throw error as Error;
    }
    const row = this.assets.get(id);
    if (!row || row.status !== 'PENDING') return Promise.resolve(false);
    if (row.expiresAt === null || row.expiresAt <= now) return Promise.resolve(false); // WHERE expires_at > now
    const clash = [...this.assets.values()].some(
      (a) =>
        a.id !== id &&
        a.status === 'READY' &&
        a.kind === row.kind &&
        a.checksumSha256 === row.checksumSha256,
    );
    if (clash) throw uniqueViolation23505();
    this.assets.set(id, { ...row, status: 'READY', confirmedAt: now, expiresAt: null });
    return Promise.resolve(true);
  }

  expirePending(_tx: MediaTx, id: string, now: Date): Promise<boolean> {
    this.calls.push('expirePending');
    const row = this.assets.get(id);
    if (!row || row.status !== 'PENDING') return Promise.resolve(false);
    this.assets.set(id, { ...row, expiresAt: now });
    return Promise.resolve(true);
  }

  deletePending(_tx: MediaTx, id: string): Promise<boolean> {
    this.calls.push('deletePending');
    const row = this.assets.get(id);
    if (!row || row.status !== 'PENDING') return Promise.resolve(false);
    this.assets.delete(id);
    return Promise.resolve(true);
  }

  deleteById(_tx: MediaTx, id: string): Promise<boolean> {
    this.calls.push('deleteById');
    if (this.usageOf(id).length > 0) throw fkViolation();
    return Promise.resolve(this.assets.delete(id));
  }

  findExpiredPending(before: Date, limit: number): Promise<{ id: string; objectKey: string }[]> {
    this.calls.push('findExpiredPending');
    return Promise.resolve(
      [...this.assets.values()]
        .filter((a) => a.status === 'PENDING' && a.expiresAt !== null && a.expiresAt < before)
        .sort((a, b) => (a.expiresAt as Date).getTime() - (b.expiresAt as Date).getTime())
        .slice(0, limit)
        .map((a) => ({ id: a.id, objectKey: a.objectKey })),
    );
  }

  deleteExpiredPending(ids: readonly string[], before: Date): Promise<number> {
    this.calls.push('deleteExpiredPending');
    let n = 0;
    for (const id of ids) {
      const row = this.assets.get(id);
      if (row && row.status === 'PENDING' && row.expiresAt !== null && row.expiresAt < before) {
        this.assets.delete(id);
        n += 1;
      }
    }
    return Promise.resolve(n);
  }

  findPage(filter: MediaPageFilter): Promise<{ rows: MediaAssetRow[]; total: number }> {
    this.calls.push('findPage');
    const rows = [...this.assets.values()]
      .map((r) => this.withUsage(r))
      .filter((r) => !filter.kind || r.kind === filter.kind)
      .filter((r) => !filter.status || r.status === filter.status)
      .filter(
        (r) =>
          filter.unreferenced === undefined ||
          (filter.unreferenced ? r.usageCount === 0 : r.usageCount > 0),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
    const start = (filter.page - 1) * filter.pageSize;
    return Promise.resolve({
      rows: rows.slice(start, start + filter.pageSize),
      total: rows.length,
    });
  }

  findUsages(assetId: string): Promise<MediaUsageRow[]> {
    this.calls.push('findUsages');
    return Promise.resolve(this.usageOf(assetId));
  }

  findBannerUsages(assetId: string): Promise<MediaBannerUsageRow[]> {
    this.calls.push('findBannerUsages');
    return Promise.resolve(this.bannerUsageOf(assetId));
  }

  asRepository = (): MediaRepository => this as unknown as MediaRepository;
}
