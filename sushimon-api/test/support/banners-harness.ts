import { AdminBannersService } from '../../src/banners/admin-banners.service.js';
import { BannersTimeService } from '../../src/banners/banners-time.service.js';
import { PublicBannersReader } from '../../src/banners/public-banners.reader.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import type { Clock } from '../../src/branch-schedule/clock.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { MediaUrlService } from '../../src/media/media-url.service.js';
import { bid } from './fake-branch-products-repo.js';
import { FakeBannersRepo } from './fake-banners-repo.js';
import { mediaConfig } from './media-harness.js';

export const TZ = 'America/Guatemala';
export const A = bid(1);
export const B = bid(2);
export const C = bid(3);
export const INACTIVE_BRANCH = bid(4);
export const MISSING_BRANCH = bid(99);

/** Instante a partir de la hora local de Guatemala (UTC-6, sin horario de verano). */
export const local = (iso: string): Date => new Date(`${iso}-06:00`);
/** Lunes 16 de noviembre de 2026, 16:00 local. */
export const NOW = local('2026-11-16T16:00:00');

export class MutableClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
}

/** Mundo de sucursales + repositorio de banners en memoria + servicios REALES. */
export function bannersHarness(opts: { publicBaseUrl?: string | null } = {}) {
  const repo = new FakeBannersRepo();
  repo.seedBranch(A, 'Zona 10');
  repo.seedBranch(B, 'Antigua');
  repo.seedBranch(C, 'Escuintla');
  repo.seedBranch(INACTIVE_BRANCH, 'Cerrada', false);
  repo.seedAsset(1);
  const clock = new MutableClock(NOW);
  const time = new BannersTimeService(clock, TZ);
  const authorization = new AuthorizationService({} as IdentityService);
  const audit = new AuditService();
  const urls = new MediaUrlService(
    mediaConfig(opts.publicBaseUrl === null ? { publicBaseUrl: null, mode: 'UNAVAILABLE' } : {}),
  );
  const admin = new AdminBannersService(repo.asRepository(), audit, authorization, time, urls);
  const reader = new PublicBannersReader(repo.asReadRepository(), time, urls);
  return { repo, clock, time, admin, reader, authorization, urls, audit };
}
