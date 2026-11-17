import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../query-keys';

/**
 * F17 (spec 018 D6d): tras CUALQUIER mutación del backoffice que cambie lo que ve la tienda (productos, categorías, precios y
 * disponibilidad por sucursal, medios, modificadores, promociones, banners, sucursales, horarios) se invalidan los agregados públicos
 * y las fichas. Helper ÚNICO: así ninguna mutación se olvida de una clave. La caché compartida del servidor (≤ 15 s) no se purga.
 */
export function invalidateStoreAggregates(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.store.bootstrapAll }),
    qc.invalidateQueries({ queryKey: queryKeys.store.menuAll }),
    qc.invalidateQueries({ queryKey: queryKeys.store.searchAll }),
    qc.invalidateQueries({ queryKey: queryKeys.products.storeDetails }),
  ]);
}
