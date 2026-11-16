import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { PublicModifierGroup } from '@/lib/data-access/models';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import { renderStore } from '@/test/store-providers';
import { useModifierSelection, estimatedUnitCents } from '../modifier-selection';
import { useProducts } from '../hooks';
import { useProductSheet } from '../product-sheet-context';
import { ProductSheet, ProductSheetHost, type SheetAddPayload } from './product-sheet-host';

function Opener({ id }: { id: string }) {
  const { openProduct } = useProductSheet();
  return (
    <>
      <button type="button" onClick={() => openProduct(id)}>
        abrir
      </button>
      <ProductSheetHost />
    </>
  );
}

/** Monta la ficha DIRECTAMENTE con `onAdd` para observar la selección estructurada que recibirá F18. */
function DirectSheet({ id, onAdd }: { id: string; onAdd: (p: SheetAddPayload) => void }) {
  const products = useProducts();
  const product = products.data?.find((p) => p.id === id);
  if (!product) return null;
  return (
    <ProductSheet
      product={product}
      catalog={products.data ?? []}
      onClose={() => {}}
      onAdd={onAdd}
    />
  );
}

async function openSheet(id: string, options: Parameters<typeof renderStore>[1] = {}) {
  const view = await renderStore(<Opener id={id} />, options);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
  const dialog = await screen.findByRole('dialog');
  return { view, dialog };
}

const addButton = () => screen.getByRole('button', { name: /^Agregar\s*Q/ });

describe('Ficha pública F12: selector de extras', () => {
  it('sin grupos (Dumplings) no muestra selector ni totales de extras', async () => {
    const { dialog } = await openSheet('dumplings');
    await waitFor(() => expect(addButton()).toBeEnabled());
    expect(within(dialog).queryByText('Extras estimados (por unidad)')).toBeNull();
    expect(within(dialog).queryByRole('group', { name: /Extras|Salsa/ })).toBeNull();
    expect(within(dialog).queryByText('Obligatorio')).toBeNull();
  });

  it('grupo opcional con tope: muestra regla, «+Q5.00», casillas y total estimado en céntimos', async () => {
    const { dialog } = await openSheet('california-roll');
    const extras = await within(dialog).findByRole('group', { name: /Extras/ });
    expect(within(extras).getByText('Opcional')).toBeVisible();
    expect(within(extras).getByText('Elige hasta 3')).toBeVisible();
    const queso = within(extras).getByRole('checkbox', { name: /Queso crema/ });
    expect(queso).not.toBeChecked();
    expect(within(extras).getByText('+Q5.00')).toBeVisible();
    expect(within(extras).getByText('+Q4.00')).toBeVisible();
    expect(within(extras).getByText('+Q3.00')).toBeVisible();
    // Opción inactiva en el servidor: no se ofrece.
    expect(within(extras).queryByText(/Crunch de tempura/)).toBeNull();
    expect(addButton()).toBeEnabled();
    fireEvent.click(queso);
    fireEvent.click(within(extras).getByRole('checkbox', { name: /Aguacate/ }));
    expect(within(dialog).getByText('+Q9.00')).toBeVisible();
    // California Roll = Q57.00 base → Q66.00 estimado por unidad.
    expect(within(dialog).getByText('Q66.00')).toBeVisible();
    expect(within(dialog).getByText(/el servidor recalcula el precio/)).toBeVisible();
    // Se puede cambiar de opinión.
    fireEvent.click(queso);
    expect(within(dialog).getByText('+Q4.00', { selector: 'dd' })).toBeVisible();
    expect(within(dialog).getByText('Q61.00')).toBeVisible();
    expect(within(extras).getByText('1 de 3 elegidas')).toBeVisible();
  });

  it('con tope alcanzado (max 3) deshabilita las casillas no marcadas y avisa; al quitar una se rehabilita', async () => {
    const { dialog } = await openSheet('sushi-pizza', {
      prepareStore: (store) => {
        const extras = store.modifierGroups.find((g) => g.id === 'mgroup-extras')!;
        extras.maxSelect = 2;
      },
    });
    const extras = await within(dialog).findByRole('group', { name: /Extras/ });
    const [queso, aguacate, salsa] = ['Queso crema', 'Aguacate', 'Salsa extra'].map((n) =>
      within(extras).getByRole('checkbox', { name: new RegExp(n) }),
    );
    fireEvent.click(queso!);
    fireEvent.click(aguacate!);
    expect(salsa).toBeDisabled();
    expect(within(extras).getByText(/Máximo alcanzado/)).toBeVisible();
    fireEvent.click(aguacate!);
    expect(salsa).toBeEnabled();
  });

  it('grupo obligatorio (radio): agregar deshabilitado hasta elegir; mensaje accesible en vivo; reemplaza la elección', async () => {
    const { dialog } = await openSheet('sushi-pizza');
    const salsa = await within(dialog).findByRole('group', { name: /Salsa/ });
    expect(within(salsa).getByText('Obligatorio')).toBeVisible();
    expect(within(salsa).getByText('Elige 1')).toBeVisible();
    const radios = within(salsa).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(addButton()).toBeDisabled();
    const live = within(salsa).getByRole('status');
    expect(live).toHaveTextContent('Elige al menos 1 opción en «Salsa».');
    expect(
      within(dialog).getByText('Completa los grupos obligatorios para agregar al pedido.'),
    ).toBeVisible();
    fireEvent.click(within(salsa).getByRole('radio', { name: /Mayo spicy/ }));
    expect(addButton()).toBeEnabled();
    expect(live).not.toHaveTextContent('Elige al menos');
    fireEvent.click(within(salsa).getByRole('radio', { name: /Ponzu/ }));
    expect(within(salsa).getByRole('radio', { name: /Ponzu/ })).toBeChecked();
    expect(within(salsa).getByRole('radio', { name: /Mayo spicy/ })).not.toBeChecked();
  });

  it('grupo opcional de elección única ofrece «Ninguno» para deshacer', async () => {
    const { dialog } = await openSheet('dumplings', {
      prepareStore: (store) => {
        store.modifierGroups.push({
          id: 'mgroup-opt1',
          name: 'Picante',
          minSelect: 0,
          maxSelect: 1,
          active: true,
          createdAt: '2026-11-01T12:00:00.000Z',
          updatedAt: '2026-11-01T12:00:00.000Z',
        });
        store.modifiers.push({
          id: 'mopt-p1',
          groupId: 'mgroup-opt1',
          name: 'Picante',
          extraPrice: '1.00',
          active: true,
          sortOrder: 0,
          createdAt: '2026-11-01T12:00:00.000Z',
          updatedAt: '2026-11-01T12:00:00.000Z',
        });
        store.productModifierGroups.dumplings = ['mgroup-opt1'];
      },
    });
    const group = await within(dialog).findByRole('group', { name: /Picante/ });
    expect(within(group).getByText('Elige hasta 1')).toBeVisible();
    const none = within(group).getByRole('radio', { name: /Ninguno/ });
    expect(none).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: /Picante/ }));
    expect(within(dialog).getByText('+Q1.00', { selector: 'dd' })).toBeVisible();
    fireEvent.click(none);
    expect(within(dialog).getByText('+Q0.00', { selector: 'dd' })).toBeVisible();
  });

  it('agregar con el flujo actual (carrito mock): agrega el producto base y avisa que el carrito aún no lleva extras', async () => {
    const { view, dialog } = await openSheet('sushi-pizza');
    const salsa = await within(dialog).findByRole('group', { name: /Salsa/ });
    fireEvent.click(within(salsa).getByRole('radio', { name: /Ponzu/ }));
    expect(
      within(dialog).getByText(/El carrito de esta versión aún no incluye extras/),
    ).toBeVisible();
    fireEvent.click(addButton());
    expect(view.api().cart.lines).toEqual([{ productId: 'sushi-pizza', quantity: 1, note: '' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('onAdd recibe la selección ESTRUCTURADA {groupId, modifierIds[]} (solo grupos con elección)', async () => {
    const onAdd = vi.fn();
    await renderStore(<DirectSheet id="sushi-pizza" onAdd={onAdd} />);
    const dialog = await screen.findByRole('dialog');
    const salsa = await within(dialog).findByRole('group', { name: /Salsa/ });
    fireEvent.click(within(salsa).getByRole('radio', { name: /Salsa de anguila/ }));
    const extras = within(dialog).getByRole('group', { name: /Extras/ });
    fireEvent.click(within(extras).getByRole('checkbox', { name: /Salsa extra/ }));
    fireEvent.click(within(extras).getByRole('checkbox', { name: /Queso crema/ }));
    fireEvent.click(addButton());
    expect(onAdd).toHaveBeenCalledWith({
      productId: 'sushi-pizza',
      quantity: 1,
      note: '',
      modifiers: [
        { groupId: 'mgroup-salsa', modifierIds: ['mopt-anguila'] },
        { groupId: 'mgroup-extras', modifierIds: ['mopt-salsa-extra', 'mopt-queso-crema'] },
      ],
    });
  });

  it('error al cargar la ficha (no 404): avisa, ofrece reintentar y no deja agregar a ciegas', async () => {
    // La ficha reintenta 2 veces los errores que no son 404: hacen falta 3 fallos seguidos para que se vea el error.
    let failures = 3;
    const { dialog } = await openSheet('sushi-pizza', {
      wrapClient: (base) =>
        withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
          if (/^\/v1\/store\/products\/sushi-pizza$/.test(path) && failures-- > 0) {
            throw new ApiError(500, 'server_error', 'Error del servidor');
          }
          return base.request<T>(path, options);
        }),
    });
    expect(
      await within(dialog).findByText(/No se pudieron cargar los extras de este producto/),
    ).toBeVisible();
    expect(addButton()).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reintentar' }));
    expect(await within(dialog).findByRole('group', { name: /Salsa/ })).toBeVisible();
    expect(within(dialog).queryByText(/No se pudieron cargar los extras/)).toBeNull();
  }, 15_000);

  it('en inglés: etiquetas, regla y mensajes traducidos', async () => {
    const { dialog } = await openSheet('sushi-pizza', { locale: 'en' });
    const salsa = await within(dialog).findByRole('group', { name: /Salsa/ });
    expect(within(salsa).getByText('Required')).toBeVisible();
    expect(within(salsa).getByText('Choose 1')).toBeVisible();
    expect(within(salsa).getByRole('status')).toHaveTextContent(
      'Choose at least 1 option in “Salsa”.',
    );
    const extras = within(dialog).getByRole('group', { name: /Extras/ });
    expect(within(extras).getByText('Choose up to 3')).toBeVisible();
    expect(within(salsa).getAllByText('Included')).toHaveLength(3);
  });
});

describe('useModifierSelection (selección estructurada para F18)', () => {
  const group = (
    id: string,
    min: number,
    max: number,
    ids: [string, string][],
  ): PublicModifierGroup => ({
    id,
    name: id,
    minSelect: min,
    maxSelect: max,
    required: min >= 1,
    options: ids.map(([oid, price]) => ({ id: oid, name: oid, extraPrice: price })),
  });
  const groups = [
    group('g1', 1, 1, [
      ['a', '0.00'],
      ['b', '1.10'],
    ]),
    group('g2', 0, 2, [
      ['x', '0.10'],
      ['y', '0.20'],
      ['z', '0.30'],
    ]),
  ];

  it('radio reemplaza, casillas respetan el tope y la suma es exacta en céntimos', () => {
    const { result } = renderHook(() => useModifierSelection(groups));
    expect(result.current.valid).toBe(false);
    expect(result.current.issueOf(groups[0]!)).toEqual({ kind: 'required', min: 1, chosen: 0 });
    act(() => result.current.toggle(groups[0]!, 'a'));
    act(() => result.current.toggle(groups[0]!, 'b'));
    expect(result.current.chosen.g1).toEqual(['b']);
    act(() => result.current.toggle(groups[1]!, 'x'));
    act(() => result.current.toggle(groups[1]!, 'y'));
    act(() => result.current.toggle(groups[1]!, 'z')); // tope 2: se ignora
    expect(result.current.chosen.g2).toEqual(['x', 'y']);
    expect(result.current.valid).toBe(true);
    expect(result.current.extraCents).toBe(140); // 1.10 + 0.10 + 0.20, sin 0.30000000000000004
    expect(result.current.selections).toEqual([
      { groupId: 'g1', modifierIds: ['b'] },
      { groupId: 'g2', modifierIds: ['x', 'y'] },
    ]);
    act(() => result.current.clearGroup('g2'));
    expect(result.current.selections).toEqual([{ groupId: 'g1', modifierIds: ['b'] }]);
    act(() => result.current.reset());
    expect(result.current.selections).toEqual([]);
  });

  it('ignora ids que ya no existen tras un refresco de los grupos', () => {
    const { result, rerender } = renderHook(({ g }) => useModifierSelection(g), {
      initialProps: { g: groups },
    });
    act(() => result.current.toggle(groups[0]!, 'b'));
    rerender({ g: [group('g1', 1, 1, [['a', '0.00']])] });
    expect(result.current.chosen.g1).toEqual([]);
    expect(result.current.valid).toBe(false);
  });

  it('precio estimado = base + extras en céntimos', () => {
    expect(estimatedUnitCents('57.00', 900)).toBe(6600);
    expect(estimatedUnitCents('abc', 100)).toBeNull();
  });
});
