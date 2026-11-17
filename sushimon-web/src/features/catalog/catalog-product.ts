import type { DataClient } from '@/lib/data-access/types';
import type {
  Product,
  PublicProductCategoryRef,
  PublicProductDetail,
  PublicProductMedia,
  SimulatedProductExtras,
  StoreBranchMenuItem,
  StoreProductPromo,
} from '@/lib/data-access/models';
import { artForCategorySlugs, isFoodArt } from '@/lib/product-decor';
import { priceToNumber } from '@/lib/product-rules';
import type { StoreMenuParams } from '@/lib/store-rules';
import { listAllStoreMenu } from '@/services/branch-products';
import { listSimulatedProductExtras } from '@/services/products';

/**
 * Producto de la tienda tal como lo consumen menú, carrito, checkout y favoritos: el modelo UI `Product` (precio numérico
 * para sumar y mostrar) construido a partir de la TARJETA del menú (`StoreBranchMenuItem`, F17) o de la ficha (`PublicProductDetail`)
 * más lo que el contrato NO provee. La UI solo muestra lo que devuelve la respuesta: precio, disponibilidad y promoción vienen del
 * servidor para la sucursal pedida; el servidor recalcula al crear el pedido (F19+).
 */
export interface CatalogProduct extends Product {
  slug: string;
  /**
   * Precio de lista como cadena canónica (`"85.00"`). Con sucursal es el EFECTIVO de esa sucursal; sin ella, el base. Las tarjetas
   * del menú no exponen el precio base ni si hay un precio especial (contrato F17).
   */
  basePrice: string;
  /** Precio EFECTIVO de la sucursal elegida (o el base sin sucursal), como cadena canónica. */
  effectivePrice: string;
  category: PublicProductCategoryRef;
  /** Imágenes referenciadas (vacía = placeholder). La tarjeta trae solo la principal; la ficha, la galería completa. */
  media: PublicProductMedia[];
  /** Promoción pública INDICATIVA vigente de mayor ahorro (F15) o `null`; la decide el servidor. */
  promo: StoreProductPromo | null;
}

export interface ProductFilters {
  /**
   * Sucursal cuyo menú se pide. `undefined` = la seleccionada en el modo de pedido; `null` = ninguna (precios base).
   */
  branchId?: string | null;
  /** `false` = no consultar (carga perezosa: p. ej., el carrito cerrado). */
  enabled?: boolean;
}

/** `available=null` (sin sucursal: se desconoce) se trata como disponible; solo `false` es «agotado». */
const isAvailable = (available: boolean | null | undefined) => available !== false;

/**
 * Lo SIMULADO que el contrato no trae (textos en inglés, ilustración, destacado). Con `extras` (solo en el mock) se usan sus valores;
 * sin ellos (api real) se derivan valores neutros: ilustración por categoría y sin destacado.
 */
export function cardToCatalogProduct(
  card: StoreBranchMenuItem,
  extras?: SimulatedProductExtras,
): CatalogProduct {
  // El esquema solo marca 4 campos como obligatorios (`productId`, `slug`, `price`, `available`) aunque el servidor SIEMPRE envía el
  // resto (defecto del contrato, F17): se tolera su ausencia con valores neutros en vez de romper la pantalla.
  const category = card.category ?? { id: '', slug: '', name: '' };
  const art = artForCategorySlugs([category.slug]);
  return {
    id: card.productId,
    slug: card.slug,
    name: card.name ?? card.slug,
    nameEn: extras?.nameEn,
    description: card.summary ?? '',
    descriptionEn: extras?.descriptionEn,
    basePrice: card.price,
    effectivePrice: card.price,
    price: priceToNumber(card.price),
    categoryId: category.id,
    category,
    media: card.image ? [card.image] : [],
    promo: card.promo ?? null,
    illustration: extras?.illustration ?? art,
    featured: extras?.featured ?? false,
    food: extras?.food ?? isFoodArt(art),
    available: isAvailable(card.available),
    availability: [],
  };
}

/**
 * Ficha → producto de la UI. Con sucursal (`offer`) el precio y la disponibilidad son los de ESA sucursal; sin ella, el precio base y
 * «disponible». Conserva la descripción COMPLETA (la tarjeta solo trae el resumen).
 */
export function detailToCatalogProduct(
  detail: PublicProductDetail,
  extras?: SimulatedProductExtras,
): CatalogProduct {
  const art = artForCategorySlugs([detail.category.slug]);
  const price = detail.offer?.price ?? detail.basePrice;
  return {
    id: detail.id,
    slug: detail.slug,
    name: detail.name,
    nameEn: extras?.nameEn,
    description: detail.description ?? '',
    descriptionEn: extras?.descriptionEn,
    basePrice: price,
    effectivePrice: price,
    price: priceToNumber(price),
    categoryId: detail.category.id,
    category: detail.category,
    media: detail.media,
    promo: detail.promotions?.[0] ?? null,
    illustration: extras?.illustration ?? art,
    featured: extras?.featured ?? false,
    food: extras?.food ?? isFoodArt(art),
    available: isAvailable(detail.offer?.available),
    availability: [],
  };
}

/** Extras simulados por id (solo el mock; en http no existen y el menú sigue con valores neutros). */
async function loadExtras(
  client: DataClient,
): Promise<ReadonlyMap<string, SimulatedProductExtras>> {
  if (client.kind !== 'mock') return new Map();
  try {
    const result = await listSimulatedProductExtras(client);
    return new Map(result.items.map((e) => [e.productId, e]));
  } catch {
    return new Map();
  }
}

export interface StoreMenuProducts {
  items: CatalogProduct[];
  total: number;
  /** Del servidor (primera página): sirven para programar el refetch en `nextChangeAt`. */
  generatedAt?: string;
  nextChangeAt?: string | null;
}

/**
 * Menú COMPLETO de una sucursal (o sin sucursal) como productos de la UI: sigue `total` página a página (`getStoreBranchMenu`, de 100
 * en 100) con las tarjetas del servidor. Una sola solicitud con ≤ 100 productos visibles. La promoción, el precio y la
 * disponibilidad son los de la respuesta; nada se recalcula aquí.
 */
export async function loadStoreMenu(
  client: DataClient,
  params: Omit<StoreMenuParams, 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<StoreMenuProducts> {
  const [menu, extras] = await Promise.all([
    listAllStoreMenu(client, params, signal),
    loadExtras(client),
  ]);
  return {
    items: menu.items.map((card) => cardToCatalogProduct(card, extras.get(card.productId))),
    total: menu.total,
    generatedAt: menu.generatedAt,
    nextChangeAt: menu.nextChangeAt,
  };
}

/** Slug de un producto de la UI si lo trae (los `CatalogProduct` sí; los modelos mínimos de pruebas no). */
export function productSlug(product: Product): string | null {
  const slug = (product as { slug?: unknown }).slug;
  return typeof slug === 'string' && slug ? slug : null;
}
