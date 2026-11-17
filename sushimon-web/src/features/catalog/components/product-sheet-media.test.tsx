import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findLoadedDialog } from '@/test/sheet';
import { renderStore } from '@/test/store-providers';
import { useProductSheet } from '../product-sheet-context';
import { ProductSheetHost } from './product-sheet-host';

function Opener() {
  const { openProduct } = useProductSheet();
  return (
    <>
      <button type="button" onClick={() => openProduct('dumplings')}>
        abrir
      </button>
      <ProductSheetHost />
    </>
  );
}

const urls = ['https://cdn.example.test/a.webp', 'https://cdn.example.test/b.webp'];

describe('F14 · ficha con imágenes reales', () => {
  it('muestra la primera imagen eager, la galería y cambia con los puntos; alt del texto o del nombre', async () => {
    await renderStore(<Opener />, {
      prepareStore: (store) => {
        const p = store.products.find((x) => x.id === 'dumplings')!;
        p.media = urls.map((url, i) => ({
          id: `m${i}`,
          url,
          altText: i === 0 ? 'Dumplings al vapor' : null,
          sortOrder: i,
          assetId: null,
        }));
      },
    });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await findLoadedDialog();
    const img = await within(dialog).findByRole('img', { name: 'Dumplings al vapor' });
    expect(img).toHaveAttribute('src', urls[0]);
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('decoding', 'async');
    const dot = within(dialog).getByRole('button', { name: /Imagen 2 de 2|2 de 2/ });
    // M8: objetivo táctil ≥ 44 px (el punto visible es un hijo decorativo).
    expect(dot.className).toMatch(/h-11/);
    expect(dot.className).toMatch(/w-11/);
    fireEvent.click(dot);
    const second = within(dialog).getByRole('img', { name: 'Dumplings' });
    expect(second).toHaveAttribute('src', urls[1]);
    // Falla la carga: vuelve a la ilustración sin bucles.
    fireEvent.error(second);
    expect(within(dialog).queryByRole('img', { name: 'Dumplings' })).toBeNull();
  });
});
