import type { DataClient } from '@/lib/data-access/types';
import type {
  Product,
  PublicProduct,
  PublicProductCategoryRef,
  PublicProductMedia,
  SimulatedProductExtras,
} from '@/lib/data-access/models';
import { artForCategorySlugs, isFoodArt } from '@/lib/product-decor';
import { priceToNumber } from '@/lib/product-rules';
import { listAllStoreProducts, listSimulatedProductExtras } from '@/services/products';

/**
 * Producto de la tienda tal como lo consumen menú, carrito, checkout y favoritos: el modelo UI `Product` (precio numérico
 * para sumar y mostrar) construido a partir del contrato F11 (`PublicProduct`, precio base como cadena) más lo que F11 NO
 * provee. `categoryId` es el id de la categoría real (F10) y `price` el `basePrice` global: el servidor recalcula al crear el
 * pedido (F19+).
 */
export interface CatalogProduct extends Product {
  slug: string;
  /** Precio base canónico (`"85.00"`). */
  basePrice: string;
  category: PublicProductCategoryRef;
  /** Imágenes referenciadas (vacía = placeholder). */
  media: PublicProductMedia[];
}

export interface ProductFilters {
  /** Sucursal para `available` (SIMULADO hasta F13; solo el mock lo resuelve). */
  branchId?: string;
}

/**
 * Lo SIMULADO que F11 no trae (F12/F13/F15 y textos por idioma). Con `extras` (solo en el mock) se usan sus valores; sin ellos
 * (api real) se derivan valores neutros: ilustración por categoría, sin destacado, siempre disponible.
 */
export function toCatalogProduct(
  product: PublicProduct,
  extras?: SimulatedProductExtras,
): CatalogProduct {
  const art = artForCategorySlugs([product.category.slug]);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    nameEn: extras?.nameEn,
    description: product.description ?? '',
    descriptionEn: extras?.descriptionEn,
    basePrice: product.basePrice,
    price: priceToNumber(product.basePrice),
    categoryId: product.category.id,
    category: product.category,
    media: product.media,
    illustration: extras?.illustration ?? art,
    featured: extras?.featured ?? false,
    food: extras?.food ?? isFoodArt(art),
    available: extras?.available ?? true,
    availability: extras?.availability ?? [],
  };
}

/**
 * Catálogo completo: TODA la lista pública de F11 (`GET /v1/store/products`, páginas de 100) unida por id con los extras
 * simulados cuando el cliente es el mock. Si los extras fallan, el menú sigue con valores neutros (no son contrato).
 */
export async function loadCatalog(
  client: DataClient,
  filters: ProductFilters = {},
): Promise<CatalogProduct[]> {
  const [products, extras] = await Promise.all([
    listAllStoreProducts(client),
    client.kind === 'mock'
      ? listSimulatedProductExtras(client, filters.branchId).then(
          (r) => new Map(r.items.map((e) => [e.productId, e])),
          () => new Map<string, SimulatedProductExtras>(),
        )
      : Promise.resolve(new Map<string, SimulatedProductExtras>()),
  ]);
  return products.map((p) => toCatalogProduct(p, extras.get(p.id)));
}
