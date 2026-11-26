import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { ProductsScreen } from './components/ProductsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

const renderScreen = (
  ui: ReactElement,
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
  prepareStore?: Parameters<typeof renderBackoffice>[1] extends infer O
    ? O extends { prepareStore?: infer P }
      ? P
      : never
    : never,
) => renderBackoffice(<BackofficeShell>{ui}</BackofficeShell>, { role, scenario, prepareStore });

const card = (name: string) => screen.getByText(name).closest('.pcard') as HTMLElement;

async function openNew() {
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
  return screen.findByRole('dialog', { name: 'Nuevo producto' });
}

describe('Productos F11: lista del servidor y permisos', () => {
  it('administrador: lista paginada (20 por página), acciones y precios en GTQ', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    expect(await screen.findByText('Dumplings')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar Dumplings' })).toBeEnabled();
    expect(screen.getByText('31 productos')).toBeVisible();
    expect(screen.getByText('Página 1 de 2 · 31 productos')).toBeVisible();
    expect(within(card('Dumplings')).getByText('Q53.00')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2 · 31 productos')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('muestra publiclyVisible y el motivo: inactivo y categoría oculta', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'gyoza');
    expect(await screen.findByText('Gyoza Vegetal')).toBeVisible();
    expect(within(card('Gyoza Vegetal')).getByText('Inactivo')).toBeVisible();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar producto' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'edición');
    expect(await screen.findByText('Roll Edición Limitada')).toBeVisible();
    expect(
      within(card('Roll Edición Limitada')).getByText('Oculto: categoría oculta'),
    ).toBeVisible();
  });

  it('el encargado: solo lectura con aviso, sin alta ni edición; marca agotado en SU sucursal desde «Sucursales»', async () => {
    await renderScreen(<ProductsScreen />, 'manager');
    expect(await screen.findByText('Dumplings')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Dumplings' })).toBeDisabled();
    expect(screen.getByText('Tienes acceso de solo lectura al catálogo.')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Sucursales de Dumplings: precio y disponibilidad' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Sucursales · Dumplings' });
    const toggle = await within(dialog).findByRole('switch', { name: 'Disponible: Sucursal 1' });
    expect(toggle).toBeEnabled();
    // Sin `catalog.update` el precio queda de solo lectura con aviso (la API devolvería 403).
    expect(within(dialog).getByLabelText('Sucursal 1: precio especial')).toBeDisabled();
    expect(within(dialog).getByText(/No tienes permiso para fijar precios/)).toBeVisible();
    await userEvent.click(toggle);
    expect(await screen.findByText('Sucursal 1 marcado como agotado')).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('switch', { name: 'Disponible: Sucursal 1' }),
      ).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('con permiso de escritura pero solo por sucursal: aviso de alcance y acciones deshabilitadas', async () => {
    await renderScreen(<ProductsScreen />, 'manager', 'default', (store) => {
      const role = store.roles.find((r) => r.code === 'manager')!;
      role.permissions = [...role.permissions, 'catalog.update'];
    });
    await screen.findByText('Dumplings');
    expect(screen.getByText(/necesitas acceso a todas las sucursales/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Editar Dumplings' })).toBeDisabled();
  });

  it('filtros: categoría, estado y búsqueda con debounce; limpia desde el estado vacío', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por categoría' }), [
      'Entradas',
    ]);
    await waitFor(() => expect(screen.queryByText('Joselito Roll')).toBeNull());
    expect(screen.getByText('Dumplings')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Inactivos' }));
    expect(await screen.findByText('Gyoza Vegetal')).toBeVisible();
    expect(screen.queryByText('Dumplings')).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'zzz');
    expect(await screen.findByText('Sin productos')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('Joselito Roll')).toBeVisible();
  });

  it('la vista Tabla conserva los datos y el acceso a «Sucursales»', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Tabla' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Estado' })).toBeVisible();
    expect(within(table).getByText('Q53.00')).toBeVisible();
    expect(
      within(table).getByRole('button', {
        name: 'Sucursales de Dumplings: precio y disponibilidad',
      }),
    ).toBeVisible();
  });

  it('estados: vacío sin catálogo y error con reintento', async () => {
    const { unmount } = await renderScreen(<ProductsScreen />, 'admin', 'empty');
    expect(await screen.findByText('Todavía no hay productos en el catálogo.')).toBeVisible();
    unmount();
    await renderScreen(<ProductsScreen />, 'admin', 'error');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo cargar el catálogo.');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });
});

describe('Productos F11: crear y editar', () => {
  it('valida con aviso por campo y lleva el foco al primer error', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    const dialog = await openNew();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    const name = within(dialog).getByRole('textbox', { name: 'Nombre' });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getAllByRole('alert')[0]).toHaveTextContent(/Escribe un nombre/);
    await userEvent.type(name, 'Roll Mon');
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(within(dialog).getByLabelText(/^Precio/)).toHaveFocus();
    expect(within(dialog).getByText(/precio mayor a Q0\.00/)).toBeVisible();
  });

  it('crea un producto con slug generado y SKU, sin imágenes (la sección «Imágenes» ya se ofrece en el alta) y aparece en la lista', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    const dialog = await openNew();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Roll Mon');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Categoría/ }),
      'Sushi Rolls',
    );
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '48,5');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^SKU/ }), 'rm-1');
    // F14: sin campo de URL; las imágenes se eligen como archivos (ver product-create-media.test.tsx).
    expect(within(dialog).queryByRole('textbox', { name: /URL de la imagen/ })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Imágenes' })).toBeVisible();
    expect(within(dialog).getByText('0/8')).toBeVisible();
    expect(within(dialog).queryByText(/Guarda el producto para poder añadir/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await screen.findByText('Producto «Roll Mon» creado')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), 'roll mon');
    const created = await screen.findByText('Roll Mon');
    const item = created.closest('.pcard') as HTMLElement;
    expect(within(item).getByText('Q48.50')).toBeVisible();
    expect(within(item).getByText('roll-mon', { exact: false })).toBeVisible();
  });

  it('409 por slug: error en el campo sin cerrar el modal', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    const dialog = await openNew();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Otro');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Categoría/ }),
      'Entradas',
    );
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '10');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Slug/ }), 'dumplings');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await within(dialog).findByText('Este slug ya está en uso.')).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: /^Slug/ })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Nuevo producto' })).toBeVisible();
  });

  it('409 por SKU y 422 de categoría se mapean por code', async () => {
    const { api } = await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    // Un SKU ya usado (creado «desde otra sesión») y una URL http: la validación local la detiene antes.
    api().store.products[0]!.sku = 'DUP-1';
    const dialog = await openNew();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Otro');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /^Categoría/ }),
      'Entradas',
    );
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '10');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^SKU/ }), 'dup-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await within(dialog).findByText('Este SKU ya está en uso.')).toBeVisible();

    await userEvent.clear(within(dialog).getByRole('textbox', { name: /^SKU/ }));

    // Categoría desactivada «en otra sesión» tras abrir el modal: 422 PRODUCT_CATEGORY_INVALID.
    api().store.menuCategories.find((c) => c.slug === 'entradas')!.active = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(
      await within(dialog).findByText(/La categoría ya no existe o está desactivada/),
    ).toBeVisible();
  });

  it('503 PRODUCTS_BUSY: mensaje fijo reintentable; el segundo intento guarda', async () => {
    await renderScreen(<ProductsScreen />, 'admin', 'default', (store) => {
      store.productsBusy = 1;
    });
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Dumplings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
    const price = within(dialog).getByLabelText(/^Precio/);
    await userEvent.clear(price);
    await userEvent.type(price, '60');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(
      await within(dialog).findByText('Hay otra edición en curso. Espera un momento y reintenta.'),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await screen.findByText('Producto «Dumplings» actualizado')).toBeVisible();
    await waitFor(() => expect(within(card('Dumplings')).getByText('Q60.00')).toBeVisible());
  });

  it('403 del servidor (permiso revocado tras abrir) se muestra sin cerrar el modal', async () => {
    const { api } = await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Dumplings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
    const role = api().store.roles.find((r) => r.code === 'admin')!;
    role.permissions = role.permissions.filter((p) => p !== 'catalog.update');
    await userEvent.clear(within(dialog).getByLabelText(/^Precio/));
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '61');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(
      await within(dialog).findByText(/No tienes permiso para modificar productos/),
    ).toBeVisible();
  });

  it('editar sin cambios avisa y no envía; editar el precio actualiza la tarjeta', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Editar Dumplings' }));
    let dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
    expect(within(dialog).getByRole('textbox', { name: 'Nombre' })).toHaveValue('Dumplings');
    expect(within(dialog).getByLabelText(/^Precio/)).toHaveValue('53.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await screen.findByText('No hay cambios que guardar')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Editar Dumplings' }));
    dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
    await userEvent.clear(within(dialog).getByLabelText(/^Precio/));
    await userEvent.type(within(dialog).getByLabelText(/^Precio/), '60');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    expect(await screen.findByText('Producto «Dumplings» actualizado')).toBeVisible();
    await waitFor(() => expect(within(card('Dumplings')).getByText('Q60.00')).toBeVisible());
  });
});

describe('Productos F11: activar y desactivar', () => {
  it('desactiva con confirmación y vuelve a activar; el estado se refleja', async () => {
    await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar Dumplings' }));
    const confirm = await screen.findByRole('dialog', { name: '¿Desactivar Dumplings?' });
    expect(confirm).toHaveTextContent('dejará de verse en la tienda');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('Dumplings desactivado')).toBeVisible();
    await waitFor(() => expect(within(card('Dumplings')).getByText('Inactivo')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: 'Activar Dumplings' }));
    const again = await screen.findByRole('dialog', { name: '¿Activar Dumplings?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Activar' }));
    expect(await screen.findByText('Dumplings activado')).toBeVisible();
  });

  it('un error al desactivar (404/409/503) se muestra en la confirmación sin cerrarla', async () => {
    const { api } = await renderScreen(<ProductsScreen />, 'admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar Dumplings' }));
    const confirm = await screen.findByRole('dialog', { name: '¿Desactivar Dumplings?' });
    api().store.productsBusy = 1;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Desactivar' }));
    expect(
      await within(confirm).findByText('Hay otra edición en curso. Espera un momento y reintenta.'),
    ).toBeVisible();
  });
});
