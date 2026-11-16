import { Inject, Injectable } from '@nestjs/common';
import { MEDIA_CONFIG, type MediaConfig } from './media-config.js';
import { mediaNotFound, toAssetView } from './media-policy.js';
import { MediaRepository } from './media.repository.js';
import { MediaUrlService } from './media-url.service.js';
import type {
  AdminMediaAssetDetailView,
  AdminMediaAssetPageView,
  AdminMediaAssetView,
  MediaAssetRow,
  MediaPageFilter,
  MediaStorageMode,
} from './media.types.js';

/** Lecturas de la biblioteca de medios (`catalog.read`). No toca el almacenamiento externo. */
@Injectable()
export class MediaQueryService {
  constructor(
    @Inject(MediaRepository) private readonly repo: MediaRepository,
    @Inject(MediaUrlService) private readonly urls: MediaUrlService,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  /** `MOCK` solo con el adaptador simulado; el resto (R2 o sin almacenamiento) son objetos de R2. */
  get storageMode(): MediaStorageMode {
    return this.config.mode === 'MOCK' ? 'MOCK' : 'R2';
  }

  view(row: MediaAssetRow): AdminMediaAssetView {
    return toAssetView(row, this.storageMode, (key) => this.urls.tryPublicUrl(key));
  }

  async list(filter: MediaPageFilter): Promise<AdminMediaAssetPageView> {
    const { rows, total } = await this.repo.findPage(filter);
    return {
      items: rows.map((r) => this.view(r)),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
    };
  }

  async get(id: string): Promise<AdminMediaAssetDetailView> {
    const row = await this.repo.findById(id);
    if (!row) throw mediaNotFound();
    const usages = await this.repo.findUsages(id);
    return { ...this.view(row), usages };
  }
}
