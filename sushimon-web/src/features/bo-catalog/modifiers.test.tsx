import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { ModifiersScreen } from './components/ModifiersScreen';
import { ProductsScreen } from './components/ProductsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/modificadores'));

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

const row = (name: string) =>
  screen.getByText(name, { selector: '.cell-main' }).closest('.trow') as HTMLElement;
const BUSY = 'Hay otra edición en curso. Espera un momento y reintenta.';

describe('Extras F12: lista de grupos y permisos', () => {
  it('administrador: resumen obligatorio/opcional, regla, conteo de opciones y de productos, estado', async () => {
    await renderScreen(<ModifiersScreen />);
    expect(await screen.findByText('Extras', { selector: '.cell-main' })).toBeVisible();
    expect(
      screen.getByText('3 grupos de extras · globales, compartibles entre productos'),
    ).toBeVisible();
    const extras = row('Extras');
    expect(within(extras).getByText('Opcional')).toBeVisible();
    expect(within(extras).getByText('Elige hasta 3')).toBeVisible();
    expect(within(extras).getByText('3 activas de 4')).toBeVisible();
    expect(within(extras).getByText('3 productos')).toBeVisible();
    const salsa = row('Salsa');
    expect(within(salsa).getByText('Obligatorio')).toBeVisible();
    expect(within(salsa).getByText('Elige 1')).toBeVisible();
    expect(within(salsa).getByText('2 productos')).toBeVisible();
    expect(within(row('Bebida del combo')).getByText('Inactivo')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nuevo grupo' })).toBeEnabled();
  });

  it('el encargado: solo lectura con aviso; ve opciones pero no crea ni edita', async () => {
    await renderScreen(<ModifiersScreen />, 'manager');
    expect(await screen.findByText('Extras', { selector: '.cell-main' })).toBeVisible();
    expect(screen.getByText('Tienes acceso de solo lectura al catálogo.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nuevo grupo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Extras' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desactivar Extras' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Opciones de Extras' }));
    const dialog = await screen.findByRole('dialog', { name: 'Opciones de Extras' });
    expect(await within(dialog).findByText('Queso crema')).toBeVisible();
    expect(within(dialog).getByText(/Solo lectura/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Subir Aguacate' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Agregar' })).toBeDisabled();
  });

  it('permiso de escritura pero solo por sucursal: aviso de alcance y acciones deshabilitadas', async () => {
    await renderScreen(<ModifiersScreen />, 'manager', 'default', (store) => {
      const role = store.roles.find((r) => r.code === 'manager')!;
      role.permissions = [...role.permissions, 'catalog.update'];
    });
    await screen.findByText('Extras', { selector: '.cell-main' });
    expect(screen.getByText(/necesitas acceso a todas las sucursales/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Editar Extras' })).toBeDisabled();
  });

  it('403 del servidor muestra la pantalla de acceso denegado', async () => {
    await renderScreen(<ModifiersScreen />, 'admin', 'forbidden');
    expect(await screen.findByRole('heading', { name: /acceso|permiso/i })).toBeVisible();
  });

  it('búsqueda con debounce, filtro de estado y vacío con limpiar filtros', async () => {
    await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Inactivos' }));
    expect(await screen.findByText('Bebida del combo', { selector: '.cell-main' })).toBeVisible();
    expect(screen.queryByText('Salsa', { selector: '.cell-main' })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar grupo de extras' }), 'zzz');
    expect(await screen.findByText('Sin grupos de extras')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('Salsa', { selector: '.cell-main' })).toBeVisible();
  });

  it('sin grupos (escenario empty): estado vacío', async () => {
    await renderScreen(<ModifiersScreen />, 'admin', 'empty');
    expect(await screen.findByText('Sin grupos de extras')).toBeVisible();
    expect(screen.getByText(/Todavía no hay grupos de extras/)).toBeVisible();
  });
});

describe('Extras F12: crear y editar grupos', () => {
  it('crea un grupo obligatorio con opciones iniciales y aparece en la lista', async () => {
    await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo grupo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo grupo de extras' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Término');
    const min = within(dialog).getByRole('textbox', { name: 'Mínimo a elegir' });
    await userEvent.clear(min);
    await userEvent.type(min, '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar opción' }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Nombre de la opción 1' }),
      'Medio',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar opción' }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Nombre de la opción 2' }),
      'Bien cocido',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Precio extra de la opción 2' }),
      '2,5',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await screen.findByText('Grupo «Término» creado')).toBeVisible();
    const created = await waitFor(() => row('Término'));
    expect(within(created).getByText('Obligatorio')).toBeVisible();
    expect(within(created).getByText('2 activas de 2')).toBeVisible();
  });

  it('valida antes de enviar: nombre, límites incoherentes y mínimo inalcanzable', async () => {
    await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo grupo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo grupo de extras' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await within(dialog).findByText(/Escribe un nombre de 1 a 80/)).toBeVisible();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'Nuevo');
    const min = within(dialog).getByRole('textbox', { name: 'Mínimo a elegir' });
    await userEvent.clear(min);
    await userEvent.type(min, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect((await within(dialog).findAllByText(/0 ≤ mínimo ≤ máximo/)).length).toBeGreaterThan(0);
    const max = within(dialog).getByRole('textbox', { name: 'Máximo a elegir' });
    await userEvent.clear(max);
    await userEvent.type(max, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(
      await within(dialog).findByText(/El mínimo supera las opciones del grupo/),
    ).toBeVisible();
  });

  it('409 por nombre repetido (sin distinguir mayúsculas) se muestra en el campo y no cierra', async () => {
    await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo grupo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo grupo de extras' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre' }), 'EXTRAS');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await within(dialog).findByText('Este nombre ya está en uso.')).toBeVisible();
    expect(
      within(dialog).getByText('Ya existe un grupo con ese nombre. Elige otro.'),
    ).toBeVisible();
  });

  it('edita nombre y límites; 422 por mínimo inalcanzable y 503 MODIFIERS_BUSY reintentable', async () => {
    const { api } = await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Extras' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar grupo de extras' });
    const min = within(dialog).getByRole('textbox', { name: 'Mínimo a elegir' });
    await userEvent.clear(min);
    await userEvent.type(min, '3');
    const max = within(dialog).getByRole('textbox', { name: 'Máximo a elegir' });
    await userEvent.clear(max);
    await userEvent.type(max, '4');
    // Solo hay 3 opciones activas: min 4 inalcanzable (el servidor decide).
    await userEvent.clear(min);
    await userEvent.type(min, '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await within(dialog).findByText(/Los límites no son válidos/)).toBeVisible();
    await userEvent.clear(min);
    await userEvent.type(min, '2');
    api().store.modifiersBusy = 1;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await within(dialog).findByText(BUSY)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await screen.findByText('Grupo «Extras» actualizado')).toBeVisible();
    await waitFor(() => expect(within(row('Extras')).getByText('Obligatorio')).toBeVisible());
    expect(within(row('Extras')).getByText('Elige de 2 a 4')).toBeVisible();
  });

  it('sin cambios: avisa y cierra sin llamar al servidor', async () => {
    await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Salsa' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar grupo de extras' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar grupo' }));
    expect(await screen.findByText('No hay cambios que guardar')).toBeVisible();
  });

  it('desactiva con confirmación (muestra productos afectados) y reactiva', async () => {
    await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar Extras' }));
    const confirm = await screen.findByRole('dialog', { name: '¿Desactivar Extras?' });
    expect(confirm).toHaveTextContent('3 productos lo usan');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('Extras desactivado')).toBeVisible();
    await waitFor(() => expect(within(row('Extras')).getByText('Inactivo')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: 'Activar Extras' }));
    const again = await screen.findByRole('dialog', { name: '¿Activar Extras?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Activar' }));
    expect(await screen.findByText('Extras activado')).toBeVisible();
  });

  it('un error al activar (reactivar sin opciones suficientes, 503) se muestra en la confirmación', async () => {
    const { api } = await renderScreen(<ModifiersScreen />);
    await screen.findByText('Extras', { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: 'Activar Bebida del combo' }));
    const confirm = await screen.findByRole('dialog', { name: '¿Activar Bebida del combo?' });
    api().store.modifiersBusy = 1;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Activar' }));
    expect(await within(confirm).findByText(BUSY)).toBeVisible();
  });
});

describe('Extras F12: opciones de un grupo', () => {
  const openOptions = async (name = 'Extras') => {
    await screen.findByText(name, { selector: '.cell-main' });
    await userEvent.click(screen.getByRole('button', { name: `Opciones de ${name}` }));
    const dialog = await screen.findByRole('dialog', { name: `Opciones de ${name}` });
    await within(dialog).findByRole('list', { name: 'Opciones del grupo' });
    return dialog;
  };

  it('lista opciones con precio extra en GTQ y estado; indica la regla del grupo', async () => {
    await renderScreen(<ModifiersScreen />);
    const dialog = await openOptions();
    expect(within(dialog).getByText('Opcional · Elige hasta 3')).toBeVisible();
    expect(within(dialog).getByText('Precio extra: Q5.00')).toBeVisible();
    expect(within(dialog).getByText('Precio extra: Q4.00')).toBeVisible();
    expect(within(dialog).getByText('Crunch de tempura')).toBeVisible();
    expect(within(dialog).getByText('Inactiva')).toBeVisible();
    expect(within(dialog).getByText('4 de 30 opciones')).toBeVisible();
  });

  it('crea una opción al final con precio decimal; valida precio y detecta nombre repetido (409)', async () => {
    await renderScreen(<ModifiersScreen />);
    const dialog = await openOptions();
    const name = within(dialog).getByRole('textbox', { name: 'Nombre de la nueva opción' });
    const price = within(dialog).getByRole('textbox', { name: 'Precio extra de la nueva opción' });
    await userEvent.type(name, 'Jalapeño');
    await userEvent.type(price, '12.345');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(
      await within(dialog).findByText(/Escribe un precio extra de Q0.00 a Q9,999.99/),
    ).toBeVisible();
    await userEvent.clear(price);
    await userEvent.type(price, '1,5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('Opción «Jalapeño» creada')).toBeVisible();
    expect(await within(dialog).findByText('Precio extra: Q1.50')).toBeVisible();
    await userEvent.type(name, 'AGUACATE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(
      await within(dialog).findByText('Este nombre ya está en uso en el grupo.'),
    ).toBeVisible();
  });

  it('edita nombre y precio extra en línea', async () => {
    await renderScreen(<ModifiersScreen />);
    const dialog = await openOptions();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Editar Queso crema' }));
    const nameInput = within(dialog).getByRole('textbox', { name: 'Nombre de Queso crema' });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Queso crema doble');
    const priceInput = within(dialog).getByRole('textbox', { name: 'Precio extra de Queso crema' });
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '7.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Opción «Queso crema doble» actualizada')).toBeVisible();
    expect(await within(dialog).findByText('Precio extra: Q7.50')).toBeVisible();
  });

  it('activa y desactiva; 422 MODIFIER_GROUP_UNSATISFIABLE con mensaje claro', async () => {
    await renderScreen(<ModifiersScreen />);
    const dialog = await openOptions('Salsa');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Desactivar la opción Salsa de anguila' }),
    );
    expect(await screen.findByText('Salsa de anguila desactivada')).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Desactivar la opción Mayo spicy' }),
    );
    expect(await screen.findByText('Mayo spicy desactivada')).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Desactivar la opción Ponzu' }),
    );
    expect(
      await within(dialog).findByText(/quedaría con menos opciones activas que su mínimo/),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Desactivar la opción Ponzu' }),
    ).toBeEnabled();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Activar la opción Mayo spicy' }),
    );
    expect(await screen.findByText('Mayo spicy activada')).toBeVisible();
  });

  it('503 MODIFIERS_BUSY al cambiar una opción: mensaje fijo y el reintento funciona', async () => {
    const { api } = await renderScreen(<ModifiersScreen />);
    const dialog = await openOptions();
    api().store.modifiersBusy = 1;
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Desactivar la opción Aguacate' }),
    );
    expect(await within(dialog).findByText(BUSY)).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Desactivar la opción Aguacate' }),
    );
    expect(await screen.findByText('Aguacate desactivada')).toBeVisible();
  });

  it('reordena con subir/bajar: anuncia en vivo, conserva el foco y respeta los extremos', async () => {
    await renderScreen(<ModifiersScreen />);
    const dialog = await openOptions();
    const names = () =>
      within(within(dialog).getByRole('list', { name: 'Opciones del grupo' }))
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.cell-main')?.textContent);
    expect(names()).toEqual(['Queso crema', 'Aguacate', 'Salsa extra', 'Crunch de tempura']);
    expect(within(dialog).getByRole('button', { name: 'Subir Queso crema' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Bajar Crunch de tempura' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bajar Queso crema' }));
    await waitFor(() => expect(names()[1]).toBe('Queso crema'));
    expect(within(dialog).getByRole('status', { name: '' })).toBeDefined();
    expect(
      await within(dialog).findByText('Queso crema movida a la posición 2 de 4'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Bajar Queso crema' })).toHaveFocus(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir Queso crema' }));
    await waitFor(() => expect(names()[0]).toBe('Queso crema'));
    // Al llegar al extremo el botón se deshabilita y el foco pasa al contrario.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Bajar Queso crema' })).toHaveFocus(),
    );
  });
});

describe('Extras F12: asociar grupos a un producto (editor de producto)', () => {
  const openEditor = async (name: string, role: StaffRole = 'admin') => {
    resetNavigationMock('/backoffice/productos');
    const rendered = await renderScreen(<ProductsScreen />, role);
    await screen.findByText('Dumplings');
    // La lista es paginada (20 por página): se busca el producto para no depender de la página.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), name);
    await screen.findByText(name);
    await userEvent.click(screen.getByRole('button', { name: `Editar ${name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar producto' });
    const list = await within(dialog)
      .findByRole('list', { name: 'Grupos de extras del producto' })
      .catch(() => null);
    return { dialog, list, rendered };
  };

  it('muestra los grupos asociados con su regla y permite añadir, ordenar, quitar y guardar (PUT reemplaza)', async () => {
    const { dialog, rendered } = await openEditor('Sushi Pizza');
    const list = within(dialog).getByRole('list', { name: 'Grupos de extras del producto' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.cell-main')?.textContent),
    ).toEqual(['Salsa', 'Extras']);
    expect(within(dialog).getByRole('button', { name: 'Guardar extras' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir el grupo Extras' }));
    expect(
      await within(dialog).findByText('Extras movido a la posición 1 de 2 (sin guardar)'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar el grupo Salsa' }));
    expect(within(dialog).getByRole('button', { name: 'Guardar extras' })).toBeEnabled();
    // Solo grupos ACTIVOS no asociados: «Salsa» vuelve a la lista; «Bebida del combo» (inactivo) nunca.
    const select = within(dialog).getByRole('combobox', { name: 'Grupo de extras a agregar' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Elige un grupo…', 'Salsa']);
    await userEvent.selectOptions(select, 'Salsa');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar grupo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar extras' }));
    expect(await screen.findByText('Extras del producto guardados')).toBeVisible();
    await waitFor(() =>
      expect(rendered.api().store.productModifierGroups['sushi-pizza']).toEqual([
        'mgroup-extras',
        'mgroup-salsa',
      ]),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Guardar extras' })).toBeDisabled(),
    );
  });

  it('añade un grupo a un producto sin extras y respeta el máximo de 10', async () => {
    const { dialog, rendered } = await openEditor('Dumplings');
    expect(within(dialog).getByText('Este producto no tiene grupos de extras.')).toBeVisible();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Grupo de extras a agregar' }),
      'Extras',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar grupo' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar extras' }));
    expect(await screen.findByText('Extras del producto guardados')).toBeVisible();
    expect(rendered.api().store.productModifierGroups.dumplings).toEqual(['mgroup-extras']);
    expect(within(dialog).getByText('1/10')).toBeVisible();
  });

  it('errores por code: 503 MODIFIERS_BUSY reintentable y 422 MODIFIER_GROUP_INVALID (grupo desactivado en otra sesión)', async () => {
    const { dialog, rendered } = await openEditor('Dumplings');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Grupo de extras a agregar' }),
      'Salsa',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar grupo' }));
    rendered.api().store.modifiersBusy = 1;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar extras' }));
    expect(await within(dialog).findByText(BUSY)).toBeVisible();
    rendered.api().store.modifierGroups.find((g) => g.id === 'mgroup-salsa')!.active = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar extras' }));
    expect(
      await within(dialog).findByText(/Algún grupo ya no existe o está inactivo/),
    ).toBeVisible();
  });

  it('sin alcance global: solo lectura con aviso y controles deshabilitados', async () => {
    resetNavigationMock('/backoffice/productos');
    await renderScreen(<ProductsScreen />, 'manager', 'default', (store) => {
      const role = store.roles.find((r) => r.code === 'manager')!;
      role.permissions = [...role.permissions, 'catalog.update'];
    });
    await screen.findByText('Dumplings');
    // El botón de editar está deshabilitado sin alcance global (no se puede abrir el editor).
    expect(screen.getByRole('button', { name: 'Editar Dumplings' })).toBeDisabled();
  });
});
