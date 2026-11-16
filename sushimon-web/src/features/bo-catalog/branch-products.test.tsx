import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { ProductsScreen } from './components/ProductsScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/productos'));

type Prepare = NonNullable<Parameters<typeof renderBackoffice>[1]>['prepareStore'];

const renderScreen = (role: StaffRole = 'admin', prepareStore?: Prepare) =>
  renderBackoffice(
    <BackofficeShell>
      <ProductsScreen />
    </BackofficeShell>,
    { role, prepareStore },
  );

async function openBranches(name: string) {
  await screen.findByText('Dumplings');
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar producto' }), name);
  await screen.findByRole('button', {
    name: `Sucursales de ${name}: precio y disponibilidad`,
  });
  await userEvent.click(
    screen.getByRole('button', { name: `Sucursales de ${name}: precio y disponibilidad` }),
  );
  const dialog = await screen.findByRole('dialog', { name: `Sucursales · ${name}` });
  await within(dialog).findByText('Sucursal 1');
  return dialog;
}

const rowOf = (dialog: HTMLElement, branch: string) =>
  within(dialog).getByText(branch).closest('li') as HTMLElement;
const effective = (row: HTMLElement) => within(row).getByTestId('effective-price');

describe('F13 backoffice · sección «Sucursales» de un producto', () => {
  it('administrador: una fila por sucursal con base, precio especial, efectivo y disponibilidad', async () => {
    await renderScreen('admin');
    const dialog = await openBranches('Dynamita Roll');
    const s2 = rowOf(dialog, 'Sucursal 2');
    expect(effective(s2)).toHaveTextContent('Q86.00');
    expect(within(s2).getByLabelText('Sucursal 2: precio especial')).toHaveValue('86.00');
    expect(within(s2).getByText('Q82.00')).toBeVisible(); // precio base
    expect(effective(rowOf(dialog, 'Sucursal 1'))).toHaveTextContent('Q82.00');
    // Incluye sucursales inactivas dentro del alcance global.
    expect(within(rowOf(dialog, 'Sucursal 5')).getByText('Sucursal inactiva')).toBeVisible();
    // Sin stock numérico: solo disponible/agotado.
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/existencias|unidades/i)).not.toBeInTheDocument();
  });

  it('fija un precio especial, lo refleja y «Quitar precio especial» vuelve al base', async () => {
    await renderScreen('admin');
    const dialog = await openBranches('Dynamita Roll');
    const s1 = rowOf(dialog, 'Sucursal 1');
    await userEvent.type(within(s1).getByLabelText('Sucursal 1: precio especial'), '90,5');
    await userEvent.click(
      within(s1).getByRole('button', { name: 'Sucursal 1: guardar precio especial' }),
    );
    expect(await screen.findByText('Precio especial guardado: Sucursal 1')).toBeVisible();
    await waitFor(() => expect(effective(rowOf(dialog, 'Sucursal 1'))).toHaveTextContent('Q90.50'));
    const clear = within(rowOf(dialog, 'Sucursal 1')).getByRole('button', {
      name: 'Sucursal 1: quitar precio especial',
    });
    await userEvent.click(clear);
    await waitFor(() => expect(effective(rowOf(dialog, 'Sucursal 1'))).toHaveTextContent('Q82.00'));
    expect(
      within(rowOf(dialog, 'Sucursal 1')).getByLabelText('Sucursal 1: precio especial'),
    ).toHaveValue('');
  });

  it('valida en el cliente: 0 y formas inválidas no se envían y muestran el mensaje', async () => {
    await renderScreen('admin');
    const dialog = await openBranches('Dynamita Roll');
    const s1 = rowOf(dialog, 'Sucursal 1');
    const input = within(s1).getByLabelText('Sucursal 1: precio especial');
    await userEvent.type(input, '0');
    await userEvent.click(
      within(s1).getByRole('button', { name: 'Sucursal 1: guardar precio especial' }),
    );
    expect(await within(s1).findByRole('alert')).toHaveTextContent('mayor a 0');
    await userEvent.clear(input);
    await userEvent.type(input, '12.345');
    await userEvent.keyboard('{Enter}');
    expect(await within(s1).findByRole('alert')).toHaveTextContent('importe válido');
    expect(effective(s1)).toHaveTextContent('Q82.00');
  });

  it('503 BRANCH_PRODUCTS_BUSY: mensaje fijo reintentable; el segundo intento guarda', async () => {
    await renderScreen('admin', (store) => {
      store.branchProductsBusy = 1;
    });
    const dialog = await openBranches('Dynamita Roll');
    const s1 = rowOf(dialog, 'Sucursal 1');
    await userEvent.type(within(s1).getByLabelText('Sucursal 1: precio especial'), '90');
    const save = within(s1).getByRole('button', { name: 'Sucursal 1: guardar precio especial' });
    await userEvent.click(save);
    expect(await within(s1).findByRole('alert')).toHaveTextContent(
      'Hay otra edición en curso. Espera un momento y reintenta.',
    );
    await userEvent.click(save);
    await waitFor(() => expect(effective(rowOf(dialog, 'Sucursal 1'))).toHaveTextContent('Q90.00'));
  });

  it('404 BRANCH_NOT_FOUND (alcance revocado tras abrir): mensaje claro y se recarga', async () => {
    const view = await renderScreen('admin');
    const dialog = await openBranches('Dynamita Roll');
    // Otra sesión desactiva y retira la sucursal del servidor: simulamos 404 quitándola del store.
    view.api().store.branches = view.api().store.branches.filter((b) => b.id !== 'sucursal-3');
    const s3 = rowOf(dialog, 'Sucursal 3');
    await userEvent.type(within(s3).getByLabelText('Sucursal 3: precio especial'), '90');
    await userEvent.click(
      within(s3).getByRole('button', { name: 'Sucursal 3: guardar precio especial' }),
    );
    expect(await within(s3).findByRole('alert')).toHaveTextContent('no existe o no tienes acceso');
  });

  it('el interruptor marca agotado y disponible; afecta a «Ofertado»', async () => {
    await renderScreen('admin');
    const dialog = await openBranches('Dynamita Roll');
    const s1 = rowOf(dialog, 'Sucursal 1');
    expect(within(s1).getByText('Ofertado')).toBeVisible();
    await userEvent.click(within(s1).getByRole('switch', { name: 'Disponible: Sucursal 1' }));
    expect(await screen.findByText('Sucursal 1 marcado como agotado')).toBeVisible();
    await waitFor(() =>
      expect(within(rowOf(dialog, 'Sucursal 1')).getByText('No ofertado')).toBeVisible(),
    );
    await userEvent.click(
      within(rowOf(dialog, 'Sucursal 1')).getByRole('switch', { name: 'Disponible: Sucursal 1' }),
    );
    await waitFor(() =>
      expect(within(rowOf(dialog, 'Sucursal 1')).getByText('Ofertado')).toBeVisible(),
    );
  });

  it('un encargado acotado solo ve SU sucursal', async () => {
    await renderScreen('manager');
    const dialog = await openBranches('Dynamita Roll');
    expect(within(dialog).getByText('Sucursal 1')).toBeVisible();
    expect(within(dialog).queryByText('Sucursal 2')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Sucursal 3')).not.toBeInTheDocument();
  });

  it('el editor de producto (solo editar) incluye la sección «Sucursales»; el alta no', async () => {
    await renderScreen('admin');
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    const create = await screen.findByRole('dialog', { name: 'Nuevo producto' });
    expect(within(create).queryByRole('heading', { name: 'Sucursales' })).not.toBeInTheDocument();
    await userEvent.click(within(create).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar Dumplings' }));
    const edit = await screen.findByRole('dialog', { name: 'Editar producto' });
    expect(await within(edit).findByRole('heading', { name: 'Sucursales' })).toBeVisible();
    expect(await within(edit).findByLabelText('Sucursal 1: precio especial')).toBeVisible();
  });
});

describe('F13 backoffice · vista «Por sucursal» (matriz)', () => {
  async function openMatrix(role: StaffRole = 'admin') {
    await renderScreen(role);
    await screen.findByText('Dumplings');
    await userEvent.click(screen.getByRole('button', { name: 'Por sucursal' }));
    return screen.findByRole('list', { name: 'Productos de la sucursal' });
  }

  it('lista paginada de una sucursal con base, especial y disponibilidad; ofrece el selector de sucursal', async () => {
    const list = await openMatrix();
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByText('Página 1 de 2 · 31 productos')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Sucursal' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2 · 31 productos')).toBeVisible();
  });

  it('filtra «Solo con precio especial», disponibilidad y texto; cambia de sucursal', async () => {
    await openMatrix();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sucursal' }), 'sucursal-2');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Solo con precio especial' }));
    const list = await screen.findByRole('list', { name: 'Productos de la sucursal' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list).getByText('Dynamita Roll')).toBeVisible();
    expect(within(list).getByTestId('effective-price')).toHaveTextContent('Q86.00');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Solo con precio especial' }));
    await userEvent.click(screen.getByRole('button', { name: 'Agotado' }));
    await waitFor(() => {
      const items = within(
        screen.getByRole('list', { name: 'Productos de la sucursal' }),
      ).getAllByRole('listitem');
      expect(items).toHaveLength(1);
    });
    expect(screen.getByText('Gaseosas')).toBeVisible();
  });

  it('edición en línea del precio especial y de la disponibilidad', async () => {
    await openMatrix();
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar producto en la sucursal' }),
      'dumplings',
    );
    const row = (await screen.findByText('Dumplings')).closest('li') as HTMLElement;
    await userEvent.type(within(row).getByLabelText('Dumplings: precio especial'), '49');
    await userEvent.click(
      within(row).getByRole('button', { name: 'Dumplings: guardar precio especial' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByText('Dumplings').closest('li') as HTMLElement).getByTestId(
          'effective-price',
        ),
      ).toHaveTextContent('Q49.00'),
    );
    await userEvent.click(
      within(screen.getByText('Dumplings').closest('li') as HTMLElement).getByRole('switch', {
        name: 'Disponible: Dumplings',
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByText('Dumplings').closest('li') as HTMLElement).getByRole('switch', {
          name: 'Disponible: Dumplings',
        }),
      ).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('el encargado: sucursal fija, precio de solo lectura y disponibilidad editable', async () => {
    await openMatrix('manager');
    expect(screen.getByRole('combobox', { name: 'Sucursal' })).toBeDisabled();
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Buscar producto en la sucursal' }),
      'dumplings',
    );
    const row = (await screen.findByText('Dumplings')).closest('li') as HTMLElement;
    expect(within(row).getByLabelText('Dumplings: precio especial')).toBeDisabled();
    expect(within(row).getByRole('switch', { name: 'Disponible: Dumplings' })).toBeEnabled();
  });
});
