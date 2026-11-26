import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import type { StaffRole } from '@/lib/data-access/models';
import type { MockScenario } from '@/mocks/scenarios';
import type { MockStore } from '@/mocks/store';
import { listStoreCategories } from '@/services/categories';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { CategoriesScreen } from './components/CategoriesScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

beforeEach(() => resetNavigationMock('/backoffice/categorias'));

const renderScreen = (
  role: StaffRole = 'admin',
  scenario: MockScenario = 'default',
  prepareStore?: (store: MockStore) => void,
) =>
  renderBackoffice(
    <BackofficeShell>
      <CategoriesScreen />
    </BackofficeShell>,
    { role, scenario, prepareStore },
  );

const rows = () =>
  screen
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.cname')?.textContent)
    .filter(Boolean);
const rowOf = (name: string) =>
  screen.getByText(name, { selector: '.cname' }).closest('[role="listitem"]') as HTMLElement;
const ready = () => screen.findByText('Entradas', { selector: '.cname' });

describe('Categorías (F10): árbol y estados', () => {
  it('lista el árbol indentado con nivel, slug y estado efectivo (incluye inactivas y ocultas por ancestro)', async () => {
    await renderScreen();
    await ready();
    expect(rows()).toEqual([
      'Entradas',
      'Monchis',
      'Sushi Rolls',
      'Rolls fríos',
      'Rolls tempura',
      'Bebidas espirituosas',
      'Bebidas relax',
      'Postres',
      'Temporada',
      'Edición limitada',
    ]);
    expect(rowOf('Sushi Rolls')).toHaveAttribute('data-depth', '1');
    expect(rowOf('Rolls fríos')).toHaveAttribute('data-depth', '2');
    expect(within(rowOf('Rolls fríos')).getByText('rolls-frios')).toBeVisible();
    expect(rowOf('Rolls fríos')).toHaveTextContent('Nivel 2 · dentro de Sushi Rolls');
    expect(within(rowOf('Sushi Rolls')).getByText('Visible en la web')).toBeVisible();
    expect(within(rowOf('Temporada')).getByText('Inactiva')).toBeVisible();
    // Activa pero oculta porque su padre está inactivo.
    expect(within(rowOf('Edición limitada')).getByText('Oculta: padre inactivo')).toBeVisible();
  });

  it('estado vacío con invitación a crear', async () => {
    await renderScreen('admin', 'empty');
    expect(await screen.findByText('Todavía no hay categorías.')).toBeVisible();
    expect(screen.getByText(/Crea la primera/)).toBeVisible();
  });

  it('error: aviso con "Reintentar"', async () => {
    await renderScreen('admin', 'error');
    const alert = await screen.findByText('No se pudieron cargar las categorías.');
    expect(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: 'Reintentar',
      }),
    ).toBeVisible();
  });

  it('403 del servidor: pantalla de acceso denegado', async () => {
    await renderScreen('admin', 'forbidden');
    expect(await screen.findByRole('heading', { name: /acceso|permiso/i })).toBeVisible();
  });
});

describe('Categorías (F10): permisos de la sesión', () => {
  it('el encargado (catalog.read por sucursal) ve el árbol, pero todas las acciones de escritura están deshabilitadas con aviso', async () => {
    await renderScreen('manager');
    await ready();
    expect(screen.getByText(/Solo lectura/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nueva categoría' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Entradas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desactivar Entradas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eliminar Entradas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Agregar subcategoría a Entradas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar Entradas' })).toBeDisabled();
  });

  it('con catalog.create/update pero SIN alcance global las acciones siguen deshabilitadas y se explica por qué', async () => {
    await renderScreen('manager', 'default', (store) => {
      store.roles
        .find((r) => r.code === 'manager')!
        .permissions.push('catalog.create', 'catalog.update');
    });
    await ready();
    expect(screen.getByText(/necesitas acceso a todas las sucursales/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nueva categoría' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Entradas' })).toBeDisabled();
  });

  it('el administrador (alcance global) puede actuar y no ve avisos de permisos', async () => {
    await renderScreen('admin');
    await ready();
    expect(screen.queryByText(/Solo lectura/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Nueva categoría' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar Entradas' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Eliminar Entradas' })).toBeEnabled();
  });

  it('si el permiso se revoca en el servidor tras cargar, el 403 se explica sin cerrar el diálogo', async () => {
    const user = userEvent.setup();
    const view = await renderScreen('admin');
    await ready();
    view.api().store.roles.find((r) => r.code === 'admin')!.permissions = ['catalog.read'];
    await user.click(screen.getByRole('button', { name: 'Desactivar Entradas' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(
      await within(dialog).findByText(/No tienes permiso para modificar categorías/),
    ).toBeVisible();
  });
});

describe('Categorías (F10): crear y editar', () => {
  it('crea una categoría raíz (slug autogenerado) al final del nivel y avisa', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Nueva categoría' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' });
    await user.type(within(dialog).getByLabelText('Nombre'), 'Bowls Poke');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(
      await screen.findByText('Categoría «Bowls Poke» creada al final de su nivel'),
    ).toBeVisible();
    await waitFor(() => expect(rowOf('Bowls Poke')).toBeVisible());
    expect(within(rowOf('Bowls Poke')).getByText('bowls-poke')).toBeVisible();
    // Raíces: la nueva queda después de "Temporada" y antes de sus hijos? No: depth-first => tras la última raíz y su subárbol.
    expect(rows().at(-1)).toBe('Bowls Poke');
  });

  it('valida el nombre en el cliente: error asociado al campo y foco', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Nueva categoría' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    const name = within(dialog).getByLabelText('Nombre');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(/Escribe un nombre de 1 a 80/)).toBeVisible();
  });

  it('crea una subcategoría desde la fila del padre', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Agregar subcategoría a Entradas' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Categoría padre')).toHaveValue('cat-entradas');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Frías');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(rowOf('Frías')).toHaveAttribute('data-depth', '2'));
  });

  it('el botón de subcategoría se deshabilita en el nivel 3 y en categorías inactivas', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    expect(screen.getByRole('button', { name: 'Agregar subcategoría a Temporada' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Agregar subcategoría a Rolls tempura' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Especial');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(rowOf('Especial')).toHaveAttribute('data-depth', '3'));
    expect(screen.getByRole('button', { name: 'Agregar subcategoría a Especial' })).toBeDisabled();
  });

  it('409 CATEGORY_SLUG_TAKEN: mensaje por campo y en aviso, el diálogo sigue abierto con lo escrito', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Nueva categoría' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Otra de rolls');
    await user.type(within(dialog).getByLabelText('Slug (URL)'), 'rolls');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(await within(dialog).findByText('Este slug ya está en uso.')).toBeVisible();
    expect(within(dialog).getByLabelText('Slug (URL)')).toHaveFocus();
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Otra de rolls');
    // Corrige el slug y guarda.
    await user.clear(within(dialog).getByLabelText('Slug (URL)'));
    await user.type(within(dialog).getByLabelText('Slug (URL)'), 'otra-de-rolls');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(rowOf('Otra de rolls')).toBeVisible());
  });

  it('edita nombre, slug y descripción', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Editar Monchis' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar categoría' });
    const name = within(dialog).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Monchis y más');
    await user.type(within(dialog).getByLabelText('Descripción (opcional)'), 'Para picar');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Categoría «Monchis y más» actualizada')).toBeVisible();
    await waitFor(() => expect(rowOf('Monchis y más')).toBeVisible());
    expect(within(rowOf('Monchis y más')).getByText('Para picar')).toBeVisible();
  });

  it('sin cambios no llama a la API y lo avisa', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Editar Monchis' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('No hay cambios que guardar')).toBeVisible();
  });

  it('mueve una categoría a otro padre (el selector excluye ella y sus descendientes)', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Editar Sushi Rolls' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText('Categoría padre');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).not.toContain('Sushi Rolls');
    expect(options).not.toContain('— Rolls fríos');
    expect(options).not.toContain('Temporada'); // inactiva
    await user.selectOptions(select, 'cat-postres');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(rowOf('Sushi Rolls')).toHaveAttribute('data-depth', '2'));
    expect(rowOf('Rolls fríos')).toHaveAttribute('data-depth', '3');
  });

  it('CICLO BLOQUEADO (422 CATEGORY_CYCLE): otra sesión movió a la hija; el servidor lo rechaza y la jerarquía no cambia', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    // La vista (obsoleta) aún muestra "Rolls fríos" como hermana de "Rolls tempura": ofrece moverla bajo ella.
    // En el servidor otra persona ya la había metido dentro de "Rolls tempura": sería un ciclo.
    view.api().store.menuCategories.find((c) => c.id === 'cat-rolls-frios')!.parentId =
      'cat-rolls-tempura';
    await user.click(screen.getByRole('button', { name: 'Editar Rolls tempura' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Categoría padre'), 'cat-rolls-frios');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await within(dialog).findByText(/No puedes mover una categoría dentro de sí misma/),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/Elige otra categoría padre: esta crearía un ciclo/),
    ).toBeVisible();
    expect(
      view.api().store.menuCategories.find((c) => c.id === 'cat-rolls-tempura')!.parentId,
    ).toBe('cat-rolls');
  });

  it('422 CATEGORY_DEPTH_EXCEEDED: otra sesión profundizó el árbol; se explica el límite de 3 niveles', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    view.api().store.menuCategories.find((c) => c.id === 'cat-rolls')!.parentId = 'cat-entradas';
    await user.click(screen.getByRole('button', { name: 'Agregar subcategoría a Rolls fríos' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Demasiado profunda');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(await within(dialog).findByText(/hasta 3 niveles|máximo 3 niveles/i)).toBeVisible();
    expect(within(dialog).getByText(/Superaría los 3 niveles/)).toBeVisible();
  });

  it('422 CATEGORY_PARENT_INVALID: el padre se desactivó en otra sesión; avisa y recarga', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Agregar subcategoría a Postres' }));
    const dialog = await screen.findByRole('dialog');
    view.api().store.menuCategories.find((c) => c.id === 'cat-postres')!.active = false;
    await user.type(within(dialog).getByLabelText('Nombre'), 'Helados');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(await within(dialog).findByText(/ya no existe o está desactivada/)).toBeVisible();
    expect(within(dialog).getByText('Elige una categoría padre activa.')).toBeVisible();
  });
});

describe('Categorías (F10): activar y desactivar con confirmación', () => {
  it('desactiva un padre: explica el efecto, oculta el subárbol (hijos activos pero ocultos) y la tienda deja de publicarlo', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Desactivar Sushi Rolls' }));
    const dialog = await screen.findByRole('dialog', { name: /Desactivar «Sushi Rolls»/ });
    expect(within(dialog).getByText(/y sus 2 subcategorías dejarán de verse/)).toBeVisible();
    expect(within(dialog).getByText('Estado actual: Visible en la web')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('«Sushi Rolls» desactivada')).toBeVisible();
    await waitFor(() => expect(within(rowOf('Sushi Rolls')).getByText('Inactiva')).toBeVisible());
    expect(within(rowOf('Rolls fríos')).getByText('Oculta: padre inactivo')).toBeVisible();
    const tree = await listStoreCategories(view.api().client);
    expect(JSON.stringify(tree)).not.toContain('rolls-frios');
    expect(tree.items.map((c) => c.slug)).not.toContain('rolls');
  });

  it('cancelar no cambia nada; activar bajo un padre inactivo advierte que seguirá oculta', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Desactivar Monchis' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Volver' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowOf('Monchis')).getByText('Visible en la web')).toBeVisible();

    // "Edición limitada" está activa bajo "Temporada" (inactiva): se desactiva y vuelve a activar con aviso.
    await user.click(screen.getByRole('button', { name: 'Desactivar Edición limitada' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }),
    );
    await waitFor(() =>
      expect(within(rowOf('Edición limitada')).getByText('Inactiva')).toBeVisible(),
    );
    await user.click(screen.getByRole('button', { name: 'Activar Edición limitada' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/seguirá oculta en la web mientras «Temporada» esté inactiva/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Activar' }));
    await waitFor(() =>
      expect(within(rowOf('Edición limitada')).getByText('Oculta: padre inactivo')).toBeVisible(),
    );
  });
});

describe('Categorías (ADR-0034): eliminar', () => {
  it('confirma con foco en «Cancelar», explica que es permanente, elimina, avisa y devuelve el foco al título', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Eliminar Rolls fríos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eliminar «Rolls fríos»' });
    expect(within(dialog).getByText(/de forma permanente/)).toBeVisible();
    expect(within(dialog).getByText(/no tiene subcategorías, productos ni banners/)).toBeVisible();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }));
    expect(await screen.findByText('Categoría «Rolls fríos» eliminada')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText('Rolls fríos', { selector: '.cname' })).toBeNull(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Categorías', level: 1 })).toHaveFocus(),
    );
    const admin = await view
      .api()
      .client.get<{ items: { slug: string }[] }>('/v1/admin/categories');
    expect(admin.items.map((c) => c.slug)).not.toContain('rolls-frios');
  });

  it('cancelar no borra nada', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Eliminar Postres' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowOf('Postres')).toBeVisible();
  });

  it('409 CATEGORY_IN_USE: no se cierra, explica con conteos (singular/plural, sin ceros) y ofrece «Desactivar en su lugar»', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Eliminar Postres' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'No se puede eliminar «Postres» porque está en uso: 1 producto.',
    );
    expect(rowOf('Postres')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Desactivar en su lugar' }));
    expect(await screen.findByText('«Postres» desactivada')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(within(rowOf('Postres')).getByText('Inactiva')).toBeVisible());
  });

  it('409 con subcategorías y productos los lista juntos', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Eliminar Sushi Rolls' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /está en uso: 2 subcategorías y \d+ productos\./,
    );
  });

  it('en una categoría ya inactiva en uso no se ofrece desactivar', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Eliminar Temporada' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('1 subcategoría.');
    expect(within(dialog).queryByRole('button', { name: 'Desactivar en su lugar' })).toBeNull();
  });

  it('404: la categoría ya no existe; avisa, recarga y cierra', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Eliminar Rolls fríos' }));
    const dialog = await screen.findByRole('dialog');
    const store = view.api().store;
    store.menuCategories = store.menuCategories.filter((c) => c.id !== 'cat-rolls-frios');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }));
    expect(await screen.findByText(/La categoría ya no existe/)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.queryByText('Rolls fríos', { selector: '.cname' })).toBeNull(),
    );
  });

  it('403 si el permiso se revoca tras cargar: se explica en el diálogo sin cerrarlo', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    view.api().store.roles.find((r) => r.code === 'admin')!.permissions = ['catalog.read'];
    await user.click(screen.getByRole('button', { name: 'Eliminar Rolls fríos' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar categoría' }));
    expect(
      await within(dialog).findByText(/No tienes permiso para modificar categorías/),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Eliminar categoría' })).toBeEnabled();
  });
});

describe('Categorías (F10): reordenar entre hermanos', () => {
  it('sube y baja con el teclado, anuncia el cambio, conserva el foco y el orden persiste', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    const up = screen.getByRole('button', { name: 'Subir Entradas' });
    expect(up).toBeDisabled();
    const down = screen.getByRole('button', { name: 'Bajar Entradas' });
    down.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(rows().slice(0, 2)).toEqual(['Monchis', 'Entradas']));
    expect(screen.getByText('Entradas ahora está en la posición 2 de 7')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Bajar Entradas' })).toHaveFocus(),
    );
    const roots = view
      .api()
      .store.menuCategories.filter((c) => c.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(roots.map((c) => c.sortOrder)).toEqual(roots.map((_, i) => i));
    await user.click(screen.getByRole('button', { name: 'Subir Entradas' }));
    await waitFor(() => expect(rows().slice(0, 2)).toEqual(['Entradas', 'Monchis']));
  });

  it('reordena solo dentro del mismo padre y con los extremos deshabilitados', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await ready();
    expect(screen.getByRole('button', { name: 'Subir Rolls fríos' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar Rolls tempura' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Bajar Rolls fríos' }));
    await waitFor(() =>
      expect(rows().slice(2, 5)).toEqual(['Sushi Rolls', 'Rolls tempura', 'Rolls fríos']),
    );
  });

  it('422 CATEGORY_REORDER_MISMATCH: otra sesión agregó una hermana; avisa, recarga y deja volver a ordenar', async () => {
    const user = userEvent.setup();
    const view = await renderScreen();
    await ready();
    const store = view.api().store;
    store.menuCategories.push({
      ...store.menuCategories[0]!,
      id: 'cat-nueva',
      slug: 'nueva',
      name: 'Nueva ajena',
      sortOrder: 99,
    });
    await user.click(screen.getByRole('button', { name: 'Bajar Entradas' }));
    expect(
      await screen.findByText(/Otra persona cambió las categorías de este nivel/),
    ).toBeVisible();
    await waitFor(() => expect(rowOf('Nueva ajena')).toBeVisible());
    expect(rows().slice(0, 2)).toEqual(['Entradas', 'Monchis']);
  });
});
