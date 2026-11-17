import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { useProductSheet } from '../product-sheet-context';
import { ProductSheetHost } from './product-sheet-host';

function Opener({ id, slug }: { id: string; slug?: string | null }) {
  const { openProduct } = useProductSheet();
  return (
    <>
      <button type="button" onClick={() => openProduct(id, slug)}>
        abrir
      </button>
      <ProductSheetHost />
    </>
  );
}

describe('ProductSheetHost · carga perezosa por slug (F17)', () => {
  it('cerrada no pide NADA (ni menú ni ficha): antes cargaba el catálogo completo en cada página', async () => {
    const spy = createSpyClient();
    await renderStore(<Opener id="dumplings" slug="dumplings" />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await act(async () => {});
    expect(spy.calls.filter((c) => c.path.startsWith('/v1/store'))).toEqual([]);
  });

  it('con slug (de la tarjeta): UNA ficha con la sucursal; el menú NO se carga', async () => {
    const spy = createSpyClient();
    await renderStore(<Opener id="dumplings" slug="dumplings" />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dumplings' });
    expect(within(dialog).getByText('Q53', { selector: 'p' })).toBeInTheDocument();
    expect(spy.calls.filter((c) => c.path.startsWith('/v1/store')).map((c) => c.path)).toEqual([
      '/v1/store/products/dumplings',
    ]);
    expect(spy.calls.at(-1)?.query).toMatchObject({ branchId: 'sucursal-1' });
  });

  it('sin slug (p. ej. el carrusel solo conoce el id): el menú se carga solo ahora, una vez, y luego la ficha', async () => {
    const spy = createSpyClient();
    await renderStore(<Opener id="dumplings" />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await act(async () => {});
    expect(spy.count('GET', /store\/menu/)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    await screen.findByRole('dialog', { name: 'Dumplings' });
    await waitFor(() => expect(spy.count('GET', /store\/products\/dumplings/)).toBe(1));
    expect(spy.count('GET', /^\/v1\/store\/menu$/)).toBe(1);
  });

  it('muestra el precio y la disponibilidad de ESA sucursal tomados de la respuesta (oferta)', async () => {
    await renderStore(<Opener id="dynamita-roll" slug="dynamita-roll" />, {
      branchId: 'sucursal-2',
    });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dynamita Roll' });
    expect(within(dialog).getByText('Q86', { selector: 'p' })).toBeInTheDocument();
  });

  it('agotado en la sucursal: aviso y no se puede agregar', async () => {
    await renderStore(<Opener id="gaseosas" slug="gaseosas" />, { branchId: 'sucursal-2' });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gaseosas' });
    await within(dialog).findByText(/no está disponible por ahora/);
    expect(screen.getByRole('button', { name: /^Agregar\s*Q/ })).toBeDisabled();
  });

  it('muestra la promoción pública indicativa de la respuesta (sin recalcularla)', async () => {
    await renderStore(<Opener id="gaseosas" slug="gaseosas" />, { branchId: 'sucursal-1' });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gaseosas' });
    expect(await within(dialog).findByText(/Promoción:/)).toBeVisible();
    expect(within(dialog).getByText(/Precio promocional indicativo/)).toBeVisible();
  });

  it('404 (producto o sucursal inexistente) sin nada en caché: diálogo con el mensaje propio (goneNote), no el error de red', async () => {
    await renderStore(<Opener id="x" slug="no-existe" />, { branchId: 'sucursal-1' });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    await screen.findByRole('dialog');
    expect(
      await screen.findByRole('dialog', {
        name: 'Este producto ya no está disponible en el menú.',
      }),
    ).toBeVisible();
    expect(screen.queryByText(/No pudimos abrir este producto/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('error de red: mensaje distinto con «Reintentar»; al reintentar se abre la ficha', async () => {
    let failures = 1;
    await renderStore(<Opener id="dumplings" slug="dumplings" />, {
      branchId: 'sucursal-1',
      wrapClient: (base) =>
        withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
          if (path === '/v1/store/products/dumplings' && failures-- > 0) {
            throw new ApiError(0, 'offline', 'sin conexión');
          }
          return base.request<T>(path, options);
        }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    expect(
      await screen.findByRole('dialog', {
        name: /No hay conexión: no pudimos cargar este producto/,
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('dialog', { name: 'Dumplings' })).toBeVisible();
  });

  it('abre el diálogo YA con esqueleto aria-busy y estado de carga anunciable; luego muestra la ficha', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /^\/v1\/store\/products\/dumplings$/);
    await renderStore(<Opener id="dumplings" slug="dumplings" />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cargando producto…' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Cargando producto…');
    await act(async () => gate.release());
    expect(await screen.findByRole('dialog', { name: 'Dumplings' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('con la tarjeta de origen pinta nombre y precio al instante, antes de que llegue el detalle', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /^\/v1\/store\/products\/dumplings$/);
    function WithSeed() {
      const { openProduct } = useProductSheet();
      return (
        <>
          <button
            type="button"
            onClick={() =>
              openProduct('dumplings', 'dumplings', {
                id: 'dumplings',
                name: 'Dumplings',
                description: 'Resumen',
                price: 53,
                categoryId: 'c',
                illustration: 'roll',
                featured: false,
                food: true,
                available: true,
                availability: [],
              })
            }
          >
            abrir-con-tarjeta
          </button>
          <ProductSheetHost />
        </>
      );
    }
    await renderStore(<WithSeed />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    fireEvent.click(screen.getByRole('button', { name: 'abrir-con-tarjeta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dumplings' });
    expect(within(dialog).getByText('Q53', { selector: 'p' })).toBeVisible();
    await act(async () => gate.release());
  });

  it('el total de «Agregar» es el mismo que el estimado del resumen con extras (un solo total)', async () => {
    await renderStore(<Opener id="sushi-pizza" slug="sushi-pizza" />, { branchId: 'sucursal-1' });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sushi Pizza' });
    await within(dialog).findByRole('group', { name: /Salsa/ });
    const estimated = within(dialog).getByText('Precio estimado por unidad').nextElementSibling;
    const add = within(dialog).getByRole('button', { name: /^Agregar\s*Q/ });
    const amount = (text: string | null | undefined) =>
      Number((text ?? '').replace(/[^0-9.]/g, ''));
    expect(amount(add.textContent)).toBe(amount(estimated?.textContent));
    expect(amount(add.textContent)).toBeGreaterThan(0);
  });

  it('cambiar de sucursal con la ficha abierta la cierra (no queda un precio de la sucursal anterior)', async () => {
    const view = await renderStore(<Opener id="dynamita-roll" slug="dynamita-roll" />, {
      branchId: 'sucursal-1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    await screen.findByRole('dialog', { name: 'Dynamita Roll' });
    await act(async () => view.api().mode.update({ branchId: 'sucursal-2' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
