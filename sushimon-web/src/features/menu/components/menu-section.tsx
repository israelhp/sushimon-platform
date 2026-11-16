'use client';

import { ProductCard } from '@/features/catalog/components/product-card';
import type { Product } from '@/lib/data-access/models';
import { useCategoryLabel } from '../category-label';
import { categoryDecor, type MenuSection as Section } from '../menu-model';
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
  const label = useCategoryLabel();
  const { category, products, path } = section;
  const decor = categoryDecor(category, path);
  const parent = path[path.length - 1];
  const headingId = `h-${category.id}`;
  return (
    <section className="mb-7" aria-labelledby={headingId}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b border-line pb-1.5 lg:mb-1 lg:border-b-0 lg:pb-0">
        <h2 id={headingId} className="disp flex items-baseline gap-2 text-[22px] sm:text-[26px]">
          {label(category)}
          {parent ? (
            <span className="text-[13px] font-medium text-muted">· {label(parent)}</span>
          ) : null}
          {decor.jp && !parent ? (
            <span className="font-jp text-[12px] tracking-[0.15em] text-primary" lang="ja">
              {decor.jp}
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
