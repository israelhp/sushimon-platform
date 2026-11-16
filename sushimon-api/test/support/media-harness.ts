import { createHash } from 'node:crypto';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { AdminMediaService } from '../../src/media/admin-media.service.js';
import { MediaCleanupService } from '../../src/media/media-cleanup.service.js';
import {
  MOCK_BUCKET,
  MOCK_PUBLIC_BASE_URL,
  type MediaConfig,
} from '../../src/media/media-config.js';
import { MediaQueryService } from '../../src/media/media-query.service.js';
import { MediaUrlService } from '../../src/media/media-url.service.js';
import type { MediaStoragePort } from '../../src/media/media-storage.port.js';
import type { MediaRepository } from '../../src/media/media.repository.js';
import { MockMediaStorageAdapter } from '../../src/media/mock-media-storage.adapter.js';
import { FakeMediaRepo } from './fake-media-repo.js';

export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Un PNG "válido" a efectos de firma: 8 bytes mágicos + relleno distinto por `seed`. */
export const pngBytes = (seed = 1, size = 64): Uint8Array =>
  Uint8Array.from([...PNG_HEAD, ...Array.from({ length: size - 8 }, (_, i) => (i * seed) % 251)]);

export const mediaConfig = (over: Partial<MediaConfig> = {}): MediaConfig => ({
  mode: 'MOCK',
  maxBytes: 5_242_880,
  uploadTtlSeconds: 300,
  bucket: MOCK_BUCKET,
  publicBaseUrl: MOCK_PUBLIC_BASE_URL,
  ...over,
});

export interface AuditEvent {
  action: string;
  entityId: string;
  actorId: string | null;
  reason?: unknown;
  newValues?: unknown;
}

/** Servicios REALES de medios sobre repositorio en memoria y almacenamiento simulado (o el doble que se indique). */
export function mediaHarness(
  opts: { storage?: MediaStoragePort; config?: Partial<MediaConfig> } = {},
) {
  const repo = new FakeMediaRepo();
  const mock = new MockMediaStorageAdapter();
  const storage: MediaStoragePort = opts.storage ?? mock;
  const config = mediaConfig(opts.config);
  const urls = new MediaUrlService(config);
  const queries = new MediaQueryService(repo.asRepository(), urls, config);
  const cleanup = new MediaCleanupService(repo.asRepository(), storage);
  const audit = {
    record: vi.fn((tx: { auditEvent: { create: (a: unknown) => unknown } }, e: AuditEvent) => {
      tx.auditEvent.create({ data: e });
      return Promise.resolve();
    }),
  };
  const service = new AdminMediaService(
    repo.asRepository(),
    storage,
    queries,
    cleanup,
    audit as never,
    new AuthorizationService({} as IdentityService),
    config,
  );
  return { repo, mock, storage, config, urls, queries, cleanup, audit, service };
}

export type MediaRepoLike = MediaRepository;
