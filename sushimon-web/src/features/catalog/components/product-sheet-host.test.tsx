import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts } from '@/lib/data-access/types';
import { findLoadedDialog } from '@/test/sheet';
import { renderStore } from '@/test/store-providers';
import { MAX_QUANTITY } from '@/lib/cart-rules';
import { useProductSheet } from '../product-sheet-context';
import { ProductSheetHost } from './product-sheet-host';

function Opener({ id }: { id: string }) {
  const { openProduct, productId } = useProductSheet();
  return (
    <>
      <button type="button" onClick={() => openProduct(id)}>
        abrir
      </button>
      <output data-testid="open-id">{productId ?? ''}</output>
      <ProductSheetHost />
    </>
  );
}

async function openSheet(id = 'dumplings', options: Parameters<typeof renderStore>[1] = {}) {
  const view = await renderStore(<Opener id={id} />, options);
  // Espera a que el catálogo cargue antes de abrir.
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
  const dialog = await findLoadedDialog();
  return { view, dialog };
}

const increase = () => screen.getByRole('button', { name: 'Aumentar cantidad' });
const decrease = () => screen.getByRole('button', { name: 'Disminuir cantidad' });

describe('ProductSheet', () => {
  it('muestra nombre, categoría, descripción, precio y observaciones como diálogo accesible', async () => {
    const { dialog } = await openSheet();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Dumplings');
    expect(await within(dialog).findByText('Entradas')).toBeInTheDocument();
    expect(within(dialog).getByText(/Empanaditas al vapor rellenas de cerdo/)).toBeInTheDocument();
    expect(within(dialog).getByText('Q53', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Observaciones')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Las observaciones no modifican el precio.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Agregar Dumplings a favoritos' }),
    ).toBeInTheDocument();
  });

  it('la cantidad va de 1 a 99 y el total mostrado la acompaña', async () => {
    await openSheet();
    const add = screen.getByRole('button', { name: /^Agregar\s*Q53$/ });
    expect(decrease()).toBeDisabled();
    fireEvent.click(increase());
    fireEvent.click(increase());
    expect(screen.getByRole('button', { name: /^Agregar\s*Q159$/ })).toBeInTheDocument();
    expect(add).toBe(screen.getByRole('button', { name: /^Agregar\s*Q159$/ }));
    fireEvent.click(decrease());
    expect(screen.getByRole('button', { name: /^Agregar\s*Q106$/ })).toBeInTheDocument();
  });

  it('no pasa de 99 unidades', async () => {
    await openSheet();
    for (let i = 0; i < MAX_QUANTITY + 5; i++) {
      if (!(increase() as HTMLButtonElement).disabled) fireEvent.click(increase());
    }
    expect(increase()).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Cantidad' })).toHaveTextContent('99');
    expect(screen.getByRole('button', { name: /^Agregar\s*Q5,?247$/ })).toBeInTheDocument();
    expect(screen.getByText('Máximo 99 por pedido.')).toBeInTheDocument();
  });

  it('agrega con cantidad y nota, avisa y cierra', async () => {
    const { view } = await openSheet('dumplings', { branchId: 'sucursal-1' });
    fireEvent.click(increase());
    fireEvent.click(increase());
    fireEvent.change(screen.getByLabelText('Observaciones'), {
      target: { value: 'Sin ajonjolí' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Agregar\s*Q159$/ }));
    expect(view.api().cart.lines).toMatchObject([
      { productId: 'dumplings', quantity: 3, note: 'Sin ajonjolí', selections: [] },
    ]);
    expect(await screen.findByText('3 × Dumplings agregado a tu pedido')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-id')).toBeEmptyDOMElement();
  });

  it('Esc y el botón de cerrar la cierran sin agregar nada', async () => {
    const { view } = await openSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.api().cart.lines).toEqual([]);
  });

  it('al reabrir otro producto empieza de nuevo (cantidad 1, sin nota)', async () => {
    await openSheet();
    fireEvent.click(increase());
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'x' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    await findLoadedDialog();
    expect(screen.getByLabelText('Observaciones')).toHaveValue('');
    expect(screen.getByRole('group', { name: 'Cantidad' })).toHaveTextContent('1');
  });

  it('producto no disponible: aviso y no se puede agregar', async () => {
    const { view } = await openSheet('calientito-roll', {
      scenario: 'product-unavailable',
      branchId: 'sucursal-1',
    });
    expect(screen.getByText(/no está disponible por ahora/)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: /^Agregar\s*Q/ });
    expect(add).toBeDisabled();
    expect(increase()).toBeDisabled();
    fireEvent.click(add);
    expect(view.api().cart.lines).toEqual([]);
  });

  it('F13: la ficha muestra el precio EFECTIVO de la sucursal elegida', async () => {
    const { dialog } = await openSheet('dynamita-roll', { branchId: 'sucursal-2' });
    expect(within(dialog).getAllByText('Q86').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('Q82')).not.toBeInTheDocument();
  });

  it('en inglés usa nombre y descripción traducidos', async () => {
    await openSheet('dumplings', { locale: 'en' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Steamed pork and vegetable dumplings/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Special requests')).toBeInTheDocument();
  });

  it('un producto que no existe: el diálogo se abre y dice que ya no está disponible (sin ficha vacía ni agregar)', async () => {
    await renderStore(<Opener id="no-existe" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Este producto ya no está disponible en el menú.',
    });
    expect(dialog).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('button', { name: /^Agregar\s*Q/ })).not.toBeInTheDocument();
  });
});

describe('ProductSheet · ficha del servidor (F11)', () => {
  const seedRollFrio = (store: import('@/mocks/store').MockStore) => {
    const base = store.products.find((p) => p.id === 'alaska-roll')!;
    Object.assign(base, {
      categoryId: 'cat-rolls-frios',
      media: [
        { id: 'm1', url: 'https://cdn.ejemplo.com/a.jpg', altText: 'Alaska roll', sortOrder: 0 },
        { id: 'm2', url: 'https://cdn.ejemplo.com/b.jpg', altText: null, sortOrder: 1 },
        { id: 'm3', url: 'javascript:alert(1)', altText: 'xss', sortOrder: 2 },
      ],
    });
  };

  it('breadcrumb de categoría con ancestros (raíz → hoja) y galería solo con URL https', async () => {
    const { dialog } = await openSheet('alaska-roll', { prepareStore: seedRollFrio });
    const crumb = await within(dialog).findByRole('navigation', { name: 'Categoría del producto' });
    await waitFor(() => expect(crumb).toHaveTextContent('Sushi Rolls›Rolls fríos'));
    expect(within(crumb).getByText('Rolls fríos')).toHaveAttribute('aria-current', 'location');
    const img = within(dialog).getByRole('img', { name: 'Alaska roll' });
    expect(img).toHaveAttribute('src', 'https://cdn.ejemplo.com/a.jpg');
    const dots = within(dialog).getAllByRole('button', { name: /^Imagen \d de 2$/ });
    expect(dots).toHaveLength(2); // la URL javascript: se descarta
    fireEvent.click(dots[1]!);
    // Sin altText la imagen es decorativa (alt vacío): el nombre va en el título.
    expect(dialog.querySelector('img[src^="https"]')).toHaveAttribute(
      'src',
      'https://cdn.ejemplo.com/b.jpg',
    );
    expect(dialog.querySelector('[src^="javascript"]')).toBeNull();
  });

  it('sin imágenes muestra el placeholder (ilustración, sin <img>)', async () => {
    const { dialog } = await openSheet('dumplings');
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.querySelector('svg')).not.toBeNull();
  });

  it('si la ficha ya no está publicada (404) avisa y no deja agregar', async () => {
    let target: import('@/mocks/store').MockStore | null = null;
    const { dialog } = await openSheet('dumplings', {
      prepareStore: (store) => {
        target = store;
      },
      wrapClient: (base) =>
        withShortcuts('mock', async (path, options) => {
          if (/^\/v1\/store\/products\/dumplings$/.test(path)) {
            throw new ApiError(
              404,
              'not_found',
              'Producto no encontrado',
              undefined,
              undefined,
              'PRODUCT_NOT_FOUND',
            );
          }
          return base.request(path, options);
        }),
    });
    expect(target).not.toBeNull();
    expect(
      await within(dialog).findByText('Este producto ya no está disponible en el menú.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agregar\s*Q53$/ })).toBeDisabled();
  });
});
