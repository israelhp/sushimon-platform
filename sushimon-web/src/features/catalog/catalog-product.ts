import type { DataClient } from '@/lib/data-access/types';
import type {
  Product,
  PublicProduct,
  PublicProductCategoryRef,
  PublicProductMedia,
  SimulatedProductExtras,
  StoreBranchMenu,
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
  /**
   * Precio base GLOBAL canónico (`"85.00"`) del catálogo F11. `price`/`effectivePrice` son el de la SUCURSAL elegida cuando el
   * overlay F13 está aplicado; sin sucursal (o si el overlay falló) coinciden con el base.
   */
  basePrice: string;
  /** F13: precio EFECTIVO (override o base) de la sucursal seleccionada, como cadena canónica. */
  effectivePrice: string;
  category: PublicProductCategoryRef;
  /** Imágenes referenciadas (vacía = placeholder). */
  media: PublicProductMedia[];
}

export interface ProductFilters {
  /**
   * Sucursal cuyo overlay F13 se aplica. `undefined` = la seleccionada en el modo de pedido; `null` = ninguna (precios base).
   * La lista base (F11) NO depende de la sucursal: solo el overlay.
   */
  branchId?: string | null;
}

/**
 * Lo SIMULADO que F11 no trae (F15 y textos por idioma). Con `extras` (solo en el mock) se usan sus valores; sin ellos
 * (api real) se derivan valores neutros: ilustración por categoría, sin destacado, siempre disponible (la disponibilidad real es el overlay F13).
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
    effectivePrice: product.basePrice,
    categoryId: product.category.id,
    category: product.category,
    media: product.media,
    illustration: extras?.illustration ?? art,
    featured: extras?.featured ?? false,
    food: extras?.food ?? isFoodArt(art),
    available: true,
    availability: [],
  };
}

/**
 * F13: combina el catálogo F11 con el overlay de UNA sucursal. Precio EFECTIVO y `available` salen del overlay; un producto que
 * el overlay NO trae (no visible, o aún no publicado en esa sucursal) NO se oferta. Nunca se usa el precio de otra sucursal.
 */
export function applyBranchMenu(
  products: readonly CatalogProduct[],
  menu: StoreBranchMenu,
): CatalogProduct[] {
  const byId = new Map(menu.items.map((item) => [item.productId, item]));
  return products.flatMap((product) => {
    const item = byId.get(product.id);
    if (!item) return [];
    return [
      {
        ...product,
        effectivePrice: item.price,
        price: priceToNumber(item.price),
        available: item.available,
      },
    ];
  });
}

/**
 * Catálogo completo: TODA la lista pública de F11 (`GET /v1/store/products`, páginas de 100) unida por id con los extras
 * simulados cuando el cliente es el mock. Si los extras fallan, el menú sigue con valores neutros (no son contrato).
 */
export async function loadCatalog(client: DataClient): Promise<CatalogProduct[]> {
  const [products, extras] = await Promise.all([
    listAllStoreProducts(client),
    client.kind === 'mock'
      ? listSimulatedProductExtras(client).then(
          (r) => new Map(r.items.map((e) => [e.productId, e])),
          () => new Map<string, SimulatedProductExtras>(),
        )
      : Promise.resolve(new Map<string, SimulatedProductExtras>()),
  ]);
  return products.map((p) => toCatalogProduct(p, extras.get(p.id)));
}
