import { AdminBannersService } from '../../src/banners/admin-banners.service.js';
import { PublicBannersReader } from '../../src/banners/public-banners.reader.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { MediaUrlService } from '../../src/media/media-url.service.js';
import { FakeBannersRepo } from './fake-banners-repo.js';
import { mediaConfig } from './media-harness.js';

/** Doble de la liberación de la imagen (F14 `removeUnusedAsset`): registra llamadas y puede fallar. */
export class FakeImageReleaser {
  released: string[] = [];
  failWith: Error | null = null;
  removeUnusedAsset(_staff: unknown, assetId: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.released.push(assetId);
    return Promise.resolve();
  }
}

/** Repositorio de banners en memoria + servicios REALES (la liberación de imagen es un doble). */
export function bannersHarness(opts: { publicBaseUrl?: string | null } = {}) {
  const repo = new FakeBannersRepo();
  repo.seedAsset(1);
  const authorization = new AuthorizationService({} as IdentityService);
  const audit = new AuditService();
  const urls = new MediaUrlService(
    mediaConfig(opts.publicBaseUrl === null ? { publicBaseUrl: null, mode: 'UNAVAILABLE' } : {}),
  );
  const releaser = new FakeImageReleaser();
  const admin = new AdminBannersService(repo.asRepository(), audit, authorization, urls, releaser);
  const reader = new PublicBannersReader(repo.asReadRepository(), urls);
  return { repo, admin, reader, authorization, urls, audit, releaser };
}
