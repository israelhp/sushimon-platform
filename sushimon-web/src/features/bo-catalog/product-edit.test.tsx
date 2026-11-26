import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import * as products from '@/services/products';
import { ProductsScreen } from './components/ProductsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

const renderScreen = (role: StaffRole = 'admin') =>
  renderBackoffice(
    <BackofficeShell>
      <ProductsScreen />
    </BackofficeShell>,
    { role },
  );

const card = (name: string) => screen.getByText(name).closest('.pcard') as HTMLElement;
const stored = (api: () => { store: { products: { id: string }[] } }, id: string) =>
  api().store.products.find((p) => p.id === id) as unknown as Record<string, unknown>;

async function openEdit(name = 'Dumplings') {
  await screen.findByText(name);
  await userEvent.click(screen.getByRole('button', { name: `Editar ${name}` }));
  return screen.findByRole('dialog', { name: 'Editar producto' });
}
const save = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Guardar producto' });

async function replace(el: HTMLElement, text: string) {
  await userEvent.clear(el);
  if (text) await userEvent.type(el, text);
}

describe('Editar la información de un producto (F11)', () => {
  it('cambia nombre, slug, SKU, categoría, precio, descripción y estado; la lista y la tienda lo reflejan', async () => {
    const { api } = await renderScreen();
    const dialog = await openEdit();
    await replace(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Dumplings Premium');
    await replace(within(dialog).getByRole('textbox', { name: /^Slug/ }), 'dumplings-premium');
    await replace(within(dialog).getByRole('textbox', { name: /^SKU/ }), 'dmp-9');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Categoría/ }),
      'Sushi Rolls',
    );
    await replace(within(dialog).getByLabelText(/^Precio/), '70,5');
    await replace(within(dialog).getByRole('textbox', { name: 'Descripción' }), 'Nueva receta');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Activo/ }));
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Dumplings Premium» actualizado')).toBeVisible();

    expect(stored(api, 'dumplings')).toMatchObject({
      name: 'Dumplings Premium',
      slug: 'dumplings-premium',
      sku: 'DMP-9',
      description: 'Nueva receta',
      basePrice: '70.50',
      active: false,
    });
    const item = await waitFor(() => card('Dumplings Premium'));
    expect(within(item).getByText('Q70.50')).toBeVisible();
    expect(within(item).getByText('Inactivo')).toBeVisible();
    // La tienda (consulta pública) ya no lo ofrece: el catálogo público se invalidó.
    const pub = await products.listStoreProducts(api().client, { q: 'dumplings' });
    expect(pub.items.map((p) => p.name)).not.toContain('Dumplings Premium');
  });

  it('vaciar el SKU y la descripción los borra (null) y la lista conserva el resto', async () => {
    const { api } = await renderScreen();
    let dialog = await openEdit();
    await replace(within(dialog).getByRole('textbox', { name: /^SKU/ }), 'tmp-1');
    await replace(within(dialog).getByRole('textbox', { name: 'Descripción' }), 'Algo');
    await userEvent.click(save(dialog));
    await screen.findByText('Producto «Dumplings» actualizado');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored(api, 'dumplings')).toMatchObject({ sku: 'TMP-1', description: 'Algo' });

    dialog = await openEdit();
    expect(within(dialog).getByRole('textbox', { name: /^SKU/ })).toHaveValue('TMP-1');
    await replace(within(dialog).getByRole('textbox', { name: /^SKU/ }), '');
    await replace(within(dialog).getByRole('textbox', { name: 'Descripción' }), '');
    await userEvent.click(save(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(stored(api, 'dumplings')).toMatchObject({ sku: null, description: null });
    expect(within(card('Dumplings')).getByText('Q53.00')).toBeVisible();
  });

  it('un producto inactivo se puede reactivar desde el editor', async () => {
    const { api } = await renderScreen();
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Inactivos' }));
    const dialog = await openEdit('Gyoza Vegetal');
    const active = within(dialog).getByRole('checkbox', { name: /^Activo/ });
    expect(active).not.toBeChecked();
    await userEvent.click(active);
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Gyoza Vegetal» actualizado')).toBeVisible();
    expect(api().store.products.find((p) => p.name === 'Gyoza Vegetal')!.active).toBe(true);
  });

  it('si el cambio saca al producto del filtro de la lista, igual avisa y cierra', async () => {
    const { api } = await renderScreen();
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Activos' }));
    const dialog = await openEdit();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Activo/ }));
    await userEvent.click(save(dialog));
    expect(await screen.findByText('Producto «Dumplings» actualizado')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByText('Dumplings')).toBeNull());
    expect(api().store.products.find((p) => p.id === 'dumplings')!.active).toBe(false);
  });

  it('409 por slug o SKU al editar: error en el campo, el modal sigue abierto y no cambia nada', async () => {
    const { api } = await renderScreen();
    const dialog = await openEdit();
    await replace(within(dialog).getByRole('textbox', { name: /^Slug/ }), 'joselito-roll');
    await userEvent.click(save(dialog));
    expect(await within(dialog).findByText('Este slug ya está en uso.')).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: /^Slug/ })).toHaveFocus();
    await replace(within(dialog).getByRole('textbox', { name: /^Slug/ }), 'dumplings');

    api().store.products.find((p) => p.id !== 'dumplings')!.sku = 'OTRO-1';
    await replace(within(dialog).getByRole('textbox', { name: /^SKU/ }), 'otro-1');
    await userEvent.click(save(dialog));
    expect(await within(dialog).findByText('Este SKU ya está en uso.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Editar producto' })).toBeVisible();
    expect(stored(api, 'dumplings')).toMatchObject({ slug: 'dumplings', sku: null });
  });

  it('422 de categoría inválida (desactivada tras abrir): mensaje y se recargan las categorías', async () => {
    const { api } = await renderScreen();
    const dialog = await openEdit();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Categoría/ }),
      'Sushi Rolls',
    );
    api().store.menuCategories.find((c) => c.name === 'Sushi Rolls')!.active = false;
    await userEvent.click(save(dialog));
    expect(
      await within(dialog).findByText(/La categoría ya no existe o está desactivada/),
    ).toBeVisible();
    expect(within(dialog).getByRole('combobox', { name: /^Categoría/ })).toHaveFocus();
  });

  it('404: el producto desapareció en otra sesión; se avisa y la lista se recarga', async () => {
    const { api } = await renderScreen();
    const dialog = await openEdit();
    api().store.products = api().store.products.filter((p) => p.id !== 'dumplings');
    await replace(within(dialog).getByLabelText(/^Precio/), '61');
    await userEvent.click(save(dialog));
    expect(await screen.findByText(/El producto ya no existe/)).toBeVisible();
    await waitFor(() => expect(screen.queryByText('Dumplings')).toBeNull());
  });

  it('validación local al editar: slug vacío y precio inválido no se envían', async () => {
    const { api } = await renderScreen();
    const dialog = await openEdit();
    await replace(within(dialog).getByRole('textbox', { name: /^Slug/ }), '');
    await userEvent.click(save(dialog));
    expect(within(dialog).getByRole('textbox', { name: /^Slug/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await replace(within(dialog).getByRole('textbox', { name: /^Slug/ }), 'dumplings');
    await replace(within(dialog).getByLabelText(/^Precio/), 'abc');
    await userEvent.click(save(dialog));
    expect(within(dialog).getByLabelText(/^Precio/)).toHaveFocus();
    expect(stored(api, 'dumplings')).toMatchObject({ basePrice: '53.00' });
  });
});
