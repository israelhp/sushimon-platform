import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/data-access/models';
import { clearSimulatedObjects, registerSimulatedObject } from '@/lib/media-simulated';
import { renderWithIntl } from '@/test/render';
import { ProductArt, firstProductImage } from './product-art';

const product = (media: { url: string; altText: string | null }[]) =>
  ({ id: 'p1', name: 'Roll', illustration: 'roll', media }) as unknown as Product & {
    media: { url: string; altText: string | null }[];
  };
const CDN = 'https://cdn.example.test/products/2026/a.webp';

afterEach(() => {
  clearSimulatedObjects();
  vi.unstubAllGlobals();
});

describe('F14 · imagen de producto en la tienda', () => {
  it('muestra media[0] con lazy, decoding async, dimensiones, sizes y alt; sin optimizador', () => {
    const { container } = renderWithIntl(
      <ProductArt
        product={product([{ url: CDN, altText: 'Roll de salmón' }])}
        sizing={{ width: 320, height: 110, sizes: '50vw' }}
        altFallback="Roll"
      />,
    );
    const img = screen.getByRole('img', { name: 'Roll de salmón' });
    expect(img).toHaveAttribute('src', CDN);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('width', '320');
    expect(img).toHaveAttribute('height', '110');
    expect(img).toHaveAttribute('sizes', '50vw');
    expect(img.getAttribute('src')).not.toMatch(/_next\/image|cdn-cgi/);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('alt = nombre cuando la API no trae texto alternativo', () => {
    renderWithIntl(
      <ProductArt product={product([{ url: CDN, altText: null }])} altFallback="Roll" />,
    );
    expect(screen.getByRole('img', { name: 'Roll' })).toBeInTheDocument();
  });

  it('la imagen principal de la ficha es eager con prioridad alta', () => {
    renderWithIntl(
      <ProductArt
        product={product([{ url: CDN, altText: 'x' }])}
        sizing={{ width: 430, height: 340, priority: true }}
      />,
    );
    const img = screen.getByRole('img', { name: 'x' });
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('sin imágenes muestra la ilustración (sin <img>)', () => {
    const { container } = renderWithIntl(<ProductArt product={product([])} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(firstProductImage(product([]))).toBeNull();
  });

  it('onError cae a la ilustración UNA vez (sin bucle de reintentos)', () => {
    const { container } = renderWithIntl(
      <ProductArt product={product([{ url: CDN, altText: 'x' }])} />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'x' }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('http (no https) o esquema ajeno no se renderiza', () => {
    const { container } = renderWithIntl(
      <ProductArt product={product([{ url: 'http://cdn.example.test/a.webp', altText: null }])} />,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('URL simulada (.invalid) sin bytes: ilustración y NUNCA se pide el host; con bytes locales, blob:', () => {
    const url = 'https://media-simulado.invalid/products/2026/media-asset-4.webp';
    const first = renderWithIntl(<ProductArt product={product([{ url, altText: 'x' }])} />);
    expect(first.container.querySelector('img')).toBeNull();
    first.unmount();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:local', revokeObjectURL: () => {} }),
    );
    registerSimulatedObject('media-asset-4', new Blob(['x']));
    renderWithIntl(<ProductArt product={product([{ url, altText: 'x' }])} />);
    expect(screen.getByRole('img', { name: 'x' })).toHaveAttribute('src', 'blob:local');
  });
});
