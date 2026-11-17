import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { cardToCatalogProduct } from '../catalog-product';
import { ProductCard } from './product-card';

const soldOut = cardToCatalogProduct({
  productId: 'gaseosas',
  slug: 'gaseosas',
  price: '10.00',
  available: false,
  name: 'Gaseosas',
  summary: 'Bebida',
  image: null,
  category: { id: 'c', slug: 'relax', name: 'Relax' },
  promo: null,
});

describe('ProductCard · agotado (F17, M5/M6)', () => {
  it('tarjeta vertical y fila usan la MISMA insignia visible «Agotado» (texto, no solo color)', async () => {
    await renderStore(
      <>
        <ProductCard product={soldOut} catalog={[soldOut]} />
        <ProductCard product={soldOut} catalog={[soldOut]} variant="row" />
      </>,
    );
    const badges = screen.getAllByText('Agotado');
    expect(badges).toHaveLength(2);
    const [tile, row] = badges;
    // Mismas clases base de la insignia en ambas variantes.
    for (const cls of ['rounded-full', 'border-danger/50', 'bg-danger-soft', 'text-danger']) {
      expect(tile?.className).toContain(cls);
      expect(row?.className).toContain(cls);
    }
    // En la fila el control sigue deshabilitado y con nombre accesible que explica el estado.
    expect(
      screen.getByRole('button', { name: 'Gaseosas: agotado, no se puede agregar' }),
    ).toBeDisabled();
  });

  it('solo se atenúa la imagen: el texto (nombre, precio, descripción) conserva su opacidad', async () => {
    const { container } = await renderStore(
      <ProductCard product={soldOut} catalog={[soldOut]} variant="row" />,
    );
    const article = container.querySelector('article');
    expect(article?.className).not.toMatch(/opacity/);
    expect(screen.getByRole('heading', { name: 'Gaseosas' }).className).not.toMatch(/opacity/);
    expect(
      container.querySelector('svg.grayscale, img.grayscale, [class*="grayscale"]'),
    ).not.toBeNull();
  });
});
