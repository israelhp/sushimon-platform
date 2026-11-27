import type {
  AdminBanner,
  AdminBannerList,
  StoreBanner,
  StoreBannerList,
} from '@/lib/data-access/models';
import {
  BANNER_ALT_MAX,
  BANNER_LIMIT,
  cleanAlt,
  hasDisallowedBannerChars,
} from '@/lib/banner-rules';
import { badRequest, fail, failCode } from '../domain';
import type { BannerRecord } from '../fixtures/banners';
import type { MediaAssetRecord, MockStore } from '../store';
import { assetPublicUrl, removeAsset } from './media';
import { now, requireStaff, type Handler, type Req } from './shared';

/**
 * F16 (simplificado, ADR-0033) — Banners del Inicio. El mock EMULA al servidor con la MISMA semántica del contrato:
 * - Público (`GET /v1/store/banners`, sin parámetros): solo banners `active` cuya imagen es un asset `READY` de tipo `BANNER_IMAGE`,
 *   en orden de creación (`createdAt`, desempate `id`), máx. 5, con la forma `{id, image: {url, mimeType}, alt}` (nunca código,
 *   versión ni ids de asset). NO simula `Cache-Control` ni el límite de tasa.
 * - Admin: `banners.read|create|update` con alcance GLOBAL (el banner no tiene sucursal; acotado => 403; aal2 lo simula la sesión).
 *   Lista completa (0..5, `limit=5`). Alta: `imageAssetId` + `imageAlt` (+ `active`, por defecto `true`); 400 de forma (campos
 *   desconocidos, `imageAlt` fuera de 1..120), 422 `BANNER_IMAGE_INVALID` (violations `ASSET_UNKNOWN|ASSET_NOT_READY|ASSET_KIND_MISMATCH`)
 *   | `BANNER_ALT_INVALID`, 409 `BANNER_LIMIT_REACHED` al intentar el 6.º (sin escribir). PATCH parcial con `expectedVersion`
 *   obligatorio (409 `BANNER_VERSION_CONFLICT`); sin cambios reales = 200 sin subir `version`. DELETE con `expectedVersion` en la
 *   query: borrado físico (204) y, de mejor esfuerzo, libera el asset si ningún banner ni producto lo usa. 404 `BANNER_NOT_FOUND`;
 *   503 `BANNERS_BUSY` determinista (`store.bannersBusy`). Orden de comprobación: sesión/permiso -> 404 -> forma (400) -> versión (409)
 *   -> reglas (422) -> tope (409). NO simula auditoría, UUID ni límites de tasa.
 *
 * La imagen sale del almacén SIMULADO de medios (F14): URL `*.invalid` que la tienda nunca pide por red.
 */

const has = (raw: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

/** Orden de creación: `createdAt` y, en empate, `id`. */
const byCreation = (a: BannerRecord, b: BannerRecord) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function failBusy(store: MockStore): void {
  if ((store.bannersBusy ?? 0) > 0) {
    store.bannersBusy = (store.bannersBusy ?? 0) - 1;
    failCode(503, 'BANNERS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

const bannerNotFound = (): never => failCode(404, 'BANNER_NOT_FOUND', 'Banner no encontrado');

function assetOf(store: MockStore, b: BannerRecord): MediaAssetRecord | undefined {
  return store.mediaAssets.find((a) => a.id === b.imageAssetId);
}

// ── Público ────────────────────────────────────────────────────────────────────────────────

function storeView(store: MockStore, b: BannerRecord): StoreBanner | null {
  const asset = assetOf(store, b);
  if (!asset || asset.status !== 'READY' || asset.kind !== 'BANNER_IMAGE') return null;
  return {
    id: b.id,
    image: { url: assetPublicUrl(asset), mimeType: asset.mimeType },
    alt: b.imageAlt,
  };
}

/** Banners activos con imagen disponible, en orden de creación (la comparte el bootstrap del Inicio, F17). */
export function publicBannerList(store: MockStore): StoreBannerList {
  const items = [...store.banners]
    .filter((b) => b.active)
    .sort(byCreation)
    .flatMap((b) => {
      const view = storeView(store, b);
      return view ? [view] : [];
    })
    .slice(0, BANNER_LIMIT);
  return { items };
}

/** GET /v1/store/banners — público, sin parámetros. */
export const listStoreBanners: Handler = (req): StoreBannerList => {
  failBusy(req.store);
  return publicBannerList(req.store);
};

// ── Administración ─────────────────────────────────────────────────────────────────────────

/** El banner no tiene sucursal: toda operación exige el permiso con alcance GLOBAL (si no, 403). */
function actorFor(req: Req, permission: 'banners.read' | 'banners.create' | 'banners.update') {
  const actor = requireStaff(req, permission);
  if (!actor.scope.allBranches) {
    fail(403, 'Los banners son globales: se requiere alcance sobre todas las sucursales');
  }
  return actor;
}

function adminView(store: MockStore, b: BannerRecord): AdminBanner {
  const asset = assetOf(store, b);
  return {
    id: b.id,
    image: {
      assetId: b.imageAssetId,
      url: asset && asset.status === 'READY' ? assetPublicUrl(asset) : null,
      mimeType: asset?.mimeType ?? 'image/webp',
      sizeBytes: asset?.sizeBytes ?? 1,
    },
    imageAlt: b.imageAlt,
    active: b.active,
    version: b.version,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** GET /v1/admin/banners — todos (activos e inactivos), orden de creación. */
export const listAdminBanners: Handler = (req): AdminBannerList => {
  actorFor(req, 'banners.read');
  const { store } = req;
  failBusy(store);
  return {
    items: [...store.banners].sort(byCreation).map((b) => adminView(store, b)),
    limit: BANNER_LIMIT,
  };
};

/** GET /v1/admin/banners/:id */
export const getAdminBanner: Handler = (req): AdminBanner => {
  actorFor(req, 'banners.read');
  const found = req.store.banners.find((b) => b.id === req.params.id);
  if (!found) bannerNotFound();
  return adminView(req.store, found as BannerRecord);
};

const CREATE_KEYS = ['imageAssetId', 'imageAlt', 'active'] as const;
const UPDATE_KEYS = ['expectedVersion', 'imageAssetId', 'imageAlt', 'active'] as const;

/** Forma (400): solo claves permitidas y tipos correctos; `imageAlt` de 1 a 120 caracteres. */
function parseShape(raw: Record<string, unknown>, allowed: readonly string[], create: boolean) {
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) problems.push(`${key}: campo no permitido`);
  }
  if (has(raw, 'imageAssetId') && typeof raw.imageAssetId !== 'string') {
    problems.push('imageAssetId: texto');
  }
  if (create && !has(raw, 'imageAssetId')) problems.push('imageAssetId: obligatorio');
  if (has(raw, 'imageAlt')) {
    if (typeof raw.imageAlt !== 'string') problems.push('imageAlt: texto');
    else if (raw.imageAlt.length < 1 || raw.imageAlt.length > BANNER_ALT_MAX) {
      problems.push(`imageAlt: entre 1 y ${BANNER_ALT_MAX} caracteres`);
    }
  } else if (create) {
    problems.push('imageAlt: obligatorio');
  }
  if (has(raw, 'active') && typeof raw.active !== 'boolean') problems.push('active: booleano');
  if (allowed.includes('expectedVersion')) {
    const v = raw.expectedVersion;
    if (!Number.isInteger(v) || (v as number) < 1) problems.push('expectedVersion: entero >= 1');
  }
  if (problems.length > 0) badRequest(problems);
}

/** 422: imagen inexistente / sin confirmar / que no es de banner. */
function assertImage(store: MockStore, assetId: string): void {
  const asset = store.mediaAssets.find((a) => a.id === assetId);
  const code = !asset
    ? 'ASSET_UNKNOWN'
    : asset.status !== 'READY'
      ? 'ASSET_NOT_READY'
      : asset.kind !== 'BANNER_IMAGE'
        ? 'ASSET_KIND_MISMATCH'
        : null;
  if (code) {
    failCode(422, 'BANNER_IMAGE_INVALID', 'La imagen del banner no es válida', [
      { path: 'imageAssetId', code, message: code },
    ]);
  }
}

/** 422: texto alternativo en blanco (o solo invisibles) o con caracteres de control. Devuelve el texto recortado. */
function assertAlt(raw: string): string {
  const clean = cleanAlt(raw);
  if (clean === null || hasDisallowedBannerChars(clean)) {
    failCode(422, 'BANNER_ALT_INVALID', 'El texto alternativo no es válido', [
      {
        path: 'imageAlt',
        code: clean === null ? 'ALT_BLANK' : 'ALT_CHARS',
        message: 'Describe la imagen con 1 a 120 caracteres, sin caracteres de control',
      },
    ]);
  }
  return clean as string;
}

/** POST /v1/admin/banners */
export const createAdminBanner: Handler = (req): AdminBanner => {
  actorFor(req, 'banners.create');
  const { store } = req;
  const raw = rawBody(req);
  parseShape(raw, CREATE_KEYS, true);
  assertImage(store, raw.imageAssetId as string);
  const imageAlt = assertAlt(raw.imageAlt as string);
  if (store.banners.length >= BANNER_LIMIT) {
    failCode(
      409,
      'BANNER_LIMIT_REACHED',
      `Ya existen ${BANNER_LIMIT} banners; elimina uno antes de crear otro`,
    );
  }
  failBusy(store);
  const stamp = now(req).toISOString();
  const n = store.sequences.banner++;
  const record: BannerRecord = {
    id: `banner-${n}`,
    code: `banner-${n}`,
    imageAssetId: raw.imageAssetId as string,
    imageAlt,
    active: (raw.active as boolean | undefined) ?? true,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.banners.push(record);
  return adminView(store, record);
};

/** PATCH /v1/admin/banners/:id — parcial con `expectedVersion`. */
export const updateAdminBanner: Handler = (req): AdminBanner => {
  actorFor(req, 'banners.update');
  const { store } = req;
  const current = store.banners.find((b) => b.id === req.params.id);
  if (!current) return bannerNotFound();
  const raw = rawBody(req);
  parseShape(raw, UPDATE_KEYS, false);
  if (raw.expectedVersion !== current.version) {
    failCode(409, 'BANNER_VERSION_CONFLICT', 'El banner cambió; recarga e inténtalo de nuevo');
  }
  if (has(raw, 'imageAssetId')) assertImage(store, raw.imageAssetId as string);
  const imageAlt = has(raw, 'imageAlt') ? assertAlt(raw.imageAlt as string) : current.imageAlt;
  const next = {
    imageAssetId: (raw.imageAssetId as string | undefined) ?? current.imageAssetId,
    imageAlt,
    active: (raw.active as boolean | undefined) ?? current.active,
  };
  // Sin cambios reales: 200 sin escribir, sin subir `version`.
  if (
    next.imageAssetId === current.imageAssetId &&
    next.imageAlt === current.imageAlt &&
    next.active === current.active
  ) {
    return adminView(store, current);
  }
  failBusy(store);
  Object.assign(current, next);
  current.version += 1;
  current.updatedAt = now(req).toISOString();
  return adminView(store, current);
};

/** DELETE /v1/admin/banners/:id?expectedVersion — 204. Exige `banners.update`; no idempotente (repetir => 404). */
export const deleteAdminBanner: Handler = (req): void => {
  actorFor(req, 'banners.update');
  const { store } = req;
  const rawVersion = req.query.get('expectedVersion');
  const expected = rawVersion !== null && /^\d{1,9}$/.test(rawVersion) ? Number(rawVersion) : null;
  const current = store.banners.find((b) => b.id === req.params.id);
  if (!current) return bannerNotFound();
  if (expected === null || expected < 1) badRequest(['expectedVersion: entero >= 1 (query)']);
  if (expected !== current.version) {
    failCode(409, 'BANNER_VERSION_CONFLICT', 'El banner cambió; recarga e inténtalo de nuevo');
  }
  failBusy(store);
  store.banners = store.banners.filter((b) => b.id !== current.id);
  // Mejor esfuerzo (como `deleteAdminMedia`): libera el asset solo si ningún banner ni producto lo usa y hay almacenamiento.
  const used =
    store.banners.some((b) => b.imageAssetId === current.imageAssetId) ||
    store.products.some((p) => p.media.some((m) => m.assetId === current.imageAssetId));
  if (!used && !store.mediaStorageUnavailable) removeAsset(store, current.imageAssetId);
};
