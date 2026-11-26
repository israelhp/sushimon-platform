import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { useProductSheet } from '../product-sheet-context';
import { useProducts } from '../hooks';
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

function Row({ id }: { id: string }) {
  const products = useProducts();
  const sheet = useProductSheet();
  const product = products.data?.find((p) => p.id === id);
  return (
    <>
      <output data-testid="sheet">{sheet.productId ?? ''}</output>
      {product ? (
        <ProductCard product={product} catalog={products.data ?? []} variant="row" />
      ) : null}
    </>
  );
}

describe('ProductCard · agregar con extras (F18)', () => {
  it('sin extras agrega 1 directo; con grupos de extras abre la ficha y NO agrega', async () => {
    const user = userEvent.setup();
    const view = await renderStore(
      <>
        <Row id="dumplings" />
        <Row id="sushi-pizza" />
      </>,
      { branchId: 'sucursal-1' },
    );
    await user.click(await screen.findByRole('button', { name: 'Agregar Dumplings a tu pedido' }));
    await waitFor(() => expect(view.api().cart.quantityOf('dumplings')).toBe(1));
    await user.click(
      await screen.findByRole('button', { name: 'Agregar Sushi Pizza a tu pedido' }),
    );
    await waitFor(() => expect(screen.getAllByTestId('sheet')[1]).toHaveTextContent('sushi-pizza'));
    expect(view.api().cart.quantityOf('sushi-pizza')).toBe(0);
  });

  it('sin sucursal elegida no agrega: abre la hoja de modo de pedido', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Row id="dumplings" />);
    await user.click(await screen.findByRole('button', { name: 'Agregar Dumplings a tu pedido' }));
    await waitFor(() => expect(view.api().shell.orderSheet).toBe(true));
    expect(view.api().cart.count).toBe(0);
  });

  it('el «+» del control de cantidad incrementa la línea existente y avisa al llegar a 99', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Row id="dumplings" />, { branchId: 'sucursal-1' });
    await screen.findByRole('button', { name: 'Agregar Dumplings a tu pedido' });
    await act(async () => {
      view.api().cart.add(cartInput('dumplings', 98));
    });
    const plus = await screen.findByRole('button', { name: 'Agregar uno de Dumplings' });
    await user.click(plus);
    expect(view.api().cart.quantityOf('dumplings')).toBe(99);
    await user.click(plus);
    expect(view.api().cart.quantityOf('dumplings')).toBe(99);
    expect(await screen.findByText(/Máximo 99 unidades/)).toBeInTheDocument();
  });
});

describe('ProductCard · varias configuraciones y «Deshacer» (U5)', () => {
  const pizza = (sauce: string) =>
    cartInput('sushi-pizza', 1, '', {
      unitCents: 7200,
      selections: [{ groupId: 'mgroup-salsa', optionId: sauce, quantity: 1 }],
      options: [
        {
          groupId: 'mgroup-salsa',
          optionId: sauce,
          groupName: 'Salsa',
          optionName: sauce,
          extraCents: 0,
        },
      ],
    });

  it('con extras o varias líneas NO muestra un ± ambiguo: «En tu pedido: N» abre el pedido y «+» agrega otra configuración', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Row id="sushi-pizza" />, { branchId: 'sucursal-1' });
    await act(async () => view.api().cart.add([pizza('mopt-ponzu'), pizza('mopt-mayo-spicy')]));
    expect(screen.queryByRole('button', { name: /Quitar uno de/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /En tu pedido: 2/ }));
    expect(view.api().shell.cartOpen).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Agregar Sushi Pizza a tu pedido' }));
    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveTextContent('sushi-pizza'));
    expect(view.api().cart.count).toBe(2);
  });

  it('«−» desde 1 quita la línea con «Deshacer»', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<Row id="dumplings" />, { branchId: 'sucursal-1' });
    await act(async () => view.api().cart.add(cartInput('dumplings', 1)));
    await user.click(await screen.findByRole('button', { name: 'Quitar uno de Dumplings' }));
    expect(view.api().cart.count).toBe(0);
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(view.api().cart.count).toBe(1);
  });
});
