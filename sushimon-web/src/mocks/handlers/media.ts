import type {
  AdminMediaAsset,
  AdminMediaAssetDetail,
  AdminMediaAssetPage,
  AdminMediaUploadIntent,
  AdminProductMedia,
  AdminProductMediaList,
} from '@/lib/data-access/models';
import { hexToBase64 } from '@/lib/media-optimize';
import {
  MEDIA_ALT_MAX,
  MEDIA_MAX_BYTES,
  MEDIA_PAGE_MAX,
  MEDIA_PAGE_SIZE_MAX,
  MEDIA_PENDING_LIMIT,
  MEDIA_PER_PRODUCT_MAX,
  MEDIA_UPLOAD_TTL_SECONDS,
  SIMULATED_MEDIA_HOST,
  SIMULATED_UPLOAD_HOST,
  extensionForMime,
  intentShapeProblems,
  isAllowedMime,
  type MediaMime,
} from '@/lib/media-rules';
import { hasDisallowedControlChars } from '@/lib/product-rules';
import { badRequest, fail, failCode } from '../domain';
import type { MediaAssetRecord, MockStore, ProductRecord } from '../store';
import { now, requireStaff, type Handler, type Req } from './shared';

/**
 * F14 — Imágenes y medios (spec 015). El mock EMULA a la API: intent (forma 400 → almacenamiento 503 → MIME 422 → tamaño 422 →
 * dedup 200 por checksum → tope de PENDING 422 → crea PENDING 201 con vigencia de 300 s), complete (404 · READY idempotente ·
 * 410 caducado · 503 sin almacenamiento · 422 objeto ausente · 422 contenido distinto, que borra objeto y fila), biblioteca,
 * borrado (409 `MEDIA_IN_USE`) y vínculo con productos (adjuntar, alt, reordenar exacto, desvincular sin borrar el asset;
 * tope de 8). Lectura `catalog.read`; escritura `catalog.update` con alcance GLOBAL. Errores deterministas: `store.mediaStorageUnavailable`
 * (503 `MEDIA_STORAGE_UNAVAILABLE`), `store.mediaBusy` (503 `MEDIA_BUSY`) y `store.productsBusy` (503 `PRODUCTS_BUSY`).
 *
 * SIMULADO: no hay bytes ni R2. El PUT lo reemplaza `PUT /v1/demo/media/objects/:assetId` (solo mock), que registra lo que
 * `HeadObject` vería (tamaño, tipo, checksum). Las URLs públicas usan el host reservado `*.invalid`. NO simula auditoría ni
 * cabeceras `no-store` ni la forma UUID de los ids.
 */

const reader = (req: Req) => requireStaff(req, 'catalog.read');

function writer(req: Req) {
  const actor = requireStaff(req, 'catalog.update');
  if (!actor.scope.allBranches) {
    fail(403, 'Los medios son globales: se requiere alcance sobre todas las sucursales');
  }
  return actor;
}

const publicUrlOf = (objectKey: string) => `https://${SIMULATED_MEDIA_HOST}/${objectKey}`;

/** URL pública simulada de un asset (la usa también el mock de productos para enlazar `assetId`). */
export const assetPublicUrl = (a: Pick<MediaAssetRecord, 'objectKey'>) => publicUrlOf(a.objectKey);

const usageCount = (store: MockStore, assetId: string): number =>
  store.products.reduce((n, p) => n + p.media.filter((m) => m.assetId === assetId).length, 0);

function assetView(store: MockStore, a: MediaAssetRecord): AdminMediaAsset {
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    url: a.status === 'READY' ? assetPublicUrl(a) : null,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    checksumSha256: a.checksumSha256,
    createdAt: a.createdAt,
    confirmedAt: a.confirmedAt,
    expiresAt: a.status === 'PENDING' ? a.expiresAt : null,
    usageCount: usageCount(store, a.id),
    storageMode: 'MOCK',
  };
}

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

/** Solo las claves permitidas (400 si sobra alguna). */
function onlyKeys(raw: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(raw)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${k}: campo no permitido`);
}

function storageGuard(store: MockStore): void {
  if (store.mediaStorageUnavailable) {
    failCode(503, 'MEDIA_STORAGE_UNAVAILABLE', 'El almacenamiento de imágenes no está disponible');
  }
}

function mediaBusy(store: MockStore): void {
  if ((store.mediaBusy ?? 0) > 0) {
    store.mediaBusy = (store.mediaBusy ?? 0) - 1;
    failCode(503, 'MEDIA_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

function productsBusy(store: MockStore): void {
  if ((store.productsBusy ?? 0) > 0) {
    store.productsBusy = (store.productsBusy ?? 0) - 1;
    failCode(503, 'PRODUCTS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

const removeAsset = (store: MockStore, id: string) => {
  store.mediaAssets = store.mediaAssets.filter((a) => a.id !== id);
  delete store.mediaObjects[id];
};

/** Purga perezosa (≤ 100) de PENDING caducados, como antes de crear un intent. */
function purgeExpired(store: MockStore, at: Date): void {
  const expired = store.mediaAssets
    .filter((a) => a.status === 'PENDING' && a.expiresAt !== null && new Date(a.expiresAt) <= at)
    .slice(0, 100);
  for (const a of expired) removeAsset(store, a.id);
}

// ── Intent y confirmación ────────────────────────────────────────────────────────────────

/** POST /v1/admin/media/upload-intents — 200 (deduplicado) o 201 (PENDING). */
export const createUploadIntent: Handler = (req): AdminMediaUploadIntent => {
  const actor = writer(req);
  const raw = rawBody(req);
  const problems = [
    ...onlyKeys(raw, ['kind', 'mimeType', 'sizeBytes', 'checksumSha256']),
    ...intentShapeProblems(raw),
  ];
  if (problems.length > 0) badRequest([...new Set(problems)]);
  const { store } = req;
  storageGuard(store);
  const mimeType = raw.mimeType as string;
  if (!isAllowedMime(mimeType)) {
    failCode(422, 'MEDIA_TYPE_NOT_ALLOWED', 'Solo se admiten JPEG, PNG, WebP o AVIF');
  }
  const sizeBytes = raw.sizeBytes as number;
  if (sizeBytes > MEDIA_MAX_BYTES) {
    failCode(422, 'MEDIA_TOO_LARGE', 'La imagen supera el tamaño máximo (5 MiB)');
  }
  const checksum = raw.checksumSha256 as string;
  const existing = store.mediaAssets.find(
    (a) => a.status === 'READY' && a.checksumSha256 === checksum,
  );
  if (existing) {
    return {
      assetId: existing.id,
      deduplicated: true,
      uploadUrl: null,
      headers: null,
      expiresAt: null,
      storageMode: 'MOCK',
      asset: assetView(store, existing),
    };
  }
  const at = now(req);
  purgeExpired(store, at);
  const pending = store.mediaAssets.filter(
    (a) => a.status === 'PENDING' && a.createdById === actor.id,
  ).length;
  if (pending >= MEDIA_PENDING_LIMIT) {
    failCode(
      422,
      'MEDIA_PENDING_LIMIT_REACHED',
      `Hay ${MEDIA_PENDING_LIMIT} cargas pendientes; espera a que caduquen o complétalas`,
    );
  }
  mediaBusy(store);
  const id = `media-asset-${store.sequences.mediaAsset++}`;
  const year = at.getUTCFullYear();
  const record: MediaAssetRecord = {
    id,
    kind: 'PRODUCT_IMAGE',
    status: 'PENDING',
    mimeType,
    sizeBytes,
    checksumSha256: checksum,
    objectKey: `products/${year}/${id}.${extensionForMime(mimeType as MediaMime)}`,
    createdAt: at.toISOString(),
    confirmedAt: null,
    expiresAt: new Date(at.getTime() + MEDIA_UPLOAD_TTL_SECONDS * 1000).toISOString(),
    createdById: actor.id,
  };
  store.mediaAssets.push(record);
  return {
    assetId: id,
    deduplicated: false,
    uploadUrl: `https://${SIMULATED_UPLOAD_HOST}/${record.objectKey}?simulado=1`,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-amz-checksum-sha256': hexToBase64(checksum),
    },
    expiresAt: record.expiresAt,
    storageMode: 'MOCK',
    asset: assetView(store, record),
  };
};

/** POST /v1/admin/media/complete */
export const completeUpload: Handler = (req): AdminMediaAsset => {
  writer(req);
  const raw = rawBody(req);
  const problems = onlyKeys(raw, ['assetId']);
  if (typeof raw.assetId !== 'string' || raw.assetId.length === 0) {
    problems.push('assetId: debe ser un identificador');
  }
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const asset = store.mediaAssets.find((a) => a.id === raw.assetId);
  if (!asset) failCode(404, 'MEDIA_NOT_FOUND', 'Imagen no encontrada');
  if (asset.status === 'READY') return assetView(store, asset); // idempotente
  const at = now(req);
  if (asset.expiresAt !== null && new Date(asset.expiresAt) <= at) {
    failCode(410, 'MEDIA_UPLOAD_EXPIRED', 'La carga caducó; vuelve a subir la imagen');
  }
  storageGuard(store);
  const object = store.mediaObjects[asset.id];
  if (!object) failCode(422, 'MEDIA_OBJECT_MISSING', 'No se encontró el archivo subido');
  if (
    object.sizeBytes !== asset.sizeBytes ||
    object.contentType !== asset.mimeType ||
    object.checksumSha256 !== asset.checksumSha256
  ) {
    removeAsset(store, asset.id);
    failCode(422, 'MEDIA_CONTENT_MISMATCH', 'El archivo subido no coincide con lo declarado');
  }
  const winner = store.mediaAssets.find(
    (a) => a.id !== asset.id && a.status === 'READY' && a.checksumSha256 === asset.checksumSha256,
  );
  if (winner) {
    removeAsset(store, asset.id); // carrera de dedup: gana el asset ya confirmado
    return assetView(store, winner);
  }
  mediaBusy(store);
  asset.status = 'READY';
  asset.confirmedAt = at.toISOString();
  asset.expiresAt = null;
  return assetView(store, asset);
};

/** PUT /v1/demo/media/objects/:assetId — SOLO mock: el «almacén» registra el objeto que recibió el PUT firmado. */
export const putSimulatedObject: Handler = (req): void => {
  const { store } = req;
  const asset = store.mediaAssets.find((a) => a.id === req.params.assetId);
  if (!asset || asset.status !== 'PENDING') fail(404, 'No hay un intent pendiente para ese objeto');
  if (asset.expiresAt !== null && new Date(asset.expiresAt) <= now(req)) {
    fail(403, 'La URL de subida caducó (simulado)');
  }
  const raw = rawBody(req);
  if (
    !Number.isInteger(raw.sizeBytes) ||
    typeof raw.contentType !== 'string' ||
    typeof raw.checksumSha256 !== 'string'
  ) {
    badRequest(['sizeBytes, contentType y checksumSha256 son obligatorios']);
  }
  store.mediaObjects[asset.id] = {
    sizeBytes: raw.sizeBytes as number,
    contentType: raw.contentType as string,
    checksumSha256: raw.checksumSha256 as string,
  };
};

// ── Biblioteca ────────────────────────────────────────────────────────────────────────────

const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

/** GET /v1/admin/media?kind&status&unreferenced&page&pageSize */
export const listAdminMedia: Handler = (req): AdminMediaAssetPage => {
  reader(req);
  const problems: string[] = [];
  const page = strictInt(req.query.get('page'), 1);
  const pageSize = strictInt(req.query.get('pageSize'), 20);
  if (page === null || page < 1 || page > MEDIA_PAGE_MAX) {
    problems.push(`page: entre 1 y ${MEDIA_PAGE_MAX}`);
  }
  if (pageSize === null || pageSize < 1 || pageSize > MEDIA_PAGE_SIZE_MAX) {
    problems.push(`pageSize: entre 1 y ${MEDIA_PAGE_SIZE_MAX}`);
  }
  const kind = req.query.get('kind');
  if (kind !== null && kind !== 'PRODUCT_IMAGE') problems.push('kind: PRODUCT_IMAGE');
  const status = req.query.get('status');
  if (status !== null && status !== 'PENDING' && status !== 'READY') {
    problems.push('status: PENDING o READY');
  }
  const unref = req.query.get('unreferenced');
  if (unref !== null && unref !== 'true' && unref !== 'false') {
    problems.push('unreferenced: debe ser true o false');
  }
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const p = page ?? 1;
  const size = pageSize ?? 20;
  const matches = store.mediaAssets
    .filter((a) => status === null || a.status === status)
    .filter((a) => unref === null || (usageCount(store, a.id) === 0) === (unref === 'true'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return {
    items: matches.slice((p - 1) * size, p * size).map((a) => assetView(store, a)),
    page: p,
    pageSize: size,
    total: matches.length,
  };
};

/** GET /v1/admin/media/:id */
export const getAdminMedia: Handler = (req): AdminMediaAssetDetail => {
  reader(req);
  const { store } = req;
  const asset = store.mediaAssets.find((a) => a.id === req.params.id);
  if (!asset) failCode(404, 'MEDIA_NOT_FOUND', 'Imagen no encontrada');
  const usages = store.products.flatMap((p) =>
    p.media
      .filter((m) => m.assetId === asset.id)
      .map((m) => ({ productId: p.id, productName: p.name, productMediaId: m.id })),
  );
  return { ...assetView(store, asset), usages };
};

/** DELETE /v1/admin/media/:id — 204; 409 `MEDIA_IN_USE`; 503 sin almacenamiento (antes de tocar la fila). */
export const deleteAdminMedia: Handler = (req): void => {
  writer(req);
  const { store } = req;
  const asset = store.mediaAssets.find((a) => a.id === req.params.id);
  if (!asset) failCode(404, 'MEDIA_NOT_FOUND', 'Imagen no encontrada');
  storageGuard(store);
  if (usageCount(store, asset.id) > 0) {
    failCode(409, 'MEDIA_IN_USE', 'La imagen está en uso por algún producto');
  }
  mediaBusy(store);
  removeAsset(store, asset.id);
};

// ── Vínculo con productos ──────────────────────────────────────────────────────────────────

function productOf(store: MockStore, id: string | undefined): ProductRecord {
  const product = store.products.find((p) => p.id === id);
  if (!product) failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  return product;
}

function mediaOf(product: ProductRecord, id: string | undefined): AdminProductMedia {
  const media = product.media.find((m) => m.id === id);
  if (!media) failCode(404, 'PRODUCT_MEDIA_NOT_FOUND', 'Imagen del producto no encontrada');
  return media;
}

const sorted = (media: readonly AdminProductMedia[]) =>
  [...media].sort((a, b) => a.sortOrder - b.sortOrder);

const renumber = (product: ProductRecord, ordered: readonly AdminProductMedia[]) => {
  ordered.forEach((m, i) => {
    m.sortOrder = i;
  });
  product.media = [...ordered];
};

function altOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') badRequest(['altText: debe ser texto o null']);
  const alt = value.trim();
  if (alt.length > MEDIA_ALT_MAX || hasDisallowedControlChars(alt)) {
    failCode(
      422,
      'PRODUCT_MEDIA_INVALID',
      `El texto alternativo admite hasta ${MEDIA_ALT_MAX} caracteres`,
      [{ path: 'altText', code: 'ALT_TOO_LONG', message: 'Texto alternativo largo' }],
    );
  }
  return alt || null;
}

/** POST /v1/admin/products/:id/media — 201. */
export const attachProductMedia: Handler = (req): AdminProductMedia => {
  writer(req);
  const raw = rawBody(req);
  const problems = onlyKeys(raw, ['assetId', 'altText']);
  if (typeof raw.assetId !== 'string' || raw.assetId.length === 0) {
    problems.push('assetId: debe ser un identificador');
  }
  if (raw.altText !== undefined && raw.altText !== null && typeof raw.altText !== 'string') {
    problems.push('altText: debe ser texto o null');
  }
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const product = productOf(store, req.params.id);
  const asset = store.mediaAssets.find((a) => a.id === raw.assetId);
  if (!asset) failCode(404, 'MEDIA_NOT_FOUND', 'Imagen no encontrada');
  if (asset.status !== 'READY') {
    failCode(422, 'MEDIA_ASSET_NOT_READY', 'La imagen aún no está confirmada');
  }
  if (product.media.some((m) => m.assetId === asset.id)) {
    failCode(409, 'MEDIA_ALREADY_ATTACHED', 'La imagen ya está en este producto');
  }
  if (product.media.length >= MEDIA_PER_PRODUCT_MAX) {
    failCode(422, 'PRODUCT_MEDIA_INVALID', `Máximo ${MEDIA_PER_PRODUCT_MAX} imágenes por producto`);
  }
  const altText = altOf(raw.altText);
  productsBusy(store);
  const created: AdminProductMedia = {
    id: `media-${store.sequences.media++}`,
    url: assetPublicUrl(asset),
    altText,
    sortOrder: product.media.length,
    assetId: asset.id,
  };
  product.media.push(created);
  product.updatedAt = now(req).toISOString();
  return created;
};

/** PATCH /v1/admin/products/:id/media/:mediaId — `{ altText }`. */
export const updateProductMedia: Handler = (req): AdminProductMedia => {
  writer(req);
  const raw = rawBody(req);
  const problems = onlyKeys(raw, ['altText']);
  if (!('altText' in raw)) problems.push('altText: obligatorio');
  if (problems.length > 0) badRequest(problems);
  const product = productOf(req.store, req.params.id);
  const media = mediaOf(product, req.params.mediaId);
  const altText = altOf(raw.altText);
  if (altText !== media.altText) {
    productsBusy(req.store);
    media.altText = altText;
    product.updatedAt = now(req).toISOString();
  }
  return { ...media };
};

/** PUT /v1/admin/products/:id/media/order — `{ orderedIds }` exactos (ids de `product_media`). */
export const reorderProductMedia: Handler = (req): AdminProductMediaList => {
  writer(req);
  const raw = rawBody(req);
  const problems = onlyKeys(raw, ['orderedIds']);
  const ids = raw.orderedIds;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    problems.push('orderedIds: debe ser una lista de identificadores');
  } else if (ids.length > MEDIA_PER_PRODUCT_MAX) {
    problems.push(`orderedIds: máximo ${MEDIA_PER_PRODUCT_MAX}`);
  }
  if (problems.length > 0) badRequest(problems);
  const product = productOf(req.store, req.params.id);
  const ordered = ids as string[];
  const current = sorted(product.media);
  const exact =
    ordered.length === current.length &&
    new Set(ordered).size === ordered.length &&
    ordered.every((id) => current.some((m) => m.id === id));
  if (!exact) {
    failCode(
      422,
      'MEDIA_REORDER_MISMATCH',
      'La lista debe contener exactamente las imágenes del producto',
    );
  }
  const next = ordered.map((id) => current.find((m) => m.id === id) as AdminProductMedia);
  if (next.some((m, i) => m.id !== current[i]?.id)) {
    productsBusy(req.store);
    renumber(product, next);
    product.updatedAt = now(req).toISOString();
  }
  return { items: sorted(product.media).map((m) => ({ ...m })) };
};

/** DELETE /v1/admin/products/:id/media/:mediaId — 204; NO borra el asset. */
export const detachProductMedia: Handler = (req): void => {
  writer(req);
  const product = productOf(req.store, req.params.id);
  const media = mediaOf(product, req.params.mediaId);
  productsBusy(req.store);
  renumber(
    product,
    sorted(product.media).filter((m) => m.id !== media.id),
  );
  product.updatedAt = now(req).toISOString();
};
