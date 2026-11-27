import type { BannerTx, BannersRepository } from '../../src/banners/banners.repository.js';
import type { BannersReadRepository } from '../../src/banners/banners-read.repository.js';
import type {
  BannerAssetRow,
  BannerRecord,
  BannerScalars,
  NewBanner,
  StoreBannerRow,
} from '../../src/banners/banners.types.js';

export const bnid = (n: number) => `00000000-0000-4000-8000-${String(n + 12000).padStart(12, '0')}`;
export const assetid = (n: number) =>
  `00000000-0000-4000-8000-${String(n + 13000).padStart(12, '0')}`;
export const T0 = new Date('2026-01-01T00:00:00Z');

export interface StoredBanner {
  id: string;
  code: string;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  imageAssetId: string;
  imageAlt: string;
}

export interface FakeAsset extends BannerAssetRow {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
}

const copy = (b: StoredBanner): StoredBanner => ({ ...b });

/** Error con la forma de la violación del trigger `banners_max_count_trg` (0023). */
export const maxCountTriggerError = () =>
  Object.assign(new Error('banners_max_count'), {
    code: 'P2010',
    meta: { code: '23514', message: 'banners_max_count', constraint: 'banners_max_count' },
  });

/**
 * Doble en memoria de `BannersRepository` Y `BannersReadRepository`. Emula COMMIT/ROLLBACK por instantánea, el candado de
 * fila y, opcionalmente, el trigger de tope (`emulateTrigger`). Los activos se siembran con `seedAsset`. Cuenta llamadas.
 */
export class FakeBannersRepo {
  banners = new Map<string, StoredBanner>();
  assets = new Map<string, FakeAsset>();
  audit: Record<string, unknown>[] = [];
  calls: string[] = [];
  failTransactionWith: unknown = null;
  failReadWith: unknown = null;
  /** Se ejecuta tras bloquear (simula una escritura concurrente entre la lectura y el PATCH/DELETE). */
  afterLock: (() => void) | null = null;
  /** Si es `true`, el INSERT falla como el trigger cuando ya hay 5 filas (carrera que el conteo previo no vio). */
  emulateTrigger = false;
  /** Fuerza que `count` devuelva otro valor (simula la carrera entre el conteo y el INSERT). */
  countOverride: number | null = null;
  private counter = 0;

  callCount = (name: string) => this.calls.filter((c) => c === name).length;
  asRepository = () => this as unknown as BannersRepository;
  asReadRepository = () => this as unknown as BannersReadRepository;

  seedAsset(n: number, over: Partial<FakeAsset> = {}): FakeAsset {
    const id = assetid(n);
    const asset: FakeAsset = {
      id,
      kind: 'BANNER_IMAGE',
      status: 'READY',
      objectKey: `banners/2026/obj-${n}.webp`,
      mimeType: 'image/webp',
      sizeBytes: 200_000,
      ...over,
    };
    this.assets.set(id, asset);
    return asset;
  }

  seed(over: Partial<StoredBanner> = {}): StoredBanner {
    this.counter += 1;
    const n = this.counter;
    const asset = [...this.assets.values()][0] ?? this.seedAsset(n);
    const row: StoredBanner = {
      id: bnid(n),
      code: `banner-${n}`,
      active: true,
      version: 1,
      createdAt: new Date(T0.getTime() + n * 1000),
      updatedAt: T0,
      imageAssetId: asset.id,
      imageAlt: `Alt ${n}`,
      ...over,
    };
    this.banners.set(row.id, row);
    return row;
  }

  // ---------- transacciones y candados ----------

  async transaction<T>(fn: (tx: BannerTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const snapshot = new Map([...this.banners].map(([k, v]) => [k, copy(v)]));
    const auditLength = this.audit.length;
    const state = { dirty: false };
    const tx = {
      __state: state,
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as BannerTx;
    try {
      return await fn(tx);
    } catch (error) {
      // Solo revierte si ESTA transacción escribió (otra concurrente pudo confirmar mientras tanto).
      if (state.dirty) {
        this.audit.length = auditLength;
        this.banners = snapshot;
      }
      throw error;
    }
  }

  private markDirty(tx: unknown): void {
    const state = (tx as { __state?: { dirty: boolean } } | undefined)?.__state;
    if (state) state.dirty = true;
  }

  lockBanner(_tx: unknown, id: string): Promise<boolean> {
    this.calls.push('lockBanner');
    const found = this.banners.has(id);
    this.afterLock?.();
    return Promise.resolve(found);
  }

  // ---------- lecturas ----------

  private guardRead(): void {
    if (this.failReadWith) throw this.failReadWith as Error;
  }

  findAsset(id: string): Promise<BannerAssetRow | null> {
    this.calls.push('findAsset');
    const a = this.assets.get(id);
    return Promise.resolve(a ? { id: a.id, kind: a.kind, status: a.status } : null);
  }

  count(): Promise<number> {
    this.calls.push('count');
    return Promise.resolve(this.countOverride ?? this.banners.size);
  }

  private byCreation = (a: StoredBanner, b: StoredBanner): number =>
    a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  findAll(): Promise<BannerRecord[]> {
    this.calls.push('findAll');
    this.guardRead();
    return Promise.resolve(
      [...this.banners.values()].sort(this.byCreation).map((s) => this.toRecord(s)),
    );
  }

  findById(id: string): Promise<BannerRecord | null> {
    this.calls.push('findById');
    this.guardRead();
    const s = this.banners.get(id);
    return Promise.resolve(s ? this.toRecord(s) : null);
  }

  private toRecord(s: StoredBanner): BannerRecord {
    const asset = this.assets.get(s.imageAssetId) as FakeAsset;
    return {
      id: s.id,
      active: s.active,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      imageAlt: s.imageAlt,
      image: {
        assetId: asset.id,
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      },
    };
  }

  // ---------- escrituras ----------

  createBanner(tx: unknown, data: NewBanner, now: Date = new Date()): Promise<void> {
    this.calls.push('createBanner');
    this.markDirty(tx);
    if (this.emulateTrigger && this.banners.size >= 5)
      return Promise.reject(maxCountTriggerError());
    this.counter += 1;
    // Orden de creación estable en las pruebas: instantes crecientes aunque el reloj real no avance.
    const createdAt = new Date(Math.max(now.getTime(), T0.getTime() + this.counter * 1000));
    this.banners.set(data.id, {
      id: data.id,
      code: data.code,
      active: data.active,
      version: 1,
      createdAt,
      updatedAt: createdAt,
      imageAssetId: data.imageAssetId,
      imageAlt: data.imageAlt,
    });
    return Promise.resolve();
  }

  saveBanner(tx: unknown, id: string, scalars: BannerScalars, now: Date): Promise<void> {
    this.calls.push('saveBanner');
    this.markDirty(tx);
    const cur = this.banners.get(id);
    if (!cur) return Promise.reject(new Error('fila inexistente'));
    const next: StoredBanner = { ...copy(cur), version: cur.version + 1, updatedAt: now };
    if (scalars.imageAssetId !== undefined) next.imageAssetId = scalars.imageAssetId;
    if (scalars.imageAlt !== undefined) next.imageAlt = scalars.imageAlt;
    if (scalars.active !== undefined) next.active = scalars.active;
    this.banners.set(id, next);
    return Promise.resolve();
  }

  deleteBanner(tx: unknown, id: string): Promise<void> {
    this.calls.push('deleteBanner');
    this.markDirty(tx);
    this.banners.delete(id);
    return Promise.resolve();
  }

  // ---------- lectura pública ----------

  findActive(limit: number): Promise<StoreBannerRow[]> {
    this.calls.push('findActive');
    this.guardRead();
    return Promise.resolve(
      [...this.banners.values()]
        .filter((b) => b.active)
        .filter((b) => {
          const a = this.assets.get(b.imageAssetId);
          return a !== undefined && a.status === 'READY' && a.kind === 'BANNER_IMAGE';
        })
        .sort(this.byCreation)
        .slice(0, limit)
        .map((b) => {
          const asset = this.assets.get(b.imageAssetId) as FakeAsset;
          return {
            id: b.id,
            alt: b.imageAlt,
            objectKey: asset.objectKey,
            mimeType: asset.mimeType,
          };
        }),
    );
  }
}
