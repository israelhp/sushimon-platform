import type {
  AdminBanner,
  AdminBannerOrder,
  AdminBannerPage,
  AdminBannerSummary,
  BannerCtaType,
  BannerHiddenReason,
  BannerLifecycle,
  BannerLocale,
  BannerPage,
  PromotionScope,
  StoreBanner,
  StoreBannerCta,
  StoreBannerList,
} from '@/lib/data-access/models';
import {
  BANNER_ALT_MAX,
  BANNER_BRANCHES_MAX,
  BANNER_CODE_PATTERN,
  BANNER_CTA_LABEL_MAX,
  BANNER_NOT_EXPIRED_MAX,
  BANNER_PAGE_MAX,
  BANNER_PAGE_SIZE_MAX,
  BANNER_SEARCH_MAX,
  BANNER_SORT_MAX,
  BANNER_SUBTITLE_MAX,
  BANNER_TITLE_MAX,
  STORE_BANNERS_MAX,
  bannerLifecycle,
  bannersNextChange,
  cleanText,
  compareByPriority,
  hasDisallowedBannerChars,
  isBannerCtaType,
  isBannerExpiredByDate,
  isBannerLocale,
  isBannerPage,
  normalizeBannerCode,
  resolveTexts,
  type BannerTexts,
} from '@/lib/banner-rules';
import { isInstantWithZone, isLiveAt, lifecycleOf, nextChangeAt } from '@/lib/promotion-rules';
import { badRequest, failCode } from '../domain';
import type { BannerRecord } from '../fixtures/banners';
import type { PromotionRecord } from '../fixtures/promotions';
import type { MediaAssetRecord, MockStore } from '../store';
import { assetPublicUrl } from './media';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F16 — Banners del Inicio (spec 017, ADR-0022). El mock EMULA al servidor con la MISMA semántica del contrato:
 * - Público (`GET /v1/store/banners?branchId&locale`): solo banners elegibles AHORA: activos, vigencia `[startsAt, endsAt)`
 *   (instantes), imagen READY de tipo `BANNER_IMAGE`, traducción `es` válida, destino de catálogo ACTIVO y, si hay promoción
 *   vinculada (F15), promoción VIGENTE (`isLiveAt`: activa + vigencia + horario semanal) que aplica a la sucursal consultada.
 *   Sin `branchId` solo `ALL` (y, con promoción, solo una promoción `ALL`). Máximo 10, orden `sortOrder, createdAt, id`. Texto por
 *   idioma con respaldo POR CAMPO a `es` (`fallbackFields`). NUNCA devuelve `code`, `version`, `promotionId` ni datos de la promoción
 *   (un cupón no se revela). `nextChangeAt` = menor instante futuro (≤ 14 días) entre fechas de banners activos candidatos y cambios
 *   de la promoción vinculada; `generatedAt` = reloj del servidor. NO simula `Cache-Control` ni el límite de tasa.
 * - Admin: `banners.read|create|update` (aal2 lo simula la sesión). Lectura con alcance (acotado = los que aplican a alguna de sus
 *   sucursales, `branches` recortado, `editable=false` si no cubre todas). Escritura: `ALL` exige alcance global (403
 *   `BANNER_SCOPE_FORBIDDEN`), `SELECTED` exige cubrir todas (404 `BRANCH_NOT_FOUND` si no existe/fuera de alcance); un banner que
 *   no toca el alcance es 404 `BANNER_NOT_FOUND`. 400 de forma; 409 `BANNER_CODE_TAKEN` | `BANNER_VERSION_CONFLICT`; 422
 *   `BANNER_{IMAGE,TRANSLATION,CTA,PERIOD,SCOPE,PROMOTION}_INVALID` | `BANNER_REORDER_MISMATCH` | `BANNER_LIMIT_REACHED` con
 *   `violations`; 503 `BANNERS_BUSY` determinista (`store.bannersBusy`). PATCH parcial con `expectedVersion`; sin cambios = 200 sin
 *   subir `version`; el estado va aparte (idempotente, sin versión). Reordenado atómico por conjunto exacto de NO vencidos. Sin
 *   borrado. NO simula auditoría, UUID ni límites de tasa.
 *
 * La imagen sale del almacén SIMULADO de medios (F14): URL `*.invalid` que la tienda nunca pide por red.
 */

// ── Utilidades ─────────────────────────────────────────────────────────────────────────────

const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const has = (raw: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

const iso = (ms: number | Date) => new Date(ms).toISOString();

type Violation = { path: string; code: string; message: string };

function failBusy(store: MockStore): void {
  if ((store.bannersBusy ?? 0) > 0) {
    store.bannersBusy = (store.bannersBusy ?? 0) - 1;
    failCode(503, 'BANNERS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

function bannerNotFound(): never {
  return failCode(404, 'BANNER_NOT_FOUND', 'Banner no encontrado');
}
function branchNotFound(): never {
  return failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
}

/** ¿El banner aplica a la sucursal? (`ALL` incluye las futuras). */
const appliesToBranch = (b: Pick<BannerRecord, 'branchScope' | 'branchIds'>, branchId: string) =>
  b.branchScope === 'ALL' || b.branchIds.includes(branchId);

/** ¿La promoción aplica a la sucursal? Sin sucursal, solo si es de todas. */
const promotionAppliesTo = (p: PromotionRecord, branchId: string | null): boolean =>
  p.branchScope === 'ALL' || (branchId !== null && p.branchIds.includes(branchId));

/** ¿El alcance de la promoción CUBRE el del banner? (`ALL` exige promoción `ALL`; `SELECTED` exige `ALL` o todas sus sucursales.) */
function promotionCovers(
  p: PromotionRecord,
  b: Pick<BannerRecord, 'branchScope' | 'branchIds'>,
): boolean {
  if (p.branchScope === 'ALL') return true;
  return b.branchScope === 'SELECTED' && b.branchIds.every((id) => p.branchIds.includes(id));
}

const textsOf = (t: BannerTexts | null | undefined): BannerTexts | null => (t ? { ...t } : null);

// ── Elegibilidad (ocultación) ──────────────────────────────────────────────────────────────

function assetOf(store: MockStore, b: BannerRecord): MediaAssetRecord | undefined {
  return store.mediaAssets.find((a) => a.id === b.imageAssetId);
}

const imageAvailable = (store: MockStore, b: BannerRecord): boolean => {
  const a = assetOf(store, b);
  return Boolean(a && a.status === 'READY' && a.kind === 'BANNER_IMAGE');
};

/** Destino de catálogo ACTIVO (solo el `active` directo, como el servidor). `null` si el tipo no tiene destino. */
function ctaTargetActive(store: MockStore, b: BannerRecord): boolean | null {
  if (b.cta.type === 'CATEGORY') {
    return store.menuCategories.find((c) => c.id === b.cta.categoryId)?.active ?? false;
  }
  if (b.cta.type === 'PRODUCT') {
    return store.products.find((p) => p.id === b.cta.productId)?.active ?? false;
  }
  return null;
}

/**
 * Motivo por el que un banner PUBLICADO por fechas no se muestra (`null` = se muestra). `branchId` solo en la lectura pública;
 * en administración se evalúa con el alcance propio del banner (la promoción debe cubrirlo).
 */
function hiddenReasonOf(
  store: MockStore,
  b: BannerRecord,
  at: Date,
  branchId: string | null | 'admin',
): BannerHiddenReason | null {
  if (b.promotionId !== null) {
    const p = store.promotions.find((x) => x.id === b.promotionId);
    const applies =
      branchId === 'admin'
        ? Boolean(p && promotionCovers(p, b))
        : Boolean(p && promotionAppliesTo(p, branchId));
    if (!p || !isLiveAt(p, at) || !applies) return 'PROMOTION_NOT_LIVE';
  }
  if (ctaTargetActive(store, b) === false) return 'CTA_TARGET_INACTIVE';
  if (!imageAvailable(store, b)) return 'IMAGE_UNAVAILABLE';
  return null;
}

// ── Público ────────────────────────────────────────────────────────────────────────────────

function publicCta(store: MockStore, b: BannerRecord): StoreBannerCta {
  switch (b.cta.type) {
    case 'CATEGORY': {
      const slug = store.menuCategories.find((c) => c.id === b.cta.categoryId)?.slug ?? null;
      return { type: 'CATEGORY', categorySlug: slug };
    }
    case 'PRODUCT':
      return { type: 'PRODUCT', productId: b.cta.productId };
    case 'PAGE':
      return { type: 'PAGE', page: b.cta.page };
    default:
      return { type: b.cta.type };
  }
}

function storeView(store: MockStore, b: BannerRecord, locale: BannerLocale): StoreBanner | null {
  const texts = resolveTexts(b.translations.es, b.translations.en, locale);
  const asset = assetOf(store, b);
  if (!texts || !asset) return null;
  return {
    id: b.id,
    title: texts.title,
    subtitle: texts.subtitle,
    ctaLabel: texts.ctaLabel,
    imageAlt: texts.imageAlt,
    image: { url: assetPublicUrl(asset), mimeType: asset.mimeType },
    cta: publicCta(store, b),
    fallbackFields: texts.fallbackFields,
  };
}

/** GET /v1/store/banners?branchId&locale — público. */
export const listStoreBanners: Handler = (req): StoreBannerList => {
  const problems: string[] = [];
  const localeRaw = req.query.get('locale') ?? 'es';
  if (!isBannerLocale(localeRaw)) problems.push('locale: es o en');
  const branchRaw = req.query.get('branchId');
  if (branchRaw !== null && branchRaw.length === 0) problems.push('branchId: vacío');
  if (problems.length > 0) badRequest(problems);
  const locale = localeRaw as BannerLocale;
  const { store } = req;
  let branchId: string | null = null;
  if (branchRaw !== null) {
    const branch = store.branches.find((b) => b.id === branchRaw);
    if (!branch || !branch.active) branchNotFound();
    branchId = branch.id;
  }
  failBusy(store);
  const at = now(req);

  // Candidatos: activos y que aplican a la consulta (sin `branchId` solo `ALL`).
  const candidates = store.banners.filter(
    (b) => b.active && (branchId === null ? b.branchScope === 'ALL' : appliesToBranch(b, branchId)),
  );
  const items = candidates
    .filter((b) => bannerLifecycle(b, at) === 'PUBLISHED')
    .filter((b) => hiddenReasonOf(store, b, at, branchId) === null)
    .sort(compareByPriority)
    .flatMap((b) => {
      const view = storeView(store, b, locale);
      return view ? [view] : [];
    })
    .slice(0, STORE_BANNERS_MAX);

  const promoChanges = candidates.flatMap((b) => {
    const p = b.promotionId === null ? null : store.promotions.find((x) => x.id === b.promotionId);
    return p ? [nextChangeAt([p], at)] : [];
  });
  const next = bannersNextChange(candidates, promoChanges, at);
  return {
    branchId,
    locale,
    generatedAt: iso(at),
    nextChangeAt: next ? iso(next) : null,
    items,
  };
};

// ── Administración: vistas y alcance ───────────────────────────────────────────────────────

type Scope = StaffActor['scope'];

const inScope = (scope: Scope, branchId: string) =>
  scope.allBranches || scope.branchIds.includes(branchId);

/** ¿Toca el alcance? Global: todos; acotado: los que aplican a alguna de sus sucursales (incluidos los `ALL`). */
function touchesScope(scope: Scope, b: BannerRecord, store: MockStore): boolean {
  if (scope.allBranches) return true;
  const mine = store.branches.filter((x) => scope.branchIds.includes(x.id)).map((x) => x.id);
  return mine.some((id) => appliesToBranch(b, id));
}

/** ¿Cubre TODAS las sucursales del banner? (`ALL` exige alcance global.) */
function coversAll(scope: Scope, b: Pick<BannerRecord, 'branchScope' | 'branchIds'>): boolean {
  if (scope.allBranches) return true;
  return b.branchScope === 'SELECTED' && b.branchIds.every((id) => scope.branchIds.includes(id));
}

const updateScopeOf = (actor: StaffActor): Scope | null => actor.grants['banners.update'] ?? null;

function summaryOf(
  store: MockStore,
  b: BannerRecord,
  readScope: Scope,
  updateScope: Scope | null,
  at: Date,
): AdminBannerSummary {
  const lifecycle = bannerLifecycle(b, at);
  const reason = lifecycle === 'PUBLISHED' ? hiddenReasonOf(store, b, at, 'admin') : null;
  const asset = assetOf(store, b);
  const promo =
    b.promotionId === null ? null : store.promotions.find((p) => p.id === b.promotionId);
  const category =
    b.cta.type === 'CATEGORY' ? store.menuCategories.find((c) => c.id === b.cta.categoryId) : null;
  const product =
    b.cta.type === 'PRODUCT' ? store.products.find((p) => p.id === b.cta.productId) : null;
  const target = category ?? product;
  return {
    id: b.id,
    code: b.code,
    title: b.translations.es.title ?? '',
    image: {
      assetId: b.imageAssetId,
      url: asset && asset.status === 'READY' ? assetPublicUrl(asset) : null,
      mimeType: asset?.mimeType ?? 'image/webp',
      sizeBytes: asset?.sizeBytes ?? 0,
    },
    cta: {
      type: b.cta.type,
      categoryId: b.cta.categoryId,
      productId: b.cta.productId,
      page: b.cta.page,
      targetLabel: target?.name ?? null,
      targetActive: ctaTargetActive(store, b),
    },
    branchScope: b.branchScope,
    branches:
      b.branchScope === 'ALL'
        ? []
        : store.branches
            .filter((x) => b.branchIds.includes(x.id) && inScope(readScope, x.id))
            .sort((x, y) => x.name.localeCompare(y.name, 'es') || byId(x, y))
            .map((x) => ({ id: x.id, name: x.name })),
    promotion: promo ? { id: promo.id, name: promo.name, lifecycle: lifecycleOf(promo, at) } : null,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    active: b.active,
    sortOrder: b.sortOrder,
    lifecycle,
    visibleNow: lifecycle === 'PUBLISHED' && reason === null,
    hiddenReason: reason,
    hasEnglish: Boolean(cleanText(b.translations.en?.title)),
    editable: updateScope !== null && coversAll(updateScope, b),
    version: b.version,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function detailOf(
  store: MockStore,
  b: BannerRecord,
  readScope: Scope,
  updateScope: Scope | null,
  at: Date,
): AdminBanner {
  return {
    ...summaryOf(store, b, readScope, updateScope, at),
    translations: { es: { ...b.translations.es }, en: textsOf(b.translations.en) },
  };
}

const viewFor = (req: Req, actor: StaffActor, b: BannerRecord): AdminBanner =>
  detailOf(req.store, b, actor.scope, updateScopeOf(actor), now(req));

// ── Administración: lectura ────────────────────────────────────────────────────────────────

const LIFECYCLES: readonly BannerLifecycle[] = ['INACTIVE', 'SCHEDULED', 'PUBLISHED', 'EXPIRED'];
const SORTS = ['priority', 'startsAt', 'endsAt', 'createdAt'] as const;

/** Instante opcional como número ordenable (`null` al final). */
const instantKey = (v: string | null) => (v === null ? Number.POSITIVE_INFINITY : Date.parse(v));

/** GET /v1/admin/banners?branchId&lifecycle&q&sort&order&page&pageSize */
export const listAdminBanners: Handler = (req): AdminBannerPage => {
  const actor = requireStaff(req, 'banners.read');
  const problems: string[] = [];
  const q = req.query;
  const page = strictInt(q.get('page'), 1);
  const pageSize = strictInt(q.get('pageSize'), 20);
  if (page === null || page < 1 || page > BANNER_PAGE_MAX) {
    problems.push(`page: entre 1 y ${BANNER_PAGE_MAX}`);
  }
  if (pageSize === null || pageSize < 1 || pageSize > BANNER_PAGE_SIZE_MAX) {
    problems.push(`pageSize: entre 1 y ${BANNER_PAGE_SIZE_MAX}`);
  }
  const lifecycle = q.get('lifecycle');
  if (lifecycle !== null && !(LIFECYCLES as readonly string[]).includes(lifecycle)) {
    problems.push('lifecycle: INACTIVE, SCHEDULED, PUBLISHED o EXPIRED');
  }
  const sort = q.get('sort') ?? 'priority';
  if (!(SORTS as readonly string[]).includes(sort)) problems.push('sort inválido');
  const order = q.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') problems.push('order: asc o desc');
  const text = q.get('q');
  if (text !== null && text.length > BANNER_SEARCH_MAX) {
    problems.push(`q: máximo ${BANNER_SEARCH_MAX} caracteres`);
  }
  if (problems.length > 0) badRequest(problems);

  const { store } = req;
  const branchId = q.get('branchId');
  if (branchId !== null) {
    const exists = store.branches.some((b) => b.id === branchId);
    if (!exists || !inScope(actor.scope, branchId)) branchNotFound();
  }
  const at = now(req);
  const needle = text ? foldText(text.trim()) : '';
  const sign = order === 'desc' ? -1 : 1;
  const compare = (a: BannerRecord, b: BannerRecord): number => {
    if (sort === 'priority') return compareByPriority(a, b) * sign || byId(a, b);
    let main = 0;
    if (sort === 'startsAt') main = instantKey(a.startsAt) - instantKey(b.startsAt);
    else if (sort === 'endsAt') main = instantKey(a.endsAt) - instantKey(b.endsAt);
    else main = a.createdAt.localeCompare(b.createdAt);
    return (Number.isNaN(main) ? 0 : main) * sign || byId(a, b);
  };
  const matches = store.banners
    .filter((b) => touchesScope(actor.scope, b, store))
    .filter((b) => branchId === null || appliesToBranch(b, branchId))
    .filter((b) => lifecycle === null || bannerLifecycle(b, at) === lifecycle)
    .filter(
      (b) =>
        !needle ||
        foldText(b.code).includes(needle) ||
        foldText(b.translations.es.title ?? '').includes(needle) ||
        foldText(b.translations.en?.title ?? '').includes(needle),
    )
    .sort(compare);
  const size = pageSize as number;
  const start = ((page as number) - 1) * size;
  const update = updateScopeOf(actor);
  return {
    items: matches
      .slice(start, start + size)
      .map((b) => summaryOf(store, b, actor.scope, update, at)),
    page: page as number,
    pageSize: size,
    total: matches.length,
  };
};

/** GET /v1/admin/banners/:id */
export const getAdminBanner: Handler = (req): AdminBanner => {
  const actor = requireStaff(req, 'banners.read');
  const b = req.store.banners.find((x) => x.id === req.params.id);
  if (!b || !touchesScope(actor.scope, b, req.store)) bannerNotFound();
  return viewFor(req, actor, b);
};

// ── Administración: forma (400) ────────────────────────────────────────────────────────────

type TextPatch = Partial<Record<keyof BannerTexts, string | null>>;

interface Shape {
  code?: string;
  imageAssetId?: string;
  /** `en: null` = eliminar el inglés. */
  translations?: { es?: TextPatch; en?: TextPatch | null };
  cta?: {
    type: BannerCtaType;
    categoryId?: string | null;
    productId?: string | null;
    page?: string | null;
  };
  branchScope?: PromotionScope;
  branchIds?: string[];
  promotionId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
  active?: boolean;
  expectedVersion?: number;
}

const CREATE_KEYS = [
  'code',
  'imageAssetId',
  'translations',
  'cta',
  'branchScope',
  'branchIds',
  'promotionId',
  'startsAt',
  'endsAt',
  'sortOrder',
  'active',
] as const;
const UPDATE_KEYS = [
  'expectedVersion',
  'imageAssetId',
  'translations',
  'cta',
  'branchScope',
  'branchIds',
  'promotionId',
  'startsAt',
  'endsAt',
  'sortOrder',
] as const;

const TEXT_KEYS = ['title', 'subtitle', 'ctaLabel', 'imageAlt'] as const;

function parseTextPatch(raw: unknown, path: string, problems: string[]): TextPatch | undefined {
  if (!isRecord(raw)) {
    problems.push(`${path}: debe ser un objeto`);
    return undefined;
  }
  const out: TextPatch = {};
  for (const key of Object.keys(raw)) {
    if (!(TEXT_KEYS as readonly string[]).includes(key))
      problems.push(`${path}.${key}: campo no permitido`);
  }
  for (const key of TEXT_KEYS) {
    if (!has(raw, key)) continue;
    const v = raw[key];
    if (v !== null && typeof v !== 'string') problems.push(`${path}.${key}: texto o null`);
    else out[key] = v;
  }
  return out;
}

function parseShape(raw: Record<string, unknown>, allowed: readonly string[]): Shape {
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) problems.push(`${key}: campo no permitido`);
  }
  const out: Shape = {};
  if (has(raw, 'code')) {
    const c = typeof raw.code === 'string' ? normalizeBannerCode(raw.code) : '';
    if (!BANNER_CODE_PATTERN.test(c)) {
      problems.push(
        'code: 3 a 64 caracteres en minúsculas (letras, números o guion, sin empezar por guion)',
      );
    } else out.code = c;
  }
  if (has(raw, 'imageAssetId')) {
    if (typeof raw.imageAssetId !== 'string' || raw.imageAssetId.length === 0) {
      problems.push('imageAssetId: identificador');
    } else out.imageAssetId = raw.imageAssetId;
  }
  if (has(raw, 'translations')) {
    const tr = raw.translations;
    if (!isRecord(tr)) problems.push('translations: debe ser un objeto');
    else {
      for (const key of Object.keys(tr)) {
        if (key !== 'es' && key !== 'en') problems.push(`translations.${key}: campo no permitido`);
      }
      const t: NonNullable<Shape['translations']> = {};
      if (has(tr, 'es')) t.es = parseTextPatch(tr.es, 'translations.es', problems);
      if (has(tr, 'en')) {
        t.en = tr.en === null ? null : parseTextPatch(tr.en, 'translations.en', problems);
      }
      out.translations = t;
    }
  }
  if (has(raw, 'cta')) {
    const c = raw.cta;
    if (!isRecord(c)) problems.push('cta: debe ser un objeto');
    else {
      for (const key of Object.keys(c)) {
        if (!['type', 'categoryId', 'productId', 'page'].includes(key)) {
          problems.push(`cta.${key}: campo no permitido`);
        }
      }
      if (!isBannerCtaType(c.type)) {
        // `EXTERNAL` (y cualquier otro tipo) NO existe en el enum del contrato => 400.
        problems.push('cta.type: NONE, MENU, PROMOTIONS, CATEGORY, PRODUCT o PAGE');
      } else {
        const cta: NonNullable<Shape['cta']> = { type: c.type };
        for (const key of ['categoryId', 'productId', 'page'] as const) {
          if (!has(c, key)) continue;
          const v = c[key];
          if (v !== null && typeof v !== 'string') problems.push(`cta.${key}: texto o null`);
          else cta[key] = v;
        }
        out.cta = cta;
      }
    }
  }
  for (const key of ['branchScope'] as const) {
    if (has(raw, key)) {
      if (raw[key] !== 'ALL' && raw[key] !== 'SELECTED') problems.push(`${key}: ALL o SELECTED`);
      else out[key] = raw[key] as PromotionScope;
    }
  }
  if (has(raw, 'branchIds')) {
    const ids = raw.branchIds;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || x.length === 0)) {
      problems.push('branchIds: lista de identificadores');
    } else {
      if (ids.length > BANNER_BRANCHES_MAX)
        problems.push(`branchIds: máximo ${BANNER_BRANCHES_MAX}`);
      if (new Set(ids).size !== ids.length) problems.push('branchIds: sin repetidos');
      out.branchIds = ids as string[];
    }
  }
  if (has(raw, 'promotionId')) {
    const v = raw.promotionId;
    if (v !== null && (typeof v !== 'string' || v.length === 0)) {
      problems.push('promotionId: identificador o null');
    } else out.promotionId = v;
  }
  for (const key of ['startsAt', 'endsAt'] as const) {
    if (has(raw, key)) {
      const v = raw[key];
      if (v === null) out[key] = null;
      else if (!isInstantWithZone(v)) problems.push(`${key}: instante ISO 8601 con zona o null`);
      else out[key] = new Date(v).toISOString();
    }
  }
  if (has(raw, 'sortOrder')) {
    const v = raw.sortOrder;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > BANNER_SORT_MAX) {
      problems.push(`sortOrder: entero entre 0 y ${BANNER_SORT_MAX}`);
    } else out.sortOrder = v;
  }
  if (has(raw, 'active')) {
    if (typeof raw.active !== 'boolean') problems.push('active: booleano');
    else out.active = raw.active;
  }
  if (has(raw, 'expectedVersion')) {
    const v = raw.expectedVersion;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      problems.push('expectedVersion: entero >= 1');
    } else out.expectedVersion = v;
  }
  if (problems.length > 0) badRequest(problems);
  return out;
}

// ── Administración: estado RESULTANTE, reglas de negocio (422) y alcance ───────────────────

interface Resulting {
  imageAssetId: string;
  es: BannerTexts;
  en: BannerTexts | null;
  cta: BannerRecord['cta'];
  /** Valor del CTA tal como se pidió (para validar el tipo `PAGE` fuera de lista y la coherencia). */
  ctaPageRaw: string | null;
  branchScope: PromotionScope;
  branchIds: string[];
  promotionId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
}

const emptyTexts = (): BannerTexts => ({
  title: null,
  subtitle: null,
  ctaLabel: null,
  imageAlt: null,
});

/** Aplica un parche de texto: omitido = sin cambio; `null`/en blanco = ausente. */
function patchTexts(base: BannerTexts | null, patch: TextPatch): BannerTexts {
  const next = { ...(base ?? emptyTexts()) };
  for (const key of TEXT_KEYS) {
    if (patch[key] !== undefined) next[key] = cleanText(patch[key]);
  }
  return next;
}

const isEmptyTexts = (t: BannerTexts) => TEXT_KEYS.every((k) => t[k] === null);

/** Texto (es/en) → violaciones de longitud, caracteres y obligatoriedad (`es.title` y `es.imageAlt`). */
function textViolations(locale: 'es' | 'en', t: BannerTexts): Violation[] {
  const limits: Record<(typeof TEXT_KEYS)[number], number> = {
    title: BANNER_TITLE_MAX,
    subtitle: BANNER_SUBTITLE_MAX,
    ctaLabel: BANNER_CTA_LABEL_MAX,
    imageAlt: BANNER_ALT_MAX,
  };
  const out: Violation[] = [];
  for (const key of TEXT_KEYS) {
    const value = t[key];
    const path = `translations.${locale}.${key}`;
    if (value === null) {
      if (locale === 'es' && (key === 'title' || key === 'imageAlt')) {
        out.push({ path, code: 'REQUIRED', message: 'Obligatorio en español' });
      }
      continue;
    }
    if (value.length > limits[key]) {
      out.push({ path, code: 'TOO_LONG', message: `Máximo ${limits[key]} caracteres` });
    } else if (hasDisallowedBannerChars(value)) {
      out.push({ path, code: 'INVALID_CHARS', message: 'Contiene caracteres no permitidos' });
    }
  }
  return out;
}

/** 422 en orden: alcance, traducciones, periodo, CTA, imagen, promoción y tope de 100. */
function assertScopeShape(r: Pick<Resulting, 'branchScope' | 'branchIds'>): void {
  if (r.branchScope === 'ALL' && r.branchIds.length > 0) {
    failCode(
      422,
      'BANNER_SCOPE_INVALID',
      'Un banner para todas las sucursales no lleva sucursales',
      [{ path: 'branchIds', code: 'ALL_WITH_BRANCHES', message: 'Omite branchIds con ALL' }],
    );
  }
  if (r.branchScope === 'SELECTED' && r.branchIds.length === 0) {
    failCode(422, 'BANNER_SCOPE_INVALID', 'Elige al menos una sucursal', [
      { path: 'branchIds', code: 'EMPTY', message: 'Obligatorio con SELECTED' },
    ]);
  }
}

/** Alcance de ESCRITURA sobre las sucursales RESULTANTES: `ALL` => global (403); `SELECTED` => existen y están en alcance (404). */
function assertWriteScope(
  store: MockStore,
  scope: Scope,
  r: Pick<Resulting, 'branchScope' | 'branchIds'>,
): void {
  if (r.branchScope === 'ALL') {
    if (!scope.allBranches) {
      failCode(
        403,
        'BANNER_SCOPE_FORBIDDEN',
        'Un banner para todas las sucursales exige alcance sobre todas',
      );
    }
    return;
  }
  for (const id of r.branchIds) {
    if (!store.branches.some((b) => b.id === id) || !inScope(scope, id)) branchNotFound();
  }
}

/** ¿El resultado cuenta contra el tope de 100? (no vencido por fecha). */
const countsAgainstLimit = (endsAt: string | null, at: Date) =>
  !isBannerExpiredByDate({ endsAt }, at);

function assertBusinessRules(
  store: MockStore,
  r: Resulting,
  at: Date,
  options: { exceptId?: string; counts: boolean },
): void {
  const textProblems = [...textViolations('es', r.es), ...(r.en ? textViolations('en', r.en) : [])];
  if (textProblems.length > 0) {
    failCode(422, 'BANNER_TRANSLATION_INVALID', 'Revisa los textos del banner', textProblems);
  }
  if (r.startsAt !== null && r.endsAt !== null && Date.parse(r.endsAt) <= Date.parse(r.startsAt)) {
    failCode(422, 'BANNER_PERIOD_INVALID', 'El fin debe ser posterior al inicio', [
      { path: 'endsAt', code: 'ENDS_BEFORE_START', message: 'endsAt debe ser mayor que startsAt' },
    ]);
  }
  const ctaProblems: Violation[] = [];
  const { type } = r.cta;
  const refs = {
    CATEGORY: r.cta.categoryId,
    PRODUCT: r.cta.productId,
    PAGE: r.ctaPageRaw,
  } as const;
  for (const key of ['CATEGORY', 'PRODUCT', 'PAGE'] as const) {
    const value = refs[key];
    if (type === key && value === null) {
      ctaProblems.push({
        path: `cta.${key === 'CATEGORY' ? 'categoryId' : key === 'PRODUCT' ? 'productId' : 'page'}`,
        code: 'FIELD_MISMATCH',
        message: 'Falta el destino',
      });
    }
    if (type !== key && value !== null) {
      ctaProblems.push({
        path: `cta.${key === 'CATEGORY' ? 'categoryId' : key === 'PRODUCT' ? 'productId' : 'page'}`,
        code: 'FIELD_MISMATCH',
        message: 'No corresponde al tipo',
      });
    }
  }
  if (type === 'PAGE' && r.ctaPageRaw !== null && !isBannerPage(r.ctaPageRaw)) {
    ctaProblems.push({
      path: 'cta.page',
      code: 'FIELD_MISMATCH',
      message: 'Página fuera de la lista blanca',
    });
  }
  if (ctaProblems.length === 0 && type === 'CATEGORY') {
    const c = store.menuCategories.find((x) => x.id === r.cta.categoryId);
    if (!c)
      ctaProblems.push({
        path: 'cta.categoryId',
        code: 'TARGET_UNKNOWN',
        message: 'La categoría no existe',
      });
    else if (!c.active)
      ctaProblems.push({
        path: 'cta.categoryId',
        code: 'TARGET_INACTIVE',
        message: 'La categoría está inactiva',
      });
  }
  if (ctaProblems.length === 0 && type === 'PRODUCT') {
    const p = store.products.find((x) => x.id === r.cta.productId);
    if (!p)
      ctaProblems.push({
        path: 'cta.productId',
        code: 'TARGET_UNKNOWN',
        message: 'El producto no existe',
      });
    else if (!p.active)
      ctaProblems.push({
        path: 'cta.productId',
        code: 'TARGET_INACTIVE',
        message: 'El producto está inactivo',
      });
  }
  if (ctaProblems.length > 0) {
    failCode(422, 'BANNER_CTA_INVALID', 'El destino del botón no es válido', ctaProblems);
  }
  const asset = store.mediaAssets.find((a) => a.id === r.imageAssetId);
  const imageProblem = !asset
    ? 'ASSET_UNKNOWN'
    : asset.status !== 'READY'
      ? 'ASSET_NOT_READY'
      : asset.kind !== 'BANNER_IMAGE'
        ? 'ASSET_KIND_MISMATCH'
        : null;
  if (imageProblem) {
    failCode(422, 'BANNER_IMAGE_INVALID', 'La imagen del banner no es válida', [
      { path: 'imageAssetId', code: imageProblem, message: imageProblem },
    ]);
  }
  if (r.promotionId !== null) {
    const p = store.promotions.find((x) => x.id === r.promotionId);
    const code = !p ? 'PROMOTION_UNKNOWN' : !promotionCovers(p, r) ? 'BRANCH_SCOPE_MISMATCH' : null;
    if (code) {
      failCode(422, 'BANNER_PROMOTION_INVALID', 'La promoción vinculada no es válida', [
        { path: 'promotionId', code, message: code },
      ]);
    }
  }
  if (options.counts && countsAgainstLimit(r.endsAt, at)) {
    const others = store.banners.filter(
      (b) => b.id !== options.exceptId && !isBannerExpiredByDate(b, at),
    ).length;
    if (others + 1 > BANNER_NOT_EXPIRED_MAX) {
      failCode(
        422,
        'BANNER_LIMIT_REACHED',
        `Hay ${BANNER_NOT_EXPIRED_MAX} banners no vencidos; desactiva o deja vencer alguno`,
      );
    }
  }
}

const codeTaken = (store: MockStore, code: string, exceptId?: string) =>
  store.banners.some((b) => b.code === code && b.id !== exceptId);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

const sameInstant = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

const sameCta = (a: BannerRecord['cta'], b: BannerRecord['cta']) =>
  a.type === b.type &&
  a.categoryId === b.categoryId &&
  a.productId === b.productId &&
  a.page === b.page;

const sameTexts = (a: BannerTexts | null, b: BannerTexts | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** CTA del contrato → registro (`page` solo si pertenece a la lista blanca; el resto se valida aparte). */
function ctaRecord(cta: NonNullable<Shape['cta']>): {
  cta: BannerRecord['cta'];
  pageRaw: string | null;
} {
  return {
    cta: {
      type: cta.type,
      categoryId: cta.categoryId ?? null,
      productId: cta.productId ?? null,
      page: isBannerPage(cta.page) ? (cta.page as BannerPage) : null,
    },
    pageRaw: cta.page ?? null,
  };
}

// ── Administración: escrituras ─────────────────────────────────────────────────────────────

/** POST /v1/admin/banners */
export const createAdminBanner: Handler = (req): AdminBanner => {
  const actor = requireStaff(req, 'banners.create');
  const raw = rawBody(req);
  const shape = parseShape(raw, CREATE_KEYS);
  const missing = ['code', 'imageAssetId', 'translations', 'cta', 'branchScope']
    .filter((k) => !has(raw, k))
    .map((k) => `${k}: obligatorio`);
  if (!shape.translations?.es) missing.push('translations.es: obligatorio');
  if (missing.length > 0) badRequest([...new Set(missing)]);
  const { store } = req;
  const at = now(req);
  const { cta, pageRaw } = ctaRecord(shape.cta as NonNullable<Shape['cta']>);
  const en = shape.translations?.en ? patchTexts(null, shape.translations.en) : null;
  const r: Resulting = {
    imageAssetId: shape.imageAssetId as string,
    es: patchTexts(null, shape.translations?.es as TextPatch),
    en: en && !isEmptyTexts(en) ? en : null,
    cta,
    ctaPageRaw: pageRaw,
    branchScope: shape.branchScope as PromotionScope,
    branchIds: shape.branchIds ?? [],
    promotionId: shape.promotionId ?? null,
    startsAt: shape.startsAt ?? null,
    endsAt: shape.endsAt ?? null,
    sortOrder: 0,
  };
  assertScopeShape(r);
  assertWriteScope(store, actor.scope, r);
  failBusy(store);
  // Prioridad por defecto = último + 1 entre los no vencidos (el empate por carrera es legal).
  const live = store.banners.filter((b) => !isBannerExpiredByDate(b, at));
  r.sortOrder =
    shape.sortOrder ??
    Math.min(
      BANNER_SORT_MAX,
      live.reduce((m, b) => Math.max(m, b.sortOrder + 1), 0),
    );
  assertBusinessRules(store, r, at, { counts: true });
  if (codeTaken(store, shape.code as string)) {
    failCode(409, 'BANNER_CODE_TAKEN', 'Ya existe un banner con ese código', [
      { path: 'code', code: 'CODE_TAKEN', message: 'El código ya está en uso' },
    ]);
  }
  const stamp = at.toISOString();
  const record: BannerRecord = {
    id: `banner-${store.sequences.banner++}`,
    code: shape.code as string,
    imageAssetId: r.imageAssetId,
    cta: r.cta,
    promotionId: r.promotionId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    active: shape.active ?? true,
    sortOrder: r.sortOrder,
    version: 1,
    branchScope: r.branchScope,
    branchIds: r.branchScope === 'ALL' ? [] : [...r.branchIds],
    translations: { es: r.es, en: r.en },
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.banners.push(record);
  return viewFor(req, actor, record);
};

/** PATCH /v1/admin/banners/:id */
export const updateAdminBanner: Handler = (req): AdminBanner => {
  const actor = requireStaff(req, 'banners.update');
  const { store } = req;
  const current = store.banners.find((b) => b.id === req.params.id);
  if (!current || !touchesScope(actor.scope, current, store)) bannerNotFound();
  if (!coversAll(actor.scope, current)) {
    failCode(403, 'BANNER_SCOPE_FORBIDDEN', 'No cubres todas las sucursales de este banner');
  }
  const shape = parseShape(rawBody(req), UPDATE_KEYS);
  if (shape.expectedVersion === undefined) badRequest(['expectedVersion: obligatorio']);
  const fields = Object.keys(shape).filter((k) => k !== 'expectedVersion');
  if (fields.length === 0) badRequest(['Indica al menos un campo a cambiar']);
  if (shape.expectedVersion !== current.version) {
    failCode(409, 'BANNER_VERSION_CONFLICT', 'El banner cambió; recarga e inténtalo de nuevo');
  }
  const at = now(req);

  const branchScope = shape.branchScope ?? current.branchScope;
  const ctaNext = shape.cta
    ? ctaRecord(shape.cta)
    : { cta: current.cta, pageRaw: current.cta.page };
  const esPatch = shape.translations?.es;
  const enPatch = shape.translations?.en;
  const en =
    enPatch === undefined
      ? current.translations.en
      : enPatch === null
        ? null
        : patchTexts(current.translations.en, enPatch);
  const r: Resulting = {
    imageAssetId: shape.imageAssetId ?? current.imageAssetId,
    es: esPatch ? patchTexts(current.translations.es, esPatch) : { ...current.translations.es },
    en: en && !isEmptyTexts(en) ? en : null,
    cta: ctaNext.cta,
    ctaPageRaw: ctaNext.pageRaw,
    branchScope,
    branchIds:
      branchScope === 'ALL' ? (shape.branchIds ?? []) : (shape.branchIds ?? current.branchIds),
    promotionId: shape.promotionId !== undefined ? shape.promotionId : current.promotionId,
    startsAt: shape.startsAt !== undefined ? shape.startsAt : current.startsAt,
    endsAt: shape.endsAt !== undefined ? shape.endsAt : current.endsAt,
    sortOrder: shape.sortOrder ?? current.sortOrder,
  };
  assertScopeShape(r);
  assertWriteScope(store, actor.scope, r);
  failBusy(store);
  // El tope solo se vuelve a comprobar si el banner pasa de vencido a no vencido (ampliar `endsAt`) estando activo o no.
  const wasCounted = countsAgainstLimit(current.endsAt, at);
  assertBusinessRules(store, r, at, {
    exceptId: current.id,
    counts: !wasCounted && countsAgainstLimit(r.endsAt, at),
  });

  const changed =
    r.imageAssetId !== current.imageAssetId ||
    !sameTexts(r.es, current.translations.es) ||
    !sameTexts(r.en, current.translations.en) ||
    !sameCta(r.cta, current.cta) ||
    r.branchScope !== current.branchScope ||
    !sameSet(r.branchScope === 'ALL' ? [] : r.branchIds, current.branchIds) ||
    r.promotionId !== current.promotionId ||
    !sameInstant(r.startsAt, current.startsAt) ||
    !sameInstant(r.endsAt, current.endsAt) ||
    r.sortOrder !== current.sortOrder;
  // Sin cambios reales: 200 sin escribir, sin subir `version` y sin auditar.
  if (!changed) return viewFor(req, actor, current);

  current.imageAssetId = r.imageAssetId;
  current.translations = { es: r.es, en: r.en };
  current.cta = r.cta;
  current.branchScope = r.branchScope;
  current.branchIds = r.branchScope === 'ALL' ? [] : [...r.branchIds];
  current.promotionId = r.promotionId;
  current.startsAt = r.startsAt;
  current.endsAt = r.endsAt;
  current.sortOrder = r.sortOrder;
  current.version += 1;
  current.updatedAt = at.toISOString();
  return viewFor(req, actor, current);
};

/** PATCH /v1/admin/banners/:id/status — idempotente, sin `expectedVersion`. */
export const updateAdminBannerStatus: Handler = (req): AdminBanner => {
  const actor = requireStaff(req, 'banners.update');
  const { store } = req;
  const current = store.banners.find((b) => b.id === req.params.id);
  if (!current || !touchesScope(actor.scope, current, store)) bannerNotFound();
  if (!coversAll(actor.scope, current)) {
    failCode(403, 'BANNER_SCOPE_FORBIDDEN', 'No cubres todas las sucursales de este banner');
  }
  const raw = rawBody(req);
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (key !== 'active' && key !== 'reason') problems.push(`${key}: campo no permitido`);
  }
  if (typeof raw.active !== 'boolean') problems.push('active: booleano obligatorio');
  if (
    has(raw, 'reason') &&
    (typeof raw.reason !== 'string' ||
      raw.reason.length > 200 ||
      hasDisallowedBannerChars(raw.reason))
  ) {
    problems.push('reason: texto de hasta 200 caracteres sin caracteres de control ni invisibles');
  }
  if (problems.length > 0) badRequest(problems);
  if (raw.active !== current.active) {
    failBusy(store);
    const at = now(req);
    if (raw.active === true && countsAgainstLimit(current.endsAt, at)) {
      const others = store.banners.filter(
        (b) => b.id !== current.id && !isBannerExpiredByDate(b, at),
      ).length;
      if (others + 1 > BANNER_NOT_EXPIRED_MAX) {
        failCode(422, 'BANNER_LIMIT_REACHED', `Hay ${BANNER_NOT_EXPIRED_MAX} banners no vencidos`);
      }
    }
    current.active = raw.active as boolean;
    current.version += 1;
    current.updatedAt = at.toISOString();
  }
  return viewFor(req, actor, current);
};

/** PUT /v1/admin/banners/order — conjunto EXACTO de banners no vencidos; exige alcance global. */
export const reorderAdminBanners: Handler = (req): AdminBannerOrder => {
  const actor = requireStaff(req, 'banners.update');
  if (!actor.scope.allBranches) {
    failCode(403, 'BANNER_SCOPE_FORBIDDEN', 'Reordenar exige alcance sobre todas las sucursales');
  }
  const raw = rawBody(req);
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (key !== 'orderedIds') problems.push(`${key}: campo no permitido`);
  }
  const ids = raw.orderedIds;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    problems.push('orderedIds: debe ser una lista de identificadores');
  } else if (ids.length > BANNER_NOT_EXPIRED_MAX) {
    problems.push(`orderedIds: máximo ${BANNER_NOT_EXPIRED_MAX}`);
  }
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const at = now(req);
  const ordered = ids as string[];
  const current = store.banners.filter((b) => !isBannerExpiredByDate(b, at));
  const exact =
    ordered.length === current.length &&
    new Set(ordered).size === ordered.length &&
    ordered.every((id) => current.some((b) => b.id === id));
  if (!exact) {
    failCode(
      422,
      'BANNER_REORDER_MISMATCH',
      'La lista debe contener exactamente los banners no vencidos',
    );
  }
  const changes = ordered
    .map((id, index) => ({ banner: current.find((b) => b.id === id) as BannerRecord, index }))
    .filter(({ banner, index }) => banner.sortOrder !== index);
  if (changes.length > 0) {
    failBusy(store);
    for (const { banner, index } of changes) {
      banner.sortOrder = index;
      banner.version += 1;
      banner.updatedAt = at.toISOString();
    }
  }
  return {
    items: ordered.map((id) => {
      const b = current.find((x) => x.id === id) as BannerRecord;
      return { id: b.id, sortOrder: b.sortOrder, version: b.version };
    }),
  };
};
