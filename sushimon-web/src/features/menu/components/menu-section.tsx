'use client';

import { useLocale } from 'next-intl';
import { ProductCard } from '@/features/catalog/components/product-card';
import { categoryName } from '@/features/catalog/localized';
import type { Product } from '@/lib/data-access/models';
import type { MenuSection as Section } from '../menu-model';
import { ProductListItem } from './product-list-item';

/**
 * Sección de una categoría: encabezado con rótulo japonés y contador, y sus productos.
 * Móvil/tablet: tarjetas con "Agregar" (`ProductCard` row). Escritorio (lg): filas compactas de 3 columnas.
 */
export function MenuSection({
  section,
  catalog,
}: {
  section: Section;
  catalog: readonly Product[];
}) {
  const locale = useLocale();
  const { category, products } = section;
  const headingId = `h-${category.id}`;
  return (
    <section className="mb-7" aria-labelledby={headingId}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b border-line pb-1.5 lg:mb-1 lg:border-b-0 lg:pb-0">
        <h2 id={headingId} className="disp flex items-baseline gap-2 text-[22px] sm:text-[26px]">
          {categoryName(category, locale)}
          {category.jpLabel ? (
            <span className="font-jp text-[12px] tracking-[0.15em] text-primary" lang="ja">
              {category.jpLabel}
            </span>
          ) : null}
        </h2>
        <span className="text-sm text-muted">{products.length}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:hidden">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} catalog={catalog} variant="row" />
        ))}
      </div>
      <div className="hidden lg:grid lg:grid-cols-3 lg:gap-x-6">
        {products.map((product) => (
          <ProductListItem key={product.id} product={product} catalog={catalog} />
        ))}
      </div>
    </section>
  );
}
