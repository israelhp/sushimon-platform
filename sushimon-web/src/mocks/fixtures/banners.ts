import type { BannerCtaType, BannerPage, PromotionScope } from '@/lib/data-access/models';
import type { BannerTexts } from '@/lib/banner-rules';
import { sha256Hex } from '../sha256';

/**
 * Banners del mock (F16, ADR-0022): reproducen `app.banners` + `banner_translations` + `banner_branches`. Los estados
 * (inactivo / programado / publicado / vencido) NO se guardan: se derivan de `active` y la vigencia `[startsAt, endsAt)` (instantes
 * con zona; `null` = sin extremo). El CTA es estructurado (jamás una ruta de texto): la web resuelve la ruta con una función
 * cerrada. Cada banner referencia un asset `BANNER_IMAGE` READY de la biblioteca SIMULADA (host `*.invalid`: nunca se pide por
 * red; sin bytes la tienda muestra el fondo de marca con texto y CTA). Los textos de los 4 primeros provienen de las 4
 * diapositivas fijas del carrusel anterior (sin precios: F16 no muestra importes).
 *
 * "Ahora" de la demo = miércoles 11 nov 2026, 14:25 en Guatemala: el banner de Happy Hour (promoción lun–jue 15:00–18:00) está
 * programado por su promoción y aparece hoy a las 15:00 (`nextChangeAt`).
 */
export interface BannerRecord {
  id: string;
  /** Identificador estable, único e inmutable (minúsculas). */
  code: string;
  imageAssetId: string;
  cta: {
    type: BannerCtaType;
    categoryId: string | null;
    productId: string | null;
    page: BannerPage | null;
  };
  promotionId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  /** Prioridad: menor sale primero; NO es única (empate por `createdAt`, `id`). */
  sortOrder: number;
  version: number;
  branchScope: PromotionScope;
  /** Solo con `branchScope = 'SELECTED'`. */
  branchIds: string[];
  translations: { es: BannerTexts; en: BannerTexts | null };
  createdAt: string;
  updatedAt: string;
}

/** Asset semilla de imagen de banner (la biblioteca SIMULADA lo materializa como `MediaAssetRecord`). */
export interface BannerAssetSeed {
  id: string;
  checksumSha256: string;
  objectKey: string;
  sizeBytes: number;
}

const CREATED = '2026-10-20T18:00:00.000Z';

const t = (
  title: string,
  imageAlt: string,
  subtitle: string | null = null,
  ctaLabel: string | null = null,
): BannerTexts => ({ title, subtitle, ctaLabel, imageAlt });

const NO_CTA = { categoryId: null, productId: null, page: null } as const;

const base = {
  active: true,
  version: 1,
  startsAt: null,
  endsAt: null,
  promotionId: null,
  branchScope: 'ALL',
  branchIds: [],
  createdAt: CREATED,
  updatedAt: CREATED,
} as const satisfies Partial<BannerRecord>;

const assetOf = (code: string): string => `media-seed-banner-${code}`;

export const BANNER_SEEDS: BannerRecord[] = [
  {
    ...base,
    id: 'banner-favoritos',
    code: 'favoritos',
    imageAssetId: assetOf('favoritos'),
    cta: { ...NO_CTA, type: 'CATEGORY', categoryId: 'cat-rolls' },
    sortOrder: 0,
    translations: {
      es: t(
        'Los favoritos de los MONcheros',
        'Selección de rolls favoritos de Sushi Mon',
        'Platanito, California y Calientito Roll.',
        'Ver rolls',
      ),
      en: t(
        "MONcheros' favorites",
        'Selection of favorite Sushi Mon rolls',
        'Platanito, California and Calientito Roll.',
        'See rolls',
      ),
    },
  },
  {
    ...base,
    id: 'banner-happy-hour',
    code: 'happy-hour',
    imageAssetId: assetOf('happy-hour'),
    cta: { ...NO_CTA, type: 'PROMOTIONS' },
    promotionId: 'happy-hour',
    sortOrder: 1,
    translations: {
      es: t(
        'Happy Hour',
        'Mesa con rolls y bebidas durante el Happy Hour',
        'Lunes a jueves de 3:00 a 6:00 p. m. · Solo en restaurante',
        'Ver promociones',
      ),
      en: t(
        'Happy Hour',
        'Table with rolls and drinks during Happy Hour',
        'Monday to Thursday, 3:00 to 6:00 p.m. · Dine-in only',
        'See promotions',
      ),
    },
  },
  {
    ...base,
    id: 'banner-calientito',
    code: 'calientito',
    imageAssetId: assetOf('calientito'),
    cta: { ...NO_CTA, type: 'PRODUCT', productId: 'calientito-roll' },
    sortOrder: 2,
    translations: {
      es: t(
        'Te merecés un calientito',
        'Calientito Roll recién hecho',
        'Elegí tu favorito y personalizá tu pedido.',
        'Pedí el tuyo',
      ),
      en: t(
        'You deserve something hot',
        'Freshly made Calientito Roll',
        'Pick your favorite and customize your order.',
        'Order yours',
      ),
    },
  },
  {
    ...base,
    id: 'banner-equipo',
    code: 'equipo',
    imageAssetId: assetOf('equipo'),
    cta: { ...NO_CTA, type: 'PAGE', page: 'CAREERS' },
    sortOrder: 3,
    translations: {
      es: t(
        '¿Querés ser MONchero?',
        'Equipo de cocina de Sushi Mon',
        'El mejor sushi se hace en equipo.',
        'Ver oportunidades',
      ),
      en: t(
        'Want to be a MONchero?',
        'Sushi Mon kitchen team',
        'The best sushi is made as a team.',
        'See openings',
      ),
    },
  },
  {
    // Solo en las sucursales 1 y 2 (como su promoción) y SIN traducción al inglés: en `en` todo sale en español (`fallbackFields`).
    ...base,
    id: 'banner-fin-de-mes',
    code: 'fin-de-mes',
    imageAssetId: assetOf('fin-de-mes'),
    cta: { ...NO_CTA, type: 'MENU' },
    promotionId: 'fin-de-mes',
    branchScope: 'SELECTED',
    branchIds: ['sucursal-1', 'sucursal-2'],
    sortOrder: 4,
    translations: {
      es: t(
        'Fin de mes: bebidas',
        'Bebidas frías del menú',
        'En las sucursales 1 y 2.',
        'Ver el menú',
      ),
      en: null,
    },
  },
  {
    // Programado: empieza el 20 nov (06:00 UTC = 00:00 en Guatemala).
    ...base,
    id: 'banner-navidad',
    code: 'navidad-en-rolls',
    imageAssetId: assetOf('navidad'),
    cta: { ...NO_CTA, type: 'CATEGORY', categoryId: 'cat-rolls' },
    promotionId: 'navidad-rolls',
    startsAt: '2026-11-20T06:00:00.000Z',
    endsAt: '2027-01-01T06:00:00.000Z',
    sortOrder: 5,
    translations: {
      es: t(
        'Navidad en rolls',
        'Rolls con decoración navideña',
        'Del 20 de noviembre al 31 de diciembre.',
        'Ver rolls',
      ),
      en: t('Christmas rolls', 'Rolls with Christmas decoration'),
    },
  },
  {
    // Vencido (terminó el 1 nov): no participa del reordenado ni del tope de 100.
    ...base,
    id: 'banner-semana-cliente',
    code: 'semana-del-cliente',
    imageAssetId: assetOf('semana-cliente'),
    cta: { ...NO_CTA, type: 'MENU' },
    promotionId: 'semana-cliente',
    startsAt: '2026-10-15T06:00:00.000Z',
    endsAt: '2026-11-01T06:00:00.000Z',
    sortOrder: 6,
    translations: {
      es: t('Semana del cliente', 'Mesa familiar con rolls', 'Gracias por elegirnos.'),
      en: null,
    },
  },
  {
    // Inactivo y vinculado a un CUPÓN: el banner nunca revela código ni descuento.
    ...base,
    id: 'banner-bienvenida',
    code: 'bienvenida',
    imageAssetId: assetOf('bienvenida'),
    cta: { ...NO_CTA, type: 'PROMOTIONS' },
    promotionId: 'bienvenida',
    active: false,
    sortOrder: 7,
    translations: {
      es: t(
        'Tu primer pedido, con sorpresa',
        'Caja de sushi de bienvenida',
        'Pídelo y pregunta por tu beneficio.',
        'Ver promociones',
      ),
      en: null,
    },
  },
];

const SEED_AT = '2026-11-01T12:00:00.000Z';

/** Un asset WebP READY por banner semilla (sin bytes; tamaño plausible bajo 1 MiB). */
export const BANNER_ASSET_SEEDS: readonly BannerAssetSeed[] = BANNER_SEEDS.map((b, i) => ({
  id: b.imageAssetId,
  checksumSha256: sha256Hex(`sushimon-mock-banner-${b.code}`),
  objectKey: `banners/2026/${b.imageAssetId}.webp`,
  sizeBytes: 180_000 + i * 17_311,
}));

export const BANNER_ASSET_SEED_AT = SEED_AT;
